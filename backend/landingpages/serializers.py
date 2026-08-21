from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils.text import slugify
from rest_framework import serializers

from .models import LandingPageProject, LandingPageVersion, ValidationIssue, ValidationReport
from .validation.profiles import (
    DEFAULT_CSS_SOURCE_TYPE,
    DEFAULT_PROFILE,
    DEFAULT_SCOPE,
    CssSourceType,
    ValidationProfile,
    ValidationScope,
)

# Bounds the retry loop below — collisions beyond this depth (two concurrent
# requests both retrying the *same* suffix repeatedly) are vanishingly
# unlikely for a per-user slug space and would otherwise retry forever.
_MAX_SLUG_ATTEMPTS = 10

# Enforced here (a clean 400) rather than deep inside the validation engine,
# so an oversized request never even reaches adapter code.
MAX_SOURCE_LENGTH = 200_000


class LandingPageProjectSerializer(serializers.ModelSerializer):
    """`user` is never a writable field here — the view always sets it
    from `request.user` (see views.py::LandingPageProjectViewSet), never
    from client input, so a project can never be created (or reassigned)
    to a different owner than the authenticated caller."""

    class Meta:
        model = LandingPageProject
        fields = ['id', 'name', 'slug', 'type', 'status', 'framework', 'created_at', 'updated_at']
        read_only_fields = ['id', 'slug', 'created_at', 'updated_at']

    def validate_type(self, value):
        # Writable on create (a new project must declare its type), but
        # immutable afterwards — self.instance is only set on update, never
        # on create, so this only fires for PATCH/PUT.
        if self.instance is not None and self.instance.type != value:
            raise serializers.ValidationError('Landing page type cannot be changed after creation.')
        return value

    def create(self, validated_data):
        user = self.context['request'].user
        base_slug = slugify(validated_data['name'])[:220] or 'landing-page'
        slug = base_slug
        suffix = 1
        for _attempt in range(_MAX_SLUG_ATTEMPTS):
            try:
                with transaction.atomic():
                    return LandingPageProject.objects.create(user=user, slug=slug, **validated_data)
            except IntegrityError:
                # The unique (user, slug) constraint — not a pre-check — is
                # what actually resolves the race: two concurrent requests
                # for the same name can both pass an .exists() check, but
                # only one INSERT wins, and the loser retries with the next
                # suffix instead of ever raising an unhandled 500.
                suffix += 1
                suffix_text = f'-{suffix}'
                slug = f'{base_slug[: 220 - len(suffix_text)]}{suffix_text}'
        raise IntegrityError('Could not generate a unique slug for this landing page project.')


class LandingPageVersionSerializer(serializers.ModelSerializer):
    """Save/Download closure sprint. Metadata only — never exposes storage
    paths (an implementation detail, and a potential path-disclosure) or
    raw content (see LoadLandingPageVersionView for the read-back path,
    which returns actual source text separately)."""

    class Meta:
        model = LandingPageVersion
        fields = ['id', 'project', 'version_number', 'css_source_type', 'created_at']
        read_only_fields = fields


class SaveLandingPageVersionRequestSerializer(serializers.Serializer):
    """Input contract for POST /api/v1/lp/projects/save/. Deliberately
    permissive about which language fields are populated — Save persists
    whatever is currently in the editor, including a mid-edit, not-yet-
    valid, or partially-empty state (never rejects for content reasons
    the way ValidateRequestSerializer does for `html`). `project` is a
    plain integer id, not a PrimaryKeyRelatedField, for the identical
    ownership-scoping reason as ValidateRequestSerializer.project — see
    views.py::_resolve_validate_project."""

    html = serializers.CharField(allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH)
    css = serializers.CharField(allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH)
    js = serializers.CharField(allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH)
    ampscript = serializers.CharField(allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH)
    css_source_type = serializers.ChoiceField(choices=CssSourceType.choices, required=False, default=DEFAULT_CSS_SOURCE_TYPE)
    project = serializers.IntegerField(required=False, allow_null=True, default=None)
    # Only used (and required) when `project` is omitted — naming a brand
    # new project. Ignored when saving a NEW version of an existing one
    # (a project's name/slug are changed via LandingPageProjectViewSet's
    # own update endpoint, not silently overwritten by Save).
    name = serializers.CharField(required=False, allow_blank=True, default='', max_length=200)

    def validate(self, data):
        if data['project'] is None and not data['name'].strip():
            raise serializers.ValidationError({'name': ['A name is required to save a new landing page project.']})
        if not any([data['html'].strip(), data['css'].strip(), data['js'].strip(), data['ampscript'].strip()]):
            raise serializers.ValidationError({'html': ['Enter some code before saving.']})
        return data


class ValidationIssueSerializer(serializers.ModelSerializer):
    """Exposes the Sprint 1C unified schema. `language`/`start_line`/
    `start_column`/`fixable` are additive aliases of `file`/`line`/
    `column`/`auto_fixable` (declared via `source=`, same underlying model
    columns) — the Sprint 1A/1B field names stay present and unchanged so
    the existing frontend keeps working without modification."""

    start_line = serializers.IntegerField(source='line', read_only=True)
    start_column = serializers.IntegerField(source='column', read_only=True)
    fixable = serializers.BooleanField(source='auto_fixable', read_only=True)
    profile = serializers.SerializerMethodField()

    class Meta:
        model = ValidationIssue
        fields = [
            'id', 'fingerprint', 'language', 'source_engine', 'engine_version', 'profile',
            'rule_id', 'standards_reference', 'category', 'severity', 'confidence',
            'message', 'suggestion', 'start_line', 'start_column', 'end_line', 'end_column',
            'code_excerpt', 'fixable', 'fix_type', 'deterministic_fix', 'requires_manual_review',
            'related_element', 'related_attribute',
            # Sprint CSS-A — where an embedded-CSS finding actually came
            # from (e.g. 'html-inline-style', 'html-style-block'); blank
            # for every issue produced before this sprint.
            'source_context', 'source_block_index',
            # Sprint CSS-B — resolved local-asset storage path, when applicable.
            'source_asset_id',
            # Sprint CSS-C — position in SCSS/Sass's generated CSS, before
            # mapping back to the original source; null otherwise.
            'generated_start_line', 'generated_start_column',
            # AI Engineer full-source-analysis sprint — reasoning/evidence/
            # cross_language/verifiable/chunk metadata; null for every
            # issue no AI Engineer pass ever touched. See
            # validation/schema.py::ValidationIssueData.ai_metadata.
            'ai_metadata',
            # Tool-Grounded AI Engineer sprint — structured diagnostics
            # contract's root-cause grouping; empty string means none.
            'root_cause_id',
            # Sprint 1A/1B compatibility — unchanged field names/values.
            'file', 'line', 'column', 'auto_fixable', 'risk',
        ]
        read_only_fields = fields

    def get_profile(self, obj) -> str:
        return obj.report.profile


class ValidationReportSerializer(serializers.ModelSerializer):
    issues = ValidationIssueSerializer(many=True, read_only=True)

    class Meta:
        model = ValidationReport
        fields = [
            'id', 'project', 'version', 'duration_ms', 'profile', 'validation_scope', 'css_source_type',
            'engine_status', 'analysis_coverage', 'error_count', 'warning_count', 'info_count', 'created_at', 'issues',
        ]
        read_only_fields = fields


class ValidateRequestSerializer(serializers.Serializer):
    """Input contract for POST /api/v1/lp/validate/. `project` is a plain
    integer id, not a DRF PrimaryKeyRelatedField, deliberately — its
    queryset needs to be scoped to the authenticated user, which the view
    enforces explicitly (see ValidateView.post) rather than relying on a
    field-level queryset that would otherwise leak whether a *different*
    user's project id exists (404 vs validation error are handled
    identically as a generic "not found" either way).

    `profile` is optional and defaults to 'standard' — an existing Sprint
    1B request that omits it entirely keeps working unchanged."""

    html = serializers.CharField(
        allow_blank=True, required=True, trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    js = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    # Deprecated — accepted only for legacy API-client compatibility. Never
    # populated by current frontend code, never treated as AMPscript, and
    # never validated (see engine.py::run() — `ts` is accepted and
    # discarded, exactly like before this sprint). Use `ampscript` instead.
    ts = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    ampscript = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    project = serializers.IntegerField(required=False, allow_null=True, default=None)
    profile = serializers.ChoiceField(
        choices=ValidationProfile.choices, required=False, default=DEFAULT_PROFILE,
    )
    validation_scope = serializers.ChoiceField(
        choices=ValidationScope.choices, required=False, default=DEFAULT_SCOPE,
    )
    # Sprint CSS-C — which syntax the standalone CSS-tab source (`css`
    # above) is written in. 'less' is accepted here for API-contract
    # stability even though its engine doesn't exist yet (see
    # engine.py::run() — it reports honestly unavailable rather than
    # being silently validated as plain CSS).
    css_source_type = serializers.ChoiceField(
        choices=CssSourceType.choices, required=False, default=DEFAULT_CSS_SOURCE_TYPE,
    )

    def validate(self, data):
        # A single-language scope with no source for that language has
        # nothing to validate — rejected here (a clean 400) rather than
        # silently running the adapter against '' or, worse, running the
        # wrong language's adapters. 'complete' is deliberately exempt: an
        # empty HTML source there is a reportable landing-page defect, not
        # a malformed request (see validation/engine.py::_required_html_issue).
        scope = data.get('validation_scope', DEFAULT_SCOPE)
        required_field_by_scope = {
            ValidationScope.HTML: ('html', 'Enter HTML code before validating HTML.'),
            ValidationScope.CSS: ('css', 'Enter CSS code before validating CSS.'),
            ValidationScope.JAVASCRIPT: ('js', 'Enter JavaScript code before validating JavaScript.'),
            # Deprecated scope — no engine runs for it anymore (see
            # engine.py), but a legacy client selecting it still gets a
            # clean, honest validation error rather than a stale one.
            ValidationScope.TYPESCRIPT: ('ts', 'Enter TypeScript code before validating TypeScript.'),
            ValidationScope.AMPSCRIPT: ('ampscript', 'Enter AMPscript before validating AMPscript.'),
        }
        if scope in required_field_by_scope:
            field_name, message = required_field_by_scope[scope]
            if not (data.get(field_name) or '').strip():
                raise serializers.ValidationError({field_name: [message]})
        return data


# Bounds how many issue_ids a single fix preview/apply request may name —
# well above any realistic selection, far below where patch generation
# (which re-runs real validator adapters, some via a Node subprocess) could
# become a resource concern.
MAX_FIX_ISSUE_IDS = 100


class FixRequestSerializer(serializers.Serializer):
    """Shared input contract for POST /api/v1/lp/fixes/preview/ and
    /api/v1/lp/fixes/apply/. The caller always resends the CURRENT full
    source for every language — never a diff, never trusted from the
    report row — because the entire safety model (see fixes/__init__.py)
    depends on regenerating every patch against what is in the editor
    right now, not what was true when the report was created."""

    report = serializers.IntegerField()
    issue_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_empty=False, max_length=MAX_FIX_ISSUE_IDS,
    )
    html = serializers.CharField(
        allow_blank=True, required=True, trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    js = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    ampscript = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css_source_type = serializers.ChoiceField(
        choices=CssSourceType.choices, required=False, default=DEFAULT_CSS_SOURCE_TYPE,
    )
    validation_scope = serializers.ChoiceField(
        choices=ValidationScope.choices, required=False, default=DEFAULT_SCOPE,
    )
    profile = serializers.ChoiceField(
        choices=ValidationProfile.choices, required=False, default=DEFAULT_PROFILE,
    )


# Lower than MAX_FIX_ISSUE_IDS — an AI review call is far more expensive
# (a real provider round-trip, not a local re-run of an adapter) than a
# deterministic fix preview.
MAX_AI_REVIEW_ISSUE_IDS = 30


class AIReviewRequestSerializer(FixRequestSerializer):
    """POST /api/v1/lp/ai-review/request/ — same contract as
    FixRequestSerializer, just a tighter issue_ids cap."""

    issue_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_empty=False, max_length=MAX_AI_REVIEW_ISSUE_IDS,
    )


class YuktiExplainRequestSerializer(serializers.Serializer):
    """POST /api/v1/lp/yukti/explain/. Unlike FixRequestSerializer/
    AIReviewRequestSerializer, `issue_ids` may be EMPTY — that means "every
    actionable issue currently on the report" (the batch/Complete-LP
    explanation), not an error. A non-empty list means "explain just these
    issues" (the per-issue explanation, normally a single id). Same
    resend-current-full-source contract as every other fix/review
    endpoint — explanations are grounded in the source as it is right now,
    not as it was when the report was created."""

    report = serializers.IntegerField()
    issue_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list, max_length=MAX_AI_REVIEW_ISSUE_IDS,
    )
    html = serializers.CharField(
        allow_blank=True, required=True, trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    js = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    ampscript = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css_source_type = serializers.ChoiceField(
        choices=CssSourceType.choices, required=False, default=DEFAULT_CSS_SOURCE_TYPE,
    )
    validation_scope = serializers.ChoiceField(
        choices=ValidationScope.choices, required=False, default=DEFAULT_SCOPE,
    )
    profile = serializers.ChoiceField(
        choices=ValidationProfile.choices, required=False, default=DEFAULT_PROFILE,
    )


class AIReviewApplyRequestSerializer(serializers.Serializer):
    """POST /api/v1/lp/ai-review/apply/ — the client sends back only
    `accepted_fix_ids` (opaque identifiers), never proposal content; see
    views.py::AIReviewApplyView, which looks the real, server-trusted
    proposal up from the cache written by /ai-review/request/ instead of
    trusting anything about offsets/expected_text/replacement_text from
    the client."""

    report = serializers.IntegerField()
    review_id = serializers.CharField(max_length=64)
    accepted_fix_ids = serializers.ListField(
        child=serializers.CharField(max_length=64), allow_empty=False, max_length=MAX_AI_REVIEW_ISSUE_IDS,
    )
    html = serializers.CharField(
        allow_blank=True, required=True, trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    js = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    ampscript = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css_source_type = serializers.ChoiceField(
        choices=CssSourceType.choices, required=False, default=DEFAULT_CSS_SOURCE_TYPE,
    )
    validation_scope = serializers.ChoiceField(
        choices=ValidationScope.choices, required=False, default=DEFAULT_SCOPE,
    )
    profile = serializers.ChoiceField(
        choices=ValidationProfile.choices, required=False, default=DEFAULT_PROFILE,
    )


class AIFixIssuesRunRequestSerializer(serializers.Serializer):
    """POST /api/v1/lp/ai-fix/run/ — AI Engineer Autonomous Repair sprint.
    Clicking "AI Fix Issues" is consent to repair every currently
    repairable issue in scope (spec section 1/17/18) — there is no
    per-issue selection step, so this carries only the report/sources/scope
    the loop needs to re-validate and repair from, never an issue-id list.

    `operation_id` (Source-Repair Integrity sprint) is an OPTIONAL
    client-generated idempotency key — a double-click, a browser retry, or
    a duplicate submission carrying the SAME operation_id for the SAME
    user is served the cached result of the first real execution rather
    than mutating source a second time. Omitted entirely, the request
    always executes (matches every other endpoint's existing behavior)."""

    report = serializers.IntegerField()
    operation_id = serializers.CharField(
        required=False, default='', allow_blank=True, max_length=100,
    )
    html = serializers.CharField(
        allow_blank=True, required=True, trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    js = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    ampscript = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css_source_type = serializers.ChoiceField(
        choices=CssSourceType.choices, required=False, default=DEFAULT_CSS_SOURCE_TYPE,
    )
    validation_scope = serializers.ChoiceField(
        choices=ValidationScope.choices, required=False, default=DEFAULT_SCOPE,
    )
    profile = serializers.ChoiceField(
        choices=ValidationProfile.choices, required=False, default=DEFAULT_PROFILE,
    )


# Bounds the AMPscript preview-only mock-value map — a handful of named
# values (FirstName, EmailAddress, ...), never a bulk data payload.
MAX_AMPSCRIPT_MOCK_VALUES = 20
MAX_AMPSCRIPT_MOCK_VALUE_LENGTH = 500


class PreviewRequestSerializer(serializers.Serializer):
    """POST /api/v1/lp/preview/ — assembles and stores a short-lived
    Secure Preview snapshot of the CURRENT editor state (see
    views.py::PreviewCreateView, preview/assembly.py). `html` is required
    and must not be blank: Preview only ever renders a real page, never an
    empty placeholder document (see preview/__init__.py's module
    docstring). Individual field limits match the validator's own
    MAX_SOURCE_LENGTH; the ASSEMBLED document is independently re-checked
    against settings.LP_PREVIEW_MAX_DOCUMENT_BYTES in the view, since that
    combined size is what actually matters for a preview snapshot."""

    html = serializers.CharField(
        allow_blank=False, required=True, trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    js = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    ampscript = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    css_source_type = serializers.ChoiceField(
        choices=CssSourceType.choices, required=False, default=DEFAULT_CSS_SOURCE_TYPE,
    )
    validation_scope = serializers.ChoiceField(
        choices=ValidationScope.choices, required=False, default=DEFAULT_SCOPE,
    )
    profile = serializers.ChoiceField(
        choices=ValidationProfile.choices, required=False, default=DEFAULT_PROFILE,
    )
    # Preview-only substitutions for `%%=v(@name)=%%` — see
    # preview/ampscript_preview.py. Never saved as production Salesforce
    # values, never sent to SFMC.
    ampscript_mock_values = serializers.DictField(
        child=serializers.CharField(
            allow_blank=True, trim_whitespace=False, max_length=MAX_AMPSCRIPT_MOCK_VALUE_LENGTH,
        ),
        required=False, default=dict,
    )

    def validate_ampscript_mock_values(self, value):
        if len(value) > MAX_AMPSCRIPT_MOCK_VALUES:
            raise serializers.ValidationError(
                f'No more than {MAX_AMPSCRIPT_MOCK_VALUES} preview mock values are allowed.'
            )
        return value


class CrossBrowserCheckRequestSerializer(serializers.Serializer):
    """POST /api/v1/lp/preview/<token>/cross-browser/ — `token` itself
    comes from the URL (see urls.py), never the body; this only carries
    which engine/viewport to render at. Bounds are re-validated again in
    landingpages/cross_browser/__init__.py::run_cross_browser_check —
    this is a clean 400 for an obviously bad request, that is the actual
    enforcement boundary."""

    engine = serializers.ChoiceField(choices=['chromium', 'firefox', 'webkit'])
    width = serializers.IntegerField(min_value=320, max_value=2560)
    height = serializers.IntegerField(min_value=480, max_value=1600)

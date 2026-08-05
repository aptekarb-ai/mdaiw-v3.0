from django.db import IntegrityError, transaction
from django.utils.text import slugify
from rest_framework import serializers

from .models import LandingPageProject, ValidationIssue, ValidationReport
from .validation.profiles import DEFAULT_PROFILE, DEFAULT_SCOPE, ValidationProfile, ValidationScope

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
            'id', 'project', 'version', 'duration_ms', 'profile', 'validation_scope', 'engine_status',
            'error_count', 'warning_count', 'info_count', 'created_at', 'issues',
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
    ts = serializers.CharField(
        allow_blank=True, required=False, default='', trim_whitespace=False, max_length=MAX_SOURCE_LENGTH,
    )
    project = serializers.IntegerField(required=False, allow_null=True, default=None)
    profile = serializers.ChoiceField(
        choices=ValidationProfile.choices, required=False, default=DEFAULT_PROFILE,
    )
    validation_scope = serializers.ChoiceField(
        choices=ValidationScope.choices, required=False, default=DEFAULT_SCOPE,
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
            ValidationScope.TYPESCRIPT: ('ts', 'Enter TypeScript code before validating TypeScript.'),
        }
        if scope in required_field_by_scope:
            field_name, message = required_field_by_scope[scope]
            if not (data.get(field_name) or '').strip():
                raise serializers.ValidationError({field_name: [message]})
        return data

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .validation.profiles import (
    DEFAULT_CSS_SOURCE_TYPE,
    DEFAULT_PROFILE,
    DEFAULT_SCOPE,
    CssSourceType,
    ValidationProfile,
    ValidationScope,
)


class LandingPageType(models.TextChoices):
    VALIDATOR = 'validator', 'Validator'
    BUILDER = 'builder', 'Builder'
    AI_GENERATED = 'ai-generated', 'AI Generated'


class LandingPageStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    VALIDATING = 'validating', 'Validating'
    NEEDS_FIXES = 'needs-fixes', 'Needs Fixes'
    READY = 'ready', 'Ready'
    ARCHIVED = 'archived', 'Archived'


class FrameworkType(models.TextChoices):
    BOOTSTRAP = 'bootstrap', 'Bootstrap'
    TAILWIND = 'tailwind', 'Tailwind'
    CUSTOM = 'custom', 'Custom'


class LandingPageProject(models.Model):
    """A user's landing-page project. Ownership is direct (`user`), never
    inferred — every view in this app filters its queryset on
    `user=request.user` before any lookup, the same manual-ownership-check
    convention used by faceauth.FaceCredential."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='landing_page_projects',
    )
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220)
    type = models.CharField(max_length=20, choices=LandingPageType.choices, default=LandingPageType.VALIDATOR)
    status = models.CharField(max_length=20, choices=LandingPageStatus.choices, default=LandingPageStatus.DRAFT)
    framework = models.CharField(max_length=20, choices=FrameworkType.choices, default=FrameworkType.CUSTOM)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'slug'], name='unique_landingpage_slug_per_user'),
        ]
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.name} (user={self.user_id})'


class LandingPageVersion(models.Model):
    """A saved snapshot of a project's source. Content itself lives in
    storage (see landingpages/storage/) — these fields hold
    storage-relative paths only, never raw content and never a caller-
    supplied path (always produced by storage.base.build_path()). Never
    overwritten in place: a new version row + new storage paths are
    created instead, per the "never overwrite original automatically"
    safety rule."""

    project = models.ForeignKey(LandingPageProject, on_delete=models.CASCADE, related_name='versions')
    version_number = models.PositiveIntegerField()
    html_path = models.CharField(max_length=500, blank=True, default='')
    css_path = models.CharField(max_length=500, blank=True, default='')
    js_path = models.CharField(max_length=500, blank=True, default='')
    # Deprecated — TypeScript was replaced by AMPscript as the LP source
    # language. Kept (not removed) so existing rows and migration history
    # stay valid; no code path writes to this field anymore. A later
    # cleanup migration may drop it once Save/versioning ships and existing
    # environments have been reviewed.
    ts_path = models.CharField(max_length=500, blank=True, default='')
    ampscript_path = models.CharField(max_length=500, blank=True, default='')
    # Save/Download closure sprint — which syntax the saved `css_path`
    # content is actually written in (CSS/LESS/SCSS/Sass). Without this,
    # a saved LESS/SCSS/Sass project would silently be treated as plain
    # CSS on reload — the ORIGINAL preprocessor source is always what's
    # persisted at css_path (see the module docstring on save/download:
    # "never compile and replace original preprocessor source").
    css_source_type = models.CharField(max_length=10, choices=CssSourceType.choices, default=DEFAULT_CSS_SOURCE_TYPE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'version_number'], name='unique_landingpage_version_number_per_project'
            ),
        ]
        ordering = ['-version_number']

    def __str__(self):
        return f'{self.project_id} v{self.version_number}'


class RepairKnowledgeStatus(models.TextChoices):
    VERIFIED = 'verified', 'Verified'
    REJECTED = 'rejected', 'Rejected'


class RepairKnowledgeRecord(models.Model):
    """Verified/Rejected Repair Knowledge — application-level learning for
    the LP Validator & Fixer's AI Engineer (see fixes/repair_memory.py).

    This is NOT model retraining. It is a small, versioned, generalized
    "we've proven this repair strategy works for this rule in this
    structural context before" ledger, so a future operation can skip a
    fresh LLM reasoning call for an already-proven pattern (and can avoid
    re-proposing a strategy already proven NOT to work).

    Deliberately stores only GENERALIZED structural facts — never raw
    customer landing-page source. `context_signature` is a hash of a
    small dict of booleans/counts (see repair_memory.compute_context_signature),
    not a copy of any source text; `strategy_key` names a CODE-registered
    transform (see fixes/verified_recipes.py), not a stored diff/patch."""

    language = models.CharField(max_length=20)
    rule_id = models.CharField(max_length=200)
    context_signature = models.CharField(max_length=64)
    strategy_key = models.CharField(max_length=100)
    strategy_description = models.TextField(blank=True, default='')
    status = models.CharField(max_length=10, choices=RepairKnowledgeStatus.choices)

    attempt_count = models.PositiveIntegerField(default=0)
    success_count = models.PositiveIntegerField(default=0)
    failure_count = models.PositiveIntegerField(default=0)
    rollback_count = models.PositiveIntegerField(default=0)

    # A lightweight environment fingerprint captured at the moment of the
    # most recent SUCCESS (e.g. {'profile': 'standard', 'css_source_type':
    # 'scss'}) — not a full per-engine version inventory (this project has
    # no central version registry to draw one from), but enough to notice
    # "the validation profile this recipe was proven under has changed."
    # Every recipe-produced candidate is still authoritatively re-validated
    # before ever being accepted (candidate-first architecture, unconditional)
    # — this field is a signal for demotion/review, not a correctness gate.
    last_verified_environment = models.JSONField(default=dict, blank=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['language', 'rule_id', 'context_signature', 'strategy_key'],
                name='unique_repair_knowledge_strategy',
            ),
        ]
        indexes = [
            models.Index(fields=['language', 'rule_id', 'context_signature'], name='repair_knowledge_lookup_idx'),
        ]

    def __str__(self):
        return f'{self.language}:{self.rule_id} [{self.strategy_key}] {self.status} ({self.success_count}/{self.attempt_count})'

    # Confidence-based promotion/demotion (Verified Repair Memory sprint,
    # closure spec section 9) — Laplace-smoothed success ratio, NOT a raw
    # success/attempt fraction. Smoothing is what makes a strategy's trust
    # resist flipping on a single data point: one success alone (1/1 ->
    # confidence 0.67) is enough to promote, but one ISOLATED plain
    # failure after a long successful history barely moves it (e.g.
    # 20 successes + 1 failure -> confidence (20+1)/(21+2) = 0.91, still
    # comfortably verified) — see repair_memory.record_attempt_result for
    # the full promotion/demotion policy this backs.
    @property
    def confidence(self) -> float:
        return (self.success_count + 1) / (self.attempt_count + 2)


class AuthoritativeKnowledgeStatus(models.TextChoices):
    CANDIDATE = 'candidate', 'Candidate'
    VERIFIED = 'verified', 'Verified'
    SUPERSEDED = 'superseded', 'Superseded'
    REJECTED = 'rejected', 'Rejected'


class AuthoritativeKnowledgeRecord(models.Model):
    """Controlled Self-Learning AI Engineer sprint — provenance ledger for
    guidance the AI Engineer pulled from an APPROVED online technical
    source (see knowledge/sources.py's allowlist) when the local, code-
    authored Rule Knowledge Registry (validation/rules/) had no entry for
    a rule. This is application-level learning about REPAIR STRATEGIES,
    never OpenAI model retraining, and never a store of customer content:
    `excerpt` is a short, bounded quote from a PUBLIC spec/docs page,
    never anything derived from a user's landing-page source.

    Status lifecycle mirrors RepairKnowledgeRecord's spirit but tracks a
    fetched REFERENCE rather than a code-registered strategy:
    CANDIDATE (fetched, not yet proven to help a real accepted repair),
    VERIFIED (has backed at least one authoritatively-revalidated accepted
    candidate), SUPERSEDED (a fresher fetch for the same language/rule_id
    produced materially different content — `superseded_by` points at the
    replacement), REJECTED (proven not to help, or provenance could not be
    trusted). Never used as proof on its own — every candidate it informs
    still goes through the same authoritative revalidation as any other
    (see knowledge/research.py, fixes/iterative.py)."""

    language = models.CharField(max_length=20)
    rule_id = models.CharField(max_length=200)
    source_name = models.CharField(max_length=100)
    source_url = models.URLField(max_length=500)
    source_title = models.CharField(max_length=300, blank=True, default='')
    excerpt = models.TextField(blank=True, default='')
    content_hash = models.CharField(max_length=64)
    retrieved_at = models.DateTimeField()
    confidence = models.FloatField(default=0.3)
    status = models.CharField(
        max_length=10, choices=AuthoritativeKnowledgeStatus.choices, default=AuthoritativeKnowledgeStatus.CANDIDATE,
    )
    superseded_by = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='supersedes',
    )

    attempt_count = models.PositiveIntegerField(default=0)
    success_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['language', 'rule_id', 'source_url'], name='unique_authoritative_knowledge_source',
            ),
        ]
        indexes = [
            models.Index(fields=['language', 'rule_id', 'status'], name='authoritative_kb_lookup_idx'),
        ]

    def __str__(self):
        return f'{self.language}:{self.rule_id} [{self.source_name}] {self.status}'


class ValidationReport(models.Model):
    """`user` is direct (not only reachable via `project`) so an ad-hoc
    validation request — paste-and-validate without ever saving a project
    — still has an unambiguous owner. `project`/`version` are optional and
    nullable for exactly that reason."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='validation_reports',
    )
    project = models.ForeignKey(
        LandingPageProject,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='validation_reports',
    )
    version = models.ForeignKey(
        LandingPageVersion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='validation_reports',
    )
    duration_ms = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    warning_count = models.PositiveIntegerField(default=0)
    info_count = models.PositiveIntegerField(default=0)
    profile = models.CharField(max_length=20, choices=ValidationProfile.choices, default=DEFAULT_PROFILE)
    validation_scope = models.CharField(max_length=20, choices=ValidationScope.choices, default=DEFAULT_SCOPE)
    # Sprint CSS-C — which syntax the standalone CSS-tab source was
    # written in for this report. 'css' whenever the CSS tab wasn't part
    # of the scope at all.
    css_source_type = models.CharField(max_length=10, choices=CssSourceType.choices, default=DEFAULT_CSS_SOURCE_TYPE)
    # Per-adapter run status (engine name, success, duration, issue count,
    # safe failure message) — never contains a stack trace. List of plain
    # dicts, see validation/schema.py::EngineStatus.
    engine_status = models.JSONField(default=list, blank=True)
    # AI Engineer full-source-analysis sprint — per-language coverage
    # metadata (source_lines, engine coverage, ai coverage, chunk count),
    # never raw source content. See ai_engineer/__init__.py::build_coverage.
    # Empty dict for every report produced before this sprint.
    analysis_coverage = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'ValidationReport({self.pk}, user={self.user_id})'


class ValidationIssue(models.Model):
    class Severity(models.TextChoices):
        ERROR = 'error', 'Error'
        WARNING = 'warning', 'Warning'
        INFO = 'info', 'Info'

    class Category(models.TextChoices):
        SYNTAX = 'syntax', 'Syntax'
        ACCESSIBILITY = 'accessibility', 'Accessibility'
        SEO = 'seo', 'SEO'
        SECURITY = 'security', 'Security'
        PERFORMANCE = 'performance', 'Performance'
        RESPONSIVE = 'responsive', 'Responsive'
        # CSS structural/semantic validation phases (see
        # validators_node/validate_css.mjs's css-tree-backed pipeline).
        STRUCTURE = 'structure', 'Structure'
        PROPERTY = 'property', 'Property'
        VALUE = 'value', 'Value'
        COMPATIBILITY = 'compatibility', 'Compatibility'
        # AI Engineer full-source-analysis sprint — for contextual findings
        # (inconsistent patterns, semantic misuse, dead/unreferenced code)
        # that don't fit any deterministic-engine category above.
        MAINTAINABILITY = 'maintainability', 'Maintainability'

    class FileType(models.TextChoices):
        HTML = 'html', 'HTML'
        CSS = 'css', 'CSS'
        JAVASCRIPT = 'javascript', 'JavaScript'
        # Deprecated — see LandingPageVersion.ts_path's comment. Kept so
        # historical ValidationIssue rows with file/language='typescript'
        # remain readable; no adapter produces this value anymore.
        TYPESCRIPT = 'typescript', 'TypeScript'
        AMPSCRIPT = 'ampscript', 'AMPscript'
        CDN = 'cdn', 'CDN'

    class Risk(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'

    class Confidence(models.TextChoices):
        DEFINITE = 'definite', 'Definite'
        LIKELY = 'likely', 'Likely'
        POSSIBLE = 'possible', 'Possible'

    class FixType(models.TextChoices):
        NONE = '', 'None'
        INSERT_CLOSING_TAG = 'insert-closing-tag', 'Insert closing tag'
        ADD_ATTRIBUTE = 'add-attribute', 'Add attribute'
        REMOVE_DUPLICATE = 'remove-duplicate', 'Remove duplicate'

    report = models.ForeignKey(ValidationReport, on_delete=models.CASCADE, related_name='issues')
    severity = models.CharField(max_length=10, choices=Severity.choices)
    category = models.CharField(max_length=20, choices=Category.choices)
    rule_id = models.CharField(max_length=100)
    message = models.TextField()
    # `file` says which editor tab a finding belongs to; `language` says
    # what it actually is. They were the same value for every adapter
    # before Sprint CSS-A (still are, for all of them except the two new
    # embedded-CSS adapters) — CSS embedded inside HTML is language='css'
    # but file='html', since that's the tab the developer edits it in.
    # See validation/schema.py::ValidationIssueData.file/language.
    file = models.CharField(max_length=20, choices=FileType.choices)
    language = models.CharField(max_length=20, choices=FileType.choices, default='', blank=True)
    line = models.PositiveIntegerField()
    column = models.PositiveIntegerField(null=True, blank=True)
    suggestion = models.TextField(blank=True, default='')
    auto_fixable = models.BooleanField(default=False)
    risk = models.CharField(max_length=10, choices=Risk.choices, default=Risk.LOW)

    # Sprint 1C unified-schema fields. `fingerprint` is a stable identity
    # (language + source_engine + rule_id + normalized range + normalized
    # message — never line number alone, see validation/schema.py) used for
    # dedup, not a primary key. `line`/`column` above remain the canonical
    # start position for Sprint 1A/1B API compatibility; end_line/end_column
    # are additive.
    fingerprint = models.CharField(max_length=64, db_index=True, default='', blank=True)
    source_engine = models.CharField(max_length=50, default='', blank=True)
    engine_version = models.CharField(max_length=30, default='', blank=True)
    standards_reference = models.CharField(max_length=300, default='', blank=True)
    confidence = models.CharField(max_length=10, choices=Confidence.choices, default=Confidence.DEFINITE)
    end_line = models.PositiveIntegerField(null=True, blank=True)
    end_column = models.PositiveIntegerField(null=True, blank=True)
    code_excerpt = models.TextField(default='', blank=True)
    fix_type = models.CharField(max_length=20, choices=FixType.choices, default=FixType.NONE, blank=True)
    deterministic_fix = models.JSONField(null=True, blank=True)
    requires_manual_review = models.BooleanField(default=True)
    related_element = models.CharField(max_length=100, default='', blank=True)
    related_attribute = models.CharField(max_length=100, default='', blank=True)

    # Sprint CSS-A additions — where an embedded-CSS finding actually came
    # from within its editor tab (see validation/schema.py::
    # ValidationIssueData.source_context/source_block_index). Blank for
    # every issue produced before this sprint, and for every non-CSS issue.
    source_context = models.CharField(max_length=50, default='', blank=True)
    source_block_index = models.PositiveIntegerField(null=True, blank=True)
    # Sprint CSS-B — storage-relative path of the local project asset a
    # finding came from, when one was actually resolved (see
    # validation/adapters/html_external_stylesheet.py). Blank otherwise.
    source_asset_id = models.CharField(max_length=500, default='', blank=True)
    # Sprint CSS-C — for a finding produced against SCSS/Sass's generated
    # CSS, its position in that generated CSS before mapping back to the
    # original source (see validation/adapters/css_scss_sass.py). Null
    # for every non-preprocessor issue.
    generated_start_line = models.PositiveIntegerField(null=True, blank=True)
    generated_start_column = models.PositiveIntegerField(null=True, blank=True)

    # AI Engineer full-source-analysis sprint — see
    # validation/schema.py::ValidationIssueData.ai_metadata for shape. Null
    # for every issue produced before this sprint and for every issue no AI
    # Engineer pass ever touched.
    ai_metadata = models.JSONField(null=True, blank=True)

    # Tool-Grounded AI Engineer sprint, spec section 4/5 — structured
    # diagnostics contract's root-cause grouping. Empty string means no
    # known grouping. See validation/schema.py::ValidationIssueData.
    root_cause_id = models.CharField(max_length=100, default='', blank=True)

    class Meta:
        ordering = ['line', 'column']

    def __str__(self):
        return f'{self.severity}:{self.rule_id} @ line {self.line}'


class LandingPagePreviewSnapshot(models.Model):
    """A short-lived, per-user snapshot of an assembled Secure Preview
    document (see preview/assembly.py). `token` — never the numeric PK —
    is the only identifier the preview URL exposes, so a URL leaked via
    browser history/referrer/logs cannot be enumerated to another
    snapshot. Ownership (`user`) and `expires_at` are independently
    re-checked on every GET in views.py — the token's own unguessability
    is defense in depth, not the sole access control. Content is stored
    directly (not via storage/, which is for durable project assets) since
    a preview snapshot is ephemeral, request-scoped output that only
    PreviewServeView ever reads back."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='lp_preview_snapshots',
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    html = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'LandingPagePreviewSnapshot({self.token}, user={self.user_id})'

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

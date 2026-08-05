from django.conf import settings
from django.db import models

from .validation.profiles import DEFAULT_PROFILE, DEFAULT_SCOPE, ValidationProfile, ValidationScope


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
    ts_path = models.CharField(max_length=500, blank=True, default='')
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
    # Per-adapter run status (engine name, success, duration, issue count,
    # safe failure message) — never contains a stack trace. List of plain
    # dicts, see validation/schema.py::EngineStatus.
    engine_status = models.JSONField(default=list, blank=True)
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

    class FileType(models.TextChoices):
        HTML = 'html', 'HTML'
        CSS = 'css', 'CSS'
        JAVASCRIPT = 'javascript', 'JavaScript'
        TYPESCRIPT = 'typescript', 'TypeScript'
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

    class Meta:
        ordering = ['line', 'column']

    def __str__(self):
        return f'{self.severity}:{self.rule_id} @ line {self.line}'

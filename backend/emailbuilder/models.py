import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from .name_normalization import normalize_email_name

MIN_EMAIL_WIDTH = 320
MAX_EMAIL_WIDTH = 1200
DEFAULT_EMAIL_WIDTH = 700


class EmailPlatform(models.TextChoices):
    """Stable internal values — never the display label. Generic is the
    max-compatibility default; the other members are placeholders for
    future platform adapters (AMPScript/Marketo tokens/HubL/...), not
    implemented by this feature."""

    GENERIC = 'generic', 'Generic'
    SFMC = 'sfmc', 'Salesforce Marketing Cloud'
    MARKETO = 'marketo', 'Marketo'
    HUBSPOT = 'hubspot', 'HubSpot'
    PARDOT = 'pardot', 'Pardot / Account Engagement'
    OTHER = 'other', 'Other'


class EmailStartType(models.TextChoices):
    BLANK = 'blank', 'Blank Email'
    TEMPLATE = 'template', 'Template'
    HTML = 'html', 'Existing HTML'
    AI = 'ai', 'AI Generate'


class EmailDocumentStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'


def default_content():
    # Mutable defaults on a JSONField must be a callable — this is the
    # empty Email Document Model (EDM), see edm.py for the validated shape.
    return {'version': 1, 'modules': []}


class EmailDocument(models.Model):
    """A Module-4 email's setup metadata (Feature 02 — the setup wizard).
    Ownership is direct (`user`), never inferred — every view in this app
    filters its queryset on `user=request.user` before any lookup, the
    same manual-ownership-check convention landingpages.LandingPageProject
    already uses, so another user's document id 404s rather than 403s.

    No HTML/rendered-content field yet — that belongs to the actual
    builder feature (not implemented here), not this setup wizard."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='email_documents',
    )
    name = models.CharField(max_length=120)
    # Derived, never client-writable (absent from EmailDocumentSerializer's
    # `fields`) — kept in sync by save() below. Canonical per-user
    # uniqueness key: see name_normalization.py for why this is a stored
    # Python-computed column rather than a database Lower(name) expression.
    # max_length is wider than `name`'s because casefold() can expand a
    # handful of Unicode code points (e.g. German ß -> "ss").
    name_normalized = models.CharField(max_length=360, editable=False)
    # Email Document Standards slice — three DELIBERATELY distinct
    # concepts, never conflated in UI copy or code:
    #   `name`          the builder/dashboard draft name (above) — never
    #                    rendered into the email itself.
    #   `email_title`   rendered verbatim (escaped) into <title> in <head>.
    #   `email_subject` document/send metadata only — NEVER rendered as
    #                    HTML markup (no fake <meta name="subject">);
    #                    exposed for the Email Builder UI, the Email AI
    #                    Engineer, and future Send/Test/Export integrations.
    email_title = models.CharField(max_length=150, blank=True, default='')
    email_subject = models.CharField(max_length=200, blank=True, default='')
    # Optional. Absent/blank by default. Many email clients ignore
    # favicons entirely — this is a nice-to-have enhancement, never
    # presented as an email-client compatibility requirement. Must pass
    # the same URL-security allow-list as every other URL in this app
    # (see serializers.py's validate_favicon_url / edm.UNSAFE_URL_PREFIXES).
    favicon_url = models.URLField(max_length=2000, blank=True, default='')
    # Reset/Custom CSS — schema added now (Sub-phase 1) so Sub-phase 2
    # doesn't need a second migration; the renderer/UI only start USING
    # these once Sub-phase 2 lands. Reset defaults ON per approved
    # decision; Custom CSS defaults OFF/empty.
    reset_css_enabled = models.BooleanField(default=True)
    custom_css_enabled = models.BooleanField(default=False)
    custom_css = models.TextField(blank=True, default='')
    # Module-4 E4 — document-level default for the existing per-module
    # `settings.outlookVml` opt-in (frontend/src/emailbuilder/edm.ts).
    # Reuses that SAME field name/semantics rather than inventing a second
    # Outlook setting: the renderer resolves each module's EFFECTIVE
    # outlookVml as `module.settings.outlookVml ?? this document flag`
    # (see htmlRenderer.ts's RenderableEmail.outlookVml), so an explicit
    # per-module value (set today only via the AI Engineer's
    # APPLY_VML_PATTERN/APPLY_OUTLOOK_WRAPPER actions) still wins, and every
    # other module falls back to this one document-wide switch. Off by
    # default — same "absent = today's exact existing behavior" convention
    # as every other boolean here.
    outlook_vml_enabled = models.BooleanField(default=False)
    platform = models.CharField(
        max_length=20, choices=EmailPlatform.choices, default=EmailPlatform.GENERIC,
    )
    width = models.PositiveIntegerField(
        default=DEFAULT_EMAIL_WIDTH,
        validators=[MinValueValidator(MIN_EMAIL_WIDTH), MaxValueValidator(MAX_EMAIL_WIDTH)],
    )
    start_type = models.CharField(
        max_length=20, choices=EmailStartType.choices, default=EmailStartType.BLANK,
    )
    status = models.CharField(
        max_length=20, choices=EmailDocumentStatus.choices, default=EmailDocumentStatus.DRAFT,
    )
    # The Email Document Model (EDM) — structured module tree, never raw
    # DOM/HTML. Shape is validated by serializers.validate_content /
    # edm.py, not by the database. Feature 03's builder reads/writes this;
    # the table-first HTML renderer (frontend/src/emailbuilder/htmlRenderer.ts)
    # is a pure function of this data, never stored itself.
    content = models.JSONField(default=default_content)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'name_normalized'], name='unique_emaildocument_user_name_normalized',
            ),
        ]

    def save(self, *args, **kwargs):
        # Every write path funnels through here (DRF's ModelSerializer
        # create()/update() both end in instance.save() — see
        # serializers.py's EmailDocumentSerializer) — so `name` is always
        # stored trimmed and `name_normalized` is always kept in sync,
        # regardless of caller. Bulk operations (`.update()`/`bulk_create`/
        # `bulk_update`) bypass save() by design in Django, so any future
        # code path that bulk-writes `name` must set `name_normalized`
        # itself — see the data migration for the one existing example.
        self.name = self.name.strip()
        self.name_normalized = normalize_email_name(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.name} (user={self.user_id})'


def email_asset_upload_path(instance, filename):
    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'jpg'
    return f'email_assets/{uuid.uuid4().hex}.{extension}'


class EmailAssetCategory(models.TextChoices):
    IMAGE = 'image', 'Images'
    LOGO = 'logo', 'Logos'
    ICON = 'icon', 'Icons'
    OTHER = 'other', 'Others'


class EmailAssetSourceType(models.TextChoices):
    UPLOAD = 'upload', 'Uploaded file'
    EXTERNAL = 'external', 'External URL'


class EmailAsset(models.Model):
    """Feature 08 — a user's personal reusable image library for the email
    builder (logos, hero images, icons referenced by URL). Same ownership
    boundary as EmailDocument/SavedEmailModule: another user's asset id is
    filtered out before lookup (404, not 403).

    Exactly one of `file`/`external_url` is populated, matching
    `source_type` — enforced by EmailAssetSerializer.validate(), not the
    database (Django has no clean per-field-set-by-choice constraint short
    of a CheckConstraint referencing two columns, which SQLite/Postgres
    handle inconsistently enough it isn't worth it for a two-value choice).
    `width`/`height`/`file_size`/`content_type` are populated for uploads
    only (probed from the decoded image at upload time, see validators.py)
    — left null for external assets, since reliably fetching a
    cross-origin image's real dimensions would mean the backend fetching
    arbitrary user-supplied URLs server-side, which this feature does not
    do."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='email_assets',
    )
    name = models.CharField(max_length=200)
    category = models.CharField(
        max_length=20, choices=EmailAssetCategory.choices, default=EmailAssetCategory.IMAGE,
    )
    source_type = models.CharField(max_length=20, choices=EmailAssetSourceType.choices)
    file = models.ImageField(upload_to=email_asset_upload_path, blank=True, null=True)
    external_url = models.URLField(max_length=2000, blank=True)
    alt_text = models.CharField(max_length=250, blank=True)
    content_type = models.CharField(max_length=40, blank=True)
    file_size = models.PositiveIntegerField(null=True, blank=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.name} (user={self.user_id})'


class SavedEmailModule(models.Model):
    """Feature 04 — a single user's personal reusable module library.
    Captures one configured canvas module's (type, props, settings) so it
    can be re-inserted into any email later with fresh instance ids.
    Ownership is direct and manual-checked (`user`), same convention as
    EmailDocument — another user's saved module id 404s, never 403s.
    Personal only for Feature 04; no team/shared libraries yet."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='saved_email_modules',
    )
    name = models.CharField(max_length=120)
    module_type = models.CharField(max_length=40)
    props = models.JSONField(default=dict)
    settings = models.JSONField(default=dict)
    # Feature 05 — present only when the saved module is a layout with
    # nested column content (a list of column objects, each with its own
    # nested module tree); an empty list for every other saved module
    # type. See edm.py's validate_module_instance for the validated shape.
    columns = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.name} (user={self.user_id})'


class RepairSignalOutcome(models.TextChoices):
    ACCEPTED = 'accepted', 'Accepted'
    REJECTED = 'rejected', 'Rejected'


class RepairSignalSource(models.TextChoices):
    VALIDATION_CENTER_SINGLE = 'validation_center_single', 'Validation Center — single Fix'
    VALIDATION_CENTER_BULK = 'validation_center_bulk', 'Validation Center — Fix All'
    AI_ENGINEER_REPAIR = 'ai_engineer_repair', 'AI Engineer — repair proposal'
    # R4-B2 — accepted/rejected reconstruction-correction proposals (R4-C's
    # future concern; this choice exists now so learning.record_signal can
    # accept a reconstruction-sourced signal the moment R4-C starts
    # emitting one, without a later migration). Never written by R4-B2
    # itself — see reconstructionReview.ts's "no learning mutation yet"
    # docstring.
    AI_ENGINEER_RECONSTRUCTION = 'ai_engineer_reconstruction', 'AI Engineer — reconstruction repair'


class LearnedRepairSignal(models.Model):
    """Feature 14 V3 Sub-phase 8 — one explicit, per-user Accept/Reject
    decision about a REPAIR ISSUE TYPE (never a specific document/module
    instance). Ranking/advisory only — see learning.py's module docstring
    for the full invariant list this table must never violate. Deliberately
    minimal: no document/module/content/prop fields, ever (see the
    approved report — storing instance identifiers or raw content here
    would be both unnecessary for ranking and a privacy/blast-radius risk
    this feature has no reason to take on).

    `event_id` is a client-generated identifier for the ONE human
    interaction (a single Fix click, or one candidate within one Fix-All/
    AI-Engineer-repair-proposal Apply-or-Cancel click) that produced this
    row — see EmailBuilderWorkspacePage's callers. The
    (user, event_id) uniqueness below is the DURABLE correctness
    mechanism for "retrying the same network request must not create a
    second learning event" (approved amendment) — the cache-based rate
    limit in views.py is abuse protection only, never deduplication."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='learned_repair_signals',
    )
    # Not a strict Django UUIDField on purpose — the frontend reuses
    # idGenerator.ts's existing generateId() (crypto.randomUUID() with a
    # non-UUID string fallback for environments without it), the SAME id
    # generator every EDM module/column id already uses, rather than
    # introducing a second, UUID-only id generator for this one field.
    # Uniqueness (not UUID-ness) is what the idempotency contract needs.
    event_id = models.CharField(max_length=64)
    # Stable "<category>:<rule-slug>" signature only — see
    # repairEngine.ts's signatureForIssueId(). NEVER the full
    # ValidationIssue.id (which carries a per-instance module/document id
    # suffix), never props/content/HTML, never a provider prompt.
    signature = models.CharField(max_length=160)
    outcome = models.CharField(max_length=20, choices=RepairSignalOutcome.choices)
    source = models.CharField(max_length=30, choices=RepairSignalSource.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'event_id'], name='unique_learned_repair_signal_event'),
        ]
        indexes = [
            models.Index(fields=['user', 'signature', 'created_at'], name='learnedrepairsignal_rank_idx'),
        ]

    def __str__(self):
        return f'{self.signature}={self.outcome} (user={self.user_id})'

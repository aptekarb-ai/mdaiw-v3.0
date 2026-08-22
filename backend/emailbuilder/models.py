import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

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

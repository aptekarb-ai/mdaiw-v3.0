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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.name} (user={self.user_id})'

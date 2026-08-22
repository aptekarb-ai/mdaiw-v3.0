from django.conf import settings
from django.core.exceptions import ValidationError

from PIL import Image, UnidentifiedImageError

# Mirrors employees.validators.validate_profile_photo's approach exactly
# (trust decoded bytes, never the filename extension or client-supplied
# Content-Type header) — extended with GIF since animated GIFs are a
# common email-marketing asset type profile photos never needed.
_FORMAT_TO_CONTENT_TYPE = {
    'JPEG': 'image/jpeg',
    'PNG': 'image/png',
    'WEBP': 'image/webp',
    'GIF': 'image/gif',
}


def validate_asset_image(uploaded_file):
    """Validate an uploaded email asset image.

    Raises django.core.exceptions.ValidationError on any failure. On
    success, returns (content_type, width, height) read from the decoded
    image so the caller doesn't need to reopen the file a third time.
    """
    if uploaded_file.size > settings.EMAIL_ASSET_MAX_BYTES:
        max_mb = settings.EMAIL_ASSET_MAX_BYTES // (1024 * 1024)
        raise ValidationError(f'Asset must be {max_mb} MB or smaller.')

    uploaded_file.seek(0)
    try:
        probe = Image.open(uploaded_file)
        probe.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValidationError('Asset is not a valid image.')

    # verify() leaves the Image object unusable for further access; the
    # underlying file handle must be re-opened to read the decoded format
    # and dimensions.
    uploaded_file.seek(0)
    try:
        reopened = Image.open(uploaded_file)
        detected_format = reopened.format
        width, height = reopened.size
        reopened.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValidationError('Asset is not a valid image.')

    content_type = _FORMAT_TO_CONTENT_TYPE.get(detected_format or '')
    if content_type not in settings.EMAIL_ASSET_ALLOWED_CONTENT_TYPES:
        raise ValidationError('Asset must be a JPEG, PNG, WebP, or GIF image.')

    uploaded_file.seek(0)
    return content_type, width, height

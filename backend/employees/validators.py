from django.conf import settings
from django.core.exceptions import ValidationError

from PIL import Image, UnidentifiedImageError

_FORMAT_TO_CONTENT_TYPE = {
    'JPEG': 'image/jpeg',
    'PNG': 'image/png',
    'WEBP': 'image/webp',
}


def validate_profile_photo(uploaded_file):
    """Validate an uploaded profile photo.

    Trusts neither the filename extension nor the client-supplied
    Content-Type header — the actual image bytes are decoded and
    verified with Pillow, which is the authoritative source for format.
    Raises django.core.exceptions.ValidationError on any failure.
    """
    if uploaded_file.size > settings.PROFILE_PHOTO_MAX_BYTES:
        raise ValidationError('Profile photo must be 5 MB or smaller.')

    uploaded_file.seek(0)
    try:
        probe = Image.open(uploaded_file)
        probe.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValidationError('Profile photo is not a valid image.')

    # verify() leaves the Image object unusable for further access; the
    # underlying file handle must be re-opened to read the decoded format.
    uploaded_file.seek(0)
    try:
        reopened = Image.open(uploaded_file)
        detected_format = reopened.format
        reopened.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValidationError('Profile photo is not a valid image.')

    content_type = _FORMAT_TO_CONTENT_TYPE.get(detected_format or '')
    if content_type not in settings.PROFILE_PHOTO_ALLOWED_CONTENT_TYPES:
        raise ValidationError('Profile photo must be a JPEG, PNG, or WebP image.')

    uploaded_file.seek(0)

"""D4-B — the one shared attachment validation doctrine for Email AI
Engineer input ingestion (Feature 14 V4).

Same core rule as employees/validators.py and this app's own
validators.py (EmailAsset): never trust a filename extension or a
client-supplied Content-Type header — decode/parse the bytes and let the
real structure decide. This module is deliberately separate from
validators.py rather than extending it: EmailAsset validates exactly one
concept (an image, for the module renderer) and must not be touched by
D4-B's broader document-type doctrine (see the D4-B completion report for
why: "do not weaken the existing EmailAsset validator").

Where the two doctrines overlap (image decode-and-verify), this module
follows the identical Pillow verify()-then-reopen pattern used by
EmailAsset/profile-photo validation — same approach, independent code,
so a future change to one can never silently affect the other's
behaviour for its own, differently-scoped, upload path.
"""

from dataclasses import dataclass, field

from django.conf import settings
from django.core.exceptions import ValidationError

from PIL import Image, UnidentifiedImageError

# --- supported / rejected type doctrine ------------------------------------

TEXT = 'text'
CSV = 'csv'
MARKDOWN = 'markdown'
PDF = 'pdf'
DOCX = 'docx'
XLSX = 'xlsx'
IMAGE = 'image'

_EXTENSION_TO_TYPE = {
    'txt': TEXT,
    'csv': CSV,
    'md': MARKDOWN,
    'markdown': MARKDOWN,
    'pdf': PDF,
    'docx': DOCX,
    'xlsx': XLSX,
    'png': IMAGE,
    'jpg': IMAGE,
    'jpeg': IMAGE,
    'webp': IMAGE,
}

# Legacy binary Office formats — never supported. Rejected up front, by
# extension, regardless of actual byte content (see module docstring:
# "explicitly reject", a hard rule, not a content sniff), AND separately
# by OLE magic-byte sniff below so a renamed .doc/.xls can't slip past by
# claiming a different extension.
_REJECTED_EXTENSIONS = {
    'doc': 'legacy Word (.doc)',
    'xls': 'legacy Excel (.xls)',
}

_REJECT_MESSAGE_TEMPLATE = (
    "{kind} files aren't supported for direct upload. Please convert it to "
    '.docx, .xlsx, .csv, or .pdf and upload again.'
)
_UNSUPPORTED_MESSAGE = (
    "This file type isn't supported. Supported types: .txt, .csv, .md, "
    '.pdf, .docx, .xlsx, .png, .jpg, .jpeg, .webp.'
)

# Magic-byte signatures — sniffed regardless of extension, both to
# classify plain-text-vs-binary intent and to catch a mismatched/renamed
# file before any parser touches it.
_OLE_MAGIC = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'  # legacy .doc/.xls/.ppt
_ZIP_MAGIC = b'PK\x03\x04'  # .docx/.xlsx (both are zip containers)
_PDF_MAGIC = b'%PDF-'

_IMAGE_FORMAT_TO_CONTENT_TYPE = {
    'JPEG': 'image/jpeg',
    'PNG': 'image/png',
    'WEBP': 'image/webp',
}

_MAGIC_SNIFF_BYTES = 16


@dataclass(frozen=True)
class ClassificationResult:
    detected_type: str
    content_type: str
    # Populated only for detected_type == IMAGE (width/height/format), so
    # the extractor doesn't need to decode the same bytes a third time.
    probe_meta: dict = field(default_factory=dict)


class RejectedAttachmentType(ValidationError):
    """Raised for a file type this app deliberately refuses (.doc/.xls or
    anything outside the supported list) — distinct from a malformed file
    of an otherwise-supported type, so the view can return the specific
    convert-your-file guidance rather than a generic validation error."""


def _extension_of(filename: str) -> str:
    if '.' not in filename:
        return ''
    return filename.rsplit('.', 1)[-1].lower()


def _looks_like_text(raw_bytes: bytes) -> bool:
    """A cheap, conservative "is this actually text" check — never trusts
    the .txt/.csv/.md extension alone. NUL bytes never appear in real
    text content; a failed UTF-8 decode means the bytes are binary data
    wearing a text extension (the "fake extension/MIME mismatch" case)."""
    if b'\x00' in raw_bytes:
        return False
    try:
        raw_bytes.decode('utf-8')
    except UnicodeDecodeError:
        return False
    return True


def _probe_image(uploaded_file) -> tuple[str, dict]:
    """Decode-and-verify an image, mirroring the existing EmailAsset/
    profile-photo pattern. Raises ValidationError on any failure."""
    uploaded_file.seek(0)
    try:
        probe = Image.open(uploaded_file)
        probe.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValidationError('Attachment is not a valid image.')

    # verify() leaves the Image object unusable for further access; the
    # underlying file handle must be re-opened to read format/size.
    uploaded_file.seek(0)
    try:
        reopened = Image.open(uploaded_file)
        detected_format = reopened.format
        width, height = reopened.size
        reopened.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValidationError('Attachment is not a valid image.')

    content_type = _IMAGE_FORMAT_TO_CONTENT_TYPE.get(detected_format or '')
    if content_type is None:
        raise ValidationError('Attachment must be a JPEG, PNG, or WebP image.')

    uploaded_file.seek(0)
    return content_type, {'width': width, 'height': height, 'format': detected_format}


def classify_and_validate_upload(uploaded_file, original_filename: str) -> ClassificationResult:
    """Validate one uploaded attachment and classify its type.

    Raises RejectedAttachmentType for a deliberately-unsupported format
    (.doc/.xls, or anything outside the supported list) with an
    actionable message. Raises ValidationError for a supported extension
    whose content fails structural validation (oversized, empty,
    mismatched, or otherwise not real content of the claimed type).
    """
    extension = _extension_of(original_filename)

    if extension in _REJECTED_EXTENSIONS:
        raise RejectedAttachmentType(
            _REJECT_MESSAGE_TEMPLATE.format(kind=_REJECTED_EXTENSIONS[extension].capitalize()),
        )

    if uploaded_file.size > settings.EMAIL_ATTACHMENT_MAX_BYTES:
        max_mb = settings.EMAIL_ATTACHMENT_MAX_BYTES // (1024 * 1024)
        raise ValidationError(f'Attachment must be {max_mb} MB or smaller.')

    if uploaded_file.size == 0:
        raise ValidationError('Attachment is empty.')

    uploaded_file.seek(0)
    head = uploaded_file.read(_MAGIC_SNIFF_BYTES)
    uploaded_file.seek(0)

    # Defense-in-depth: a real legacy OLE binary is rejected even if it
    # was renamed to claim a different, unrelated extension.
    if head.startswith(_OLE_MAGIC):
        raise RejectedAttachmentType(
            _REJECT_MESSAGE_TEMPLATE.format(kind='Legacy Word/Excel (.doc/.xls)'),
        )

    detected_type = _EXTENSION_TO_TYPE.get(extension)
    if detected_type is None:
        raise RejectedAttachmentType(_UNSUPPORTED_MESSAGE)

    if detected_type == IMAGE:
        content_type, probe_meta = _probe_image(uploaded_file)
        return ClassificationResult(detected_type=IMAGE, content_type=content_type, probe_meta=probe_meta)

    if detected_type == PDF:
        if not head.startswith(_PDF_MAGIC):
            raise ValidationError('Attachment is not a valid PDF.')
        return ClassificationResult(detected_type=PDF, content_type='application/pdf')

    if detected_type in (DOCX, XLSX):
        if not head.startswith(_ZIP_MAGIC):
            kind = 'DOCX' if detected_type == DOCX else 'XLSX'
            raise ValidationError(f'Attachment is not a valid {kind} file.')
        content_type = (
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            if detected_type == DOCX
            else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        return ClassificationResult(detected_type=detected_type, content_type=content_type)

    # TEXT / CSV / MARKDOWN — plain-text family.
    raw = uploaded_file.read()
    uploaded_file.seek(0)
    if not _looks_like_text(raw):
        raise ValidationError('Attachment does not look like a text file.')
    content_type = {'text': 'text/plain', 'csv': 'text/csv', 'markdown': 'text/markdown'}[detected_type]
    return ClassificationResult(detected_type=detected_type, content_type=content_type)

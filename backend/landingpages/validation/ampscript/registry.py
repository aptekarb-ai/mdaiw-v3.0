"""Server-owned AMPscript function registry. The API request can never
extend or alter this — it is a fixed Python module, imported, never built
from request data. Deliberately incomplete: real AMPscript has well over a
hundred functions; this covers the CloudPages-relevant and common-utility
functions this sprint's validator actually reasons about. Unknown functions
are reported as a low-confidence warning (see functions.py), never a hard
error, so the incompleteness of this table never blocks a legitimate call.
"""

from dataclasses import dataclass

CATEGORY_UTILITY = 'utility'
CATEGORY_STRING = 'string'
CATEGORY_DATETIME = 'datetime'
CATEGORY_MATH = 'math'
CATEGORY_ROWSET = 'rowset'
CATEGORY_DATA_EXTENSION = 'data-extension'
CATEGORY_HTTP = 'http'
CATEGORY_CLOUDPAGES = 'cloudpages'
CATEGORY_CONTENT = 'content'
CATEGORY_ENCRYPTION = 'encryption'
CATEGORY_PERSONALIZATION = 'personalization'


@dataclass(frozen=True)
class FunctionSpec:
    name: str
    category: str
    min_params: int
    max_params: int | None  # None = unbounded
    cloudpages_suitable: bool = True
    security_sensitive: bool = False
    deprecated: bool = False
    doc_ref: str = ''


_FUNCTIONS: tuple[FunctionSpec, ...] = (
    # Utility
    FunctionSpec('V', CATEGORY_UTILITY, 1, 1, doc_ref='ampscript-v'),
    FunctionSpec('EMPTY', CATEGORY_UTILITY, 1, 1, doc_ref='ampscript-empty'),
    FunctionSpec('IIF', CATEGORY_UTILITY, 3, 3, doc_ref='ampscript-iif'),
    FunctionSpec('OUTPUTLINE', CATEGORY_UTILITY, 1, None, doc_ref='ampscript-outputline'),
    FunctionSpec('RAISEERROR', CATEGORY_UTILITY, 1, 2, doc_ref='ampscript-raiseerror'),
    # String
    FunctionSpec('CONCAT', CATEGORY_STRING, 1, None, doc_ref='ampscript-concat'),
    FunctionSpec('FORMAT', CATEGORY_STRING, 2, 2, doc_ref='ampscript-format'),
    FunctionSpec('LENGTH', CATEGORY_STRING, 1, 1, doc_ref='ampscript-length'),
    FunctionSpec('LOWERCASE', CATEGORY_STRING, 1, 1, doc_ref='ampscript-lowercase'),
    FunctionSpec('UPPERCASE', CATEGORY_STRING, 1, 1, doc_ref='ampscript-uppercase'),
    FunctionSpec('TRIM', CATEGORY_STRING, 1, 1, doc_ref='ampscript-trim'),
    FunctionSpec('REPLACE', CATEGORY_STRING, 3, 3, doc_ref='ampscript-replace'),
    FunctionSpec('SUBSTRING', CATEGORY_STRING, 2, 3, doc_ref='ampscript-substring'),
    FunctionSpec('INDEXOF', CATEGORY_STRING, 2, 2, doc_ref='ampscript-indexof'),
    # Date/time
    FunctionSpec('NOW', CATEGORY_DATETIME, 0, 1, doc_ref='ampscript-now'),
    FunctionSpec('DATEADD', CATEGORY_DATETIME, 3, 3, doc_ref='ampscript-dateadd'),
    FunctionSpec('DATEDIFF', CATEGORY_DATETIME, 3, 3, doc_ref='ampscript-datediff'),
    FunctionSpec('FORMATDATE', CATEGORY_DATETIME, 2, 2, doc_ref='ampscript-formatdate'),
    # Math
    FunctionSpec('ADD', CATEGORY_MATH, 2, 2, doc_ref='ampscript-add'),
    FunctionSpec('SUBTRACT', CATEGORY_MATH, 2, 2, doc_ref='ampscript-subtract'),
    FunctionSpec('MULTIPLY', CATEGORY_MATH, 2, 2, doc_ref='ampscript-multiply'),
    FunctionSpec('DIVIDE', CATEGORY_MATH, 2, 2, doc_ref='ampscript-divide'),
    FunctionSpec('FORMATNUMBER', CATEGORY_MATH, 2, 2, doc_ref='ampscript-formatnumber'),
    # Row / rowset
    FunctionSpec('ROW', CATEGORY_ROWSET, 2, 2, doc_ref='ampscript-row'),
    FunctionSpec('ROWCOUNT', CATEGORY_ROWSET, 1, 1, doc_ref='ampscript-rowcount'),
    FunctionSpec('FIELD', CATEGORY_ROWSET, 2, 2, doc_ref='ampscript-field'),
    # Data Extension
    FunctionSpec('LOOKUP', CATEGORY_DATA_EXTENSION, 3, None, doc_ref='ampscript-lookup'),
    FunctionSpec('LOOKUPROWS', CATEGORY_DATA_EXTENSION, 3, None, doc_ref='ampscript-lookuprows'),
    FunctionSpec(
        'INSERTDATA', CATEGORY_DATA_EXTENSION, 3, None,
        security_sensitive=True, doc_ref='ampscript-insertdata',
    ),
    FunctionSpec(
        'UPDATEDATA', CATEGORY_DATA_EXTENSION, 3, None,
        security_sensitive=True, doc_ref='ampscript-updatedata',
    ),
    FunctionSpec(
        'UPSERTDATA', CATEGORY_DATA_EXTENSION, 3, None,
        security_sensitive=True, doc_ref='ampscript-upsertdata',
    ),
    FunctionSpec(
        'DELETEDATA', CATEGORY_DATA_EXTENSION, 2, None,
        security_sensitive=True, doc_ref='ampscript-deletedata',
    ),
    # HTTP
    FunctionSpec('HTTPGET', CATEGORY_HTTP, 1, 1, security_sensitive=True, doc_ref='ampscript-httpget'),
    FunctionSpec('HTTPPOST', CATEGORY_HTTP, 3, 4, security_sensitive=True, doc_ref='ampscript-httppost'),
    # CloudPages / site
    FunctionSpec('REQUESTPARAMETER', CATEGORY_CLOUDPAGES, 1, 1, security_sensitive=True, doc_ref='ampscript-requestparameter'),
    FunctionSpec('QUERYPARAMETER', CATEGORY_CLOUDPAGES, 1, 1, security_sensitive=True, doc_ref='ampscript-queryparameter'),
    FunctionSpec('ATTRIBUTEVALUE', CATEGORY_CLOUDPAGES, 1, 1, doc_ref='ampscript-attributevalue'),
    FunctionSpec('CLOUDPAGESURL', CATEGORY_CLOUDPAGES, 1, 2, doc_ref='ampscript-cloudpagesurl'),
    FunctionSpec('REDIRECTTO', CATEGORY_CLOUDPAGES, 1, 1, security_sensitive=True, doc_ref='ampscript-redirectto'),
    # Content
    FunctionSpec('TREATASCONTENT', CATEGORY_CONTENT, 1, 1, security_sensitive=True, doc_ref='ampscript-treatascontent'),
    FunctionSpec('CONTENTBLOCKBYNAME', CATEGORY_CONTENT, 1, 1, doc_ref='ampscript-contentblockbyname'),
    FunctionSpec('CONTENTBLOCKBYID', CATEGORY_CONTENT, 1, 1, doc_ref='ampscript-contentblockbyid'),
    # Encryption
    FunctionSpec('ENCRYPTSYMMETRIC', CATEGORY_ENCRYPTION, 2, 4, security_sensitive=True, doc_ref='ampscript-encryptsymmetric'),
    FunctionSpec('DECRYPTSYMMETRIC', CATEGORY_ENCRYPTION, 2, 4, security_sensitive=True, doc_ref='ampscript-decryptsymmetric'),
    FunctionSpec('GUID', CATEGORY_ENCRYPTION, 0, 0, doc_ref='ampscript-guid'),
    # Personalization
    FunctionSpec('AMPSCRIPTINCLUDEONSEND', CATEGORY_PERSONALIZATION, 1, 1, doc_ref='ampscript-includeonsend'),
)

REGISTRY: dict[str, FunctionSpec] = {spec.name: spec for spec in _FUNCTIONS}


def get_function(name: str) -> FunctionSpec | None:
    return REGISTRY.get(name.upper())

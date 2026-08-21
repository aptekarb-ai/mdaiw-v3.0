"""Project-wide DRF exception handler.

The rest of MDAIW's hand-rolled JsonResponse views (accounts, faceauth,
yukti) all return the same error envelope on failure:
    {"success": false, "code": "...", "message": "...", "errors"?: {...}}
and frontend/src/api/client.ts's apiRequest() only ever reads
body.message / body.code / body.errors / body.request_id on a non-2xx
response. DRF's own default exception responses ({"detail": "..."} for
auth/permission/not-found errors, a bare {"field": ["msg"]} dict for
validation errors) don't carry a top-level "message" or "code" at all, so
without this handler every DRF-view error would silently fall through to
apiRequest's generic "Something went wrong" fallback and never set `code`.

Registered globally via REST_FRAMEWORK['EXCEPTION_HANDLER'] in
settings.py — landingpages is currently the only DRF consumer, so in
practice this only reshapes landingpages error responses today, but it's
registered project-wide (not per-app) so any future DRF view gets the same
envelope for free rather than needing this reasoned through again.
"""

from rest_framework.views import exception_handler as _drf_exception_handler

_CODE_BY_STATUS = {
    400: 'VALIDATION_ERROR',
    401: 'AUTHENTICATION_REQUIRED',
    403: 'PERMISSION_DENIED',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    429: 'THROTTLED',
}


def mdaiw_exception_handler(exc, context):
    response = _drf_exception_handler(exc, context)
    if response is None:
        # Not a DRF-recognized exception (e.g. an unhandled server error) —
        # let Django's normal 500 handling take over rather than guessing.
        return None

    detail = response.data
    code = _CODE_BY_STATUS.get(response.status_code, 'ERROR')

    if isinstance(detail, dict) and 'detail' in detail:
        message = str(detail['detail'])
        errors = None
    elif isinstance(detail, dict):
        # Serializer field errors, e.g. {"name": ["This field is required."]}
        message = 'Please correct the highlighted fields.'
        errors = detail
    else:
        message = str(detail)
        errors = None

    response.data = {'success': False, 'code': code, 'message': message}
    if errors:
        response.data['errors'] = errors
    return response

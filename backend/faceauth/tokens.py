from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing

from employees.models import EmployeeProfile, RegistrationStatus

_SALT = 'faceauth.enrollment-authorization'

User = get_user_model()


class EnrollmentTokenInvalid(Exception):
    """Raised for any expired, malformed, or no-longer-applicable enrollment token."""


def issue_enrollment_token(user):
    """Short-lived signed token authorizing Face Enrollment for a pending user.

    Not a Django session — held in frontend memory only, never Local/Session
    Storage. Its cryptographic validity window is
    FACE_ENROLLMENT_TOKEN_TTL_SECONDS; independent of that, it becomes
    unusable the moment the user is no longer PENDING_FACE_ENROLLMENT
    (checked again at verification time), which is what makes it single-use
    in practice once enrollment actually succeeds.
    """
    return signing.dumps({'user_id': user.id}, salt=_SALT)


def verify_enrollment_token(token):
    """Return the pending User authorized by this token, or raise.

    Re-checks is_active/registration_status at verification time so a token
    issued before a successful enrollment cannot be replayed afterward.
    """
    try:
        payload = signing.loads(token, salt=_SALT, max_age=settings.FACE_ENROLLMENT_TOKEN_TTL_SECONDS)
    except signing.SignatureExpired as exc:
        raise EnrollmentTokenInvalid('Enrollment authorization has expired.') from exc
    except signing.BadSignature as exc:
        raise EnrollmentTokenInvalid('Enrollment authorization is invalid.') from exc

    try:
        user = User.objects.get(pk=payload['user_id'])
    except (User.DoesNotExist, KeyError) as exc:
        raise EnrollmentTokenInvalid('Enrollment authorization is invalid.') from exc

    if user.is_active:
        raise EnrollmentTokenInvalid('This account is already active.')

    try:
        profile = user.employee_profile
    except EmployeeProfile.DoesNotExist as exc:
        raise EnrollmentTokenInvalid('Enrollment authorization is invalid.') from exc

    if profile.registration_status != RegistrationStatus.PENDING_FACE_ENROLLMENT:
        raise EnrollmentTokenInvalid('Enrollment authorization is invalid.')

    return user

import json
import random
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model, login
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from employees.models import EmployeeProfile, RegistrationStatus

from . import lockout, service, throttling
from .encryption import EmbeddingDecryptionFailed, EncryptionKeyMissing
from .hashing import generate_token, hash_token, keyed_hash
from .models import FaceChallenge, FaceChallengePurpose, FaceCredential, FaceLoginAttempt
from .tokens import EnrollmentTokenInvalid, issue_enrollment_token, verify_enrollment_token

User = get_user_model()

ALL_CHALLENGE_ACTIONS = ['LOOK_CENTER', 'TURN_LEFT', 'TURN_RIGHT', 'BLINK']

GENERIC_FACE_LOGIN_FAILURE = {
    'success': False,
    'code': 'FACE_AUTHENTICATION_FAILED',
    'message': 'Face sign-in could not be completed. Use your password or try again.',
}

ENROLLMENT_RESUME_FAILURE = {
    'success': False,
    'code': 'ENROLLMENT_RESUME_FAILED',
    'message': 'We could not resume Face Enrollment with the details provided.',
}

_ENROLL_ERROR_MESSAGES = {
    'CAMERA_FRAME_INVALID': 'One of the submitted frames was not a valid image.',
    'FRAME_TOO_LARGE': 'One of the submitted frames exceeded the maximum allowed size.',
    'NO_FACE': 'No face was detected. Position your face in the frame and try again.',
    'MULTIPLE_FACES': 'Multiple faces were detected. Only one person should be visible.',
    'LIVENESS_FAILED': 'We could not verify liveness. Try again in good lighting.',
    'INCONSISTENT_FRAMES': 'Frames did not consistently show the same person. Please retry the capture.',
}
_ENROLL_FALLBACK_MESSAGE = 'Face Enrollment could not be completed. Please try again.'


def _serialize_user(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
    }


def _client_ip(request):
    return request.META.get('REMOTE_ADDR', '') or 'unknown'


def _client_user_agent(request):
    return (request.META.get('HTTP_USER_AGENT', '') or 'unknown')[:255]


def _json_body(request):
    try:
        return json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return {}


@require_POST
def challenge_view(request):
    payload = _json_body(request)
    purpose = payload.get('purpose')

    if purpose == FaceChallengePurpose.ENROLL:
        enrollment_token = payload.get('enrollment_token') or ''
        try:
            user = verify_enrollment_token(enrollment_token)
        except EnrollmentTokenInvalid:
            return JsonResponse(
                {
                    'success': False,
                    'code': 'ENROLLMENT_TOKEN_INVALID',
                    'message': 'Face Enrollment authorization is invalid or has expired.',
                },
                status=400,
            )
    elif purpose == FaceChallengePurpose.LOGIN:
        username = (payload.get('username') or '').strip()
        if not username:
            return JsonResponse(
                {'success': False, 'code': 'USERNAME_REQUIRED', 'message': 'Username is required.'},
                status=400,
            )
        # Username may or may not resolve to a real, enrolled, active account —
        # a challenge is issued either way so the response never reveals
        # whether the account or credential exists.
        user = User.objects.filter(username=username).first()
    else:
        return JsonResponse(
            {'success': False, 'code': 'INVALID_PURPOSE', 'message': 'Unsupported challenge purpose.'},
            status=400,
        )

    token = None
    for _ in range(5):
        candidate = generate_token()
        if not FaceChallenge.objects.filter(token_hash=hash_token(candidate)).exists():
            token = candidate
            break
    if token is None:
        return JsonResponse(
            {'success': False, 'code': 'SERVICE_ERROR', 'message': 'Could not create a challenge. Try again.'},
            status=500,
        )

    actions = random.sample(ALL_CHALLENGE_ACTIONS, k=3)
    ttl = settings.FACE_CHALLENGE_TTL_SECONDS

    FaceChallenge.objects.create(
        token_hash=hash_token(token),
        purpose=purpose,
        user=user,
        challenge_actions=actions,
        expires_at=timezone.now() + timedelta(seconds=ttl),
    )

    return JsonResponse(
        {
            'success': True,
            'challenge': {'token': token, 'actions': actions, 'expires_in': ttl},
        }
    )


def _load_valid_challenge(challenge_token, purpose):
    """Return (challenge, error_response) — error_response is None on success."""
    try:
        challenge = FaceChallenge.objects.get(token_hash=hash_token(challenge_token or ''), purpose=purpose)
    except FaceChallenge.DoesNotExist:
        return None, JsonResponse(
            {'success': False, 'code': 'CHALLENGE_INVALID', 'message': 'Challenge is invalid or has expired.'},
            status=400,
        )

    if challenge.is_used() or challenge.is_expired():
        return None, JsonResponse(
            {'success': False, 'code': 'CHALLENGE_INVALID', 'message': 'Challenge is invalid or has expired.'},
            status=400,
        )

    return challenge, None


@require_POST
def enroll_view(request):
    enrollment_token = request.POST.get('enrollment_token') or ''
    challenge_token = request.POST.get('challenge_token') or ''
    consent = (request.POST.get('consent') or '').lower() in ('true', '1', 'on', 'yes')
    frames = request.FILES.getlist('frames')

    try:
        user = verify_enrollment_token(enrollment_token)
    except EnrollmentTokenInvalid:
        return JsonResponse(
            {
                'success': False,
                'code': 'ENROLLMENT_TOKEN_INVALID',
                'message': 'Face Enrollment authorization is invalid or has expired.',
            },
            status=400,
        )

    challenge, error_response = _load_valid_challenge(challenge_token, FaceChallengePurpose.ENROLL)
    if error_response is not None:
        return error_response
    if challenge.user_id != user.id:
        return JsonResponse(
            {'success': False, 'code': 'CHALLENGE_INVALID', 'message': 'Challenge is invalid or has expired.'},
            status=400,
        )

    if not consent:
        return JsonResponse(
            {
                'success': False,
                'code': 'CONSENT_REQUIRED',
                'message': 'Facial-data processing consent is required to enroll.',
            },
            status=400,
        )

    if not (2 <= len(frames) <= settings.FACE_MAX_FRAMES):
        return JsonResponse(
            {
                'success': False,
                'code': 'FRAME_COUNT_INVALID',
                'message': 'An unexpected number of frames was submitted.',
            },
            status=400,
        )

    challenge.used_at = timezone.now()
    challenge.save(update_fields=['used_at'])

    try:
        credential_kwargs = service.enroll(user, frames)
    except (service.FaceServiceError, EncryptionKeyMissing) as exc:
        code = getattr(exc, 'code', 'SERVICE_ERROR')
        message = _ENROLL_ERROR_MESSAGES.get(code, _ENROLL_FALLBACK_MESSAGE)
        return JsonResponse({'success': False, 'code': code, 'message': message}, status=400)

    try:
        with transaction.atomic():
            FaceCredential.objects.create(user=user, **credential_kwargs)
            user.is_active = True
            user.save(update_fields=['is_active'])
            profile = user.employee_profile
            profile.registration_status = RegistrationStatus.ACTIVE
            profile.save(update_fields=['registration_status'])
    except IntegrityError:
        return JsonResponse(
            {'success': False, 'code': 'SERVICE_ERROR', 'message': _ENROLL_FALLBACK_MESSAGE},
            status=400,
        )

    user.backend = 'django.contrib.auth.backends.ModelBackend'
    login(request, user)

    return JsonResponse(
        {
            'success': True,
            'message': 'Face Enrollment completed successfully.',
            'account_status': RegistrationStatus.ACTIVE,
            'face_enrolled': True,
        },
        status=201,
    )


@require_POST
def verify_view(request):
    username = (request.POST.get('username') or '').strip()
    challenge_token = request.POST.get('challenge_token') or ''
    frames = request.FILES.getlist('frames')

    if not username:
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    username_hash = keyed_hash(username)
    ip_hash = keyed_hash(_client_ip(request))
    user_agent_hash = keyed_hash(_client_user_agent(request))

    def record(user, success, reason_code, distance=None, threshold=None):
        FaceLoginAttempt.objects.create(
            user=user,
            username_hash=username_hash,
            success=success,
            reason_code=reason_code,
            distance=distance,
            threshold=threshold,
            ip_hash=ip_hash,
            user_agent_hash=user_agent_hash,
        )

    if lockout.is_locked_out(username_hash):
        record(None, False, 'TEMPORARILY_LOCKED')
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    challenge, error_response = _load_valid_challenge(challenge_token, FaceChallengePurpose.LOGIN)
    if error_response is not None:
        record(None, False, 'CHALLENGE_INVALID')
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    challenge.used_at = timezone.now()
    challenge.save(update_fields=['used_at'])

    if not (1 <= len(frames) <= settings.FACE_MAX_FRAMES):
        record(None, False, 'FRAME_COUNT_INVALID')
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    user = User.objects.filter(username=username).first()
    if user is None or not user.is_active:
        record(user, False, 'ACCOUNT_UNAVAILABLE')
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    credential = FaceCredential.objects.filter(user=user, is_active=True).first()
    if credential is None:
        record(user, False, 'FACE_NOT_ENROLLED')
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    try:
        result = service.verify(credential, frames)
    except (service.FaceServiceError, EncryptionKeyMissing, EmbeddingDecryptionFailed) as exc:
        code = getattr(exc, 'code', 'SERVICE_ERROR')
        record(user, False, code)
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    if not result['verified']:
        record(user, False, 'FACE_NOT_MATCHED', distance=result['distance'], threshold=result['threshold'])
        return JsonResponse(GENERIC_FACE_LOGIN_FAILURE, status=401)

    record(user, True, 'FACE_VERIFIED', distance=result['distance'], threshold=result['threshold'])
    credential.last_verified_at = timezone.now()
    credential.save(update_fields=['last_verified_at'])

    user.backend = 'django.contrib.auth.backends.ModelBackend'
    login(request, user)

    return JsonResponse(
        {
            'success': True,
            'message': 'Signed in successfully.',
            'user': _serialize_user(user),
        }
    )


@require_GET
def status_view(request):
    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'code': 'AUTHENTICATION_REQUIRED', 'message': 'Sign in required.'}, status=401)

    credential = FaceCredential.objects.filter(user=request.user).first()
    if credential is None:
        return JsonResponse(
            {
                'success': True,
                'enrolled': False,
                'active': False,
                'model_name': None,
                'enrolled_at': None,
                'last_verified_at': None,
            }
        )

    return JsonResponse(
        {
            'success': True,
            'enrolled': True,
            'active': credential.is_active,
            'model_name': credential.model_name,
            'enrolled_at': credential.created_at.isoformat(),
            'last_verified_at': credential.last_verified_at.isoformat() if credential.last_verified_at else None,
        }
    )


@require_http_methods(['DELETE'])
def enrollment_view(request):
    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'code': 'AUTHENTICATION_REQUIRED', 'message': 'Sign in required.'}, status=401)

    payload = _json_body(request)
    password = payload.get('password') or ''

    if not request.user.check_password(password):
        return JsonResponse(
            {'success': False, 'code': 'INVALID_PASSWORD', 'message': 'Current password is incorrect.'},
            status=400,
        )

    credential = FaceCredential.objects.filter(user=request.user, is_active=True).first()
    if credential is not None:
        credential.is_active = False
        credential.revoked_at = timezone.now()
        credential.save(update_fields=['is_active', 'revoked_at'])

    return JsonResponse({'success': True, 'message': 'Face Recognition enrollment has been removed.'})


@require_POST
def enrollment_resume_view(request):
    payload = _json_body(request)
    username = (payload.get('username') or '').strip()
    password = payload.get('password') or ''
    identifier = f'{_client_ip(request)}:{username.lower()}'

    if throttling.is_throttled(
        'face-enroll-resume',
        identifier,
        settings.FACE_ENROLLMENT_RESUME_MAX_ATTEMPTS,
        settings.FACE_ENROLLMENT_RESUME_WINDOW_MINUTES * 60,
    ):
        return JsonResponse(ENROLLMENT_RESUME_FAILURE, status=429)

    throttling.record_attempt(
        'face-enroll-resume', identifier, settings.FACE_ENROLLMENT_RESUME_WINDOW_MINUTES * 60
    )

    if not username or not password:
        return JsonResponse(ENROLLMENT_RESUME_FAILURE, status=400)

    user = User.objects.filter(username=username).first()
    if user is None or user.is_active:
        return JsonResponse(ENROLLMENT_RESUME_FAILURE, status=400)

    try:
        profile = user.employee_profile
    except EmployeeProfile.DoesNotExist:
        return JsonResponse(ENROLLMENT_RESUME_FAILURE, status=400)

    if profile.registration_status != RegistrationStatus.PENDING_FACE_ENROLLMENT:
        return JsonResponse(ENROLLMENT_RESUME_FAILURE, status=400)

    if not user.check_password(password):
        return JsonResponse(ENROLLMENT_RESUME_FAILURE, status=400)

    return JsonResponse({'success': True, 'enrollment_token': issue_enrollment_token(user)})

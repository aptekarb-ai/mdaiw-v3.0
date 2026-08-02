import concurrent.futures
import json
import logging
import random
import time
import uuid
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
from .models import FaceChallenge, FaceChallengePurpose, FaceCredential, FaceEnrollmentProof, FaceLoginAttempt
from .tokens import EnrollmentTokenInvalid, issue_enrollment_token, verify_enrollment_token

User = get_user_model()

logger = logging.getLogger('faceauth.views')

# Bounds the synchronous biometric-processing call in enrollment_proof_view so
# a slow/stuck model call can never leave the HTTP request (and therefore the
# frontend's "verifying" UI) hanging indefinitely. Reused as a module-level
# singleton rather than created per-request — the pool itself is cheap and
# long-lived; only the work submitted to it is expensive. Whatever the
# submitted call is doing continues in its worker thread even if we give up
# waiting on it (Python cannot forcibly cancel a running thread); this is
# safe here because service.enroll() never writes to the database — an
# abandoned call has no result the request path will ever look at.
_ENROLLMENT_PROOF_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix='face-enrollment-proof'
)

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
    'POOR_LIGHTING': 'Move to a brighter area with light facing you.',
    'BLURRY_FRAME': 'Hold still while each image is captured.',
    'NO_FACE_DETECTED': 'Keep your complete face visible inside the guide.',
    'MULTIPLE_FACES_DETECTED': 'Only one person may be visible during Face Enrollment.',
    'FACE_TOO_SMALL': 'Move slightly closer to the camera.',
    'FACE_NOT_CENTERED': 'Position your face inside the centre guide.',
    'FACE_DETECTION_FAILED': 'We could not process this frame. Please try again.',
    'INVALID_FACE_CROP': 'We could not process the detected face. Please try again.',
    'LIVENESS_FAILED': 'We could not confirm the requested movement. Please repeat the challenge.',
    'SPOOF_DETECTED': 'A live face could not be confirmed.',
    'IDENTITY_INCONSISTENT': 'The captured images did not appear consistent. Please complete the challenge again.',
    'MODEL_UNAVAILABLE': 'Secure Face Enrollment is temporarily unavailable. Please try again.',
    'MODEL_INITIALIZATION_FAILED': 'Face Enrollment could not start. Please try again in a moment.',
    'FACE_PROCESSING_FAILED': 'Face Enrollment could not be completed. Please try again.',
    'ANTI_SPOOF_MODEL_UNAVAILABLE': 'Secure Face Enrollment is temporarily unavailable. Please try again.',
    'ANTI_SPOOF_PROCESSING_FAILED': 'We could not verify liveness for this frame. Please try again.',
}
_ENROLL_FALLBACK_MESSAGE = 'Face Enrollment could not be completed. Please try again.'
_FACE_PROCESSING_TIMEOUT_MESSAGE = 'Face Enrollment validation took too long. Please try again.'
_ENROLLMENT_PROOF_FAILED_MESSAGE = 'Face Enrollment could not be saved. Please try again.'


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


@require_GET
def readiness_view(request):
    """Public, unauthenticated — the frontend polls this before ever
    opening the camera for Face Enrollment/Face Recognition login. Reports
    on both the currently configured FaceRecognitionEngine
    (`settings.FACE_RECOGNITION_ENGINE`) and the anti-spoofing provider —
    enrollment needs both READY, since OpenCV YuNet+SFace has no
    anti-spoofing of its own. Never exposes model names, exception
    details, or filesystem paths; only one of READY/LOADING/UNAVAILABLE
    plus the engine identifier. A GET here never blocks: if warm-up has
    not been triggered yet for some reason (e.g. the process was started
    some other way than `runserver`/`run_face_server`), it is kicked off
    in the background as a defensive recovery path, but this request
    itself always returns immediately."""
    engine = service.get_engine()
    anti_spoof_provider = service.get_anti_spoof_provider()
    needs_anti_spoof_provider = not engine.includes_anti_spoofing
    engine_status = engine.readiness().status
    anti_spoof_status = anti_spoof_provider.readiness().status if needs_anti_spoof_provider else 'READY'

    if 'UNAVAILABLE' in (engine_status, anti_spoof_status):
        overall = 'UNAVAILABLE'
    elif engine_status == 'READY' and anti_spoof_status == 'READY':
        overall = 'READY'
    else:
        overall = 'LOADING'

    if overall != 'READY':
        engine.start_background_warm_up()
        if needs_anti_spoof_provider:
            anti_spoof_provider.start_background_warm_up()

    if overall == 'READY':
        return JsonResponse({'success': True, 'status': 'READY', 'engine': engine.name})
    if overall == 'UNAVAILABLE':
        return JsonResponse(
            {'success': False, 'status': 'UNAVAILABLE', 'code': 'MODEL_UNAVAILABLE', 'engine': engine.name},
            status=503,
        )
    return JsonResponse({'success': True, 'status': 'LOADING', 'engine': engine.name})


@require_POST
def challenge_view(request):
    payload = _json_body(request)
    purpose = payload.get('purpose')

    if purpose == FaceChallengePurpose.ENROLL:
        enrollment_token = payload.get('enrollment_token') or ''
        if enrollment_token:
            # Recovery-flow enrollment for a previously created pending
            # account (see faceauth/views.py::enrollment_resume_view).
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
            challenge_ttl = settings.FACE_CHALLENGE_TTL_SECONDS
        else:
            # Anonymous, pre-account challenge for the inline registration
            # wizard's Face Enrollment step — no User exists yet. Given a
            # longer TTL than a login/resume challenge because it must
            # survive until the user finishes reviewing Steps 1-2 data and
            # submits the final atomic registration in Step 4.
            identifier = _client_ip(request)
            if throttling.is_throttled(
                'face-enroll-challenge',
                identifier,
                settings.FACE_ENROLLMENT_CHALLENGE_MAX_ATTEMPTS,
                settings.FACE_ENROLLMENT_CHALLENGE_WINDOW_MINUTES * 60,
            ):
                return JsonResponse(
                    {
                        'success': False,
                        'code': 'THROTTLED',
                        'message': 'Too many Face Enrollment attempts. Please try again later.',
                    },
                    status=429,
                )
            throttling.record_attempt(
                'face-enroll-challenge', identifier, settings.FACE_ENROLLMENT_CHALLENGE_WINDOW_MINUTES * 60
            )
            user = None
            challenge_ttl = settings.FACE_ENROLLMENT_TOKEN_TTL_SECONDS
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
        challenge_ttl = settings.FACE_CHALLENGE_TTL_SECONDS
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

    FaceChallenge.objects.create(
        token_hash=hash_token(token),
        purpose=purpose,
        user=user,
        challenge_actions=actions,
        expires_at=timezone.now() + timedelta(seconds=challenge_ttl),
    )

    return JsonResponse(
        {
            'success': True,
            'challenge': {'token': token, 'actions': actions, 'expires_in': challenge_ttl},
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
def enrollment_proof_view(request):
    """Validate registration-wizard Step 3 capture immediately and issue a
    single-use, longer-TTL proof referencing the already-encrypted embedding.

    This is what lets Step 3 truthfully claim "captured successfully" — the
    frames are fully validated (face detection, anti-spoofing, cross-frame
    identity consistency) right here, not deferred to final registration.
    Final registration (accounts/views.py::register_view) only spends the
    proof; it never re-runs biometric validation.
    """
    request_id = uuid.uuid4().hex[:12]
    request_start = time.perf_counter()

    identifier = _client_ip(request)
    if throttling.is_throttled(
        'face-enrollment-proof',
        identifier,
        settings.FACE_ENROLLMENT_PROOF_MAX_ATTEMPTS,
        settings.FACE_ENROLLMENT_PROOF_WINDOW_MINUTES * 60,
    ):
        return JsonResponse(
            {
                'success': False,
                'code': 'THROTTLED',
                'message': 'Too many Face Enrollment attempts. Please try again later.',
                'request_id': request_id,
            },
            status=429,
        )
    throttling.record_attempt(
        'face-enrollment-proof', identifier, settings.FACE_ENROLLMENT_PROOF_WINDOW_MINUTES * 60
    )

    parsing_start = time.perf_counter()
    challenge_token = request.POST.get('challenge_token') or ''
    consent = (request.POST.get('consent') or '').lower() in ('true', '1', 'on', 'yes')
    frames = request.FILES.getlist('frames')
    logger.info(
        'face.enrollment_proof.request_parsing request_id=%s duration=%.2fms',
        request_id,
        (time.perf_counter() - parsing_start) * 1000,
    )

    if not consent:
        return JsonResponse(
            {
                'success': False,
                'code': 'CONSENT_REQUIRED',
                'message': 'Facial-data processing consent is required to enroll.',
                'request_id': request_id,
            },
            status=400,
        )

    challenge = FaceChallenge.objects.filter(
        token_hash=hash_token(challenge_token),
        purpose=FaceChallengePurpose.ENROLL,
        user__isnull=True,
    ).first()
    if challenge is None or challenge.is_used() or challenge.is_expired():
        return JsonResponse(
            {
                'success': False,
                'code': 'CHALLENGE_INVALID',
                'message': 'The secure Face Enrollment challenge expired. Please complete Face Enrollment again.',
                'request_id': request_id,
            },
            status=400,
        )

    if not (2 <= len(frames) <= settings.FACE_MAX_FRAMES):
        return JsonResponse(
            {
                'success': False,
                'code': 'FRAME_COUNT_INVALID',
                'message': 'An unexpected number of Face Enrollment frames was submitted.',
                'request_id': request_id,
            },
            status=400,
        )

    # Fail fast rather than let a request block on a slow first-time model
    # load inside its own timeout budget. In normal operation this
    # readiness was already established when the server process started
    # (faceauth/apps.py::FaceauthConfig.ready(), or manage.py run_face_server)
    # — this check should only ever fail in the brief window right after
    # that process starts, or if a model genuinely failed to load. Checks
    # both the configured FaceRecognitionEngine and the anti-spoofing
    # provider — OpenCV YuNet+SFace has no anti-spoofing of its own, so
    # both must be ready for a real enrollment attempt to succeed. Kicking
    # off warm-up here too is a defensive no-op in the normal case
    # (start_background_warm_up() is idempotent) and a real recovery path
    # if the process was started some other way that skipped the
    # app-ready hook.
    engine = service.get_engine()
    anti_spoof_provider = service.get_anti_spoof_provider()
    # The separate anti-spoofing provider is only actually used for an
    # engine that does not already fuse anti-spoofing into detection (see
    # FaceRecognitionEngine.includes_anti_spoofing) — don't require it
    # ready for an engine that will never call it.
    needs_anti_spoof_provider = not engine.includes_anti_spoofing
    engine_ready = engine.readiness().status == 'READY'
    anti_spoof_ready = anti_spoof_provider.readiness().status == 'READY' if needs_anti_spoof_provider else True
    if not engine_ready or not anti_spoof_ready:
        engine.start_background_warm_up()
        if needs_anti_spoof_provider:
            anti_spoof_provider.start_background_warm_up()
        for frame in frames:
            frame.close()
        logger.warning('face.enrollment_proof.models_not_ready request_id=%s', request_id)
        return JsonResponse(
            {
                'success': False,
                'code': 'MODEL_UNAVAILABLE',
                'message': _ENROLL_ERROR_MESSAGES['MODEL_UNAVAILABLE'],
                'request_id': request_id,
            },
            status=503,
        )

    # Biometric processing (DeepFace inference) stays outside the database
    # transaction — it is slow and touches no rows. Bounded by a hard
    # timeout so a slow/stuck model call can never hang this request (and
    # therefore the frontend's "verifying" UI) indefinitely — see the
    # module-level _ENROLLMENT_PROOF_EXECUTOR comment for why it is safe to
    # give up waiting on the background thread rather than kill it.
    future = _ENROLLMENT_PROOF_EXECUTOR.submit(service.enroll, None, frames, request_id)
    try:
        credential_kwargs = future.result(timeout=settings.FACE_PROCESSING_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        logger.warning('face.enrollment_proof.timeout request_id=%s', request_id)
        return JsonResponse(
            {
                'success': False,
                'code': 'FACE_PROCESSING_TIMEOUT',
                'message': _FACE_PROCESSING_TIMEOUT_MESSAGE,
                'request_id': request_id,
            },
            status=504,
        )
    except (service.FaceServiceError, EncryptionKeyMissing) as exc:
        code = getattr(exc, 'code', 'FACE_PROCESSING_FAILED')
        message = _ENROLL_ERROR_MESSAGES.get(code, _ENROLL_FALLBACK_MESSAGE)
        return JsonResponse(
            {'success': False, 'code': code, 'message': message, 'request_id': request_id}, status=400
        )
    except Exception:  # noqa: BLE001 - never leak an unhandled exception to the client
        logger.exception('face.enrollment_proof.unexpected_error request_id=%s', request_id)
        return JsonResponse(
            {
                'success': False,
                'code': 'FACE_PROCESSING_FAILED',
                'message': _ENROLL_ERROR_MESSAGES['FACE_PROCESSING_FAILED'],
                'request_id': request_id,
            },
            status=400,
        )

    proof_token = None
    for _ in range(5):
        candidate = generate_token()
        if not FaceEnrollmentProof.objects.filter(token_hash=hash_token(candidate)).exists():
            proof_token = candidate
            break
    if proof_token is None:
        return JsonResponse(
            {
                'success': False,
                'code': 'ENROLLMENT_PROOF_FAILED',
                'message': _ENROLLMENT_PROOF_FAILED_MESSAGE,
                'request_id': request_id,
            },
            status=500,
        )

    try:
        with transaction.atomic():
            locked_challenge = FaceChallenge.objects.select_for_update().get(pk=challenge.pk)
            if locked_challenge.is_used() or locked_challenge.is_expired():
                return JsonResponse(
                    {
                        'success': False,
                        'code': 'CHALLENGE_INVALID',
                        'message': 'The secure Face Enrollment challenge expired. Please complete Face Enrollment again.',
                        'request_id': request_id,
                    },
                    status=400,
                )
            locked_challenge.used_at = timezone.now()
            locked_challenge.save(update_fields=['used_at'])

            ttl = settings.FACE_ENROLLMENT_PROOF_TTL_SECONDS
            FaceEnrollmentProof.objects.create(
                token_hash=hash_token(proof_token),
                expires_at=timezone.now() + timedelta(seconds=ttl),
                **credential_kwargs,
            )
    except Exception:  # noqa: BLE001 - storage failure must not leak internals or hang the client
        logger.exception('face.enrollment_proof.storage_failed request_id=%s', request_id)
        return JsonResponse(
            {
                'success': False,
                'code': 'ENROLLMENT_PROOF_FAILED',
                'message': _ENROLLMENT_PROOF_FAILED_MESSAGE,
                'request_id': request_id,
            },
            status=500,
        )

    logger.info(
        'face.enrollment_proof.success request_id=%s total=%.1fms',
        request_id,
        (time.perf_counter() - request_start) * 1000,
    )
    return JsonResponse(
        {
            'success': True,
            'message': 'Face Enrollment verified. You can now review and submit your registration.',
            'proof_token': proof_token,
            'expires_in': ttl,
            'request_id': request_id,
        },
        status=201,
    )


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
    """Recovery path for an account created before Face Enrollment became
    optional, left in PENDING_FACE_ENROLLMENT/is_active=False by the old
    mandatory flow (see Section J of the optional-enrollment fix). The
    caller must prove they own the account with its username/password
    before anything happens either way.

    `action` picks which of the two paths continues the registration:
      - 'enroll' (default, preserves the previous behaviour/response shape):
        issues a short-lived enrollment_token so the client can proceed to
        the camera-based Face Enrollment flow via /face/challenge/ and
        /face/enroll/.
      - 'skip': activates the account immediately with no FaceCredential —
        the same "password-only" outcome final registration now offers to
        a brand-new signup, made available here to these legacy pending
        accounts too. Never activates an account whose ownership was not
        just verified via username+password above.
    """
    payload = _json_body(request)
    username = (payload.get('username') or '').strip()
    password = payload.get('password') or ''
    action = (payload.get('action') or 'enroll').strip().lower()
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

    if not username or not password or action not in ('enroll', 'skip'):
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

    if action == 'skip':
        with transaction.atomic():
            user.is_active = True
            user.save(update_fields=['is_active'])
            profile.registration_status = RegistrationStatus.ACTIVE
            profile.save(update_fields=['registration_status'])
        return JsonResponse({'success': True, 'activated': True, 'face_enrolled': False})

    return JsonResponse({'success': True, 'enrollment_token': issue_enrollment_token(user)})

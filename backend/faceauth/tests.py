import concurrent.futures
import io
import json
import threading
import time
from datetime import timedelta
from unittest.mock import MagicMock, patch

import numpy as np
from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from PIL import Image

from employees.models import EmployeeProfile, RegistrationStatus

from . import service
from .encryption import encrypt_embedding
from .hashing import hash_token, keyed_hash
from .models import FaceChallenge, FaceCredential, FaceEnrollmentProof, FaceLoginAttempt
from .tokens import issue_enrollment_token

User = get_user_model()

TEST_ENCRYPTION_KEY = Fernet.generate_key().decode()

SAME_PERSON_VECTOR = [1.0, 0.0, 0.0, 0.0]
DIFFERENT_PERSON_VECTOR = [0.0, 1.0, 0.0, 0.0]


def _jpeg_bytes():
    buffer = io.BytesIO()
    Image.new('RGB', (16, 16), color='blue').save(buffer, format='JPEG')
    return buffer.getvalue()


def _frame():
    return SimpleUploadedFile('frame.jpg', _jpeg_bytes(), content_type='image/jpeg')


def _fake_face(is_real=True, crop=None, antispoof_score=0.95):
    return {
        'facial_area': {'x': 0, 'y': 0, 'w': 10, 'h': 10},
        'confidence': 0.99,
        'is_real': is_real,
        'antispoof_score': antispoof_score,
        'face': crop if crop is not None else np.zeros((10, 10, 3), dtype=np.uint8),
    }


def _represent_same_person(*_args, **_kwargs):
    return [{'embedding': SAME_PERSON_VECTOR}]


def _represent_different_person(*_args, **_kwargs):
    return [{'embedding': DIFFERENT_PERSON_VECTOR}]


@override_settings(FACE_EMBEDDING_ENCRYPTION_KEYS=[TEST_ENCRYPTION_KEY], FACE_RECOGNITION_ENGINE='deepface')
class FaceAuthTestCase(TestCase):
    """Shared fixtures. `_verification_threshold` is patched so no test ever
    imports the real DeepFace/TensorFlow stack — only `_extract_faces` and
    `_represent` are mocked per-test where face-detection behavior matters.

    Forced onto the legacy `deepface` FaceRecognitionEngine (rather than
    the new default `opencv_sface`) deliberately — every test in this class
    exercises the DeepFace-specific mocking seam (`_extract_faces`/
    `_represent`), which only the DeepFace engine calls. This is exactly
    the "keep DeepFace... for compatibility testing" scenario the engine
    migration is designed around — see `OpenCVEngineTests`/
    `AntiSpoofProviderTests` below for the new engine's own, separate
    coverage.
    """

    def setUp(self):
        patcher = patch('faceauth.service._verification_threshold', return_value=0.3)
        patcher.start()
        self.addCleanup(patcher.stop)

        # The throttle cache is a process-wide in-memory store, not reset by
        # Django's per-test DB transaction rollback — many tests in this
        # module share the same test-client IP, so without clearing it here,
        # anonymous-challenge/enrollment-proof throttling from earlier tests
        # bleeds into later ones as spurious 429s.
        cache.clear()

        # Model readiness (faceauth/service.py::is_ready/_readiness) is real,
        # process-wide state that nothing in this test module ever populates
        # by actually loading models. Default it to "ready" (patching the
        # underlying data, not the is_ready() function itself, so tests that
        # specifically exercise is_ready()/get_model_readiness() still run
        # the real logic) — otherwise every enrollment-proof test would hit
        # the readiness gate before ever reaching the scenario it means to
        # test. Tests covering the gate itself override this individually.
        readiness_patcher = patch(
            'faceauth.service._readiness', {'detector': True, 'recognition': True, 'anti_spoofing': True}
        )
        readiness_patcher.start()
        self.addCleanup(readiness_patcher.stop)

        # assess_image_quality runs cheap, *real* OpenCV brightness/
        # sharpness analysis on the actually-decoded test frame (a tiny
        # solid-color synthetic JPEG — see _jpeg_bytes()), which has zero
        # edge variance and would genuinely (correctly) fail the sharpness
        # check every time. Default it to a no-op here, matching
        # `_verification_threshold`'s pattern, so tests exercise the rest
        # of the pipeline; dedicated tests for assess_image_quality itself
        # use real, deliberately-varied images instead (see
        # ImageQualityTests below).
        quality_patcher = patch('faceauth.service.assess_image_quality', return_value=None)
        quality_patcher.start()
        self.addCleanup(quality_patcher.stop)

    def make_pending_user(self, username='pending.user', password='StrongPass123', employee_id=None):
        user = User.objects.create_user(
            username=username, email=f'{username.replace(".", "")}@example.com', password=password, is_active=False
        )
        EmployeeProfile.objects.create(
            user=user,
            employee_id=employee_id or f'ID-{username.replace(".", "")}',
            designation='Engineer',
            department='Engineering',
            location='India',
            manager_name='Manager',
            date_of_joining='2026-01-01',
            phone='+919876543210',
            date_of_birth='1990-01-01',
        )
        return user

    def make_active_user_with_credential(self, username='active.user', password='StrongPass123', embedding=None):
        user = User.objects.create_user(
            username=username, email=f'{username.replace(".", "")}@example.com', password=password, is_active=True
        )
        EmployeeProfile.objects.create(
            user=user,
            employee_id=f'ID-{username.replace(".", "")}',
            designation='Engineer',
            department='Engineering',
            location='India',
            manager_name='Manager',
            registration_status=RegistrationStatus.ACTIVE,
            date_of_joining='2026-01-01',
            phone='+919876543210',
            date_of_birth='1990-01-01',
        )
        encrypted = encrypt_embedding(embedding or SAME_PERSON_VECTOR, 'Facenet512', 'cosine', 'retinaface')
        credential = FaceCredential.objects.create(
            user=user,
            encrypted_embedding=encrypted,
            model_name='Facenet512',
            detector_backend='retinaface',
            distance_metric='cosine',
            enrollment_frame_count=3,
        )
        return user, credential

    def _password_login(self, username, password):
        return self.client.post(
            '/api/v1/auth/login/',
            data=json.dumps({'username': username, 'password': password}),
            content_type='application/json',
        )

    def _create_enroll_challenge(self, user):
        enrollment_token = issue_enrollment_token(user)
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'ENROLL', 'enrollment_token': enrollment_token}),
            content_type='application/json',
        )
        return enrollment_token, response.json()['challenge']['token']

    def _create_login_challenge(self, username):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'LOGIN', 'username': username}),
            content_type='application/json',
        )
        return response.json()['challenge']['token']

    def _perform_enrollment(self, user, frame_count=3, represent_side_effect=None, extract_return=None, consent='true'):
        enrollment_token, challenge_token = self._create_enroll_challenge(user)
        if extract_return is None:
            extract_return = [_fake_face()]
        with patch('faceauth.service._extract_faces', return_value=extract_return), patch(
            'faceauth.service._represent', side_effect=represent_side_effect or _represent_same_person
        ):
            return self.client.post(
                '/api/v1/auth/face/enroll/',
                data={
                    'enrollment_token': enrollment_token,
                    'challenge_token': challenge_token,
                    'consent': consent,
                    'frames': [_frame() for _ in range(frame_count)],
                },
            )

    def _create_anonymous_enroll_challenge(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'ENROLL'}),
            content_type='application/json',
        )
        return response.json()['challenge']['token']

    def _perform_enrollment_proof(
        self, frame_count=3, represent_side_effect=None, extract_return=None, consent='true', challenge_token=None
    ):
        token = challenge_token if challenge_token is not None else self._create_anonymous_enroll_challenge()
        if extract_return is None:
            extract_return = [_fake_face()]
        # An exception instance/class means "raise this" (side_effect);
        # anything else means "return this" (return_value) — lets tests
        # simulate a real DeepFace-call failure, not just a bad result.
        is_exception = isinstance(extract_return, BaseException) or (
            isinstance(extract_return, type) and issubclass(extract_return, BaseException)
        )
        extract_kwargs = {'side_effect': extract_return} if is_exception else {'return_value': extract_return}
        with patch('faceauth.service._extract_faces', **extract_kwargs), patch(
            'faceauth.service._represent', side_effect=represent_side_effect or _represent_same_person
        ):
            return self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={
                    'challenge_token': token,
                    'consent': consent,
                    'frames': [_frame() for _ in range(frame_count)],
                },
            )

    def _perform_verification(self, username, frame_count=2, represent_side_effect=None, extract_return=None):
        challenge_token = self._create_login_challenge(username)
        if extract_return is None:
            extract_return = [_fake_face()]
        with patch('faceauth.service._extract_faces', return_value=extract_return), patch(
            'faceauth.service._represent', side_effect=represent_side_effect or _represent_same_person
        ):
            return self.client.post(
                '/api/v1/auth/face/verify/',
                data={
                    'username': username,
                    'challenge_token': challenge_token,
                    'frames': [_frame() for _ in range(frame_count)],
                },
            )


class ChallengeTests(FaceAuthTestCase):
    def test_enrollment_challenge_creation(self):
        user = self.make_pending_user()
        _, challenge_token = self._create_enroll_challenge(user)
        self.assertTrue(challenge_token)

    def test_login_challenge_creation(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'LOGIN', 'username': 'anyone'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(len(body['challenge']['actions']), 3)
        self.assertEqual(body['challenge']['expires_in'], 120)

    def test_login_challenge_created_for_unknown_username_too(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'LOGIN', 'username': 'does.not.exist'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_challenge_actions_are_valid_subset(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'LOGIN', 'username': 'anyone'}),
            content_type='application/json',
        )
        actions = response.json()['challenge']['actions']
        self.assertEqual(len(actions), 3)
        self.assertTrue(set(actions).issubset({'LOOK_CENTER', 'TURN_LEFT', 'TURN_RIGHT', 'BLINK'}))
        self.assertEqual(len(set(actions)), 3)

    def test_token_hash_stored_not_raw_token(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'LOGIN', 'username': 'anyone'}),
            content_type='application/json',
        )
        token = response.json()['challenge']['token']
        challenge = FaceChallenge.objects.get(token_hash=hash_token(token))
        self.assertNotEqual(challenge.token_hash, token)
        self.assertEqual(len(challenge.token_hash), 64)

    def test_invalid_enrollment_token_rejected(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'ENROLL', 'enrollment_token': 'garbage'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'ENROLLMENT_TOKEN_INVALID')

    def test_unsupported_purpose_rejected(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'BOGUS'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_csrf_enforced_on_challenge(self):
        csrf_client = Client(enforce_csrf_checks=True)
        response = csrf_client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'LOGIN', 'username': 'anyone'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_anonymous_enroll_challenge_creation(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'ENROLL'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertTrue(body['challenge']['token'])
        # Long enough to survive Step 4 review, not the short login/resume TTL.
        self.assertEqual(body['challenge']['expires_in'], 900)

    def test_anonymous_enroll_challenge_has_no_owner(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'ENROLL'}),
            content_type='application/json',
        )
        token = response.json()['challenge']['token']
        challenge = FaceChallenge.objects.get(token_hash=hash_token(token))
        self.assertIsNone(challenge.user_id)


class EnrollmentProofTests(FaceAuthTestCase):
    """Covers faceauth/views.py::enrollment_proof_view — the endpoint the
    registration wizard's Step 3 calls once capture completes. This is what
    makes Step 3's "captured successfully" message a true claim: full
    biometric validation (face detection, anti-spoofing, cross-frame
    identity consistency) happens here, not deferred to final registration.
    """

    def test_creates_a_proof_for_a_valid_anonymous_challenge(self):
        response = self._perform_enrollment_proof()
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertTrue(body['proof_token'])
        self.assertEqual(body['expires_in'], 900)

    def test_proof_encrypted_and_decryptable(self):
        self._perform_enrollment_proof()
        proof = FaceEnrollmentProof.objects.get()
        from .encryption import decrypt_embedding

        payload = decrypt_embedding(proof.encrypted_embedding)
        self.assertEqual(payload['model_name'], 'Facenet512')

    def test_plain_embedding_absent_from_proof_row(self):
        self._perform_enrollment_proof()
        proof = FaceEnrollmentProof.objects.get()
        with self.assertRaises(ValueError):
            json.loads(proof.encrypted_embedding)

    def test_embedding_never_in_proof_response(self):
        response = self._perform_enrollment_proof()
        self.assertNotIn('embedding', json.dumps(response.json()).lower())

    def test_consent_required(self):
        response = self._perform_enrollment_proof(consent='false')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CONSENT_REQUIRED')
        self.assertEqual(FaceEnrollmentProof.objects.count(), 0)

    def test_missing_challenge_rejected(self):
        response = self._perform_enrollment_proof(challenge_token='garbage')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CHALLENGE_INVALID')

    def test_challenge_from_login_purpose_rejected(self):
        login_token = self._create_login_challenge('anyone')
        response = self._perform_enrollment_proof(challenge_token=login_token)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CHALLENGE_INVALID')

    def test_challenge_expired_rejected(self):
        token = self._create_anonymous_enroll_challenge()
        FaceChallenge.objects.filter(token_hash=hash_token(token)).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        response = self._perform_enrollment_proof(challenge_token=token)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CHALLENGE_INVALID')
        self.assertEqual(FaceEnrollmentProof.objects.count(), 0)

    def test_challenge_single_use(self):
        token = self._create_anonymous_enroll_challenge()
        first = self._perform_enrollment_proof(challenge_token=token)
        self.assertEqual(first.status_code, 201)

        second = self._perform_enrollment_proof(challenge_token=token)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()['code'], 'CHALLENGE_INVALID')
        self.assertEqual(FaceEnrollmentProof.objects.count(), 1)

    def test_frame_count_invalid_rejected(self):
        response = self._perform_enrollment_proof(frame_count=1)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'FRAME_COUNT_INVALID')

    def test_zero_face_rejected(self):
        response = self._perform_enrollment_proof(extract_return=[])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'NO_FACE')
        self.assertEqual(FaceEnrollmentProof.objects.count(), 0)

    def test_multiple_faces_rejected(self):
        response = self._perform_enrollment_proof(extract_return=[_fake_face(), _fake_face()])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'MULTIPLE_FACES')

    def test_spoof_rejected(self):
        response = self._perform_enrollment_proof(extract_return=[_fake_face(is_real=False)])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'SPOOF_DETECTED')

    def test_inconsistent_frames_rejected(self):
        # All three mocked faces carry the identical antispoof_score, so
        # frame-quality ranking is a stable no-op and the first two frames
        # (by submission order) are the ones selected for embedding — see
        # process_enrollment_frames's frame-selection tradeoff. The
        # mismatched embedding must therefore be one of the first two, not
        # the third, for this test to actually exercise the rejection.
        response = self._perform_enrollment_proof(
            frame_count=3,
            represent_side_effect=[
                [{'embedding': SAME_PERSON_VECTOR}],
                [{'embedding': DIFFERENT_PERSON_VECTOR}],
                [{'embedding': SAME_PERSON_VECTOR}],
            ],
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'IDENTITY_INCONSISTENT')

    def test_corrupt_image_rejected(self):
        token = self._create_anonymous_enroll_challenge()
        bad_frame = SimpleUploadedFile('bad.jpg', b'not a real image', content_type='image/jpeg')
        response = self.client.post(
            '/api/v1/auth/face/enrollment-proof/',
            data={'challenge_token': token, 'consent': 'true', 'frames': [bad_frame, _frame()]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CAMERA_FRAME_INVALID')

    def test_csrf_enforced_on_enrollment_proof(self):
        token = self._create_anonymous_enroll_challenge()
        csrf_client = Client(enforce_csrf_checks=True)
        response = csrf_client.post(
            '/api/v1/auth/face/enrollment-proof/',
            data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
        )
        self.assertEqual(response.status_code, 403)

    # ---- performance / stuck-processing fix ----

    def test_detection_runs_once_per_frame_embedding_only_for_the_selected_subset(self):
        token = self._create_anonymous_enroll_challenge()
        with patch(
            'faceauth.service._extract_faces', return_value=[_fake_face()]
        ) as extract_mock, patch(
            'faceauth.service._represent', side_effect=_represent_same_person
        ) as represent_mock:
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 201)
        # One detection+anti-spoof call per submitted frame — every frame
        # is still fully liveness-validated, never more than once each.
        self.assertEqual(extract_mock.call_count, 3)
        # Embedding is only spent on FACE_EMBEDDING_FRAME_COUNT (2, default)
        # of the 3 validated frames — the deliberate frame-selection
        # tradeoff, not a bug. Never re-embeds the same frame twice either.
        self.assertEqual(represent_mock.call_count, 2)

    def test_embedding_count_matches_configured_selection_when_exactly_at_minimum(self):
        # With exactly 2 submitted (the minimum), both must be embedded —
        # selection never drops below what cross-frame consistency needs.
        token = self._create_anonymous_enroll_challenge()
        with patch('faceauth.service._extract_faces', return_value=[_fake_face()]), patch(
            'faceauth.service._represent', side_effect=_represent_same_person
        ) as represent_mock:
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(represent_mock.call_count, 2)

    @override_settings(FACE_EMBEDDING_FRAME_COUNT=1)
    def test_embedding_selection_never_drops_below_two_even_if_configured_lower(self):
        token = self._create_anonymous_enroll_challenge()
        with patch('faceauth.service._extract_faces', return_value=[_fake_face()]), patch(
            'faceauth.service._represent', side_effect=_represent_same_person
        ) as represent_mock:
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(represent_mock.call_count, 2)

    def test_validated_crop_is_reused_for_embedding_not_the_raw_frame(self):
        # _represent must be called with the face dict's own 'face' crop
        # and detector_backend='skip' — never the original raw decoded
        # frame array, and never a real detector backend, which would mean
        # a second, redundant detection pass over the same frame.
        token = self._create_anonymous_enroll_challenge()
        sentinel_crop = np.array([[[1, 2, 3]]], dtype=np.uint8)
        with patch(
            'faceauth.service._extract_faces', return_value=[_fake_face(crop=sentinel_crop)]
        ), patch('faceauth.service._represent', side_effect=_represent_same_person) as represent_mock:
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 201)
        for call in represent_mock.call_args_list:
            passed_image, _model_name, passed_detector_backend = call.args
            self.assertIs(passed_image, sentinel_crop)
            self.assertEqual(passed_detector_backend, 'skip')

    def test_successful_response_includes_request_id(self):
        response = self._perform_enrollment_proof()
        self.assertEqual(response.status_code, 201)
        request_id = response.json()['request_id']
        self.assertTrue(request_id)
        self.assertNotIn(' ', request_id)

    def test_error_responses_include_request_id(self):
        response = self._perform_enrollment_proof(consent='false')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.json()['request_id'])

    def test_backend_timeout_returns_safe_error_without_hanging(self):
        class _TimedOutFuture:
            def result(self, timeout=None):
                raise concurrent.futures.TimeoutError()

        token = self._create_anonymous_enroll_challenge()
        with patch('faceauth.views._ENROLLMENT_PROOF_EXECUTOR.submit', return_value=_TimedOutFuture()):
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 504)
        body = response.json()
        self.assertEqual(body['code'], 'FACE_PROCESSING_TIMEOUT')
        self.assertEqual(
            body['message'], 'Face Enrollment validation took too long. Please try again.'
        )
        self.assertTrue(body['request_id'])
        # A timed-out attempt must never leave a usable proof or a consumed
        # challenge behind for the frontend to accidentally reuse.
        self.assertEqual(FaceEnrollmentProof.objects.count(), 0)
        challenge = FaceChallenge.objects.get(token_hash=hash_token(token))
        self.assertFalse(challenge.is_used())

    def test_unexpected_processing_exception_returns_face_processing_failed(self):
        response = self._perform_enrollment_proof(extract_return=RuntimeError('boom'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'FACE_PROCESSING_FAILED')

    def test_model_unavailable_on_import_error(self):
        response = self._perform_enrollment_proof(extract_return=ImportError('deepface not installed'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'MODEL_UNAVAILABLE')

    def test_model_initialization_failed_on_os_error(self):
        response = self._perform_enrollment_proof(extract_return=OSError('could not read weights file'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'MODEL_INITIALIZATION_FAILED')

    def test_no_proof_created_on_processing_failure(self):
        self._perform_enrollment_proof(extract_return=RuntimeError('boom'))
        self.assertEqual(FaceEnrollmentProof.objects.count(), 0)

    # ---- model readiness gate ----

    def test_model_unavailable_when_not_ready_fails_fast_without_processing(self):
        token = self._create_anonymous_enroll_challenge()
        with patch(
            'faceauth.service._readiness', {'detector': False, 'recognition': False, 'anti_spoofing': False}
        ), patch('faceauth.service._extract_faces') as extract_mock, patch(
            'faceauth.service._represent'
        ) as represent_mock, patch('faceauth.service.start_background_warm_up') as warm_up_mock:
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body['code'], 'MODEL_UNAVAILABLE')
        self.assertTrue(body['request_id'])
        # Fails fast — never attempts any real (or in this test, mocked)
        # biometric processing while models are not ready.
        extract_mock.assert_not_called()
        represent_mock.assert_not_called()
        # Kicks off background warm-up as a recovery path, but never blocks
        # this request waiting for it.
        warm_up_mock.assert_called_once()
        self.assertEqual(FaceEnrollmentProof.objects.count(), 0)
        challenge = FaceChallenge.objects.get(token_hash=hash_token(token))
        self.assertFalse(challenge.is_used())

    def test_model_unavailable_gate_does_not_consume_the_challenge(self):
        token = self._create_anonymous_enroll_challenge()
        with patch(
            'faceauth.service._readiness', {'detector': False, 'recognition': False, 'anti_spoofing': False}
        ):
            self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
            )
        # A second attempt, once ready, must still be able to use the same
        # (still-unused) challenge.
        response = self._perform_enrollment_proof(challenge_token=token)
        self.assertEqual(response.status_code, 201)

    # ---- uploaded frame resource cleanup ----
    #
    # These exercise faceauth/service.py::decode_frame directly rather than
    # through a full HTTP round-trip: Django's test Client re-encodes
    # `data={'frames': [...]}` as a real multipart body and the view then
    # receives freshly-deserialized file objects on the server side — not
    # the same Python objects the test constructed — so asserting `.closed`
    # on the original objects would not actually observe server-side
    # behavior. A direct unit test of decode_frame is the correct level to
    # verify this.

    def test_decode_frame_closes_the_uploaded_file_on_success(self):
        from . import service

        frame = _frame()
        service.decode_frame(frame)
        self.assertTrue(frame.closed)

    def test_decode_frame_closes_the_uploaded_file_on_failure(self):
        from . import service

        bad_frame = SimpleUploadedFile('bad.jpg', b'not an image', content_type='image/jpeg')
        with self.assertRaises(service.FaceServiceError):
            service.decode_frame(bad_frame)
        self.assertTrue(bad_frame.closed)

    def test_no_raw_frame_files_are_written_to_media_root(self):
        import os

        from django.conf import settings as django_settings

        before = set()
        if os.path.isdir(django_settings.MEDIA_ROOT):
            for root, _dirs, files in os.walk(django_settings.MEDIA_ROOT):
                before.update(os.path.join(root, f) for f in files)

        response = self._perform_enrollment_proof()
        self.assertEqual(response.status_code, 201)

        after = set()
        if os.path.isdir(django_settings.MEDIA_ROOT):
            for root, _dirs, files in os.walk(django_settings.MEDIA_ROOT):
                after.update(os.path.join(root, f) for f in files)
        self.assertEqual(before, after)


class WarmUpModelsTests(FaceAuthTestCase):
    def test_warm_up_builds_each_configured_model_exactly_once(self):
        from . import service

        with patch('deepface.DeepFace.build_model') as build_mock:
            service.warm_up_models()

        self.assertEqual(build_mock.call_count, 3)
        calls = {(call.args[0], call.kwargs.get('task')) for call in build_mock.call_args_list}
        self.assertEqual(
            calls,
            {
                ('retinaface', 'face_detector'),
                ('Facenet512', 'facial_recognition'),
                ('Fasnet', 'spoofing'),
            },
        )

    def test_warm_up_is_idempotent_to_call_twice(self):
        from . import service

        with patch('deepface.DeepFace.build_model') as build_mock:
            service.warm_up_models()
            service.warm_up_models()

        # DeepFace's own build_model is a singleton cache internally; this
        # only proves warm_up_models() itself issues the same, small,
        # deterministic set of calls every time — never growing per call.
        self.assertEqual(build_mock.call_count, 6)

    def test_warm_up_reports_success_per_model_with_timing(self):
        from . import service

        with patch('deepface.DeepFace.build_model'):
            results = service.warm_up_models()

        self.assertEqual(set(results.keys()), {'detector', 'recognition', 'anti_spoofing'})
        for ok, elapsed_or_error in results.values():
            self.assertTrue(ok)
            self.assertIsInstance(elapsed_or_error, float)

    def test_warm_up_reports_one_model_failure_without_blocking_the_others(self):
        # A missing optional dependency for one model (e.g. anti-spoofing's
        # `torch` requirement) must not prevent the other two independent
        # models from loading and being reported as ready.
        from . import service

        def fail_only_spoofing(model_name, task=None):
            if task == 'spoofing':
                raise ValueError("You must install torch with `pip install torch` command")
            return object()

        with patch('deepface.DeepFace.build_model', side_effect=fail_only_spoofing):
            results = service.warm_up_models()

        self.assertTrue(results['detector'][0])
        self.assertTrue(results['recognition'][0])
        self.assertFalse(results['anti_spoofing'][0])
        self.assertIn('torch', results['anti_spoofing'][1])

    def test_get_model_readiness_reflects_successful_warm_up(self):
        from . import service

        with patch(
            'faceauth.service._readiness', {'detector': False, 'recognition': False, 'anti_spoofing': False}
        ), patch('deepface.DeepFace.build_model'):
            service.warm_up_models()
            readiness = service.get_model_readiness()

        self.assertEqual(readiness, {'detector': True, 'recognition': True, 'anti_spoofing': True})

    def test_is_ready_false_when_any_model_failed_to_load(self):
        from . import service

        def fail_only_spoofing(model_name, task=None):
            if task == 'spoofing':
                raise ValueError('torch missing')
            return object()

        with patch(
            'faceauth.service._readiness', {'detector': False, 'recognition': False, 'anti_spoofing': False}
        ), patch('deepface.DeepFace.build_model', side_effect=fail_only_spoofing):
            service.warm_up_models()
            # Anti-spoofing is required, not optional — liveness is never
            # skipped, so readiness must not report "ready" without it even
            # though detection and recognition loaded fine.
            self.assertFalse(service.is_ready())

    def test_is_ready_true_only_when_all_three_models_loaded(self):
        from . import service

        with patch('faceauth.service._readiness', {'detector': True, 'recognition': True, 'anti_spoofing': False}):
            self.assertFalse(service.is_ready())
        with patch('faceauth.service._readiness', {'detector': True, 'recognition': True, 'anti_spoofing': True}):
            self.assertTrue(service.is_ready())

    def test_start_background_warm_up_starts_exactly_one_thread(self):
        from . import service

        with patch('faceauth.service._warm_up_started', False), patch(
            'faceauth.service.warm_up_models'
        ), patch('threading.Thread') as thread_cls:
            thread_instance = thread_cls.return_value
            service.start_background_warm_up()
            service.start_background_warm_up()

        thread_cls.assert_called_once()
        thread_instance.start.assert_called_once()

    def test_concurrent_readiness_calls_do_not_duplicate_model_loading(self):
        # Simulates several threads racing to trigger warm-up at once (e.g.
        # several early readiness polls arriving before the app-ready hook
        # finishes). Uses real threading.Thread (only warm_up_models itself
        # is mocked, so the real background thread this spawns does cheap
        # no-op work) — the _warm_up_started/_readiness_lock guard must
        # ensure the expensive call happens at most once regardless of how
        # many callers race to trigger it.
        from . import service

        with patch('faceauth.service._warm_up_started', False), patch(
            'faceauth.service.warm_up_models'
        ) as warm_up_mock:
            threads = [threading.Thread(target=service.start_background_warm_up) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            # The daemon thread(s) start_background_warm_up spawns are
            # themselves real and asynchronous — give them a brief moment
            # to actually run before the warm_up_models mock is torn down.
            time.sleep(0.2)

        warm_up_mock.assert_called_once()


class ImageQualityAndPositionTests(FaceAuthTestCase):
    """Real, unmocked coverage of assess_image_quality/_validate_face_position
    — these run genuine OpenCV analysis, deliberately not mocked, using
    real (if synthetic) varied-pixel images rather than the module's usual
    solid-color _jpeg_bytes() test fixture (which is unsuitable here since
    it has zero edge variance by construction)."""

    def setUp(self):
        # Deliberately does NOT call super().setUp() — the shared
        # FaceAuthTestCase.setUp() patches assess_image_quality to a no-op
        # (see its docstring), which is exactly the real function this
        # class exists to exercise. cache.clear() isn't needed here since
        # these tests never go through a throttled HTTP endpoint.
        pass

    def _array_from(self, pil_image):
        return np.array(pil_image.convert('RGB'))

    def test_sharp_high_contrast_image_passes(self):
        from . import service

        image = Image.new('RGB', (64, 64), color=(128, 128, 128))
        pixels = image.load()
        for x in range(64):
            for y in range(64):
                if (x // 4 + y // 4) % 2 == 0:
                    pixels[x, y] = (30, 30, 30)
                else:
                    pixels[x, y] = (220, 220, 220)
        service.assess_image_quality(self._array_from(image))  # must not raise

    def test_all_black_image_rejected_as_poor_lighting(self):
        from . import service

        image = Image.new('RGB', (64, 64), color=(0, 0, 0))
        with self.assertRaises(service.FaceServiceError) as ctx:
            service.assess_image_quality(self._array_from(image))
        self.assertEqual(ctx.exception.code, 'POOR_LIGHTING')

    def test_all_white_image_rejected_as_poor_lighting(self):
        from . import service

        image = Image.new('RGB', (64, 64), color=(255, 255, 255))
        with self.assertRaises(service.FaceServiceError) as ctx:
            service.assess_image_quality(self._array_from(image))
        self.assertEqual(ctx.exception.code, 'POOR_LIGHTING')

    def test_uniform_midtone_image_rejected_as_blurry(self):
        from . import service

        image = Image.new('RGB', (64, 64), color=(128, 128, 128))
        with self.assertRaises(service.FaceServiceError) as ctx:
            service.assess_image_quality(self._array_from(image))
        self.assertEqual(ctx.exception.code, 'BLURRY_FRAME')

    def test_face_too_small_rejected(self):
        from . import service

        face = {'facial_area': {'x': 0, 'y': 0, 'w': 2, 'h': 2}}
        with self.assertRaises(service.FaceServiceError) as ctx:
            service._validate_face_position(face, (100, 100, 3))
        self.assertEqual(ctx.exception.code, 'FACE_TOO_SMALL')

    def test_face_not_centered_rejected(self):
        from . import service

        face = {'facial_area': {'x': 0, 'y': 0, 'w': 30, 'h': 30}}
        with self.assertRaises(service.FaceServiceError) as ctx:
            service._validate_face_position(face, (100, 100, 3))
        self.assertEqual(ctx.exception.code, 'FACE_NOT_CENTERED')

    def test_well_positioned_face_passes(self):
        from . import service

        face = {'facial_area': {'x': 35, 'y': 35, 'w': 30, 'h': 30}}
        service._validate_face_position(face, (100, 100, 3))  # must not raise


class ReadinessEndpointTests(FaceAuthTestCase):
    def test_readiness_ready(self):
        with patch('faceauth.service.get_readiness_status', return_value='READY'):
            response = self.client.get('/api/v1/auth/face/readiness/')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['status'], 'READY')

    def test_readiness_loading(self):
        with patch('faceauth.service.get_readiness_status', return_value='LOADING'), patch(
            'faceauth.service.start_background_warm_up'
        ) as warm_up_mock:
            response = self.client.get('/api/v1/auth/face/readiness/')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['status'], 'LOADING')
        warm_up_mock.assert_called_once()

    def test_readiness_unavailable(self):
        with patch('faceauth.service.get_readiness_status', return_value='UNAVAILABLE'):
            response = self.client.get('/api/v1/auth/face/readiness/')
        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertEqual(body['status'], 'UNAVAILABLE')
        self.assertEqual(body['code'], 'MODEL_UNAVAILABLE')
        # Never exposes model names, exception details, or paths.
        self.assertNotIn('detector', json.dumps(body))
        self.assertNotIn('models', json.dumps(body).lower())

    def test_readiness_never_blocks_on_a_slow_warm_up(self):
        # A GET here must return immediately even while warm-up is
        # (hypothetically) slow — start_background_warm_up() is
        # fire-and-forget, never awaited by the view.
        with patch('faceauth.service.get_readiness_status', return_value='LOADING'), patch(
            'faceauth.service.start_background_warm_up'
        ):
            response = self.client.get('/api/v1/auth/face/readiness/')
        self.assertEqual(response.status_code, 200)

    def test_readiness_does_not_require_authentication(self):
        with patch('faceauth.service.get_readiness_status', return_value='READY'):
            response = self.client.get('/api/v1/auth/face/readiness/')
        self.assertNotEqual(response.status_code, 401)

    def test_get_readiness_status_maps_error_to_unavailable(self):
        from . import service

        with patch(
            'faceauth.service._readiness', {'detector': True, 'recognition': True, 'anti_spoofing': False}
        ), patch('faceauth.service._model_errors', {'detector': None, 'recognition': None, 'anti_spoofing': 'ModuleNotFoundError'}):
            self.assertEqual(service.get_readiness_status(), 'UNAVAILABLE')

    def test_get_readiness_status_loading_when_not_all_ready_and_no_error(self):
        from . import service

        with patch(
            'faceauth.service._readiness', {'detector': True, 'recognition': False, 'anti_spoofing': False}
        ), patch('faceauth.service._model_errors', {'detector': None, 'recognition': None, 'anti_spoofing': None}):
            self.assertEqual(service.get_readiness_status(), 'LOADING')

    def test_get_readiness_status_ready_when_all_loaded(self):
        from . import service

        with patch(
            'faceauth.service._readiness', {'detector': True, 'recognition': True, 'anti_spoofing': True}
        ), patch('faceauth.service._model_errors', {'detector': None, 'recognition': None, 'anti_spoofing': None}):
            self.assertEqual(service.get_readiness_status(), 'READY')


class RunFaceServerCommandTests(FaceAuthTestCase):
    def _fake_engine(self, call_order, ready=True):
        from .engines.base import FaceEngineReadiness

        class FakeEngine:
            name = 'fake_engine'

            def warm_up(self):
                call_order.append('engine_warm_up')

            def readiness(self):
                return FaceEngineReadiness(status='READY' if ready else 'UNAVAILABLE', engine=self.name)

        return FakeEngine()

    def _fake_anti_spoof_provider(self, call_order, ready=True):
        from .anti_spoof.base import AntiSpoofProviderReadiness

        class FakeAntiSpoofProvider:
            name = 'fake_anti_spoof'

            def warm_up(self):
                call_order.append('anti_spoof_warm_up')

            def readiness(self):
                return AntiSpoofProviderReadiness(status='READY' if ready else 'UNAVAILABLE', provider=self.name)

        return FakeAntiSpoofProvider()

    def test_warms_engine_and_anti_spoof_provider_before_starting_the_server(self):
        from django.core.management import call_command as real_call_command

        call_order = []

        def fake_call_command(name, *args, **kwargs):
            if name == 'runserver':
                call_order.append('runserver')
                return None
            return real_call_command(name, *args, **kwargs)

        with patch('faceauth.service.get_engine', return_value=self._fake_engine(call_order)), patch(
            'faceauth.service.get_anti_spoof_provider', return_value=self._fake_anti_spoof_provider(call_order)
        ), patch('faceauth.management.commands.run_face_server.call_command', side_effect=fake_call_command):
            real_call_command('run_face_server')

        self.assertEqual(call_order, ['engine_warm_up', 'anti_spoof_warm_up', 'runserver'])

    def test_raises_command_error_and_never_starts_the_server_if_the_engine_is_not_ready(self):
        from django.core.management import CommandError, call_command as real_call_command

        call_order = []

        with patch(
            'faceauth.service.get_engine', return_value=self._fake_engine(call_order, ready=False)
        ), patch(
            'faceauth.service.get_anti_spoof_provider', return_value=self._fake_anti_spoof_provider(call_order)
        ), patch('faceauth.management.commands.run_face_server.call_command') as call_command_mock:
            with self.assertRaises(CommandError):
                real_call_command('run_face_server')

        call_command_mock.assert_not_called()

    def test_raises_command_error_and_never_starts_the_server_if_anti_spoof_is_not_ready(self):
        from django.core.management import CommandError, call_command as real_call_command

        call_order = []

        with patch(
            'faceauth.service.get_engine', return_value=self._fake_engine(call_order)
        ), patch(
            'faceauth.service.get_anti_spoof_provider',
            return_value=self._fake_anti_spoof_provider(call_order, ready=False),
        ), patch('faceauth.management.commands.run_face_server.call_command') as call_command_mock:
            with self.assertRaises(CommandError):
                real_call_command('run_face_server')

        call_command_mock.assert_not_called()


class EnrollmentTests(FaceAuthTestCase):
    def test_successful_enrollment(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(user)
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['account_status'], 'ACTIVE')
        self.assertTrue(body['face_enrolled'])

    def test_user_activated_after_enrollment(self):
        user = self.make_pending_user()
        self._perform_enrollment(user)
        user.refresh_from_db()
        self.assertTrue(user.is_active)

    def test_employee_profile_becomes_active(self):
        user = self.make_pending_user()
        self._perform_enrollment(user)
        profile = EmployeeProfile.objects.get(user=user)
        self.assertEqual(profile.registration_status, RegistrationStatus.ACTIVE)

    def test_facecredential_created_and_decryptable(self):
        user = self.make_pending_user()
        self._perform_enrollment(user)
        credential = FaceCredential.objects.get(user=user)
        from .encryption import decrypt_embedding

        payload = decrypt_embedding(credential.encrypted_embedding)
        self.assertEqual(payload['model_name'], 'Facenet512')

    def test_plain_embedding_absent_from_database(self):
        user = self.make_pending_user()
        self._perform_enrollment(user)
        credential = FaceCredential.objects.get(user=user)
        with self.assertRaises(ValueError):
            json.loads(credential.encrypted_embedding)

    def test_no_file_fields_on_face_credential(self):
        file_field_types = {'FileField', 'ImageField'}
        for field in FaceCredential._meta.get_fields():
            self.assertNotIn(type(field).__name__, file_field_types)

    def test_embedding_never_in_enroll_response(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(user)
        self.assertNotIn('embedding', json.dumps(response.json()).lower())

    def test_zero_face_rejected(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(user, extract_return=[])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'NO_FACE')

    def test_multiple_faces_rejected(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(user, extract_return=[_fake_face(), _fake_face()])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'MULTIPLE_FACES')

    def test_spoof_rejected(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(user, extract_return=[_fake_face(is_real=False)])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'SPOOF_DETECTED')

    def test_inconsistent_frames_rejected(self):
        # See EnrollmentProofTests.test_inconsistent_frames_rejected for why
        # the mismatched embedding must be one of the first two frames, not
        # the third, given the tied-quality-score stable-sort selection.
        user = self.make_pending_user()
        response = self._perform_enrollment(
            user,
            frame_count=3,
            represent_side_effect=[
                [{'embedding': SAME_PERSON_VECTOR}],
                [{'embedding': DIFFERENT_PERSON_VECTOR}],
                [{'embedding': SAME_PERSON_VECTOR}],
            ],
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'IDENTITY_INCONSISTENT')

    def test_corrupt_image_rejected(self):
        user = self.make_pending_user()
        enrollment_token, challenge_token = self._create_enroll_challenge(user)
        bad_frame = SimpleUploadedFile('bad.jpg', b'not a real image', content_type='image/jpeg')
        response = self.client.post(
            '/api/v1/auth/face/enroll/',
            data={
                'enrollment_token': enrollment_token,
                'challenge_token': challenge_token,
                'consent': 'true',
                'frames': [bad_frame, _frame()],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CAMERA_FRAME_INVALID')

    def test_oversized_frame_rejected(self):
        user = self.make_pending_user()
        enrollment_token, challenge_token = self._create_enroll_challenge(user)
        oversized = SimpleUploadedFile(
            'big.jpg', b'\x00' * (2 * 1024 * 1024 + 1), content_type='image/jpeg'
        )
        response = self.client.post(
            '/api/v1/auth/face/enroll/',
            data={
                'enrollment_token': enrollment_token,
                'challenge_token': challenge_token,
                'consent': 'true',
                'frames': [oversized, _frame()],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'FRAME_TOO_LARGE')

    def test_consent_required(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(user, consent='false')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CONSENT_REQUIRED')

    def test_atomic_rollback_on_credential_conflict(self):
        user = self.make_pending_user()
        encrypted = encrypt_embedding(SAME_PERSON_VECTOR, 'Facenet512', 'cosine', 'retinaface')
        FaceCredential.objects.create(
            user=user,
            encrypted_embedding=encrypted,
            model_name='Facenet512',
            detector_backend='retinaface',
            distance_metric='cosine',
            enrollment_frame_count=3,
        )
        response = self._perform_enrollment(user)
        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        profile = EmployeeProfile.objects.get(user=user)
        self.assertEqual(profile.registration_status, RegistrationStatus.PENDING_FACE_ENROLLMENT)
        self.assertEqual(FaceCredential.objects.filter(user=user).count(), 1)

    @override_settings(FACE_EMBEDDING_ENCRYPTION_KEYS=[])
    def test_missing_encryption_key_fails_safely(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(user)
        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.is_active)

    def test_challenge_single_use(self):
        user = self.make_pending_user()
        enrollment_token, challenge_token = self._create_enroll_challenge(user)
        with patch('faceauth.service._extract_faces', return_value=[_fake_face()]), patch(
            'faceauth.service._represent', side_effect=_represent_same_person
        ):
            first = self.client.post(
                '/api/v1/auth/face/enroll/',
                data={
                    'enrollment_token': enrollment_token,
                    'challenge_token': challenge_token,
                    'consent': 'true',
                    'frames': [_frame(), _frame(), _frame()],
                },
            )
        self.assertEqual(first.status_code, 201)

        second_user = self.make_pending_user(username='second.pending')
        second_enrollment_token = issue_enrollment_token(second_user)
        second = self.client.post(
            '/api/v1/auth/face/enroll/',
            data={
                'enrollment_token': second_enrollment_token,
                'challenge_token': challenge_token,
                'consent': 'true',
                'frames': [_frame(), _frame(), _frame()],
            },
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()['code'], 'CHALLENGE_INVALID')

    def test_challenge_expiry(self):
        user = self.make_pending_user()
        enrollment_token, challenge_token = self._create_enroll_challenge(user)
        FaceChallenge.objects.filter(token_hash=hash_token(challenge_token)).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        response = self.client.post(
            '/api/v1/auth/face/enroll/',
            data={
                'enrollment_token': enrollment_token,
                'challenge_token': challenge_token,
                'consent': 'true',
                'frames': [_frame(), _frame(), _frame()],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'CHALLENGE_INVALID')

    def test_csrf_enforced_on_enroll(self):
        user = self.make_pending_user()
        enrollment_token, challenge_token = self._create_enroll_challenge(user)
        csrf_client = Client(enforce_csrf_checks=True)
        response = csrf_client.post(
            '/api/v1/auth/face/enroll/',
            data={
                'enrollment_token': enrollment_token,
                'challenge_token': challenge_token,
                'consent': 'true',
                'frames': [_frame(), _frame(), _frame()],
            },
        )
        self.assertEqual(response.status_code, 403)


class VerifyTests(FaceAuthTestCase):
    def test_successful_face_login(self):
        user, _credential = self.make_active_user_with_credential()
        response = self._perform_verification(user.username)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['user']['username'], user.username)

    def test_session_created_on_successful_face_login(self):
        user, _credential = self.make_active_user_with_credential()
        self._perform_verification(user.username)
        me = self.client.get('/api/v1/auth/me/')
        self.assertTrue(me.json()['authenticated'])
        self.assertEqual(me.json()['user']['username'], user.username)

    def test_invalid_face_rejected(self):
        user, _credential = self.make_active_user_with_credential()
        response = self._perform_verification(user.username, represent_side_effect=_represent_different_person)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['code'], 'FACE_AUTHENTICATION_FAILED')

    def test_inactive_user_generic_failure(self):
        user, _credential = self.make_active_user_with_credential(username='inactive.candidate')
        user.is_active = False
        user.save()
        response = self._perform_verification(user.username)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(
            response.json(),
            {
                'success': False,
                'code': 'FACE_AUTHENTICATION_FAILED',
                'message': 'Face sign-in could not be completed. Use your password or try again.',
            },
        )

    def test_missing_credential_generic_failure(self):
        User.objects.create_user(
            username='no.credential', email='nocredential@example.com', password='StrongPass123', is_active=True
        )
        response = self._perform_verification('no.credential')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['code'], 'FACE_AUTHENTICATION_FAILED')

    def test_unknown_username_generic_failure(self):
        response = self._perform_verification('completely.unknown')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['code'], 'FACE_AUTHENTICATION_FAILED')

    def test_revoked_credential_generic_failure(self):
        user, credential = self.make_active_user_with_credential(username='revoked.candidate')
        credential.is_active = False
        credential.revoked_at = timezone.now()
        credential.save()
        response = self._perform_verification(user.username)
        self.assertEqual(response.status_code, 401)

    def test_invalid_encrypted_credential_fails_safely(self):
        user, credential = self.make_active_user_with_credential(username='corrupt.credential')
        credential.encrypted_embedding = 'not-a-valid-fernet-token'
        credential.save()
        response = self._perform_verification(user.username)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['code'], 'FACE_AUTHENTICATION_FAILED')

    def test_login_error_remains_generic_across_causes(self):
        user, _credential = self.make_active_user_with_credential(username='cause.one')
        response_a = self._perform_verification(user.username, represent_side_effect=_represent_different_person)
        response_b = self._perform_verification('unknown.user.entirely')
        self.assertEqual(response_a.json(), response_b.json())

    def test_lockout_after_repeated_failures(self):
        user, _credential = self.make_active_user_with_credential(username='lockout.candidate')
        for _ in range(5):
            self._perform_verification(user.username, represent_side_effect=_represent_different_person)

        latest_before_lock = (
            FaceLoginAttempt.objects.filter(username_hash=keyed_hash(user.username)).order_by('-created_at').first()
        )
        self.assertEqual(latest_before_lock.reason_code, 'FACE_NOT_MATCHED')

        self._perform_verification(user.username, represent_side_effect=_represent_same_person)
        latest = FaceLoginAttempt.objects.filter(username_hash=keyed_hash(user.username)).order_by('-created_at').first()
        self.assertEqual(latest.reason_code, 'TEMPORARILY_LOCKED')

    def test_password_login_still_works_during_face_lockout(self):
        user, _credential = self.make_active_user_with_credential(username='lockout.password.user')
        for _ in range(5):
            self._perform_verification(user.username, represent_side_effect=_represent_different_person)

        response = self._password_login(user.username, 'StrongPass123')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_successful_verification_resets_lockout_counter(self):
        user, _credential = self.make_active_user_with_credential(username='reset.candidate')
        for _ in range(4):
            self._perform_verification(user.username, represent_side_effect=_represent_different_person)
        success_response = self._perform_verification(user.username, represent_side_effect=_represent_same_person)
        self.assertEqual(success_response.status_code, 200)

        response = self._perform_verification(user.username, represent_side_effect=_represent_different_person)
        self.assertEqual(response.status_code, 401)
        latest = FaceLoginAttempt.objects.filter(username_hash=keyed_hash(user.username)).order_by('-created_at').first()
        self.assertEqual(latest.reason_code, 'FACE_NOT_MATCHED')

    def test_challenge_single_use_on_verify(self):
        user, _credential = self.make_active_user_with_credential(username='replay.candidate')
        challenge_token = self._create_login_challenge(user.username)
        with patch('faceauth.service._extract_faces', return_value=[_fake_face()]), patch(
            'faceauth.service._represent', side_effect=_represent_same_person
        ):
            first = self.client.post(
                '/api/v1/auth/face/verify/',
                data={'username': user.username, 'challenge_token': challenge_token, 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(first.status_code, 200)

        self.client.post('/api/v1/auth/logout/')
        with patch('faceauth.service._extract_faces', return_value=[_fake_face()]), patch(
            'faceauth.service._represent', side_effect=_represent_same_person
        ):
            second = self.client.post(
                '/api/v1/auth/face/verify/',
                data={'username': user.username, 'challenge_token': challenge_token, 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(second.status_code, 401)

    def test_csrf_enforced_on_verify(self):
        user, _credential = self.make_active_user_with_credential(username='csrf.verify.user')
        challenge_token = self._create_login_challenge(user.username)
        csrf_client = Client(enforce_csrf_checks=True)
        response = csrf_client.post(
            '/api/v1/auth/face/verify/',
            data={'username': user.username, 'challenge_token': challenge_token, 'frames': [_frame()]},
        )
        self.assertEqual(response.status_code, 403)


class StatusTests(FaceAuthTestCase):
    def test_status_requires_authentication(self):
        response = self.client.get('/api/v1/auth/face/status/')
        self.assertEqual(response.status_code, 401)

    def test_status_not_enrolled(self):
        User.objects.create_user(
            username='plain.status', email='plainstatus@example.com', password='StrongPass123', is_active=True
        )
        self._password_login('plain.status', 'StrongPass123')
        response = self.client.get('/api/v1/auth/face/status/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['enrolled'])

    def test_status_enrolled_hides_embedding(self):
        user, _credential = self.make_active_user_with_credential(username='status.enrolled')
        self._password_login(user.username, 'StrongPass123')
        response = self.client.get('/api/v1/auth/face/status/')
        body = response.json()
        self.assertTrue(body['enrolled'])
        self.assertNotIn('embedding', json.dumps(body).lower())


class _FakeYuNetDetector:
    """Stands in for cv2.FaceDetectorYN — `faces_to_return` mimics the real
    [N, 15] detection matrix (x, y, w, h, 5 landmark pairs, confidence)."""

    def __init__(self, faces_to_return=None):
        self.faces_to_return = faces_to_return
        self.set_input_size_calls = []
        self.detect_call_count = 0

    def setInputSize(self, size):  # noqa: N802 - matches cv2's own method name
        self.set_input_size_calls.append(size)

    def detect(self, image):
        self.detect_call_count += 1
        return True, self.faces_to_return


class _FakeSFaceRecognizer:
    def __init__(self, match_score=0.9, feature_value=1.0):
        self.align_crop_calls = []
        self.feature_calls = []
        self.match_calls = []
        self.match_score = match_score
        self.feature_value = feature_value

    def alignCrop(self, img, face_row):  # noqa: N802
        self.align_crop_calls.append((img, face_row))
        return np.zeros((112, 112, 3), dtype=np.uint8)

    def feature(self, aligned_img):
        self.feature_calls.append(aligned_img)
        return np.full((1, 128), self.feature_value, dtype=np.float32)

    def match(self, feature1, feature2, dis_type):
        self.match_calls.append((feature1, feature2, dis_type))
        return self.match_score


def _face_row(x=50, y=50, w=100, h=100, confidence=0.9):
    return np.array([[x, y, w, h, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, confidence]], dtype=np.float32)


def _ready_opencv_engine(detector=None, recognizer=None):
    from .engines.opencv_sface import OpenCVSFaceEngine

    engine = OpenCVSFaceEngine()
    engine._detector = detector or _FakeYuNetDetector(faces_to_return=_face_row())  # noqa: SLF001
    engine._recognizer = recognizer or _FakeSFaceRecognizer()  # noqa: SLF001
    engine._state = 'READY'  # noqa: SLF001
    return engine


@override_settings(FACE_MIN_DETECTION_CONFIDENCE=0.6, FACE_MIN_FACE_SIZE_PIXELS=60, FACE_SFACE_COSINE_THRESHOLD=0.363)
class OpenCVEngineTests(TestCase):
    """The OpenCV YuNet+SFace engine's own detector/recognizer are
    injected directly (real cv2 objects are never constructed here) —
    mirrors the same mocking-seam pattern already used for DeepFace
    (`_extract_faces`/`_represent`), just at the engine-instance level
    since OpenCVSFaceEngine holds its own cv2 model objects rather than
    calling free functions."""

    def test_readiness_states(self):
        from .engines.opencv_sface import OpenCVSFaceEngine

        engine = OpenCVSFaceEngine()
        self.assertEqual(engine.readiness().status, 'NOT_INITIALIZED')
        engine._state = 'LOADING'  # noqa: SLF001
        self.assertEqual(engine.readiness().status, 'LOADING')
        engine._state = 'READY'  # noqa: SLF001
        self.assertEqual(engine.readiness().status, 'READY')

    def test_warm_up_loads_detector_and_recognizer_once(self):
        from .engines.opencv_sface import OpenCVSFaceEngine

        engine = OpenCVSFaceEngine()
        fake_detector = _FakeYuNetDetector()
        fake_recognizer = _FakeSFaceRecognizer()
        with patch('cv2.FaceDetectorYN.create', return_value=fake_detector) as detector_create, patch(
            'cv2.FaceRecognizerSF.create', return_value=fake_recognizer
        ) as recognizer_create:
            engine.warm_up()
            engine.warm_up()  # idempotent — must not rebuild

        detector_create.assert_called_once()
        recognizer_create.assert_called_once()
        self.assertEqual(engine.readiness().status, 'READY')
        # The dummy warm-up inference ran exactly once (from the first
        # warm_up() call; the second was a no-op given state == READY).
        self.assertEqual(fake_detector.detect_call_count, 1)

    def test_warm_up_reports_unavailable_on_failure(self):
        from .engines.opencv_sface import OpenCVSFaceEngine

        engine = OpenCVSFaceEngine()
        with patch('cv2.FaceDetectorYN.create', side_effect=RuntimeError('model file missing')):
            engine.warm_up()
        self.assertEqual(engine.readiness().status, 'UNAVAILABLE')

    def test_start_background_warm_up_is_idempotent(self):
        from .engines.opencv_sface import OpenCVSFaceEngine

        engine = OpenCVSFaceEngine()
        with patch.object(engine, 'warm_up') as warm_up_mock, patch('threading.Thread') as thread_cls:
            thread_instance = thread_cls.return_value
            engine.start_background_warm_up()
            engine.start_background_warm_up()

        thread_cls.assert_called_once()
        thread_instance.start.assert_called_once()
        warm_up_mock.assert_not_called()  # the (mocked) thread was never actually run

    def test_detects_exactly_one_face_per_call(self):
        detector = _FakeYuNetDetector(faces_to_return=_face_row())
        engine = _ready_opencv_engine(detector=detector)
        image = np.zeros((300, 300, 3), dtype=np.uint8)

        engine.detect_single_face(image)

        self.assertEqual(detector.detect_call_count, 1)
        self.assertEqual(detector.set_input_size_calls, [(300, 300)])

    def test_zero_faces_rejected(self):
        engine = _ready_opencv_engine(detector=_FakeYuNetDetector(faces_to_return=None))
        image = np.zeros((300, 300, 3), dtype=np.uint8)
        with self.assertRaises(service.FaceServiceError) as ctx:
            engine.detect_single_face(image)
        self.assertEqual(ctx.exception.code, 'NO_FACE_DETECTED')

    def test_multiple_faces_rejected(self):
        two_faces = np.vstack([_face_row(x=10), _face_row(x=200)])
        engine = _ready_opencv_engine(detector=_FakeYuNetDetector(faces_to_return=two_faces))
        image = np.zeros((300, 300, 3), dtype=np.uint8)
        with self.assertRaises(service.FaceServiceError) as ctx:
            engine.detect_single_face(image)
        self.assertEqual(ctx.exception.code, 'MULTIPLE_FACES_DETECTED')

    def test_low_confidence_rejected_as_no_face(self):
        engine = _ready_opencv_engine(detector=_FakeYuNetDetector(faces_to_return=_face_row(confidence=0.1)))
        image = np.zeros((300, 300, 3), dtype=np.uint8)
        with self.assertRaises(service.FaceServiceError) as ctx:
            engine.detect_single_face(image)
        self.assertEqual(ctx.exception.code, 'NO_FACE_DETECTED')

    def test_small_face_rejected(self):
        engine = _ready_opencv_engine(detector=_FakeYuNetDetector(faces_to_return=_face_row(w=20, h=20)))
        image = np.zeros((300, 300, 3), dtype=np.uint8)
        with self.assertRaises(service.FaceServiceError) as ctx:
            engine.detect_single_face(image)
        self.assertEqual(ctx.exception.code, 'FACE_TOO_SMALL')

    def test_off_center_face_rejected(self):
        # Large enough to clear FACE_TOO_SMALL, positioned far enough from
        # center to clear FACE_NOT_CENTERED's 0.3 offset ratio, and still
        # fully inside the (larger) frame.
        engine = _ready_opencv_engine(detector=_FakeYuNetDetector(faces_to_return=_face_row(x=300, y=300, w=80, h=80)))
        image = np.zeros((400, 400, 3), dtype=np.uint8)
        with self.assertRaises(service.FaceServiceError) as ctx:
            engine.detect_single_face(image)
        self.assertEqual(ctx.exception.code, 'FACE_NOT_CENTERED')

    def test_align_and_embed_use_the_detected_face_row(self):
        recognizer = _FakeSFaceRecognizer()
        engine = _ready_opencv_engine(recognizer=recognizer)
        image = np.zeros((300, 300, 3), dtype=np.uint8)

        detected = engine.detect_single_face(image)
        aligned = engine.align_face(image, detected)
        embedding = engine.create_embedding(aligned)

        self.assertEqual(len(recognizer.align_crop_calls), 1)
        self.assertEqual(len(recognizer.feature_calls), 1)
        self.assertEqual(len(embedding), 128)

    def test_compare_embeddings_uses_configured_cosine_threshold(self):
        recognizer = _FakeSFaceRecognizer(match_score=0.5)
        engine = _ready_opencv_engine(recognizer=recognizer)

        result = engine.compare_embeddings([1.0] * 128, [1.0] * 128)

        self.assertEqual(result.threshold, 0.363)
        self.assertTrue(result.verified)  # 0.5 >= 0.363
        self.assertEqual(recognizer.match_calls[0][2], 0)  # FR_COSINE

    @override_settings(FACE_SFACE_COSINE_THRESHOLD=0.9)
    def test_compare_embeddings_rejects_below_threshold(self):
        recognizer = _FakeSFaceRecognizer(match_score=0.5)
        engine = _ready_opencv_engine(recognizer=recognizer)

        result = engine.compare_embeddings([1.0] * 128, [1.0] * 128)

        self.assertFalse(result.verified)

    def test_model_metadata_reflects_engine_and_config(self):
        engine = _ready_opencv_engine()
        metadata = engine.model_metadata()
        self.assertEqual(metadata.engine_name, 'opencv_sface')
        self.assertEqual(metadata.model_name, 'SFace')
        self.assertEqual(metadata.detector_name, 'YuNet-2026may')
        self.assertEqual(metadata.distance_metric, 'cosine')

    def test_not_ready_engine_raises_model_unavailable(self):
        from .engines.opencv_sface import OpenCVSFaceEngine

        engine = OpenCVSFaceEngine()  # never warmed
        with self.assertRaises(service.FaceServiceError) as ctx:
            engine.detect_single_face(np.zeros((300, 300, 3), dtype=np.uint8))
        self.assertEqual(ctx.exception.code, 'MODEL_UNAVAILABLE')


class AntiSpoofProviderTests(TestCase):
    def test_readiness_states(self):
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider

        provider = SilentFaceAntiSpoofProvider()
        self.assertEqual(provider.readiness().status, 'NOT_INITIALIZED')

    def test_warm_up_loads_the_model_once(self):
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider

        provider = SilentFaceAntiSpoofProvider()
        with patch('deepface.modules.modeling.build_model', return_value=object()) as build_mock:
            provider.warm_up()
            provider.warm_up()  # idempotent

        build_mock.assert_called_once_with(task='spoofing', model_name='Fasnet')
        self.assertEqual(provider.readiness().status, 'READY')

    def test_warm_up_reports_unavailable_on_failure(self):
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider

        provider = SilentFaceAntiSpoofProvider()
        with patch('deepface.modules.modeling.build_model', side_effect=RuntimeError('torch missing')):
            provider.warm_up()
        self.assertEqual(provider.readiness().status, 'UNAVAILABLE')

    def test_validate_raises_model_unavailable_when_not_ready(self):
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider
        from .engines.base import DetectedFace

        provider = SilentFaceAntiSpoofProvider()  # never warmed
        detected = DetectedFace(x=0, y=0, width=100, height=100, confidence=0.9, raw=None)
        with self.assertRaises(service.FaceServiceError) as ctx:
            provider.validate(np.zeros((300, 300, 3), dtype=np.uint8), detected)
        self.assertEqual(ctx.exception.code, 'ANTI_SPOOF_MODEL_UNAVAILABLE')

    def test_validate_returns_live_result(self):
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider
        from .engines.base import DetectedFace

        provider = SilentFaceAntiSpoofProvider()
        fake_model = type('FakeFasnet', (), {'analyze': staticmethod(lambda img, facial_area: (True, 0.97))})()
        provider._model = fake_model  # noqa: SLF001
        provider._state = 'READY'  # noqa: SLF001
        detected = DetectedFace(x=10, y=10, width=50, height=50, confidence=0.9, raw=None)

        result = provider.validate(np.zeros((300, 300, 3), dtype=np.uint8), detected)

        self.assertTrue(result.is_live)
        self.assertEqual(result.reason_code, '')
        self.assertEqual(result.provider, 'silent_face')

    def test_validate_returns_spoof_detected_not_a_generic_error(self):
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider
        from .engines.base import DetectedFace

        provider = SilentFaceAntiSpoofProvider()
        fake_model = type('FakeFasnet', (), {'analyze': staticmethod(lambda img, facial_area: (False, 0.12))})()
        provider._model = fake_model  # noqa: SLF001
        provider._state = 'READY'  # noqa: SLF001
        detected = DetectedFace(x=10, y=10, width=50, height=50, confidence=0.9, raw=None)

        result = provider.validate(np.zeros((300, 300, 3), dtype=np.uint8), detected)

        self.assertFalse(result.is_live)
        self.assertEqual(result.reason_code, 'SPOOF_DETECTED')

    def test_a_provider_service_error_is_not_reported_as_spoof(self):
        """A real infrastructure/model failure during validate() must raise
        a distinct ANTI_SPOOF_PROCESSING_FAILED, never be silently
        reinterpreted as a genuine SPOOF_DETECTED verdict — the two mean
        very different things to a real user."""
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider
        from .engines.base import DetectedFace

        provider = SilentFaceAntiSpoofProvider()

        def _raise(img, facial_area):
            raise RuntimeError('inference backend crashed')

        fake_model = type('FakeFasnet', (), {'analyze': staticmethod(_raise)})()
        provider._model = fake_model  # noqa: SLF001
        provider._state = 'READY'  # noqa: SLF001
        detected = DetectedFace(x=10, y=10, width=50, height=50, confidence=0.9, raw=None)

        with self.assertRaises(service.FaceServiceError) as ctx:
            provider.validate(np.zeros((300, 300, 3), dtype=np.uint8), detected)
        self.assertEqual(ctx.exception.code, 'ANTI_SPOOF_PROCESSING_FAILED')


@override_settings(
    FACE_EMBEDDING_ENCRYPTION_KEYS=[TEST_ENCRYPTION_KEY],
    FACE_RECOGNITION_ENGINE='opencv_sface',
    FACE_MIN_DETECTION_CONFIDENCE=0.6,
    # The shared _frame()/_jpeg_bytes() test fixture is a tiny 16x16 image
    # — sized down from the real 60px default to match it (this class
    # tests orchestration through the real HTTP view with a real decoded
    # frame, not a full-resolution synthetic array like OpenCVEngineTests).
    FACE_MIN_FACE_SIZE_PIXELS=8,
    FACE_SFACE_COSINE_THRESHOLD=0.363,
    FACE_EMBEDDING_FRAME_COUNT=2,
)
class OpenCVEnrollmentPipelineTests(FaceAuthTestCase):
    """End-to-end enrollment-proof coverage with FACE_RECOGNITION_ENGINE
    set to the new default (opencv_sface) — the engine/anti-spoof provider
    singletons are swapped for pre-warmed fakes via faceauth.service.
    get_engine/get_anti_spoof_provider so no real ONNX inference runs.
    Extends FaceAuthTestCase (not plain TestCase) purely to inherit its
    assess_image_quality no-op patch — this class's own
    FACE_RECOGNITION_ENGINE='opencv_sface' override above takes precedence
    over the parent class's 'deepface' override for that one setting."""

    def setUp(self):
        super().setUp()
        self.recognizer = _FakeSFaceRecognizer()
        # Sized to fit inside the shared 16x16 test frame (see the class's
        # FACE_MIN_FACE_SIZE_PIXELS override above) and roughly centered.
        detector = _FakeYuNetDetector(faces_to_return=_face_row(x=3, y=3, w=10, h=10))
        self.engine = _ready_opencv_engine(detector=detector, recognizer=self.recognizer)
        self.anti_spoof_provider = self._ready_anti_spoof_provider()

        engine_patcher = patch('faceauth.service.get_engine', return_value=self.engine)
        engine_patcher.start()
        self.addCleanup(engine_patcher.stop)
        anti_spoof_patcher = patch('faceauth.service.get_anti_spoof_provider', return_value=self.anti_spoof_provider)
        anti_spoof_patcher.start()
        self.addCleanup(anti_spoof_patcher.stop)

    def _ready_anti_spoof_provider(self, is_live=True):
        from .anti_spoof.silent_face import SilentFaceAntiSpoofProvider

        provider = SilentFaceAntiSpoofProvider()
        fake_model = type(
            'FakeFasnet', (), {'analyze': staticmethod(lambda img, facial_area: (is_live, 0.95))}
        )()
        provider._model = fake_model  # noqa: SLF001
        provider._state = 'READY'  # noqa: SLF001
        return provider

    def _create_anonymous_challenge(self):
        response = self.client.post(
            '/api/v1/auth/face/challenge/',
            data=json.dumps({'purpose': 'ENROLL'}),
            content_type='application/json',
        )
        return response.json()['challenge']['token']

    def test_successful_enrollment_proof_uses_opencv_engine(self):
        token = self._create_anonymous_challenge()
        response = self.client.post(
            '/api/v1/auth/face/enrollment-proof/',
            data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame(), _frame()]},
        )
        self.assertEqual(response.status_code, 201)
        proof = FaceEnrollmentProof.objects.get(token_hash=hash_token(response.json()['proof_token']))
        self.assertEqual(proof.engine_name, 'opencv_sface')
        self.assertEqual(proof.model_name, 'SFace')
        self.assertEqual(proof.detector_backend, 'YuNet-2026may')
        # Embedding only spent on FACE_EMBEDDING_FRAME_COUNT of the 3
        # submitted, already-validated frames.
        self.assertEqual(len(self.recognizer.feature_calls), 2)
        self.assertEqual(proof.enrollment_frame_count, 2)

    def test_anti_spoof_provider_used_for_opencv_engine_not_bypassed(self):
        token = self._create_anonymous_challenge()
        with patch.object(self.anti_spoof_provider, 'validate', wraps=self.anti_spoof_provider.validate) as spy:
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(spy.call_count, 2)  # once per submitted frame — never skipped

    def test_spoofed_frame_rejected_for_opencv_engine(self):
        self.anti_spoof_provider = self._ready_anti_spoof_provider(is_live=False)
        with patch('faceauth.service.get_anti_spoof_provider', return_value=self.anti_spoof_provider):
            token = self._create_anonymous_challenge()
            response = self.client.post(
                '/api/v1/auth/face/enrollment-proof/',
                data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'SPOOF_DETECTED')

    def test_cross_frame_inconsistency_rejected_for_opencv_engine(self):
        # First embedding differs from the rest — must fail identity
        # consistency using the engine's own cosine-similarity comparison.
        call_count = 0

        def alternating_feature(aligned_img):
            nonlocal call_count
            call_count += 1
            value = -1.0 if call_count == 1 else 1.0
            return np.full((1, 128), value, dtype=np.float32)

        self.recognizer.feature = alternating_feature
        # The fake recognizer's match() always returns this fixed score
        # regardless of its actual inputs — set it below any real
        # threshold so the pairwise comparison fails, exactly as a real
        # mismatched pair of embeddings would.
        self.recognizer.match_score = -1.0

        token = self._create_anonymous_challenge()
        response = self.client.post(
            '/api/v1/auth/face/enrollment-proof/',
            data={'challenge_token': token, 'consent': 'true', 'frames': [_frame(), _frame()]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'IDENTITY_INCONSISTENT')

    def test_no_embeddings_mixed_between_engines(self):
        """A credential created by the DeepFace engine must never be
        verified using the OpenCV engine's comparison logic, and vice
        versa — verify() always selects the engine from
        credential.engine_name (here 'deepface'), never from live
        FACE_RECOGNITION_ENGINE (set to 'opencv_sface' for this whole test
        class)."""
        user = User.objects.create_user(
            username='mixed.engine.check', email='mixedenginecheck@example.com',
            password='StrongPass123', is_active=True,
        )
        EmployeeProfile.objects.create(
            user=user, employee_id='ID-mixedenginecheck', designation='Engineer', department='Engineering',
            location='India', manager_name='Manager', registration_status=RegistrationStatus.ACTIVE,
            date_of_joining='2026-01-01', phone='+919876543210', date_of_birth='1990-01-01',
        )
        encrypted = encrypt_embedding(SAME_PERSON_VECTOR, 'Facenet512', 'cosine', 'retinaface')
        credential = FaceCredential.objects.create(
            user=user, encrypted_embedding=encrypted, engine_name='deepface', model_name='Facenet512',
            detector_backend='retinaface', distance_metric='cosine', enrollment_frame_count=3,
        )
        deepface_engine_mock = MagicMock()
        deepface_engine_mock.includes_anti_spoofing = True
        deepface_engine_mock.detect_single_face.side_effect = service.FaceServiceError('NO_FACE_DETECTED', 'stub')

        with patch('faceauth.service.get_engine', return_value=deepface_engine_mock) as get_engine_mock:
            with self.assertRaises(service.FaceServiceError):
                service.verify(credential, [_frame(), _frame()])

        # verify() asked the registry for the engine recorded on the
        # credential — not the live FACE_RECOGNITION_ENGINE ('opencv_sface'
        # for this test class) — and never touched self.engine (the
        # OpenCV fake) at all.
        get_engine_mock.assert_called_once_with('deepface')
        self.assertEqual(len(self.recognizer.feature_calls), 0)


class DeletionTests(FaceAuthTestCase):
    def test_deletion_requires_authentication(self):
        response = self.client.delete(
            '/api/v1/auth/face/enrollment/',
            data=json.dumps({'password': 'x'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)

    def test_deletion_with_valid_password(self):
        user, credential = self.make_active_user_with_credential(username='delete.valid')
        self._password_login(user.username, 'StrongPass123')
        response = self.client.delete(
            '/api/v1/auth/face/enrollment/',
            data=json.dumps({'password': 'StrongPass123'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        credential.refresh_from_db()
        self.assertFalse(credential.is_active)
        self.assertTrue(User.objects.filter(username=user.username).exists())

        self.client.post('/api/v1/auth/logout/')
        login_response = self._password_login(user.username, 'StrongPass123')
        self.assertEqual(login_response.status_code, 200)

    def test_deletion_with_invalid_password(self):
        user, credential = self.make_active_user_with_credential(username='delete.invalid')
        self._password_login(user.username, 'StrongPass123')
        response = self.client.delete(
            '/api/v1/auth/face/enrollment/',
            data=json.dumps({'password': 'WrongPassword'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        credential.refresh_from_db()
        self.assertTrue(credential.is_active)

    def test_csrf_enforced_on_deletion(self):
        user, _credential = self.make_active_user_with_credential(username='delete.csrf')
        self._password_login(user.username, 'StrongPass123')
        session_cookie = self.client.cookies.get('sessionid')
        enforcing_client = Client(enforce_csrf_checks=True)
        if session_cookie:
            enforcing_client.cookies['sessionid'] = session_cookie.value
        response = enforcing_client.delete(
            '/api/v1/auth/face/enrollment/',
            data=json.dumps({'password': 'StrongPass123'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)


class EnrollmentResumeTests(FaceAuthTestCase):
    def test_resume_with_correct_password(self):
        self.make_pending_user(username='resume.correct', password='StrongPass123')
        response = self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.correct', 'password': 'StrongPass123'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('enrollment_token', response.json())

    def test_resume_with_invalid_password(self):
        self.make_pending_user(username='resume.invalid', password='StrongPass123')
        response = self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.invalid', 'password': 'WrongPassword'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'ENROLLMENT_RESUME_FAILED')

    def test_resume_unknown_username_generic_failure(self):
        response = self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'nobody.at.all', 'password': 'whatever'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'ENROLLMENT_RESUME_FAILED')

    def test_resume_already_active_user_generic_failure(self):
        user, _credential = self.make_active_user_with_credential(username='resume.already.active')
        response = self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': user.username, 'password': 'StrongPass123'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_resume_does_not_create_session(self):
        self.make_pending_user(username='resume.nosession', password='StrongPass123')
        self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.nosession', 'password': 'StrongPass123'}),
            content_type='application/json',
        )
        me = self.client.get('/api/v1/auth/me/')
        self.assertFalse(me.json()['authenticated'])

    def test_resume_throttling(self):
        self.make_pending_user(username='resume.throttled', password='StrongPass123')
        for _ in range(5):
            self.client.post(
                '/api/v1/auth/face/enrollment/resume/',
                data=json.dumps({'username': 'resume.throttled', 'password': 'WrongPassword'}),
                content_type='application/json',
            )
        response = self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.throttled', 'password': 'StrongPass123'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 429)

    # ---- action='skip': recovery for legacy pending accounts now that
    # Face Enrollment is optional (Section J of the optional-enrollment fix) ----

    def test_resume_skip_activates_account_without_credential(self):
        user = self.make_pending_user(username='resume.skip.ok', password='StrongPass123')
        response = self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.skip.ok', 'password': 'StrongPass123', 'action': 'skip'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['activated'])
        self.assertFalse(body['face_enrolled'])
        self.assertNotIn('enrollment_token', body)

        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertEqual(user.employee_profile.registration_status, RegistrationStatus.ACTIVE)
        self.assertFalse(FaceCredential.objects.filter(user=user).exists())

    def test_resume_skip_allows_password_login_afterward(self):
        self.make_pending_user(username='resume.skip.login', password='StrongPass123')
        self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.skip.login', 'password': 'StrongPass123', 'action': 'skip'}),
            content_type='application/json',
        )
        response = self.client.post(
            '/api/v1/auth/login/',
            data=json.dumps({'username': 'resume.skip.login', 'password': 'StrongPass123'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_resume_skip_still_requires_correct_password(self):
        user = self.make_pending_user(username='resume.skip.badpw', password='StrongPass123')
        response = self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.skip.badpw', 'password': 'WrongPassword', 'action': 'skip'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.is_active)

    def test_resume_skip_does_not_create_a_session(self):
        self.make_pending_user(username='resume.skip.nosession', password='StrongPass123')
        self.client.post(
            '/api/v1/auth/face/enrollment/resume/',
            data=json.dumps({'username': 'resume.skip.nosession', 'password': 'StrongPass123', 'action': 'skip'}),
            content_type='application/json',
        )
        me = self.client.get('/api/v1/auth/me/')
        self.assertFalse(me.json()['authenticated'])

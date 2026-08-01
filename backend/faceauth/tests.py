import io
import json
from datetime import timedelta
from unittest.mock import patch

from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from PIL import Image

from employees.models import EmployeeProfile, RegistrationStatus

from .encryption import encrypt_embedding
from .hashing import hash_token, keyed_hash
from .models import FaceChallenge, FaceCredential, FaceLoginAttempt
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


def _fake_face(is_real=True):
    return {
        'facial_area': {'x': 0, 'y': 0, 'w': 10, 'h': 10},
        'confidence': 0.99,
        'is_real': is_real,
        'antispoof_score': 0.95,
    }


def _represent_same_person(*_args, **_kwargs):
    return [{'embedding': SAME_PERSON_VECTOR}]


def _represent_different_person(*_args, **_kwargs):
    return [{'embedding': DIFFERENT_PERSON_VECTOR}]


@override_settings(FACE_EMBEDDING_ENCRYPTION_KEYS=[TEST_ENCRYPTION_KEY])
class FaceAuthTestCase(TestCase):
    """Shared fixtures. `_verification_threshold` is patched so no test ever
    imports the real DeepFace/TensorFlow stack — only `_extract_faces` and
    `_represent` are mocked per-test where face-detection behavior matters.
    """

    def setUp(self):
        patcher = patch('faceauth.service._verification_threshold', return_value=0.3)
        patcher.start()
        self.addCleanup(patcher.stop)

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
        self.assertEqual(response.json()['code'], 'LIVENESS_FAILED')

    def test_inconsistent_frames_rejected(self):
        user = self.make_pending_user()
        response = self._perform_enrollment(
            user,
            frame_count=3,
            represent_side_effect=[
                [{'embedding': SAME_PERSON_VECTOR}],
                [{'embedding': SAME_PERSON_VECTOR}],
                [{'embedding': DIFFERENT_PERSON_VECTOR}],
            ],
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'INCONSISTENT_FRAMES')

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

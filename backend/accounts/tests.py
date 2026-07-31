import io
import json
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from PIL import Image

from employees.models import EmployeeProfile


class HealthCheckTests(TestCase):
    def test_health_endpoint_returns_ok(self):
        response = self.client.get('/api/v1/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})


class AuthEndpointTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='jane.doe',
            email='jane.doe@example.com',
            password='StrongPass123',
            first_name='Jane',
            last_name='Doe',
        )

    def _post_json(self, url, data, client=None):
        client = client or self.client
        return client.post(url, data=json.dumps(data), content_type='application/json')

    def test_csrf_endpoint_sets_cookie(self):
        response = self.client.get('/api/v1/auth/csrf/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'success': True, 'message': 'CSRF cookie set.'})
        self.assertIn('csrftoken', response.cookies)

    def test_successful_login(self):
        response = self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'StrongPass123'}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['user']['username'], 'jane.doe')
        self.assertEqual(body['user']['email'], 'jane.doe@example.com')
        self.assertNotIn('password', body['user'])
        self.assertNotIn('password', json.dumps(body))

    def test_unknown_username_returns_generic_error(self):
        response = self._post_json(
            '/api/v1/auth/login/', {'username': 'nobody', 'password': 'whatever'}
        )
        self.assertEqual(response.status_code, 401)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertEqual(body['code'], 'INVALID_CREDENTIALS')
        self.assertEqual(body['message'], 'Invalid username or password.')

    def test_invalid_password_returns_generic_error(self):
        response = self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'WrongPass'}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['code'], 'INVALID_CREDENTIALS')

    def test_missing_username(self):
        response = self._post_json('/api/v1/auth/login/', {'password': 'StrongPass123'})
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body['code'], 'USERNAME_REQUIRED')
        self.assertEqual(body['message'], 'Username is required.')

    def test_missing_password(self):
        response = self._post_json('/api/v1/auth/login/', {'username': 'jane.doe'})
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body['code'], 'PASSWORD_REQUIRED')
        self.assertEqual(body['message'], 'Password is required.')

    def test_inactive_user_returns_generic_error(self):
        self.user.is_active = False
        self.user.save()
        response = self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'StrongPass123'}
        )
        self.assertEqual(response.status_code, 401)
        body = response.json()
        self.assertEqual(body['code'], 'INVALID_CREDENTIALS')
        self.assertEqual(body['message'], 'Invalid username or password.')

    def test_session_created_after_login(self):
        self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'StrongPass123'}
        )
        response = self.client.get('/api/v1/auth/me/')
        body = response.json()
        self.assertTrue(body['authenticated'])
        self.assertEqual(body['user']['username'], 'jane.doe')
        self.assertNotIn('password', body['user'])

    def test_me_authenticated(self):
        self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'StrongPass123'}
        )
        response = self.client.get('/api/v1/auth/me/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['authenticated'])

    def test_me_unauthenticated(self):
        response = self.client.get('/api/v1/auth/me/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'authenticated': False, 'user': None})

    def test_logout_success(self):
        self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'StrongPass123'}
        )
        response = self.client.post('/api/v1/auth/logout/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_session_invalidated_after_logout(self):
        self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'StrongPass123'}
        )
        self.client.post('/api/v1/auth/logout/')
        response = self.client.get('/api/v1/auth/me/')
        self.assertEqual(response.json(), {'authenticated': False, 'user': None})

    def test_logout_safe_without_session(self):
        response = self.client.post('/api/v1/auth/logout/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_csrf_enforced_on_login(self):
        csrf_client = Client(enforce_csrf_checks=True)
        response = self._post_json(
            '/api/v1/auth/login/',
            {'username': 'jane.doe', 'password': 'StrongPass123'},
            client=csrf_client,
        )
        self.assertEqual(response.status_code, 403)

    def test_csrf_enforced_on_logout(self):
        self._post_json(
            '/api/v1/auth/login/', {'username': 'jane.doe', 'password': 'StrongPass123'}
        )
        session_cookie = self.client.cookies.get('sessionid')

        enforcing_client = Client(enforce_csrf_checks=True)
        if session_cookie:
            enforcing_client.cookies['sessionid'] = session_cookie.value

        response = enforcing_client.post('/api/v1/auth/logout/')
        self.assertEqual(response.status_code, 403)


def _image_bytes(image_format='JPEG', size=(20, 20)):
    buffer = io.BytesIO()
    Image.new('RGB', size, color='blue').save(buffer, format=image_format)
    return buffer.getvalue()


class RegistrationEndpointTests(TestCase):
    def setUp(self):
        self._media_root = tempfile.mkdtemp()
        self._settings_override = override_settings(MEDIA_ROOT=self._media_root)
        self._settings_override.enable()
        self.addCleanup(self._settings_override.disable)
        self.addCleanup(shutil.rmtree, self._media_root, ignore_errors=True)

    def _valid_payload(self, **overrides):
        payload = {
            'username': 'new.employee',
            'password': 'StrongPass123',
            'confirm_password': 'StrongPass123',
            'work_email': 'new.employee@example.com',
            'employee_id': 'MDAIW-500',
            'first_name': 'New',
            'last_name': 'Employee',
            'designation': 'Software Engineer',
            'department': 'Engineering',
            'location': 'India',
            'manager_name': 'Priya Rao',
            'date_of_joining': '2026-01-05',
            'phone': '+91 9876543210',
            'date_of_birth': '1990-06-15',
        }
        payload.update(overrides)
        return payload

    def test_successful_registration(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload())
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['registration']['username'], 'new.employee')
        self.assertEqual(body['registration']['employee_id'], 'MDAIW-500')
        self.assertEqual(body['registration']['registration_status'], 'PENDING_FACE_ENROLLMENT')
        self.assertTrue(body['registration']['face_enrollment_required'])
        self.assertNotIn('password', json.dumps(body))

    def test_user_and_employee_profile_created_together(self):
        self.client.post('/api/v1/auth/register/', self._valid_payload())
        User = get_user_model()
        user = User.objects.get(username='new.employee')
        profile = EmployeeProfile.objects.get(user=user)
        self.assertEqual(profile.employee_id, 'MDAIW-500')

    def test_new_user_is_inactive(self):
        self.client.post('/api/v1/auth/register/', self._valid_payload())
        User = get_user_model()
        user = User.objects.get(username='new.employee')
        self.assertFalse(user.is_active)

    def test_registration_status_pending_face_enrollment(self):
        self.client.post('/api/v1/auth/register/', self._valid_payload())
        profile = EmployeeProfile.objects.get(employee_id='MDAIW-500')
        self.assertEqual(profile.registration_status, 'PENDING_FACE_ENROLLMENT')

    def test_no_session_created_after_registration(self):
        self.client.post('/api/v1/auth/register/', self._valid_payload())
        response = self.client.get('/api/v1/auth/me/')
        self.assertEqual(response.json(), {'authenticated': False, 'user': None})

    def test_missing_username(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(username=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('username', response.json()['errors'])

    def test_duplicate_username(self):
        self.client.post('/api/v1/auth/register/', self._valid_payload())
        response = self.client.post(
            '/api/v1/auth/register/',
            self._valid_payload(employee_id='MDAIW-501', work_email='other@example.com'),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('username', response.json()['errors'])

    def test_missing_work_email(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(work_email=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('work_email', response.json()['errors'])

    def test_malformed_work_email(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(work_email='not-an-email'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('work_email', response.json()['errors'])

    def test_duplicate_email_case_insensitive(self):
        self.client.post('/api/v1/auth/register/', self._valid_payload())
        response = self.client.post(
            '/api/v1/auth/register/',
            self._valid_payload(
                username='another.user',
                employee_id='MDAIW-502',
                work_email='NEW.EMPLOYEE@EXAMPLE.COM',
            ),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('work_email', response.json()['errors'])

    def test_missing_password(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(password=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.json()['errors'])

    def test_mismatched_passwords(self):
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(confirm_password='Different123')
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('confirm_password', response.json()['errors'])

    def test_password_validator_rejects_weak_password(self):
        response = self.client.post(
            '/api/v1/auth/register/',
            self._valid_payload(password='password', confirm_password='password'),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.json()['errors'])

    def test_duplicate_employee_id(self):
        self.client.post('/api/v1/auth/register/', self._valid_payload())
        response = self.client.post(
            '/api/v1/auth/register/',
            self._valid_payload(username='second.user', work_email='second@example.com'),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('employee_id', response.json()['errors'])

    def test_missing_first_name(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(first_name=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('first_name', response.json()['errors'])

    def test_missing_last_name(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(last_name=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('last_name', response.json()['errors'])

    def test_missing_designation(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(designation=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('designation', response.json()['errors'])

    def test_missing_department(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(department=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('department', response.json()['errors'])

    def test_missing_location(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(location=''))
        self.assertEqual(response.status_code, 400)
        self.assertIn('location', response.json()['errors'])

    def test_invalid_date_of_birth(self):
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(date_of_birth='not-a-date')
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('date_of_birth', response.json()['errors'])

    def test_future_date_of_birth(self):
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(date_of_birth='2099-01-01')
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('date_of_birth', response.json()['errors'])

    def test_invalid_date_of_joining(self):
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(date_of_joining='not-a-date')
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('date_of_joining', response.json()['errors'])

    def test_invalid_phone(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload(phone='abc'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('phone', response.json()['errors'])

    def test_valid_profile_photo_upload(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        photo = SimpleUploadedFile('photo.jpg', _image_bytes('JPEG'), content_type='image/jpeg')
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(profile_photo=photo)
        )
        self.assertEqual(response.status_code, 201)
        profile = EmployeeProfile.objects.get(employee_id='MDAIW-500')
        self.assertTrue(profile.profile_photo)

    def test_unsupported_file_type_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        photo = SimpleUploadedFile('photo.gif', _image_bytes('GIF'), content_type='image/gif')
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(profile_photo=photo)
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('profile_photo', response.json()['errors'])

    def test_oversized_upload_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        oversized_content = b'\x00' * (5 * 1024 * 1024 + 1)
        photo = SimpleUploadedFile('photo.jpg', oversized_content, content_type='image/jpeg')
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(profile_photo=photo)
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('profile_photo', response.json()['errors'])

    def test_corrupt_image_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        photo = SimpleUploadedFile('photo.jpg', b'not a real image', content_type='image/jpeg')
        response = self.client.post(
            '/api/v1/auth/register/', self._valid_payload(profile_photo=photo)
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('profile_photo', response.json()['errors'])

    def test_csrf_enforced_on_register(self):
        csrf_client = Client(enforce_csrf_checks=True)
        response = csrf_client.post('/api/v1/auth/register/', self._valid_payload())
        self.assertEqual(response.status_code, 403)

    def test_atomic_rollback_on_duplicate_employee_id_race(self):
        User = get_user_model()
        existing_user = User.objects.create_user(
            username='existing.user', email='existing@example.com', password='StrongPass123'
        )
        EmployeeProfile.objects.create(
            user=existing_user,
            employee_id='MDAIW-999',
            designation='Engineer',
            department='Engineering',
            location='India',
            manager_name='Manager',
            date_of_joining='2026-01-01',
            phone='+919876543210',
            date_of_birth='1990-01-01',
        )
        # The pre-flight validation already rejects this as a duplicate, so no
        # partial User record should ever be created for the new attempt.
        response = self.client.post(
            '/api/v1/auth/register/',
            self._valid_payload(employee_id='MDAIW-999'),
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(username='new.employee').exists())

    def test_password_absent_from_every_response(self):
        response = self.client.post('/api/v1/auth/register/', self._valid_payload())
        self.assertNotIn('StrongPass123', json.dumps(response.json()))

    def test_no_facecredential_created(self):
        from django.apps import apps

        self.client.post('/api/v1/auth/register/', self._valid_payload())
        with self.assertRaises(LookupError):
            apps.get_model('faceauth', 'FaceCredential')

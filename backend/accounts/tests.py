import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase


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

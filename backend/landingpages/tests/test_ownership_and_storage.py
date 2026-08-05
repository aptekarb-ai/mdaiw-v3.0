import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, OperationalError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ..models import LandingPageProject, LandingPageType, ValidationReport
from ..storage.base import UnsafeStoragePathError, build_path
from ..storage.local import LocalStorageProvider
from ..storage.registry import get_storage_provider

User = get_user_model()


def _make_user(username='alice', password='pw12345!'):
    return User.objects.create_user(username=username, password=password, email=f'{username}@example.com')


class LandingPageProjectOwnershipTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')
        self.other_user = _make_user('bob')

    def test_unauthenticated_list_rejected(self):
        response = self.client.get('/api/v1/lp/projects/')
        self.assertIn(response.status_code, (401, 403))
        self.assertFalse(response.json()['success'])

    def test_unauthenticated_create_rejected(self):
        response = self.client.post('/api/v1/lp/projects/', {'name': 'My Page'})
        self.assertIn(response.status_code, (401, 403))

    def test_create_assigns_authenticated_user_as_owner(self):
        self.client.force_authenticate(self.user)
        response = self.client.post('/api/v1/lp/projects/', {'name': 'My Page'})
        self.assertEqual(response.status_code, 201, response.content)
        project = LandingPageProject.objects.get(pk=response.json()['id'])
        self.assertEqual(project.user, self.user)

    def test_list_only_returns_own_projects(self):
        LandingPageProject.objects.create(user=self.user, slug='mine', name='Mine')
        LandingPageProject.objects.create(user=self.other_user, slug='theirs', name='Theirs')
        self.client.force_authenticate(self.user)
        response = self.client.get('/api/v1/lp/projects/')
        names = [item['name'] for item in response.json()]
        self.assertEqual(names, ['Mine'])

    def test_cannot_retrieve_other_users_project(self):
        theirs = LandingPageProject.objects.create(user=self.other_user, slug='theirs', name='Theirs')
        self.client.force_authenticate(self.user)
        response = self.client.get(f'/api/v1/lp/projects/{theirs.pk}/')
        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.json()['success'])

    def test_cannot_update_other_users_project(self):
        theirs = LandingPageProject.objects.create(user=self.other_user, slug='theirs', name='Theirs')
        self.client.force_authenticate(self.user)
        response = self.client.patch(
            f'/api/v1/lp/projects/{theirs.pk}/', {'name': 'Hijacked'}, format='json'
        )
        self.assertEqual(response.status_code, 404)
        theirs.refresh_from_db()
        self.assertEqual(theirs.name, 'Theirs')

    def test_cannot_delete_other_users_project(self):
        theirs = LandingPageProject.objects.create(user=self.other_user, slug='theirs', name='Theirs')
        self.client.force_authenticate(self.user)
        response = self.client.delete(f'/api/v1/lp/projects/{theirs.pk}/')
        self.assertEqual(response.status_code, 404)
        self.assertTrue(LandingPageProject.objects.filter(pk=theirs.pk).exists())

    def test_slug_collision_generates_unique_slug(self):
        self.client.force_authenticate(self.user)
        first = self.client.post('/api/v1/lp/projects/', {'name': 'My Page'})
        second = self.client.post('/api/v1/lp/projects/', {'name': 'My Page'})
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertNotEqual(first.json()['slug'], second.json()['slug'])
        self.assertEqual(second.json()['slug'], 'my-page-2')

    def test_slug_collision_survives_preexisting_row_not_just_precheck(self):
        # Row created directly via the ORM (not through the serializer) —
        # proves the fix resolves collisions via the unique constraint
        # itself, not merely an .exists() pre-check the API path happens
        # to also perform.
        LandingPageProject.objects.create(user=self.user, slug='my-page', name='My Page')
        self.client.force_authenticate(self.user)
        response = self.client.post('/api/v1/lp/projects/', {'name': 'My Page'})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['slug'], 'my-page-2')

    def test_type_settable_on_create(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            '/api/v1/lp/projects/', {'name': 'My Page', 'type': LandingPageType.BUILDER}
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['type'], LandingPageType.BUILDER)

    def test_type_immutable_after_creation(self):
        self.client.force_authenticate(self.user)
        created = self.client.post(
            '/api/v1/lp/projects/', {'name': 'My Page', 'type': LandingPageType.VALIDATOR}
        )
        project_id = created.json()['id']
        response = self.client.patch(
            f'/api/v1/lp/projects/{project_id}/', {'type': LandingPageType.BUILDER}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()['success'])
        project = LandingPageProject.objects.get(pk=project_id)
        self.assertEqual(project.type, LandingPageType.VALIDATOR)

    def test_type_unchanged_value_on_update_is_not_rejected(self):
        self.client.force_authenticate(self.user)
        created = self.client.post(
            '/api/v1/lp/projects/', {'name': 'My Page', 'type': LandingPageType.VALIDATOR}
        )
        project_id = created.json()['id']
        response = self.client.patch(
            f'/api/v1/lp/projects/{project_id}/',
            {'name': 'Renamed', 'type': LandingPageType.VALIDATOR},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['name'], 'Renamed')


class ValidationReportOwnershipTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')
        self.other_user = _make_user('bob')

    def test_unauthenticated_validate_rejected(self):
        response = self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>'}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_validate_creates_report_owned_by_user(self):
        self.client.force_authenticate(self.user)
        response = self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        report = ValidationReport.objects.get(pk=response.json()['id'])
        self.assertEqual(report.user, self.user)

    def test_validate_with_foreign_project_id_rejected(self):
        theirs = LandingPageProject.objects.create(user=self.other_user, slug='theirs', name='Theirs')
        self.client.force_authenticate(self.user)
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '<p>hi</p>', 'project': theirs.pk}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()['success'])
        self.assertEqual(response.json()['code'], 'INVALID_PROJECT')

    def test_validate_with_own_project_id_links_report(self):
        mine = LandingPageProject.objects.create(user=self.user, slug='mine', name='Mine')
        self.client.force_authenticate(self.user)
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '<p>hi</p>', 'project': mine.pk}, format='json'
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['project'], mine.pk)

    def test_cannot_retrieve_other_users_validation_report(self):
        self.client.force_authenticate(self.other_user)
        theirs = self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>'}, format='json')
        report_id = theirs.json()['id']

        self.client.force_authenticate(self.user)
        response = self.client.get(f'/api/v1/lp/reports/{report_id}/')
        self.assertEqual(response.status_code, 404)

    def test_list_reports_only_returns_own(self):
        self.client.force_authenticate(self.other_user)
        self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>'}, format='json')

        self.client.force_authenticate(self.user)
        response = self.client.get('/api/v1/lp/reports/')
        self.assertEqual(response.json(), [])


class ValidateViewUnexpectedErrorTests(TestCase):
    """Regression coverage for the incident this fixes: an unmigrated dev
    database raised OperationalError inside ValidateView.post, which — being
    an exception DRF's default/global handler doesn't recognize — fell
    through to Django's raw HTML debug/error page. The frontend's
    apiRequest cannot parse HTML, so it collapsed to a generic fallback
    message with no diagnostic value. ValidateView.post now wraps its DB
    work so any unexpected exception still returns the project's standard
    JSON envelope."""

    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')
        self.client.force_authenticate(self.user)

    def test_unexpected_database_error_returns_json_envelope_not_html(self):
        with patch(
            'landingpages.views.ValidationReport.objects.create',
            side_effect=OperationalError('no such table: landingpages_validationreport'),
        ):
            response = self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>'}, format='json')

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response['Content-Type'], 'application/json')
        body = response.json()
        self.assertFalse(body['success'])
        self.assertEqual(body['code'], 'VALIDATION_FAILED')
        self.assertIn('request_id', body)
        # Never leak the raw exception text to the client.
        self.assertNotIn('OperationalError', body['message'])
        self.assertNotIn('landingpages_validationreport', body['message'])


class ResponseEnvelopeTests(TestCase):
    """DRF's default error shapes don't carry the {success, code, message}
    envelope the rest of the backend and frontend/src/api/client.ts rely
    on — these lock in mdaiw.exceptions.mdaiw_exception_handler's fix."""

    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')

    def test_validation_error_response_matches_envelope(self):
        self.client.force_authenticate(self.user)
        # `html` is required and non-blank-required=True but allow_blank=True;
        # omit it entirely to trigger a real field-required serializer error.
        response = self.client.post('/api/v1/lp/validate/', {}, format='json')
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertEqual(body['code'], 'VALIDATION_ERROR')
        self.assertIn('html', body['errors'])

    def test_not_found_response_matches_envelope(self):
        self.client.force_authenticate(self.user)
        response = self.client.get('/api/v1/lp/projects/999999/')
        self.assertEqual(response.status_code, 404)
        body = response.json()
        self.assertEqual(set(body.keys()), {'success', 'code', 'message'})
        self.assertFalse(body['success'])
        self.assertEqual(body['code'], 'NOT_FOUND')
        self.assertTrue(body['message'])

    def test_authentication_required_response_matches_envelope(self):
        response = self.client.get('/api/v1/lp/projects/')
        body = response.json()
        self.assertFalse(body['success'])
        self.assertIn(body['code'], ('AUTHENTICATION_REQUIRED', 'PERMISSION_DENIED'))
        self.assertIn('message', body)


class StoragePathSecurityTests(TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.root = Path(self._tmpdir.name)

    def test_build_path_rejects_traversal_segment(self):
        with self.assertRaises(UnsafeStoragePathError):
            build_path('..', 'secret')

    def test_build_path_rejects_empty_segment(self):
        with self.assertRaises(UnsafeStoragePathError):
            build_path('projects', '')

    def test_build_path_rejects_slash_in_segment(self):
        with self.assertRaises(UnsafeStoragePathError):
            build_path('projects/../etc')

    def test_build_path_rejects_no_segments(self):
        with self.assertRaises(UnsafeStoragePathError):
            build_path()

    def test_build_path_accepts_safe_segments(self):
        self.assertEqual(build_path('projects', '42', 'index_html'), 'projects/42/index_html')

    def test_local_provider_rejects_leading_slash(self):
        provider = LocalStorageProvider(root=self.root)
        with self.assertRaises(UnsafeStoragePathError):
            provider.save('/etc/passwd', b'x')

    def test_local_provider_rejects_traversal_bypassing_build_path(self):
        # Simulates a caller that skipped build_path() and hand-built a
        # traversal path directly — the belt-and-suspenders resolve()
        # containment check in LocalStorageProvider must still catch it.
        provider = LocalStorageProvider(root=self.root)
        with self.assertRaises(UnsafeStoragePathError):
            provider.save('projects/../../outside.txt', b'x')

    def test_local_provider_save_read_delete_roundtrip(self):
        provider = LocalStorageProvider(root=self.root)
        path = build_path('projects', '1', 'index_html')
        provider.save(path, b'<html></html>')
        self.assertTrue(provider.exists(path))
        self.assertEqual(provider.read(path), b'<html></html>')
        provider.delete(path)
        self.assertFalse(provider.exists(path))

    def test_local_provider_delete_missing_file_does_not_raise(self):
        provider = LocalStorageProvider(root=self.root)
        provider.delete(build_path('never', 'existed'))

    @override_settings(LP_STORAGE_PROVIDER='local')
    def test_get_storage_provider_returns_local_instance(self):
        provider = get_storage_provider()
        self.assertIsInstance(provider, LocalStorageProvider)

    @override_settings(LP_STORAGE_PROVIDER='bogus')
    def test_get_storage_provider_unknown_name_raises(self):
        from django.core.exceptions import ImproperlyConfigured

        with self.assertRaises(ImproperlyConfigured):
            get_storage_provider()

    def test_get_storage_provider_not_stale_across_settings_override(self):
        # Regression test for the removed module-level singleton: two
        # different LP_STORAGE_ROOT values must each produce a provider
        # actually rooted where its own override says, with no manual
        # cache-reset call required.
        with tempfile.TemporaryDirectory() as first_dir, tempfile.TemporaryDirectory() as second_dir:
            with override_settings(LP_STORAGE_ROOT=first_dir):
                first_provider = get_storage_provider()
            with override_settings(LP_STORAGE_ROOT=second_dir):
                second_provider = get_storage_provider()
            self.assertEqual(str(first_provider._root), str(Path(first_dir).resolve()))
            self.assertEqual(str(second_provider._root), str(Path(second_dir).resolve()))
            self.assertNotEqual(first_provider._root, second_provider._root)

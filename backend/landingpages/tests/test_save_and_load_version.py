"""Save/Download closure sprint — Save must persist the exact current
editor state (never reformat, never recompile a preprocessor, never run
AI) and Load must reconstruct it byte-for-byte. Exercises the real public
API (SaveLandingPageVersionView / LoadLandingPageVersionView), not just
model/storage internals.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from ..models import LandingPageProject, LandingPageVersion
from ..storage.base import UnsafeStoragePathError

User = get_user_model()

_HTML = '<!DOCTYPE html>\n<html lang="en">\n<!-- keep this comment -->\n<body><h1>Hi</h1></body>\n</html>\n'
_LESS = '@brand: #369;\n// a LESS-only line comment\n.a {\n  color: @brand;\n}\n'
_JS = "function greet() {\n  // keep this comment too\n  console.log('hi');\n}\n"
_AMPSCRIPT = '%%[ VAR @x\nSET @x = "quoted \\"value\\""\n]%%\n%%=v(@x)=%%\n'


class _Base(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='save_user', password='pw12345!', email='save@example.com')
        self.other = User.objects.create_user(username='other_user', password='pw12345!', email='other@example.com')
        self.client.force_authenticate(self.user)


class SaveCreatesProjectAndVersionTests(_Base):
    def test_save_without_a_project_creates_one_and_version_one(self):
        response = self.client.post(
            '/api/v1/lp/projects/save/',
            {'html': _HTML, 'css': _LESS, 'js': _JS, 'ampscript': _AMPSCRIPT, 'css_source_type': 'less', 'name': 'My Promo LP'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body['version_number'], 1)
        self.assertEqual(body['css_source_type'], 'less')
        self.assertEqual(body['project']['name'], 'My Promo LP')
        self.assertEqual(LandingPageProject.objects.filter(user=self.user).count(), 1)
        self.assertEqual(LandingPageVersion.objects.count(), 1)

    def test_save_without_a_name_and_without_a_project_is_rejected(self):
        response = self.client.post('/api/v1/lp/projects/save/', {'html': _HTML}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_save_with_no_content_at_all_is_rejected(self):
        response = self.client.post('/api/v1/lp/projects/save/', {'name': 'Empty LP'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_saving_again_against_the_same_project_creates_version_two(self):
        first = self.client.post('/api/v1/lp/projects/save/', {'html': _HTML, 'name': 'Iterative LP'}, format='json')
        project_id = first.json()['project']['id']
        second = self.client.post(
            '/api/v1/lp/projects/save/', {'html': _HTML + '<!-- v2 -->\n', 'project': project_id}, format='json',
        )
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(second.json()['version_number'], 2)
        self.assertEqual(second.json()['project']['id'], project_id)
        self.assertEqual(LandingPageVersion.objects.filter(project_id=project_id).count(), 2)


class SaveExactSourcePreservationTests(_Base):
    """The core correctness requirement — never reformat, never lose
    comments/AMPscript/embedded code, never compile-and-replace a
    preprocessor source."""

    def _save_and_load(self, **overrides):
        payload = {'html': _HTML, 'css': _LESS, 'js': _JS, 'ampscript': _AMPSCRIPT, 'css_source_type': 'less', 'name': 'Exact LP'}
        payload.update(overrides)
        save_response = self.client.post('/api/v1/lp/projects/save/', payload, format='json')
        self.assertEqual(save_response.status_code, 201, save_response.content)
        project_id = save_response.json()['project']['id']
        load_response = self.client.get(f'/api/v1/lp/projects/{project_id}/latest-version/')
        self.assertEqual(load_response.status_code, 200, load_response.content)
        return load_response.json()

    def test_html_is_byte_exact_including_comments(self):
        loaded = self._save_and_load()
        self.assertEqual(loaded['html'], _HTML)
        self.assertIn('<!-- keep this comment -->', loaded['html'])

    def test_less_source_is_preserved_exactly_never_compiled_to_css(self):
        loaded = self._save_and_load()
        self.assertEqual(loaded['css'], _LESS)
        self.assertIn('@brand: #369;', loaded['css'])  # LESS variable syntax, not compiled output
        self.assertIn('// a LESS-only line comment', loaded['css'])

    def test_javascript_comments_are_preserved(self):
        loaded = self._save_and_load()
        self.assertEqual(loaded['js'], _JS)
        self.assertIn('// keep this comment too', loaded['js'])

    def test_ampscript_is_preserved_exactly_including_escaped_quotes(self):
        loaded = self._save_and_load()
        self.assertEqual(loaded['ampscript'], _AMPSCRIPT)

    def test_stylesheet_type_round_trips(self):
        loaded = self._save_and_load()
        self.assertEqual(loaded['css_source_type'], 'less')
        self.assertEqual(loaded['version']['css_source_type'], 'less')

    def test_stylesheet_type_defaults_to_css_when_omitted(self):
        payload = {'html': _HTML, 'name': 'Default Type LP'}
        save_response = self.client.post('/api/v1/lp/projects/save/', payload, format='json')
        self.assertEqual(save_response.json()['css_source_type'], 'css')


class SaveEmptyOptionalSourceTests(_Base):
    def test_saving_html_only_leaves_other_fields_empty_on_load_not_missing(self):
        save_response = self.client.post('/api/v1/lp/projects/save/', {'html': _HTML, 'name': 'HTML Only'}, format='json')
        project_id = save_response.json()['project']['id']
        loaded = self.client.get(f'/api/v1/lp/projects/{project_id}/latest-version/').json()
        self.assertEqual(loaded['html'], _HTML)
        self.assertEqual(loaded['css'], '')
        self.assertEqual(loaded['js'], '')
        self.assertEqual(loaded['ampscript'], '')

    def test_no_storage_file_is_written_for_an_empty_optional_field(self):
        save_response = self.client.post('/api/v1/lp/projects/save/', {'html': _HTML, 'name': 'Sparse LP'}, format='json')
        version_id = save_response.json()['id']
        version = LandingPageVersion.objects.get(pk=version_id)
        self.assertNotEqual(version.html_path, '')
        self.assertEqual(version.css_path, '')
        self.assertEqual(version.js_path, '')
        self.assertEqual(version.ampscript_path, '')


class OwnershipTests(_Base):
    def test_saving_to_another_users_project_is_rejected(self):
        theirs = LandingPageProject.objects.create(user=self.other, name='Theirs', slug='theirs')
        response = self.client.post(
            '/api/v1/lp/projects/save/', {'html': _HTML, 'project': theirs.id}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('project', response.json()['errors'])

    def test_loading_another_users_project_404s(self):
        theirs = LandingPageProject.objects.create(user=self.other, name='Theirs', slug='theirs2')
        response = self.client.get(f'/api/v1/lp/projects/{theirs.id}/latest-version/')
        self.assertEqual(response.status_code, 404)

    def test_loading_a_project_with_no_saved_version_yet_404s_with_a_clear_code(self):
        mine = LandingPageProject.objects.create(user=self.user, name='Mine', slug='mine-empty')
        response = self.client.get(f'/api/v1/lp/projects/{mine.id}/latest-version/')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['code'], 'NO_SAVED_VERSION')


class SaveFailureHandlingTests(_Base):
    def test_a_storage_write_failure_returns_a_safe_500_not_a_traceback(self):
        with patch('landingpages.views.get_storage_provider') as mock_provider:
            mock_provider.return_value.save.side_effect = OSError('disk full')
            response = self.client.post(
                '/api/v1/lp/projects/save/', {'html': _HTML, 'name': 'Fails LP'}, format='json',
            )
        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertEqual(body['code'], 'SAVE_FAILED')
        self.assertNotIn('Traceback', str(body))
        # A failed save must never leave an orphaned version row.
        self.assertEqual(LandingPageVersion.objects.count(), 0)

    def test_a_storage_read_failure_on_load_returns_a_safe_500(self):
        save_response = self.client.post('/api/v1/lp/projects/save/', {'html': _HTML, 'name': 'Load Fails LP'}, format='json')
        project_id = save_response.json()['project']['id']
        with patch('landingpages.views.get_storage_provider') as mock_provider:
            mock_provider.return_value.read.side_effect = FileNotFoundError()
            response = self.client.get(f'/api/v1/lp/projects/{project_id}/latest-version/')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()['code'], 'LOAD_FAILED')

"""Corrective-sprint tests for validation_scope — request contract, engine
dispatch, empty-source handling per scope, and partial-failure behaviour."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from ..validation.engine import run

User = get_user_model()


def _make_user(username='alice', password='pw12345!'):
    return User.objects.create_user(username=username, password=password, email=f'{username}@example.com')


BROKEN_HTML = '<img src="x.png">'
BROKEN_CSS = '.hero {\n  color red;\n}\n'


class EngineScopeTests(TestCase):
    """Engine-level tests — no HTTP layer, exercises engine.run() directly."""

    def test_unknown_scope_falls_back_to_complete(self):
        result = run(html='', css='', validation_scope='not-a-real-scope')
        self.assertEqual(result.validation_scope, 'complete')

    def test_html_only_runs_only_html_adapters(self):
        result = run(html=BROKEN_HTML, css=BROKEN_CSS, validation_scope='html')
        languages = {i.language for i in result.issues}
        self.assertEqual(languages, {'html'})

    def test_css_only_runs_only_css_adapters(self):
        result = run(html=BROKEN_HTML, css=BROKEN_CSS, validation_scope='css')
        languages = {i.language for i in result.issues}
        self.assertEqual(languages, {'css'})

    def test_css_only_with_empty_html_produces_no_html_issue(self):
        result = run(html='', css=BROKEN_CSS, validation_scope='css')
        self.assertFalse(any(i.language == 'html' for i in result.issues))
        self.assertTrue(any(i.language == 'css' for i in result.issues))

    def test_complete_with_empty_html_returns_one_clear_error(self):
        result = run(html='', css='', validation_scope='complete')
        html_issues = [i for i in result.issues if i.language == 'html']
        self.assertEqual(len(html_issues), 1)
        self.assertEqual(html_issues[0].rule_id, 'html-required-for-complete-validation')
        self.assertEqual(html_issues[0].severity, 'error')

    def test_complete_skips_optional_empty_css(self):
        result = run(html='<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><h1>Hi</h1></body></html>', css='', validation_scope='complete')
        self.assertFalse(any(i.language == 'css' for i in result.issues))

    def test_javascript_scope_reports_unavailable_engine_not_html(self):
        result = run(html=BROKEN_HTML, css=BROKEN_CSS, js='const x = 1', validation_scope='javascript')
        self.assertEqual(result.issues, [])
        status = next(s for s in result.engine_status if s.engine_name == 'javascript-conformance')
        self.assertFalse(status.success)
        self.assertIn('not available', status.message)

    def test_typescript_scope_reports_unavailable_engine_not_html(self):
        result = run(html=BROKEN_HTML, ts='const x: number = 1', validation_scope='typescript')
        self.assertEqual(result.issues, [])
        status = next(s for s in result.engine_status if s.engine_name == 'typescript-conformance')
        self.assertFalse(status.success)

    def test_html_only_does_not_run_css_even_when_css_present(self):
        result = run(html=BROKEN_HTML, css=BROKEN_CSS, validation_scope='html')
        self.assertFalse(any(s.engine_name == 'css-conformance' for s in result.engine_status))


class ValidateApiScopeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')
        self.client.force_authenticate(self.user)

    def test_scope_omitted_defaults_to_complete(self):
        response = self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['validation_scope'], 'complete')

    def test_invalid_scope_returns_structured_400(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '<p>hi</p>', 'validation_scope': 'bogus'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertIn('validation_scope', body['errors'])

    def test_html_only_with_blank_html_rejected(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'validation_scope': 'html'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertIn('html', body['errors'])
        self.assertIn('Enter HTML code', body['errors']['html'][0])

    def test_css_only_with_blank_css_rejected(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'css': '', 'validation_scope': 'css'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertIn('css', body['errors'])

    def test_css_only_with_non_blank_css_and_blank_html_succeeds(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'css': BROKEN_CSS, 'validation_scope': 'css'}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        languages = {i['language'] for i in response.json()['issues']}
        self.assertEqual(languages, {'css'})

    def test_complete_lp_with_empty_html_returns_201_with_one_html_error(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'validation_scope': 'complete'}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        html_issues = [i for i in response.json()['issues'] if i['language'] == 'html']
        self.assertEqual(len(html_issues), 1)
        self.assertEqual(html_issues[0]['rule_id'], 'html-required-for-complete-validation')

    def test_report_stores_and_returns_validation_scope(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'css': BROKEN_CSS, 'validation_scope': 'css'}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['validation_scope'], 'css')

    def test_existing_clients_without_scope_remain_compatible(self):
        # Exact Sprint 1B/1C-era payload shape — no validation_scope key at all.
        response = self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>', 'css': ''}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['validation_scope'], 'complete')

    def test_unauthenticated_request_still_rejected_regardless_of_scope(self):
        anonymous_client = APIClient()
        response = anonymous_client.post(
            '/api/v1/lp/validate/', {'html': '<p>hi</p>', 'validation_scope': 'html'}, format='json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_javascript_scope_returns_201_with_unavailable_status_not_500(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'js': 'const x = 1;', 'validation_scope': 'javascript'}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body['issues'], [])
        status_entry = next(s for s in body['engine_status'] if s['engine_name'] == 'javascript-conformance')
        self.assertFalse(status_entry['success'])

"""Sprint CSS-B tests — `<link rel="stylesheet">` classification and,
where safely resolvable, local-asset content validation. See
validation/adapters/html_external_stylesheet.py.
"""

import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ..models import LandingPageProject, LandingPageVersion
from ..storage.base import build_path
from ..storage.registry import get_storage_provider
from ..validation.engine import run

User = get_user_model()


def _make_user(username='alice', password='pw12345!'):
    return User.objects.create_user(username=username, password=password, email=f'{username}@example.com')


def _external_issues(result):
    return [
        issue for issue in result.issues
        if issue.source_engine == 'html-external-stylesheet' or issue.source_context == 'local-external-stylesheet'
    ]


class _StorageBackedTestCase(TestCase):
    """Base class for tests that need a real (temp-dir) storage-backed
    project asset, matching test_ownership_and_storage.py's pattern."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.root = Path(self._tmpdir.name)
        self._settings_override = override_settings(LP_STORAGE_ROOT=self.root)
        self._settings_override.enable()
        self.addCleanup(self._settings_override.disable)

        self.user = _make_user('alice')
        self.project = LandingPageProject.objects.create(user=self.user, slug='p1', name='Page 1')

    def _save_project_css(self, content: str) -> str:
        css_path = build_path('projects', str(self.project.id), 'style_css')
        get_storage_provider().save(css_path, content.encode('utf-8'))
        LandingPageVersion.objects.create(project=self.project, version_number=1, css_path=css_path)
        return css_path


class SecurityTests(_StorageBackedTestCase):
    def test_path_traversal_href_never_reaches_storage_read(self):
        self._save_project_css('.a { color: red; }')
        html = '<link rel="stylesheet" href="../../../../etc/passwd">'
        with patch('landingpages.validation.adapters.html_external_stylesheet.get_storage_provider') as mock_get:
            result = run(html=html, validation_scope='complete', project=self.project)
            mock_get.assert_not_called()
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:missing-local-asset' for i in issues), issues)

    def test_path_traversal_href_reported_as_missing_not_crash(self):
        html = '<link rel="stylesheet" href="../../../../../windows/win.ini">'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:missing-local-asset' for i in issues), issues)

    def test_cross_project_asset_reference_never_read(self):
        # A second project (still owned by the SAME user, to isolate this
        # test from the separate cross-USER protection below) has its own
        # saved asset — a <link> in project A's HTML that happens to name
        # project B's path must never resolve, since resolution is keyed
        # to the project passed into run(), never derived from the href.
        other_project = LandingPageProject.objects.create(user=self.user, slug='p2', name='Page 2')
        other_css_path = build_path('projects', str(other_project.id), 'style_css')
        get_storage_provider().save(other_css_path, b'.b { color: red; }')
        LandingPageVersion.objects.create(project=other_project, version_number=1, css_path=other_css_path)

        html = f'<link rel="stylesheet" href="{other_css_path}">'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:missing-local-asset' for i in issues), issues)
        self.assertFalse(any(i.source_asset_id == other_css_path for i in issues), issues)

    def test_cross_user_project_access_denied_at_api_layer(self):
        # The adapter itself never sees a project it wasn't handed — this
        # confirms the upstream ownership boundary (views.py) that makes
        # that guarantee true still holds for this new code path.
        other_user = _make_user('bob')
        others_project = LandingPageProject.objects.create(user=other_user, slug='theirs', name='Theirs')

        client = APIClient()
        client.force_authenticate(self.user)
        response = client.post(
            '/api/v1/lp/validate/',
            {'html': '<p>hi</p>', 'css': '', 'validation_scope': 'complete', 'project': others_project.id},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['code'], 'INVALID_PROJECT')

    def test_unsafe_protocol_flagged(self):
        html = '<link rel="stylesheet" href="javascript:alert(1)">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:prohibited-protocol' for i in issues), issues)
        self.assertTrue(all(i.category == 'security' for i in issues if i.rule_id.endswith('prohibited-protocol')))

    def test_malformed_url_empty_href_flagged(self):
        html = '<link rel="stylesheet" href="">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:malformed-url' for i in issues), issues)

    def test_malformed_url_missing_host_flagged(self):
        html = '<link rel="stylesheet" href="https://">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:malformed-url' for i in issues), issues)

    def test_mixed_content_url_flagged(self):
        html = '<link rel="stylesheet" href="http://example.com/style.css">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:mixed-content' for i in issues), issues)

    def test_missing_local_asset_without_project_reported_safely(self):
        html = '<link rel="stylesheet" href="styles/site.css">'
        result = run(html=html, validation_scope='complete')  # no project at all
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:missing-local-asset' for i in issues), issues)

    def test_remote_content_is_never_fetched(self):
        html = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.css">'
        with patch('landingpages.validation.adapters.html_external_stylesheet.run_css_validation') as mock_validate:
            result = run(html=html, validation_scope='complete')
            mock_validate.assert_not_called()
        issues = _external_issues(result)
        self.assertTrue(issues)


class FunctionalTests(_StorageBackedTestCase):
    def test_valid_local_stylesheet_is_read_and_validated(self):
        css_path = self._save_project_css('.a { color red; }')
        html = f'<link rel="stylesheet" href="{css_path}">'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _external_issues(result)
        self.assertTrue(any(i.source_context == 'local-external-stylesheet' for i in issues), issues)
        self.assertTrue(any(i.source_asset_id == css_path for i in issues), issues)
        self.assertTrue(any(i.severity == 'error' for i in issues), issues)

    def test_valid_local_stylesheet_clean_content_produces_no_content_issues(self):
        css_path = self._save_project_css('.a { color: red; }\n')
        html = f'<link rel="stylesheet" href="{css_path}">'
        result = run(html=html, validation_scope='complete', project=self.project)
        content_issues = [i for i in _external_issues(result) if i.source_context == 'local-external-stylesheet']
        self.assertEqual(content_issues, [])

    def test_missing_local_stylesheet(self):
        self._save_project_css('.a { color: red; }')
        html = '<link rel="stylesheet" href="not_the_saved_path.css">'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:missing-local-asset' for i in issues), issues)

    def test_approved_cdn_reference_is_classified_not_downloaded(self):
        html = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        approved = [i for i in issues if i.source_context == 'approved-external-stylesheet']
        self.assertTrue(approved, issues)
        self.assertTrue(any('not downloaded' in i.message for i in approved), approved)

    def test_unapproved_remote_url(self):
        html = '<link rel="stylesheet" href="https://example-not-a-cdn.test/style.css">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:unapproved-remote-source' for i in issues), issues)

    def test_duplicate_references(self):
        html = (
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pkg/style.css">'
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pkg/style.css">'
        )
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:duplicate-reference' for i in issues), issues)

    def test_integrity_without_crossorigin(self):
        html = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pkg/style.css" integrity="sha384-x">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:integrity-without-crossorigin' for i in issues), issues)

    def test_crossorigin_without_integrity(self):
        html = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pkg/style.css" crossorigin="anonymous">'
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:crossorigin-without-integrity' for i in issues), issues)

    def test_conflicting_framework_versions(self):
        html = (
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.0/dist/css/bootstrap.css">'
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.css">'
        )
        result = run(html=html, validation_scope='complete')
        issues = _external_issues(result)
        self.assertTrue(any(i.rule_id == 'css-external:conflicting-framework-version' for i in issues), issues)

    def test_multiple_stylesheet_sources_have_isolated_findings(self):
        css_path = self._save_project_css('.ext { color red; }')
        html = (
            '<html><head>'
            f'<link rel="stylesheet" href="{css_path}">'
            '<style>.block { color red; }</style>'
            '</head>'
            '<body><div style="color red">x</div></body></html>'
        )
        result = run(html=html, css='.tab { color red; }', validation_scope='complete', project=self.project)
        # Tool-Grounded AI Engineer sprint — excludes the independent
        # Complete-LP cross-language CSS-selector check (source_context
        # is always '' for it; it isn't tied to any embedding context),
        # which this test isn't about.
        css_engine_issues = [
            issue for issue in result.issues
            if issue.language == 'css' and issue.source_engine != 'cross-language-html-css'
        ]
        contexts = {issue.source_context for issue in css_engine_issues}
        self.assertEqual(
            contexts,
            {'local-external-stylesheet', 'html-style-block', 'html-inline-style', 'standalone-css'},
            result.issues,
        )
        fingerprints = [issue.fingerprint for issue in css_engine_issues]
        self.assertEqual(len(fingerprints), len(set(fingerprints)), 'no cross-context collisions')

    def test_external_stylesheet_adapter_does_not_run_under_html_scope(self):
        css_path = self._save_project_css('.a { color red; }')
        html = f'<link rel="stylesheet" href="{css_path}">'
        result = run(html=html, validation_scope='html', project=self.project)
        self.assertEqual(_external_issues(result), [])

    def test_external_stylesheet_adapter_does_not_run_under_css_scope(self):
        result = run(html='<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pkg/style.css">',
                      css='.a { color: blue; }', validation_scope='css')
        self.assertEqual(_external_issues(result), [])

    def test_engine_status_reports_external_stylesheet_engine(self):
        html = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pkg/style.css">'
        result = run(html=html, validation_scope='complete')
        names = {status.engine_name for status in result.engine_status}
        self.assertIn('html-external-stylesheet', names)

    def test_no_stylesheet_links_produces_no_external_engine_noise(self):
        result = run(html='<p>hi</p>', validation_scope='complete')
        self.assertEqual(_external_issues(result), [])


class ApiIntegrationTests(TestCase):
    def setUp(self):
        self.user = _make_user('alice')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_validate_complete_scope_includes_external_stylesheet_findings(self):
        html = '<link rel="stylesheet" href="https://example-not-a-cdn.test/style.css">'
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': html, 'css': '', 'validation_scope': 'complete'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertTrue(any(i['rule_id'] == 'css-external:unapproved-remote-source' for i in body['issues']))

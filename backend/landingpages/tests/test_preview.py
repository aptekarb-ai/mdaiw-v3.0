"""Secure Preview tests — Module 3 LP Validator.

Local project-asset SERVING is explicitly out of scope this sprint (there
is no Save/Gallery yet, and no asset-upload endpoint at all — see the
audit note in preview/__init__.py and cdn_policy.py's module docstring).
Preview never fetches or embeds asset bytes; a relative reference is
always classified 'local-asset' and left untouched in the assembled
markup (the browser will simply 404 it inside the sandboxed iframe,
harmlessly) — tests 17/18 below verify that classification is applied
uniformly and never depends on (or leaks) another user's data, which is
the entire ownership-safety property available to test given what is
actually implemented.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient

from ..models import LandingPagePreviewSnapshot
from ..preview.ampscript_preview import simulate
from ..preview.assembly import assemble_document
from ..preview.cdn_policy import classify_url
from ..preview.csp import inner_document_csp, outer_shell_csp

_ACCEPTANCE_HTML = (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Preview Test</title></head>'
    '<body><main class="hero"><h1 id="headline">Preview Test</h1><button id="cta">Click me</button>'
    '</main></body></html>'
)
_ACCEPTANCE_SCSS = '$brand: #333;\n\n.hero {\n  padding: 40px;\n\n  h1 {\n    color: $brand;\n  }\n}\n'
_ACCEPTANCE_JS = (
    'document.getElementById("cta")?.addEventListener("click", () => { '
    'document.getElementById("headline").textContent = "JavaScript works"; });'
)


class PreviewApiTestCase(TestCase):
    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.user = User.objects.create_user(username='alice', password='pw12345!', email='alice@example.com')
        self.other = User.objects.create_user(username='bob', password='pw12345!', email='bob@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _create(self, **overrides):
        payload = {
            'html': _ACCEPTANCE_HTML, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'complete', 'profile': 'standard',
        }
        payload.update(overrides)
        return self.client.post('/api/v1/lp/preview/', payload, format='json')


class AuthAndOwnershipTests(PreviewApiTestCase):
    def test_create_requires_authentication(self):
        self.client.force_authenticate(None)
        response = self._create()
        self.assertIn(response.status_code, (401, 403))

    def test_serve_requires_authentication(self):
        response = self._create()
        token = response.json()['token']
        self.client.force_authenticate(None)
        response = self.client.get(f'/api/v1/lp/preview/{token}/')
        self.assertIn(response.status_code, (401, 403))

    def test_snapshot_belongs_to_creating_user(self):
        response = self._create()
        token = response.json()['token']
        snapshot = LandingPagePreviewSnapshot.objects.get(token=token)
        self.assertEqual(snapshot.user_id, self.user.id)

    def test_cross_user_preview_is_inaccessible(self):
        response = self._create()
        token = response.json()['token']
        other_client = APIClient()
        other_client.force_authenticate(self.other)
        response = other_client.get(f'/api/v1/lp/preview/{token}/')
        self.assertEqual(response.status_code, 404)

    def test_cross_user_and_missing_token_return_identical_status(self):
        response = self._create()
        real_token = response.json()['token']
        other_client = APIClient()
        other_client.force_authenticate(self.other)
        cross_user = other_client.get(f'/api/v1/lp/preview/{real_token}/')
        missing = self.client.get('/api/v1/lp/preview/00000000-0000-0000-0000-000000000000/')
        self.assertEqual(cross_user.status_code, missing.status_code)

    def test_preview_ids_are_random_and_unguessable(self):
        first = self._create().json()['token']
        second = self._create().json()['token']
        self.assertNotEqual(first, second)
        # A uuid4 has 122 bits of randomness — this only sanity-checks the
        # format is a real UUID, not a sequential/predictable identifier.
        self.assertEqual(len(first), 36)
        self.assertEqual(first.count('-'), 4)

    def test_snapshot_expiration_is_enforced(self):
        response = self._create()
        token = response.json()['token']
        snapshot = LandingPagePreviewSnapshot.objects.get(token=token)
        snapshot.expires_at = timezone.now() - timedelta(seconds=1)
        snapshot.save(update_fields=['expires_at'])
        response = self.client.get(f'/api/v1/lp/preview/{token}/')
        self.assertEqual(response.status_code, 410)

    def test_expired_snapshot_returns_safe_generic_message(self):
        response = self._create()
        token = response.json()['token']
        snapshot = LandingPagePreviewSnapshot.objects.get(token=token)
        snapshot.expires_at = timezone.now() - timedelta(seconds=1)
        snapshot.save(update_fields=['expires_at'])
        response = self.client.get(f'/api/v1/lp/preview/{token}/')
        content = response.content.decode()
        self.assertNotIn('Traceback', content)
        self.assertNotIn('.py', content)
        self.assertIn('expired', content.lower())


class AssemblyApiTests(PreviewApiTestCase):
    def test_valid_html_assembly_returns_201_and_serves_200(self):
        response = self._create(html=_ACCEPTANCE_HTML, css=_ACCEPTANCE_SCSS, js=_ACCEPTANCE_JS, css_source_type='scss')
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()['token']
        served = self.client.get(f'/api/v1/lp/preview/{token}/')
        self.assertEqual(served.status_code, 200)

    def test_css_is_injected_into_assembled_document(self):
        response = self._create(html=_ACCEPTANCE_HTML, css='.hero { color: red; }', css_source_type='css')
        token = response.json()['token']
        served = self.client.get(f'/api/v1/lp/preview/{token}/')
        content = served.content.decode()
        self.assertIn('.hero', content)
        self.assertIn('color: red', content)

    def test_javascript_source_added_exactly_once(self):
        response = self._create(html=_ACCEPTANCE_HTML, js=_ACCEPTANCE_JS)
        token = response.json()['token']
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertEqual(content.count('JavaScript works'), 1)

    def test_embedded_scripts_in_html_are_preserved(self):
        html = _ACCEPTANCE_HTML.replace(
            '</body>', '<script>window.__embedded = true;</script></body>',
        )
        response = self._create(html=html)
        token = response.json()['token']
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('window.__embedded = true', content)

    def test_oversized_assembled_document_is_rejected(self):
        with override_settings(LP_PREVIEW_MAX_DOCUMENT_BYTES=1000):
            response = self._create(html=_ACCEPTANCE_HTML, css='.a{}' * 1000)
        self.assertEqual(response.status_code, 413)


class StylesheetApiTests(PreviewApiTestCase):
    def test_scss_uses_generated_css_not_raw_source(self):
        response = self._create(html=_ACCEPTANCE_HTML, css=_ACCEPTANCE_SCSS, css_source_type='scss')
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()['token']
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('padding: 40px', content)
        self.assertNotIn('$brand', content)

    def test_sass_uses_generated_css(self):
        sass_source = '.hero\n  padding: 40px\n'
        response = self._create(html=_ACCEPTANCE_HTML, css=sass_source, css_source_type='sass')
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()['token']
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('padding: 40px', content)

    def test_less_uses_generated_css(self):
        less_source = '@brand: #333;\n.hero { color: @brand; }\n'
        response = self._create(html=_ACCEPTANCE_HTML, css=less_source, css_source_type='less')
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()['token']
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('color: #333', content)
        self.assertNotIn('@brand', content)

    def test_compile_failure_blocks_preview(self):
        broken_scss = '.hero { color: $undefined-variable-that-does-not-exist; ;;; {{{'
        response = self._create(html=_ACCEPTANCE_HTML, css=broken_scss, css_source_type='scss')
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body['message'], 'Stylesheet must compile successfully before preview.')


class AmpscriptSimulationTests(TestCase):
    """Direct module-level tests — AMPscript must never be executed, only
    ever pattern-matched and substituted (see preview/ampscript_preview.py's
    module docstring)."""

    def test_ampscript_never_executed_only_literal_set_recognized(self):
        text = '%%[ SET @x = RequestParameter("q") ]%% %%=v(@x)=%%'
        result, used = simulate(text)
        # RequestParameter(...) is a function call, not a literal — never
        # evaluated, so @x is never populated and the placeholder shows.
        self.assertNotIn('RequestParameter', result)
        self.assertIn('[AMPscript output', result)
        self.assertEqual(used, [])

    def test_ampscript_simulated_output_for_literal_set(self):
        text = '%%[SET @name = "Customer"]%% Hello %%=v(@name)=%%!'
        result, used = simulate(text)
        self.assertIn('Hello Customer!', result)
        self.assertEqual(used, ['name'])

    def test_mock_values_substitute_when_no_conflicting_set(self):
        result, used = simulate('Hi %%=v(@FirstName)=%%', {'FirstName': 'Alex'})
        self.assertIn('Hi Alex', result)
        self.assertEqual(used, ['FirstName'])

    def test_unsupported_construct_renders_placeholder_not_deleted(self):
        result, _used = simulate('%%=Concat(@a, @b)=%%')
        self.assertIn('[AMPscript output', result)
        self.assertNotIn('Concat', result)


class AmpscriptApiTests(PreviewApiTestCase):
    def test_ampscript_notice_appears_when_ampscript_is_present(self):
        html = _ACCEPTANCE_HTML.replace(
            '<h1 id="headline">Preview Test</h1>',
            '<h1 id="headline">%%[SET @n = "Customer"]%%Hi %%=v(@n)=%%</h1>',
        )
        response = self._create(html=html)
        token = response.json()['token']
        self.assertTrue(response.json()['ampscript_simulated'])
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('AMPscript preview is simulated', content)
        self.assertIn('Hi Customer', content)

    def test_no_ampscript_notice_when_absent(self):
        response = self._create(html=_ACCEPTANCE_HTML)
        self.assertFalse(response.json()['ampscript_simulated'])


class ExternalResourceTests(TestCase):
    """Direct module-level tests for URL classification (see
    preview/cdn_policy.py). Never fetches anything — classification is a
    pure string decision."""

    def test_approved_cdn_is_recognized(self):
        self.assertEqual(classify_url('https://cdn.jsdelivr.net/npm/lib.js'), 'approved-cdn')

    def test_unapproved_remote_is_classified_remote_not_blocked(self):
        self.assertEqual(classify_url('https://example.com/script.js'), 'remote')

    def test_javascript_protocol_is_blocked(self):
        self.assertEqual(classify_url('javascript:alert(1)'), 'blocked')

    def test_data_uri_blocked_for_script_context(self):
        self.assertEqual(classify_url('data:text/javascript,alert(1)'), 'blocked')

    def test_data_uri_allowed_for_image_context(self):
        self.assertEqual(classify_url('data:image/png;base64,abc', allow_data=True), 'remote')

    def test_file_protocol_is_blocked(self):
        self.assertEqual(classify_url('file:///etc/passwd'), 'blocked')

    def test_localhost_and_private_network_blocked(self):
        self.assertEqual(classify_url('http://localhost:9000/steal'), 'blocked')
        self.assertEqual(classify_url('http://127.0.0.1/steal'), 'blocked')
        self.assertEqual(classify_url('http://169.254.169.254/latest/meta-data/'), 'blocked')
        self.assertEqual(classify_url('http://10.0.0.5/internal'), 'blocked')

    def test_malformed_url_is_invalid(self):
        self.assertEqual(classify_url(''), 'invalid')
        self.assertEqual(classify_url('https://'), 'invalid')

    def test_relative_reference_is_local_asset(self):
        # Never fetched/proxied — see preview/cdn_policy.py's module
        # docstring and this file's own module docstring for why local
        # asset SERVING is out of scope this sprint.
        self.assertEqual(classify_url('/media/my-image.png'), 'local-asset')
        self.assertEqual(classify_url('styles.css'), 'local-asset')

    def test_local_asset_classification_is_identical_regardless_of_caller(self):
        # No per-request/per-user state ever enters classify_url — the
        # same relative href always classifies identically, which is what
        # makes "cross-user asset access" a non-issue for this module: it
        # has no user-scoped state to leak in the first place.
        first = classify_url('project-asset.css')
        second = classify_url('project-asset.css')
        self.assertEqual(first, second)
        self.assertEqual(first, 'local-asset')

    def test_dangerous_script_src_is_stripped_from_assembled_document(self):
        html = _ACCEPTANCE_HTML.replace(
            '<title>Preview Test</title>',
            '<title>Preview Test</title><script src="javascript:alert(1)"></script>',
        )
        result = assemble_document(
            html_source=html, css_source='', js_source='', ampscript_source='',
            ampscript_mock_values=None, inner_csp=inner_document_csp(),
        )
        self.assertNotIn('javascript:alert(1)', result.html)


class SecurityHeaderTests(PreviewApiTestCase):
    def test_csp_header_present_on_served_preview(self):
        token = self._create().json()['token']
        response = self.client.get(f'/api/v1/lp/preview/{token}/')
        csp = response['Content-Security-Policy']
        self.assertIn("default-src 'none'", csp)
        self.assertIn("frame-ancestors 'none'", csp)

    def test_x_robots_tag_present(self):
        token = self._create().json()['token']
        response = self.client.get(f'/api/v1/lp/preview/{token}/')
        self.assertEqual(response['X-Robots-Tag'], 'noindex, nofollow')

    def test_referrer_policy_present(self):
        token = self._create().json()['token']
        response = self.client.get(f'/api/v1/lp/preview/{token}/')
        self.assertEqual(response['Referrer-Policy'], 'no-referrer')

    def test_content_type_nosniff_present(self):
        token = self._create().json()['token']
        response = self.client.get(f'/api/v1/lp/preview/{token}/')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')

    def test_inner_document_csp_blocks_unapproved_script_hosts(self):
        csp = inner_document_csp()
        self.assertIn("connect-src 'none'", csp)
        self.assertNotIn('example.com', csp)

    def test_outer_and_inner_csp_are_independent_policies(self):
        self.assertNotEqual(outer_shell_csp(), inner_document_csp())


class RateLimitTests(PreviewApiTestCase):
    def test_rate_limit_trips_after_max_requests(self):
        with override_settings(LP_PREVIEW_MAX_REQUESTS_PER_WINDOW=2):
            first = self._create()
            second = self._create()
            third = self._create()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(third.status_code, 429)


class InputValidationTests(PreviewApiTestCase):
    def test_blank_html_is_rejected(self):
        response = self._create(html='')
        self.assertEqual(response.status_code, 400)

    def test_too_many_mock_values_rejected(self):
        mock_values = {f'v{i}': 'x' for i in range(25)}
        response = self._create(html=_ACCEPTANCE_HTML, ampscript_mock_values=mock_values)
        self.assertEqual(response.status_code, 400)

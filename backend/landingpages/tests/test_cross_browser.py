"""Cross-browser Check tests — Module 3 Secure Preview. Real Playwright
engine launches (no mocking) — same "run the real thing" convention as
test_scss_sass_compilation.py's real Node subprocess tests. Kept to a
small number of real-engine tests (each takes ~1-2s to launch+render);
network-policy and bounds-validation are covered as pure unit tests
against runner.py's own predicate, which needs no browser at all.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ..cross_browser import CrossBrowserCheckError, run_cross_browser_check
from ..cross_browser.runner import _request_is_blocked


class NetworkPolicyTests(TestCase):
    """Pure unit tests — no browser launch needed."""

    def test_https_public_host_allowed(self):
        self.assertFalse(_request_is_blocked('https://cdn.jsdelivr.net/npm/lib.js'))

    def test_javascript_protocol_blocked(self):
        self.assertTrue(_request_is_blocked('javascript:alert(1)'))

    def test_data_uri_blocked(self):
        self.assertTrue(_request_is_blocked('data:text/html,<script>1</script>'))

    def test_file_protocol_blocked(self):
        self.assertTrue(_request_is_blocked('file:///etc/passwd'))

    def test_localhost_blocked(self):
        self.assertTrue(_request_is_blocked('http://localhost:8000/api/v1/lp/preview/'))
        self.assertTrue(_request_is_blocked('http://127.0.0.1/'))

    def test_private_network_and_metadata_blocked(self):
        self.assertTrue(_request_is_blocked('http://169.254.169.254/latest/meta-data/'))
        self.assertTrue(_request_is_blocked('http://10.0.0.5/internal'))
        self.assertTrue(_request_is_blocked('http://192.168.1.1/'))


class RunnerBoundsTests(TestCase):
    def test_unsupported_engine_rejected(self):
        with self.assertRaises(CrossBrowserCheckError):
            run_cross_browser_check('<html></html>', 'ie11', 400, 480)

    def test_width_out_of_bounds_rejected(self):
        with self.assertRaises(CrossBrowserCheckError):
            run_cross_browser_check('<html></html>', 'chromium', 100, 480)

    def test_height_out_of_bounds_rejected(self):
        with self.assertRaises(CrossBrowserCheckError):
            run_cross_browser_check('<html></html>', 'chromium', 400, 100)


class RealEngineTests(TestCase):
    """One real launch per engine — proves each of the three is actually
    wired up end to end, not just that the dispatch dict has the key."""

    def test_chromium_renders_and_returns_a_screenshot(self):
        result = run_cross_browser_check('<html><body><h1>Hi</h1></body></html>', 'chromium', 400, 480)
        self.assertEqual(result['render_status'], 'rendered')
        self.assertGreater(len(result['screenshot_base64']), 100)
        self.assertEqual(result['viewport'], {'width': 400, 'height': 480})

    def test_firefox_renders(self):
        result = run_cross_browser_check('<html><body><h1>Hi</h1></body></html>', 'firefox', 400, 480)
        self.assertEqual(result['render_status'], 'rendered')

    def test_webkit_renders(self):
        result = run_cross_browser_check('<html><body><h1>Hi</h1></body></html>', 'webkit', 400, 480)
        self.assertEqual(result['render_status'], 'rendered')

    def test_blocked_network_requests_are_counted_as_failed(self):
        html = (
            '<html><body><img src="http://localhost:9/x.png">'
            '<img src="http://169.254.169.254/latest/meta-data/">'
            '</body></html>'
        )
        result = run_cross_browser_check(html, 'chromium', 400, 480)
        self.assertEqual(result['failed_resource_count'], 2)

    def test_uncaught_js_error_marks_render_status_error(self):
        html = '<html><body><script>throw new Error("boom");</script></body></html>'
        result = run_cross_browser_check(html, 'chromium', 400, 480)
        self.assertEqual(result['render_status'], 'error')

    def test_each_run_gets_an_independent_clean_context(self):
        # Each call constructs a brand-new browser.new_context() (see
        # runner.py) — nothing carries between runs, so two consecutive
        # checks of the same content must each succeed independently
        # rather than the second one inheriting state from the first.
        html = '<html><body><h1 id="h">Hi</h1></body></html>'
        first = run_cross_browser_check(html, 'chromium', 400, 480)
        second = run_cross_browser_check(html, 'chromium', 400, 480)
        self.assertEqual(first['render_status'], 'rendered')
        self.assertEqual(second['render_status'], 'rendered')

    def test_hard_timeout_is_enforced(self):
        with override_settings(LP_CROSS_BROWSER_TIMEOUT_SECONDS=0.01):
            with self.assertRaises(CrossBrowserCheckError):
                run_cross_browser_check('<html><body><h1>Hi</h1></body></html>', 'chromium', 400, 480)


class CrossBrowserApiTestCase(TestCase):
    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.user = User.objects.create_user(username='alice', password='pw12345!', email='alice@example.com')
        self.other = User.objects.create_user(username='bob', password='pw12345!', email='bob@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _create_preview(self):
        response = self.client.post(
            '/api/v1/lp/preview/',
            {'html': '<html><body><h1>Hi</h1></body></html>', 'css_source_type': 'css', 'validation_scope': 'complete'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['token']


class CrossBrowserApiTests(CrossBrowserApiTestCase):
    def test_requires_authentication(self):
        token = self._create_preview()
        self.client.force_authenticate(None)
        response = self.client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_cross_user_preview_rejected(self):
        token = self._create_preview()
        other_client = APIClient()
        other_client.force_authenticate(self.other)
        response = other_client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
        )
        self.assertEqual(response.status_code, 404)

    def test_successful_check_returns_screenshot(self):
        token = self._create_preview()
        response = self.client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['engine'], 'chromium')
        self.assertGreater(len(body['screenshot_base64']), 100)

    def test_engine_error_returns_safe_message_no_stack_trace(self):
        token = self._create_preview()
        with patch(
            'landingpages.views.run_cross_browser_check',
            side_effect=CrossBrowserCheckError('Cross-browser check could not render this engine.'),
        ):
            response = self.client.post(
                f'/api/v1/lp/preview/{token}/cross-browser/',
                {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
            )
        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertNotIn('Traceback', body['message'])
        self.assertNotIn('.py', body['message'])

    def test_unexpected_exception_returns_safe_generic_message(self):
        token = self._create_preview()
        with patch('landingpages.views.run_cross_browser_check', side_effect=RuntimeError('raw internal detail')):
            response = self.client.post(
                f'/api/v1/lp/preview/{token}/cross-browser/',
                {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
            )
        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertNotIn('raw internal detail', body['message'])
        self.assertIn('request_id', body)

    def test_expired_snapshot_rejected(self):
        from datetime import timedelta

        from django.utils import timezone

        from ..models import LandingPagePreviewSnapshot

        token = self._create_preview()
        snapshot = LandingPagePreviewSnapshot.objects.get(token=token)
        snapshot.expires_at = timezone.now() - timedelta(seconds=1)
        snapshot.save(update_fields=['expires_at'])

        response = self.client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
        )
        self.assertEqual(response.status_code, 410)

    def test_invalid_engine_rejected(self):
        token = self._create_preview()
        response = self.client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'ie11', 'width': 400, 'height': 480}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_out_of_bounds_dimensions_rejected(self):
        token = self._create_preview()
        response = self.client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'chromium', 'width': 50, 'height': 50}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    @override_settings(LP_CROSS_BROWSER_MAX_REQUESTS_PER_WINDOW=1)
    def test_rate_limit_trips_after_max_requests(self):
        token = self._create_preview()
        first = self.client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
        )
        second = self.client.post(
            f'/api/v1/lp/preview/{token}/cross-browser/',
            {'engine': 'chromium', 'width': 400, 'height': 480}, format='json',
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)


class ShellContentTests(CrossBrowserApiTestCase):
    def test_shell_contains_device_preview_toolbar(self):
        token = self._create_preview()
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('Desktop', content)
        self.assertIn('Laptop', content)
        self.assertIn('Tablet', content)
        self.assertIn('Mobile', content)
        self.assertIn('Custom', content)

    def test_shell_labels_live_preview_as_current_browser(self):
        token = self._create_preview()
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('Live Preview — Current Browser', content)
        self.assertNotIn('>Chrome<', content)
        self.assertNotIn('>Firefox<', content)
        self.assertNotIn('>Safari<', content)

    def test_shell_contains_cross_browser_panel(self):
        token = self._create_preview()
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertIn('Cross-browser Check', content)
        self.assertIn('chromium', content)
        self.assertIn('firefox', content)
        self.assertIn('webkit', content)

    def test_shell_never_claims_real_safari(self):
        token = self._create_preview()
        content = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        self.assertNotIn('Safari browser', content)

    def test_device_change_does_not_touch_stored_snapshot_html(self):
        # The toolbar only ever resizes a wrapper element client-side —
        # the srcdoc content embedded in the shell must be byte-identical
        # across renders (the shell's CSRF token legitimately varies per
        # request by Django's own masking design — see get_token() — so
        # compare only the srcdoc attribute, not the whole document).
        import re

        token = self._create_preview()
        first = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        second = self.client.get(f'/api/v1/lp/preview/{token}/').content.decode()
        srcdoc_re = re.compile(r'srcdoc="(.*?)"></iframe>', re.DOTALL)
        self.assertEqual(srcdoc_re.search(first).group(1), srcdoc_re.search(second).group(1))

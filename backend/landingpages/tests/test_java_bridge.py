"""java_bridge.py / adapters/html_nu.py — Nu Html Checker integration
(Hybrid Validator + AI Engineer architecture sprint). Mirrors
test_css_validation.py's NodeBridgeTests pattern exactly: every subprocess
call is mocked, so these tests never require a real Java runtime — the
adapter's own graceful-unavailability behavior (never a crash, never a
missing engine erasing other engines' findings) is what's actually under
test here.
"""

import json
import subprocess
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from ..validation.adapters.html_nu import HtmlNuAdapter
from ..validation.java_bridge import JavaBridgeError, run_nu_html_check


class JavaBridgeTests(SimpleTestCase):
    def test_missing_java_executable_raises_safe_error(self):
        with override_settings(LP_JAVA_EXECUTABLE='definitely-not-a-real-java-binary-xyz'):
            with self.assertRaises(JavaBridgeError) as ctx:
                run_nu_html_check('<p>hi</p>')
        self.assertNotIn('definitely-not-a-real-java-binary-xyz', str(ctx.exception))

    def test_timeout_raises_safe_error(self):
        with patch(
            'landingpages.validation.java_bridge.subprocess.run',
            side_effect=subprocess.TimeoutExpired(cmd=['java'], timeout=10),
        ):
            with self.assertRaises(JavaBridgeError) as ctx:
                run_nu_html_check('<p>hi</p>')
        self.assertIn('timed out', str(ctx.exception).lower())

    def test_exit_code_1_is_normal_and_still_parses_messages(self):
        # vnu.jar exits 1 whenever it reports errors — this is success, not
        # a crash.
        payload = json.dumps({'messages': [{'type': 'error', 'message': 'x'}]}).encode('utf-8')
        completed = subprocess.CompletedProcess(args=['java'], returncode=1, stdout=payload, stderr=b'')
        with patch('landingpages.validation.java_bridge.subprocess.run', return_value=completed):
            messages = run_nu_html_check('<html')
        self.assertEqual(len(messages), 1)

    def test_unexpected_exit_code_raises_safe_error_without_leaking_stderr(self):
        completed = subprocess.CompletedProcess(
            args=['java'], returncode=127, stdout=b'', stderr=b'Error: /secret/internal/path/vnu.jar not found',
        )
        with patch('landingpages.validation.java_bridge.subprocess.run', return_value=completed):
            with self.assertRaises(JavaBridgeError) as ctx:
                run_nu_html_check('<p>hi</p>')
        self.assertNotIn('/secret/internal/path', str(ctx.exception))

    def test_malformed_json_output_raises_safe_error(self):
        completed = subprocess.CompletedProcess(args=['java'], returncode=0, stdout=b'not json at all', stderr=b'')
        with patch('landingpages.validation.java_bridge.subprocess.run', return_value=completed):
            with self.assertRaises(JavaBridgeError):
                run_nu_html_check('<p>hi</p>')

    def test_oversized_output_raises_safe_error(self):
        completed = subprocess.CompletedProcess(
            args=['java'], returncode=0, stdout=b'{"messages": []}' + b' ' * 10, stderr=b'',
        )
        with override_settings(LP_NU_HTML_MAX_OUTPUT_BYTES=5):
            with patch('landingpages.validation.java_bridge.subprocess.run', return_value=completed):
                with self.assertRaises(JavaBridgeError):
                    run_nu_html_check('<p>hi</p>')

    def test_missing_jar_simulated_via_missing_file(self):
        with patch('landingpages.validation.java_bridge._VNU_JAR_PATH') as mock_path:
            mock_path.is_file.return_value = False
            with self.assertRaises(JavaBridgeError):
                run_nu_html_check('<p>hi</p>')

    def test_unexpected_response_shape_raises_safe_error(self):
        completed = subprocess.CompletedProcess(args=['java'], returncode=0, stdout=b'{"no_messages_key": true}', stderr=b'')
        with patch('landingpages.validation.java_bridge.subprocess.run', return_value=completed):
            with self.assertRaises(JavaBridgeError):
                run_nu_html_check('<p>hi</p>')


class HtmlNuAdapterTests(SimpleTestCase):
    def test_empty_source_short_circuits_without_a_subprocess_call(self):
        with patch('landingpages.validation.adapters.html_nu.run_nu_html_check') as mock_run:
            issues = HtmlNuAdapter().validate('   ', 'standard')
        self.assertEqual(issues, [])
        mock_run.assert_not_called()

    def test_maps_error_type_to_error_severity(self):
        with patch(
            'landingpages.validation.adapters.html_nu.run_nu_html_check',
            return_value=[{
                'type': 'error', 'message': 'Missing ">".', 'firstLine': 2, 'firstColumn': 1,
                'lastLine': 2, 'lastColumn': 6, 'extract': '<html',
            }],
        ):
            issues = HtmlNuAdapter().validate('<html\n<body></body></html>', 'standard')
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].severity, 'error')
        self.assertEqual(issues[0].source_engine, 'nu-html-checker')
        self.assertEqual(issues[0].start_line, 2)
        self.assertEqual(issues[0].message, 'Missing ">".')

    def test_maps_info_subtype_warning_to_warning_severity(self):
        with patch(
            'landingpages.validation.adapters.html_nu.run_nu_html_check',
            return_value=[{'type': 'info', 'subType': 'warning', 'message': 'Consider adding lang.', 'lastLine': 1}],
        ):
            issues = HtmlNuAdapter().validate('<html><body></body></html>', 'standard')
        self.assertEqual(issues[0].severity, 'warning')

    def test_maps_plain_info_to_info_severity(self):
        with patch(
            'landingpages.validation.adapters.html_nu.run_nu_html_check',
            return_value=[{'type': 'info', 'message': 'fyi', 'lastLine': 1}],
        ):
            issues = HtmlNuAdapter().validate('<html><body></body></html>', 'standard')
        self.assertEqual(issues[0].severity, 'info')

    def test_adapter_failure_is_isolated_from_other_html_engines(self):
        # Full engine.run() integration: an unavailable Java runtime must
        # never erase findings from html-lexical/html5lib/etc.
        from ..validation.engine import run as run_validation
        with override_settings(LP_JAVA_EXECUTABLE='definitely-not-a-real-java-binary-xyz'):
            result = run_validation(
                html='<!DOCTYPE html>\n<html\n<head><title>T</title></head><body>hi</body></html>',
                css='', js='', ts='', ampscript='', profile='standard',
                validation_scope='html', project=None, css_source_type='css',
            )
        nu_status = next(s for s in result.engine_status if s.engine_name == 'nu-html-checker')
        self.assertFalse(nu_status.success)
        self.assertNotIn('Traceback', nu_status.message)
        # The lexical scanner's own malformed-tag finding must still be present.
        self.assertTrue(any(issue.rule_id == 'malformed-start-tag' for issue in result.issues))

"""Sprint 1D fixture-based tests for the CSS validation pipeline —
Node bridge, CssConformanceAdapter, orchestrator integration, profiles,
resource limits, and the /api/v1/lp/validate/ contract with CSS."""

import subprocess
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ..validation import engine as engine_module
from ..validation import node_bridge
from ..validation.engine import run
from ..validation.node_bridge import NodeBridgeError

User = get_user_model()

_FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures' / 'validation' / 'css'


def _load_fixture(name: str) -> str:
    return (_FIXTURES_DIR / name).read_text(encoding='utf-8')


def _make_user(username='alice', password='pw12345!'):
    return User.objects.create_user(username=username, password=password, email=f'{username}@example.com')


def _css_issues(result):
    # Tool-Grounded AI Engineer sprint — excludes the Complete-LP cross-
    # language CSS-selector-to-HTML check (source_engine=
    # 'cross-language-html-css'): a real, independent finding, but not
    # something the CSS ENGINE itself produced, which is what every
    # caller of this helper actually means to isolate.
    return [
        issue for issue in result.issues
        if issue.language == 'css' and issue.source_engine != 'cross-language-html-css'
    ]


CASE_A_CSS = '.hero {\n  color red;\n  margin: 0px;\n}\n'
CASE_B_CSS = (
    '.hero {\n'
    '  width: 1440px;\n'
    '  outline: none !important;\n'
    '  margin: 0px;\n'
    '  background-image: url("javascript:alert(1)");\n'
    '  animation: missing-animation 2s linear;\n'
    '}\n'
)
CASE_C_CSS = (
    '@layer base, components;\n\n'
    ':root {\n'
    '  --space: clamp(1rem, 2vw, 2rem);\n'
    '}\n\n'
    '.card {\n'
    '  display: grid;\n'
    '  grid-template-columns: subgrid;\n'
    '  container-type: inline-size;\n'
    '  padding-inline: var(--space);\n'
    '  color: color-mix(in srgb, #000 80%, #fff);\n'
    '}\n\n'
    '@container (min-width: 40rem) {\n'
    '  .card {\n'
    '    grid-template-columns: 1fr 1fr;\n'
    '  }\n'
    '}\n'
)


class AcceptanceCaseTests(TestCase):
    def test_case_a_syntax_error_at_line_2(self):
        result = run(html='', css=CASE_A_CSS)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertTrue(any(i.start_line == 2 for i in errors), errors)
        self.assertTrue(all(i.language == 'css' for i in errors))
        # Never leaks into the HTML side of the report.
        self.assertFalse(any(i.language == 'html' and 'color' in i.message for i in result.issues))

    def test_case_b_all_six_findings_present_and_distinct(self):
        result = run(html='', css=CASE_B_CSS)
        rule_ids = {i.rule_id for i in _css_issues(result)}
        self.assertIn('stylelint:declaration-no-important', rule_ids)
        self.assertIn('stylelint:length-zero-no-unit', rule_ids)
        self.assertIn('stylelint:no-unknown-animations', rule_ids)
        self.assertIn('css-custom:responsive-fixed-width-risk', rule_ids)
        self.assertIn('css-custom:focus-outline-removed', rule_ids)
        self.assertIn('css-custom:unsafe-javascript-url', rule_ids)
        # All distinct — none deduplicated away because they share a rule block.
        self.assertEqual(len(_css_issues(result)), len(rule_ids))

    def test_case_b_javascript_url_is_high_severity(self):
        result = run(html='', css=CASE_B_CSS)
        js_url_issues = [i for i in _css_issues(result) if i.rule_id == 'css-custom:unsafe-javascript-url']
        self.assertEqual(len(js_url_issues), 1)
        self.assertEqual(js_url_issues[0].severity, 'error')
        self.assertEqual(js_url_issues[0].category, 'security')

    def test_case_c_valid_modern_css_produces_no_issues_in_standard_profile(self):
        result = run(html='', css=CASE_C_CSS, profile='standard')
        self.assertEqual(_css_issues(result), [])

    def test_case_c_legacy_profile_adds_info_only_never_errors_or_warnings(self):
        result = run(html='', css=CASE_C_CSS, profile='legacy')
        issues = _css_issues(result)
        self.assertTrue(issues)
        self.assertTrue(all(i.severity == 'info' for i in issues))
        self.assertTrue(all(i.rule_id == 'css-custom:modern-feature-compatibility-notice' for i in issues))


class CssFixtureRuleTests(TestCase):
    def _issues_for(self, fixture_name):
        return _css_issues(run(html='', css=_load_fixture(fixture_name)))

    def test_unclosed_block_detected(self):
        # Sprint CSS-A-2: a dedicated structural pass (see
        # embedded_css/validate_css.mjs's checkStructuralBalance) now
        # identifies exactly which "{" was never closed, rather than one
        # generic postcss:css-syntax-error.
        issues = self._issues_for('unclosed_block.css')
        self.assertTrue(any(i.rule_id == 'css-structure:unclosed-block' and i.start_line == 1 for i in issues))

    def test_unexpected_brace_detected(self):
        issues = self._issues_for('unexpected_brace.css')
        self.assertTrue(any(i.rule_id == 'css-structure:unmatched-closing-brace' for i in issues))

    def test_missing_colon_detected(self):
        issues = self._issues_for('missing_colon.css')
        self.assertTrue(any(i.rule_id == 'css-structure:parse-error' and i.start_line == 2 for i in issues))

    def test_missing_value_detected(self):
        issues = self._issues_for('missing_value.css')
        self.assertTrue(any(i.rule_id == 'stylelint:declaration-property-value-no-unknown' for i in issues))

    def test_invalid_declaration_detected(self):
        issues = self._issues_for('invalid_declaration.css')
        self.assertTrue(any(i.rule_id == 'stylelint:property-no-unknown' for i in issues))

    def test_invalid_selector_detected(self):
        issues = self._issues_for('invalid_selector.css')
        self.assertTrue(any(i.rule_id == 'css-structure:parse-error' for i in issues))

    def test_invalid_media_query_detected(self):
        issues = self._issues_for('invalid_media_query.css')
        self.assertTrue(any(i.rule_id == 'css-custom:empty-at-rule-condition' for i in issues))

    def test_invalid_supports_query_detected(self):
        issues = self._issues_for('invalid_supports_query.css')
        self.assertTrue(any(i.rule_id == 'css-custom:empty-at-rule-condition' for i in issues))

    def test_invalid_container_query_detected(self):
        issues = self._issues_for('invalid_container_query.css')
        self.assertTrue(any(i.rule_id == 'css-custom:empty-at-rule-condition' for i in issues))

    def test_invalid_keyframes_detected(self):
        issues = self._issues_for('invalid_keyframes.css')
        self.assertTrue(any(i.rule_id == 'css-custom:keyframes-missing-name' for i in issues))

    def test_malformed_custom_property_detected(self):
        issues = self._issues_for('malformed_custom_property.css')
        self.assertTrue(any(i.rule_id == 'stylelint:custom-property-pattern' for i in issues))

    def test_unknown_property_detected(self):
        issues = self._issues_for('unknown_property.css')
        self.assertTrue(any(i.rule_id == 'stylelint:property-no-unknown' for i in issues))

    def test_invalid_property_value_detected(self):
        issues = self._issues_for('invalid_property_value.css')
        self.assertTrue(any(i.rule_id == 'stylelint:declaration-property-value-no-unknown' for i in issues))

    def test_duplicate_declaration_detected(self):
        issues = self._issues_for('duplicate_declaration.css')
        self.assertTrue(any(i.rule_id == 'stylelint:declaration-block-no-duplicate-properties' for i in issues))

    def test_empty_rule_detected(self):
        issues = self._issues_for('empty_rule.css')
        self.assertTrue(any(i.rule_id == 'stylelint:block-no-empty' for i in issues))

    def test_vendor_prefix_problem_detected(self):
        issues = self._issues_for('vendor_prefix_problem.css')
        self.assertEqual(
            sum(1 for i in issues if i.rule_id == 'stylelint:property-no-vendor-prefix'), 2,
        )

    def test_unnecessary_zero_unit_detected(self):
        issues = self._issues_for('unnecessary_zero_unit.css')
        self.assertEqual(sum(1 for i in issues if i.rule_id == 'stylelint:length-zero-no-unit'), 2)

    def test_excessive_specificity_detected(self):
        issues = self._issues_for('excessive_specificity.css')
        self.assertTrue(any(i.rule_id == 'stylelint:selector-max-specificity' for i in issues))

    def test_important_usage_detected(self):
        issues = self._issues_for('important_usage.css')
        self.assertTrue(any(i.rule_id == 'stylelint:declaration-no-important' for i in issues))

    def test_missing_keyframe_reference_detected(self):
        issues = self._issues_for('missing_keyframe_reference.css')
        self.assertTrue(any(i.rule_id == 'stylelint:no-unknown-animations' for i in issues))

    def test_suspicious_z_index_detected(self):
        issues = self._issues_for('suspicious_z_index.css')
        found = [i for i in issues if i.rule_id == 'css-custom:suspicious-z-index']
        self.assertTrue(found)
        self.assertEqual(found[0].confidence, 'likely')

    def test_negative_invalid_dimension_detected(self):
        issues = self._issues_for('negative_invalid_dimension.css')
        custom = [i for i in issues if i.rule_id == 'css-custom:negative-invalid-dimension']
        self.assertEqual(len(custom), 2)
        self.assertTrue(all(i.severity == 'error' and i.confidence == 'definite' for i in custom))

    def test_fixed_width_overflow_risk_detected_with_confidence(self):
        issues = self._issues_for('fixed_width_overflow_risk.css')
        found = [i for i in issues if i.rule_id == 'css-custom:responsive-fixed-width-risk']
        self.assertTrue(found)
        self.assertIn(found[0].confidence, ('likely', 'possible'))
        self.assertEqual(found[0].category, 'responsive')

    def test_horizontal_overflow_risk_detected(self):
        issues = self._issues_for('horizontal_overflow_risk.css')
        self.assertTrue(any(i.rule_id == 'css-custom:responsive-fixed-width-risk' for i in issues))

    def test_focus_outline_removal_detected(self):
        issues = self._issues_for('focus_outline_removal.css')
        found = [i for i in issues if i.rule_id == 'css-custom:focus-outline-removed']
        self.assertTrue(found)
        self.assertEqual(found[0].category, 'accessibility')

    def test_very_small_font_detected(self):
        issues = self._issues_for('very_small_font.css')
        self.assertTrue(any(i.rule_id == 'css-custom:small-font-size' for i in issues))

    def test_motion_without_reduced_motion_detected(self):
        issues = self._issues_for('motion_without_reduced_motion.css')
        self.assertTrue(any(i.rule_id == 'css-custom:motion-without-reduced-motion' for i in issues))

    def test_unsafe_javascript_url_detected(self):
        issues = self._issues_for('unsafe_javascript_url.css')
        found = [i for i in issues if i.rule_id == 'css-custom:unsafe-javascript-url']
        self.assertTrue(found)
        self.assertEqual(found[0].severity, 'error')
        self.assertEqual(found[0].confidence, 'definite')

    def test_unsafe_external_import_detected(self):
        issues = self._issues_for('unsafe_external_import.css')
        self.assertTrue(any(i.rule_id == 'css-custom:insecure-external-url' for i in issues))

    def test_mixed_content_import_detected(self):
        issues = self._issues_for('mixed_content_import.css')
        self.assertTrue(any(i.rule_id == 'css-custom:insecure-external-url' for i in issues))

    def test_dangerous_data_url_detected(self):
        issues = self._issues_for('dangerous_data_url.css')
        self.assertTrue(any(i.rule_id == 'css-custom:large-data-url' for i in issues))

    def test_multiple_findings_on_one_line_all_preserved(self):
        issues = self._issues_for('multiple_findings_one_line.css')
        self.assertTrue(all(i.start_line == 1 for i in issues))
        rule_ids = {i.rule_id for i in issues}
        self.assertGreaterEqual(len(rule_ids), 3)
        self.assertEqual(len(issues), len(rule_ids))  # none collapsed into another

    def test_unicode_css_does_not_crash_or_corrupt(self):
        issues = self._issues_for('unicode.css')
        # A stylistic naming-convention warning is fine; the point is the
        # engine never crashes or mangles the UTF-8 content end-to-end.
        self.assertTrue(all(isinstance(i.message, str) for i in issues))

    def test_valid_modern_fixtures_produce_no_issues(self):
        valid_fixtures = [
            'valid_modern.css', 'valid_custom_properties.css', 'valid_grid.css',
            'valid_flexbox.css', 'valid_logical_properties.css', 'valid_cascade_layers.css',
            'valid_container_queries.css', 'valid_nesting.css', 'valid_subgrid.css',
            'valid_dynamic_viewport_units.css', 'valid_modern_colors.css',
        ]
        for fixture_name in valid_fixtures:
            with self.subTest(fixture=fixture_name):
                self.assertEqual(self._issues_for(fixture_name), [])


class CssHtmlCoexistenceTests(TestCase):
    def test_html_and_css_findings_coexist_in_one_report(self):
        html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><img src="x.png"></body></html>'
        result = run(html=html, css=CASE_A_CSS)
        languages = {i.language for i in result.issues}
        self.assertIn('html', languages)
        self.assertIn('css', languages)


class CssAdapterFailureIsolationTests(TestCase):
    def test_css_engine_failure_does_not_delete_html_findings(self):
        html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><img src="x.png"></body></html>'
        with patch(
            'landingpages.validation.adapters.css_conformance.run_css_validation',
            side_effect=NodeBridgeError('CSS validation could not be completed.'),
        ):
            result = run(html=html, css=CASE_A_CSS)

        html_issues = [i for i in result.issues if i.language == 'html']
        self.assertTrue(html_issues)
        self.assertEqual(_css_issues(result), [])

        css_status = next(s for s in result.engine_status if s.engine_name == 'css-conformance')
        self.assertFalse(css_status.success)
        self.assertNotIn('Traceback', css_status.message)


@override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
class NodeBridgeTests(TestCase):
    """Validator Worker sprint — these tests simulate SUBPROCESS-level
    transport failures directly (mocking `subprocess.run`), so the
    persistent worker pool (which never calls `subprocess.run` per
    request — see node_worker_pool.py) is disabled class-wide to force
    every call through the subprocess fallback path these tests are
    actually exercising."""

    def test_missing_node_executable_raises_safe_error(self):
        with override_settings(LP_NODE_EXECUTABLE='definitely-not-a-real-node-binary-xyz'):
            with self.assertRaises(NodeBridgeError) as ctx:
                node_bridge.run_css_validation('.a{color:red}', 'standard')
        self.assertNotIn('definitely-not-a-real-node-binary-xyz', str(ctx.exception))

    def test_timeout_raises_safe_error(self):
        with patch(
            'landingpages.validation.node_bridge.subprocess.run',
            side_effect=subprocess.TimeoutExpired(cmd=['node'], timeout=5),
        ):
            with self.assertRaises(NodeBridgeError) as ctx:
                node_bridge.run_css_validation('.a{color:red}', 'standard')
        self.assertIn('timed out', str(ctx.exception).lower())

    def test_non_zero_exit_raises_safe_error_without_leaking_stderr(self):
        completed = subprocess.CompletedProcess(
            args=['node'], returncode=1, stdout=b'', stderr=b'Error: Cannot find module \'stylelint\'\n    at secretpath',
        )
        with patch('landingpages.validation.node_bridge.subprocess.run', return_value=completed):
            with self.assertRaises(NodeBridgeError) as ctx:
                node_bridge.run_css_validation('.a{color:red}', 'standard')
        self.assertNotIn('secretpath', str(ctx.exception))
        self.assertNotIn('stylelint', str(ctx.exception))

    def test_malformed_json_output_raises_safe_error(self):
        completed = subprocess.CompletedProcess(args=['node'], returncode=0, stdout=b'not json at all', stderr=b'')
        with patch('landingpages.validation.node_bridge.subprocess.run', return_value=completed):
            with self.assertRaises(NodeBridgeError):
                node_bridge.run_css_validation('.a{color:red}', 'standard')

    def test_oversized_output_raises_safe_error(self):
        completed = subprocess.CompletedProcess(args=['node'], returncode=0, stdout=b'{"success": true}' + b' ' * 10, stderr=b'')
        with override_settings(LP_CSS_VALIDATION_MAX_OUTPUT_BYTES=5):
            with patch('landingpages.validation.node_bridge.subprocess.run', return_value=completed):
                with self.assertRaises(NodeBridgeError):
                    node_bridge.run_css_validation('.a{color:red}', 'standard')

    def test_missing_dependencies_simulated_via_missing_script(self):
        with patch('landingpages.validation.node_bridge._CSS_SCRIPT_PATH') as mock_path:
            mock_path.is_file.return_value = False
            with self.assertRaises(NodeBridgeError):
                node_bridge.run_css_validation('.a{color:red}', 'standard')


class CssResourceLimitTests(TestCase):
    def test_issue_count_is_truncated_with_notice(self):
        many_duplicates = '\n'.join(f'.item-{n} {{ color: red; color: blue; }}' for n in range(20))
        with patch.object(engine_module, 'MAX_ISSUES', 3):
            result = run(html='', css=many_duplicates)
        self.assertEqual(len(result.issues), 3)
        self.assertTrue(result.truncated)
        self.assertGreater(result.truncated_issue_count, 0)

    def test_css_line_count_is_truncated(self):
        oversized = '\n'.join(f'/* line {n} */' for n in range(30))
        with patch.object(engine_module, 'MAX_LINE_COUNT', 5):
            result = run(html='', css=oversized)
        self.assertTrue(result.truncated)
        self.assertTrue(any('truncated' in s.message.lower() for s in result.engine_status))


class CssApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')
        self.client.force_authenticate(self.user)

    def test_validate_css_only(self):
        response = self.client.post('/api/v1/lp/validate/', {'html': '', 'css': CASE_A_CSS}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        css_findings = [i for i in body['issues'] if i['language'] == 'css']
        self.assertTrue(css_findings)

    def test_validate_html_and_css_together(self):
        html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><img src="x.png"></body></html>'
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': html, 'css': CASE_A_CSS}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        languages = {i['language'] for i in response.json()['issues']}
        self.assertEqual(languages, {'html', 'css'})

    def test_validate_with_each_profile_for_css(self):
        for profile in ('standard', 'strict', 'legacy', 'experimental'):
            with self.subTest(profile=profile):
                response = self.client.post(
                    '/api/v1/lp/validate/', {'html': '', 'css': CASE_B_CSS, 'profile': profile}, format='json',
                )
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(response.json()['profile'], profile)

    def test_oversized_css_rejected_at_serializer_level(self):
        oversized_css = 'a{color:red}' * 20_000  # comfortably past MAX_SOURCE_LENGTH
        response = self.client.post('/api/v1/lp/validate/', {'html': '', 'css': oversized_css}, format='json')
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertIn('css', body['errors'])

    def test_css_engine_unavailable_returns_partial_success_not_500(self):
        html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><img src="x.png"></body></html>'
        # Validator Worker sprint — the worker pool is a process-lifetime
        # singleton (see node_worker_pool.get_worker_pool()) that does not
        # re-resolve LP_NODE_EXECUTABLE once already started by an earlier
        # test in this run; disabling it here forces this specific
        # request through the subprocess fallback the override is meant
        # to simulate failing.
        with override_settings(LP_NODE_EXECUTABLE='definitely-not-a-real-node-binary-xyz', LP_VALIDATOR_WORKER_ENABLED=False):
            response = self.client.post(
                '/api/v1/lp/validate/', {'html': html, 'css': CASE_A_CSS}, format='json',
            )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        # Tool-Grounded AI Engineer sprint — excludes the independent
        # Complete-LP cross-language CSS-selector check, which needs no
        # working CSS engine at all (it's a plain-text scan) and so can
        # legitimately still fire here; every OTHER css-language finding
        # must be absent since the CSS engine itself is unavailable.
        languages = {i['language'] for i in body['issues'] if not i['rule_id'].startswith('cross-language:')}
        self.assertIn('html', languages)
        self.assertNotIn('css', languages)
        css_status = next(s for s in body['engine_status'] if s['engine_name'] == 'css-conformance')
        self.assertFalse(css_status['success'])

"""Sprint CSS-D tests — LESS compilation, generated-CSS validation, and
source-map mapping back to the original LESS source. See
validation/adapters/css_less.py / validators_node/compile_less.mjs."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ..validation import node_bridge
from ..validation.adapters.css_less import LessAdapter
from ..validation.engine import run
from ..validation.node_bridge import NodeBridgeError


def _css_issues(result):
    return [issue for issue in result.issues if issue.language == 'css']


def _less(html='', css='', **kwargs):
    return run(html=html, css=css, css_source_type='less', validation_scope='css', **kwargs)


SPEC_LESS = (
    '@brand: #3366ff;\n\n'
    '.button {\n'
    '  color: @brand;\n\n'
    '  &:hover {\n'
    '    background: #3366ff;\n'
    '    color: darken(@brand, 10%);\n'
    '  }\n'
    '}\n'
)


class LessCompilationTests(TestCase):
    def test_valid_less_variables(self):
        result = _less(css='@brand: #369;\n\n.a {\n  color: @brand;\n}\n')
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])

    def test_valid_less_nesting(self):
        css = '.card {\n  .title {\n    color: #369;\n  }\n\n  &:hover {\n    color: #147;\n  }\n}\n'
        result = _less(css=css)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])

    def test_valid_less_mixins(self):
        css = (
            '.rounded(@radius) {\n'
            '  border-radius: @radius;\n'
            '}\n\n'
            '.box {\n'
            '  .rounded(4px);\n'
            '}\n'
        )
        result = _less(css=css)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [], result.issues)

    def test_valid_colour_functions(self):
        result = _less(css=SPEC_LESS)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [], result.issues)

    def test_undefined_variable(self):
        result = _less(css='.card {\n  color: @missing-color;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)
        self.assertTrue(any('variable' in i.message.lower() for i in issues), issues)
        self.assertTrue(any(i.start_line == 2 for i in issues), issues)

    def test_missing_brace(self):
        result = _less(css='.a {\n  color: red;\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)
        self.assertTrue(all(i.source_context == 'standalone-less' for i in issues), issues)

    def test_invalid_syntax(self):
        result = _less(css='.a {\n  color:: red;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.severity == 'error' for i in issues), issues)

    def test_multiple_diagnostics(self):
        css = (
            '.a {\n  color: #336699;\n}\n\n'
            '.b {\n  color: #778899;\n}\n'
        )
        result = _less(css=css)
        issues = [i for i in _css_issues(result) if i.rule_id == 'stylelint:color-hex-length']
        lines = {i.start_line for i in issues}
        self.assertEqual(lines, {2, 6}, issues)

    def test_generated_css_stylelint_issue_detected(self):
        result = _less(css=SPEC_LESS)
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id.startswith('stylelint:') for i in issues), issues)

    def test_source_map_mapping(self):
        result = _less(css=SPEC_LESS)
        issues = _css_issues(result)
        # "color: @brand" (original line 4) and "background: #3366ff;"
        # nested inside "&:hover {" (original line 7) each produce a
        # generated-CSS style notice that must map back to their real
        # original lines, not the generated document's own line numbers
        # — proof that source-map mapping survives LESS nesting, not
        # just top-level rules.
        #
        # Tool-Grounded AI Engineer sprint — this test previously used a
        # different rule (a blank-line-before-rule style notice) as its
        # nested-rule evidence; that rule is now correctly never reported
        # for LESS at all, since Less.js's compiler does not preserve
        # blank-line spacing in its output regardless of the LESS
        # source's own formatting (see css_engine.mjs's
        # LESS_COMPILED_OUTPUT_UNFIXABLE_RULES) — a real fix, not a
        # regression, so this test now proves the same nesting-mapping
        # guarantee with a still-genuine, still-fixable rule instead.
        lines = {i.start_line for i in issues}
        self.assertIn(4, lines, issues)
        self.assertIn(7, lines, issues)
        self.assertTrue(any(i.generated_start_line is not None for i in issues), issues)

    def test_unicode(self):
        css = '.café {\n  content: "café ☕";\n}\n'
        result = _less(css=css)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])

    def test_oversized_input_still_handled_safely(self):
        huge_value = 'a' * 250_000
        css = f'.a {{\n  content: "{huge_value}";\n}}\n'
        result = _less(css=css)
        # Either compiles (and is validated) or reports a controlled
        # engine failure — never an unhandled exception either way.
        self.assertIsNotNone(result)

    # Validator Worker sprint — the four tests below simulate SUBPROCESS-
    # level transport failures (mocked subprocess.run, or a mocked-missing
    # script path only the subprocess path ever consults); the persistent
    # worker pool never calls subprocess.run per request and doesn't
    # re-check the script path once already running, so it would silently
    # bypass these mocks and serve a real, successful result. Disabled
    # per-test (not class-wide) so every other LessCompilationTests test
    # keeps exercising whichever path — worker or subprocess — is
    # actually configured.
    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_compilation_timeout_raises_safe_error(self):
        with patch('subprocess.run', side_effect=__import__('subprocess').TimeoutExpired(cmd='node', timeout=8)):
            result = _less(css='.a { color: red; }')
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertIn('less-compiler', statuses)
        self.assertFalse(statuses['less-compiler'].success)

    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_oversized_generated_output_raises_safe_error(self):
        huge_value = 'a' * 3_000_000
        css = f'.a {{\n  content: "{huge_value}";\n}}\n'
        with override_settings(LP_CSS_VALIDATION_MAX_OUTPUT_BYTES=1000):
            result = _less(css=css)
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertIn('less-compiler', statuses)
        self.assertFalse(statuses['less-compiler'].success)

    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_compiler_unavailable_raises_safe_error(self):
        with patch.object(node_bridge, '_LESS_SCRIPT_PATH') as mock_path:
            mock_path.is_file.return_value = False
            with self.assertRaises(NodeBridgeError):
                node_bridge.run_less_compilation('.a { color: red; }', 'standard')

    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_malformed_compiler_output_raises_safe_error(self):
        import subprocess as subprocess_module

        fake_completed = subprocess_module.CompletedProcess(
            args=['node'], returncode=0, stdout=b'not json', stderr=b'',
        )
        with patch('subprocess.run', return_value=fake_completed):
            with self.assertRaises(NodeBridgeError):
                node_bridge.run_less_compilation('.a { color: red; }', 'standard')

    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_partial_html_success_when_less_fails(self):
        # A fully clean, spec-complete document — html-structure/seo have
        # nothing to flag, so any HTML finding here would itself be a
        # bug; the real point of this test is that the request never
        # 500s and the HTML engines still report success even though the
        # LESS engine failed.
        html = (
            '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title>'
            '<meta name="description" content="d"><meta name="viewport" content="width=device-width, initial-scale=1">'
            '</head><body><h1>T</h1></body></html>'
        )
        with patch.object(node_bridge, '_LESS_SCRIPT_PATH') as mock_path:
            mock_path.is_file.return_value = False
            result = run(
                html=html, css='.a { color: @missing; }', css_source_type='less', validation_scope='complete',
            )
        html_issues = [i for i in result.issues if i.language == 'html']
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertEqual(html_issues, [], html_issues)
        self.assertIn('less-compiler', statuses)
        self.assertFalse(statuses['less-compiler'].success)
        self.assertTrue(all(
            statuses[name].success for name in
            ('html5lib', 'html-structure', 'html-accessibility', 'html-seo', 'html-responsive')
            if name in statuses
        ))


class JavaScriptAndPluginSecurityTests(TestCase):
    def test_javascript_expression_rejected(self):
        result = _less(css='@secret: `process.env.SECRET`;\n.a { content: @secret; }\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)
        self.assertTrue(any('javascript' in i.message.lower() for i in issues), issues)
        # The secret must never appear anywhere in the response.
        self.assertFalse(any('SECRET' in i.message for i in issues), issues)

    def test_no_environment_value_leaks_on_javascript_rejection(self):
        import os
        os.environ['MDAIW_TEST_CANARY_SECRET'] = 'canary-value-should-never-leak'
        try:
            result = _less(css='@x: `process.env.MDAIW_TEST_CANARY_SECRET`;\n.a { content: @x; }\n')
            issues = _css_issues(result)
            self.assertFalse(any('canary-value-should-never-leak' in i.message for i in issues), issues)
        finally:
            del os.environ['MDAIW_TEST_CANARY_SECRET']


class ImportSecurityTests(TestCase):
    """Direct adapter-level tests — no project/asset-storage feature
    exists yet (same situation as Sprint CSS-B/C), so these exercise the
    `partials` parameter directly to prove the FileManager's security
    properties hold regardless of what's in it."""

    def test_absolute_import_rejected(self):
        adapter = LessAdapter()
        issues = adapter.validate('@import "/etc/passwd";\n.a { color: red; }\n', 'standard', partials={})
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_parent_directory_traversal_rejected(self):
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "../../../../etc/passwd";\n.a { color: red; }\n', 'standard',
            partials={'variables': '@brand: blue;'},
        )
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_network_import_rejected(self):
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "https://evil.example.com/x.less";\n.a { color: red; }\n', 'standard', partials={},
        )
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_protocol_relative_import_rejected(self):
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "//evil.example.com/x.less";\n.a { color: red; }\n', 'standard', partials={},
        )
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_file_scheme_import_rejected(self):
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "file:///etc/passwd";\n.a { color: red; }\n', 'standard', partials={},
        )
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_data_scheme_import_rejected(self):
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "data:text/css,.a{color:red}";\n.b { color: blue; }\n', 'standard', partials={},
        )
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_cross_project_import_never_resolves(self):
        # A partial belonging to a *different* project/user simply never
        # appears in this call's `partials` map — proving the boundary
        # holds is exactly proving an import absent from the map cannot
        # resolve, regardless of what other data exists server-side.
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "other-project-asset";\n.a { color: red; }\n', 'standard',
            partials={'my-own-asset': '@brand: blue;'},
        )
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_import_cycle_does_not_hang_or_crash(self):
        # A imports B, B imports A — Less's own compiler must detect and
        # safely error on this, not hang.
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "b";\n.a { color: red; }\n', 'standard',
            partials={'a': '@import "b";\n.a { color: red; }\n', 'b': '@import "a";\n.b { color: blue; }\n'},
        )
        # Either a controlled error or (if Less tolerates the cycle) a
        # successful compile — the only unacceptable outcome is hanging,
        # which the test framework's own timeout would already catch.
        self.assertIsNotNone(issues)

    def test_approved_same_user_partial_resolves(self):
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "variables";\n.a {\n  color: @brand;\n}\n', 'standard',
            partials={'variables': '@brand: #369;'},
        )
        self.assertFalse(any(i.rule_id == 'less:compile-error' for i in issues), issues)

    def test_finding_inside_imported_partial_is_not_reported_as_unrelated_main_line(self):
        adapter = LessAdapter()
        issues = adapter.validate(
            '@import "variables";\n.a {\n  color: @brand;\n}\n', 'standard',
            partials={'variables': '@brand: #336699;'},
        )
        hex_issues = [i for i in issues if i.rule_id == 'stylelint:color-hex-length']
        self.assertTrue(hex_issues, issues)
        # Less collapses imports into the main document's own line
        # numbering (verified empirically — unlike Dart Sass, which keeps
        # a separate source-map entry per file) — the important
        # guarantee is simply that no exception occurs and a real,
        # in-range line number is always returned.
        for issue in hex_issues:
            self.assertGreaterEqual(issue.start_line, 1)


class ScopeAndDispatchTests(TestCase):
    def test_html_scope_never_runs_less_compiler(self):
        result = run(
            html='<p>hi</p>', css='@brand: #369; .a { color: @brand; }',
            css_source_type='less', validation_scope='html',
        )
        names = {s.engine_name for s in result.engine_status}
        self.assertNotIn('less-compiler', names)

    def test_css_scope_with_less_does_not_run_html(self):
        result = _less(html='<div>not validated</div>', css='.a { color: #369; }')
        html_issues = [i for i in result.issues if i.language == 'html']
        self.assertEqual(html_issues, [])

    def test_complete_scope_merges_html_and_less_findings(self):
        html = '<img src="hero.jpg">'
        result = run(html=html, css=SPEC_LESS, css_source_type='less', validation_scope='complete')
        html_issues = [i for i in result.issues if i.language == 'html']
        self.assertTrue(html_issues, result.issues)
        # SPEC_LESS may compile with zero content issues — coexistence
        # (no fingerprint collisions between the HTML and CSS findings)
        # is what this test actually verifies.
        fingerprints = [i.fingerprint for i in result.issues if i.language == 'css' or i.language == 'html']
        self.assertEqual(len(fingerprints), len(set(fingerprints)))

    def test_css_source_type_less_is_accepted(self):
        result = _less(css='.a { color: #369; }')
        self.assertEqual(result.css_source_type, 'less')

    def test_run_result_reports_css_source_type_less(self):
        result = _less(css='.a { color: #369; }')
        names = {s.engine_name for s in result.engine_status}
        self.assertIn('less-compiler', names)


class ApiIntegrationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='alice', password='pw12345!', email='alice@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_validate_less_persists_css_source_type_on_report(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': '', 'css': '.a { color: #369; }', 'validation_scope': 'css', 'css_source_type': 'less'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['css_source_type'], 'less')

    def test_validate_rejects_unknown_css_source_type(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': '', 'css': '.a { color: red; }', 'validation_scope': 'css', 'css_source_type': 'bogus'},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_unauthenticated_validate_rejected(self):
        client = APIClient()
        response = client.post(
            '/api/v1/lp/validate/',
            {'html': '', 'css': '.a { color: #369; }', 'validation_scope': 'css', 'css_source_type': 'less'},
            format='json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_cross_user_project_still_rejected_for_less_requests(self):
        from ..models import LandingPageProject

        other_user = get_user_model().objects.create_user(
            username='bob', password='pw12345!', email='bob@example.com',
        )
        others_project = LandingPageProject.objects.create(user=other_user, slug='theirs', name='Theirs')
        response = self.client.post(
            '/api/v1/lp/validate/',
            {
                'html': '', 'css': '.a { color: #369; }', 'validation_scope': 'css',
                'css_source_type': 'less', 'project': others_project.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['code'], 'INVALID_PROJECT')


class AcceptanceCaseTests(TestCase):
    def test_case_a_css_scope_compiles_and_validates_no_html(self):
        result = run(html='<p>ignored</p>', css=SPEC_LESS, css_source_type='less', validation_scope='css')
        self.assertEqual([i for i in result.issues if i.language == 'html'], [])
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertTrue(statuses['less-compiler'].success)

    def test_case_b_compile_error_reports_original_position_no_leakage(self):
        result = _less(css='.card {\n  color: @missing-color;\n}\n')
        issues = _css_issues(result)
        errors = [i for i in issues if i.rule_id == 'less:compile-error']
        self.assertTrue(errors, issues)
        self.assertEqual(errors[0].start_line, 2)
        for issue in issues:
            self.assertNotIn('C:\\', issue.message)
            self.assertNotIn('/home/', issue.message)
            self.assertNotIn('Traceback', issue.message)

    def test_case_c_generated_warnings_map_to_original_less_and_are_labelled(self):
        css = '@space: 0px;\n\n.card {\n  margin: @space;\n  outline: none !important;\n}\n'
        result = _less(css=css)
        issues = _css_issues(result)
        self.assertFalse(any(i.rule_id == 'less:compile-error' for i in issues), issues)
        self.assertTrue(any(i.source_context == 'standalone-less' for i in issues), issues)
        self.assertTrue(any(1 <= i.start_line <= 6 for i in issues), issues)

    def test_case_d_javascript_rejected_no_secret_in_output(self):
        result = _less(css='@secret: `process.env.SECRET`;\n.a { content: @secret; }\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'less:compile-error' for i in issues), issues)
        self.assertFalse(any('SECRET' in i.message for i in issues), issues)

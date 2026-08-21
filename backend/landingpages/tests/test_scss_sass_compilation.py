"""Sprint CSS-C tests — SCSS/indented-Sass compilation, generated-CSS
validation, and source-map mapping back to the original source. See
validation/adapters/css_scss_sass.py /
validators_node/{css_engine,compile_scss}.mjs."""

from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ..validation import node_bridge
from ..validation.adapters.css_scss_sass import ScssSassAdapter
from ..validation.engine import run
from ..validation.node_bridge import NodeBridgeError


def _css_issues(result):
    return [issue for issue in result.issues if issue.language == 'css']


def _scss(html='', css='', **kwargs):
    return run(html=html, css=css, css_source_type='scss', validation_scope='css', **kwargs)


def _sass(html='', css='', **kwargs):
    return run(html=html, css=css, css_source_type='sass', validation_scope='css', **kwargs)


SPEC_SCSS = (
    '$brand: #3366ff;\n\n'
    '.button {\n'
    '  color: $brand;\n\n'
    '  &:hover {\n'
    '    color: darken($brand, 10%);\n'
    '  }\n'
    '}\n'
)


class ScssCompilationTests(TestCase):
    def test_valid_scss_variables_compile_cleanly(self):
        result = _scss(css='$brand: #369;\n\n.a {\n  color: $brand;\n}\n')
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])

    def test_valid_scss_nesting(self):
        css = '.card {\n  .title {\n    color: #369;\n  }\n\n  &:hover {\n    color: #147;\n  }\n}\n'
        result = _scss(css=css)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])

    def test_valid_mixins(self):
        css = (
            '@mixin rounded($radius) {\n'
            '  border-radius: $radius;\n'
            '}\n\n'
            '.box {\n'
            '  @include rounded(4px);\n'
            '}\n'
        )
        result = _scss(css=css)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])

    def test_valid_dart_sass_function(self):
        css = '.a {\n  width: math.div(20px, 2);\n}\n'
        # math.div requires @use "sass:math" — omitted deliberately to
        # keep this test about function *syntax*, not module wiring; a
        # missing-module compile error is still a legitimate, honest
        # result and proves the compiler ran for real.
        result = _scss(css='@use "sass:math";\n\n' + css)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [], result.issues)

    def test_invalid_variable_reference(self):
        result = _scss(css='.a {\n  color: $does-not-exist;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'scss:compile-error' for i in issues), issues)
        self.assertTrue(any('variable' in i.message.lower() for i in issues), issues)

    def test_invalid_nesting_produces_compile_error(self):
        # A malformed declaration inside a nested block confuses SCSS's
        # own parser (not just a CSS-lint concern) — see acceptance case
        # 28's "color red" example.
        css = '.card {\n  padding: 16px;\n\n  .title {\n    color red;\n  }\n}\n'
        result = _scss(css=css)
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'scss:compile-error' for i in issues), issues)

    def test_missing_brace(self):
        result = _scss(css='.a {\n  color: red;\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'scss:compile-error' for i in issues), issues)
        self.assertTrue(all(i.source_context == 'standalone-scss' for i in issues), issues)

    def test_compilation_error_preserves_original_source_position(self):
        result = _scss(css='.a {\n  color: $missing;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.start_line == 2 for i in issues), issues)

    def test_source_map_mapping_for_generated_css_finding(self):
        result = _scss(css=SPEC_SCSS)
        issues = _css_issues(result)
        # A stylelint style-convention finding on the generated
        # ".button:hover { color: rgb(...); }" line must map back to the
        # original "darken($brand, 10%)" call on line 7.
        self.assertTrue(any(i.start_line == 7 for i in issues), issues)
        self.assertTrue(any(i.generated_start_line is not None for i in issues), issues)

    def test_generated_css_stylelint_issue_detected(self):
        result = _scss(css=SPEC_SCSS)
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id.startswith('stylelint:') for i in issues), issues)

    def test_multiple_findings_across_document(self):
        css = (
            '.a {\n  color: #336699;\n}\n\n'
            '.b {\n  color: #778899;\n}\n'
        )
        result = _scss(css=css)
        issues = [i for i in _css_issues(result) if i.rule_id == 'stylelint:color-hex-length']
        lines = {i.start_line for i in issues}
        self.assertEqual(lines, {2, 6}, issues)

    def test_unicode_scss_does_not_crash_or_corrupt(self):
        css = '.café {\n  content: "café ☕";\n}\n'
        result = _scss(css=css)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])

    # Validator Worker sprint — these two simulate SUBPROCESS-level
    # transport failures; the persistent worker pool never calls
    # subprocess.run per request, so it would silently bypass the mock
    # and return a real, successful result. See the identical note on
    # LessCompilationTests in test_less_compilation.py.
    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_oversized_generated_output_raises_safe_error(self):
        huge_value = 'a' * 3_000_000
        css = f'.a {{\n  content: "{huge_value}";\n}}\n'
        with override_settings(LP_CSS_VALIDATION_MAX_OUTPUT_BYTES=1000):
            result = _scss(css=css)
        # The engine failure is isolated exactly like every other adapter
        # — reported via engine_status, not a raised exception.
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertIn('scss-compiler', statuses)
        self.assertFalse(statuses['scss-compiler'].success)

    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_timeout_raises_safe_error(self):
        with patch('subprocess.run', side_effect=__import__('subprocess').TimeoutExpired(cmd='node', timeout=8)):
            result = _scss(css='.a { color: red; }')
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertIn('scss-compiler', statuses)
        self.assertFalse(statuses['scss-compiler'].success)


class IndentedSassCompilationTests(TestCase):
    def test_valid_indented_sass_source(self):
        result = _sass(css='body\n  color: red\n')
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [])
        # A clean compile still surfaces a stylelint style-notice for
        # duplicate declaration formatting? no — just confirm zero errors
        # and that the adapter tagged the right context.
        self.assertTrue(all(i.source_context == 'standalone-sass' for i in _css_issues(result)))

    def test_indented_sass_syntax_error(self):
        result = _sass(css='body\n  color: #{$missing\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'sass:compile-error' for i in issues), issues)

    def test_indented_sass_uses_sass_rule_prefix_not_scss(self):
        result = _sass(css='body\n  color: $undefined\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id.startswith('sass:') for i in issues), issues)
        self.assertFalse(any(i.rule_id.startswith('scss:') for i in issues), issues)


class ImportSecurityTests(TestCase):
    """Direct adapter-level tests — no project/asset-storage feature
    exists yet (same situation as Sprint CSS-B), so these exercise the
    `partials` parameter directly to prove the importer's security
    properties hold regardless of what's in it."""

    def test_import_with_no_partials_rejected_cleanly(self):
        adapter = ScssSassAdapter('scss')
        issues = adapter.validate('@use "variables";\n.a { color: red; }\n', 'standard', partials={})
        self.assertTrue(any(i.rule_id == 'scss:compile-error' for i in issues), issues)
        self.assertTrue(any('import' in i.message.lower() for i in issues), issues)

    def test_parent_directory_traversal_rejected(self):
        adapter = ScssSassAdapter('scss')
        issues = adapter.validate(
            '@import "../../../../etc/passwd";\n.a { color: red; }\n', 'standard',
            partials={'variables': '$brand: blue;'},  # present, but irrelevant — never matched by the traversal string
        )
        self.assertTrue(any(i.rule_id == 'scss:compile-error' for i in issues), issues)

    def test_network_import_rejected(self):
        # @use (module-only, unlike @import) has no CSS-passthrough
        # special case for URL-shaped strings — this exercises the
        # importer's own scheme-rejection branch directly.
        adapter = ScssSassAdapter('scss')
        issues = adapter.validate(
            '@use "https://evil.example.com/x";\n.a { color: red; }\n', 'standard', partials={},
        )
        self.assertTrue(any(i.rule_id == 'scss:compile-error' for i in issues), issues)

    def test_url_shaped_import_is_left_as_literal_css_never_fetched(self):
        # A URL-shaped @import (scheme, or a bare .css suffix) is
        # standard CSS pass-through syntax that Dart Sass deliberately
        # never resolves itself (the browser would fetch it, not the
        # compiler) — confirms this well-known Sass behaviour doesn't
        # accidentally trigger a network attempt on the server.
        adapter = ScssSassAdapter('scss')
        issues = adapter.validate(
            '@import "https://fonts.example.com/style.css";\n.a { color: red; }\n', 'standard', partials={},
        )
        self.assertFalse(any(i.rule_id == 'scss:compile-error' for i in issues), issues)

    def test_absolute_path_import_rejected(self):
        adapter = ScssSassAdapter('scss')
        issues = adapter.validate('@use "/etc/passwd";\n.a { color: red; }\n', 'standard', partials={})
        self.assertTrue(any(i.rule_id == 'scss:compile-error' for i in issues), issues)

    def test_own_partial_resolves_and_compiles(self):
        adapter = ScssSassAdapter('scss')
        issues = adapter.validate(
            '@use "variables" as v;\n.a {\n  color: v.$brand;\n}\n', 'standard',
            partials={'variables': '$brand: #369;'},
        )
        # Compiles successfully — no compile-error issue.
        self.assertFalse(any(i.rule_id == 'scss:compile-error' for i in issues), issues)

    def test_finding_inside_imported_partial_is_reported_unmapped_not_as_main_document_line_one(self):
        adapter = ScssSassAdapter('scss')
        issues = adapter.validate(
            '@use "variables" as v;\n.a {\n  color: v.$brand;\n}\n', 'standard',
            partials={'variables': '$brand: #336699;'},  # triggers a stylelint hex-length notice inside the partial
        )
        hex_issues = [i for i in issues if i.rule_id == 'stylelint:color-hex-length']
        self.assertTrue(hex_issues, issues)
        for issue in hex_issues:
            self.assertEqual(issue.confidence, 'possible')
            self.assertIn('could not be mapped', issue.suggestion)
            # Must never be silently reported as line 1 of the MAIN
            # document (the finding is actually inside the partial).
            self.assertNotEqual((issue.start_line, issue.start_column), (1, 1))


class ScopeAndDispatchTests(TestCase):
    def test_html_scope_never_runs_scss_compiler(self):
        result = run(html='<p>hi</p>', css='$brand: #369; .a { color: $brand; }', css_source_type='scss', validation_scope='html')
        names = {s.engine_name for s in result.engine_status}
        self.assertNotIn('scss-compiler', names)

    def test_css_source_type_less_is_dispatched_to_the_less_compiler_not_plain_css(self):
        # Sprint CSS-D landed the real LESS engine — this asserts LESS
        # source is never silently validated as plain CSS (".mixin();"
        # is invalid CSS but valid LESS mixin-call syntax; a plain-CSS
        # misdispatch would report a syntax error here instead of
        # compiling cleanly). See test_less_compilation.py for the full
        # LESS engine test suite.
        result = run(
            html='', css='.mixin() {\n  color: red;\n}\n\n.a {\n  .mixin();\n}\n',
            css_source_type='less', validation_scope='css',
        )
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertIn('less-compiler', statuses)
        self.assertTrue(statuses['less-compiler'].success)
        errors = [i for i in _css_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [], result.issues)

    def test_plain_css_source_type_unaffected(self):
        result = run(html='', css='.a { color red; }', css_source_type='css', validation_scope='css')
        names = {s.engine_name for s in result.engine_status}
        self.assertIn('css-conformance', names)
        self.assertNotIn('scss-compiler', names)

    def test_run_result_reports_css_source_type(self):
        result = _scss(css='.a { color: #369; }')
        self.assertEqual(result.css_source_type, 'scss')


class ApiIntegrationTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.user = User.objects.create_user(username='alice', password='pw12345!', email='alice@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_validate_scss_persists_css_source_type_on_report(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': '', 'css': '.a { color: #369; }', 'validation_scope': 'css', 'css_source_type': 'scss'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['css_source_type'], 'scss')

    def test_validate_rejects_unknown_css_source_type(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': '', 'css': '.a { color: red; }', 'validation_scope': 'css', 'css_source_type': 'bogus'},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_validate_defaults_css_source_type_to_css(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': '', 'css': '.a { color: red; }', 'validation_scope': 'css'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['css_source_type'], 'css')


@override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
class NodeBridgeFailureTests(TestCase):
    """Validator Worker sprint — mocks a script path the persistent
    worker pool never re-checks per request; disabled class-wide."""

    def test_missing_script_raises_safe_error(self):
        with patch.object(node_bridge, '_SCSS_SCRIPT_PATH') as mock_path:
            mock_path.is_file.return_value = False
            with self.assertRaises(NodeBridgeError):
                node_bridge.run_scss_compilation('.a { color: red; }', 'scss', 'standard')

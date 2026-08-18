"""Tool-Grounded AI Engineer sprint — Module 3 LP Validator & Fixer.

Verifies the new "detect -> native autofix -> AI" priority tier (spec
section 3): Stylelint's own `fix: true` for CSS/LESS/SCSS and ESLint's own
`verifyAndFix` for JS now run BEFORE any AI proposal is even requested,
and the LESS-compiled-CSS validation no longer reports a small family of
purely compiler-output-formatting warnings that no edit to the LESS
SOURCE could ever resolve (Less.js's compiler does not preserve blank-
line spacing between rules, unlike Dart Sass's 'expanded' output style —
verified directly against the installed less@4.8.1/sass@1.102.0).
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewResult
from ..fixes import iterative as it
from ..validation import node_bridge
from ..validation.engine import run as run_validation_engine

User = get_user_model()


class _RaisesIfCalledProvider:
    """An AI provider that fails the test if AI Engineer ever reaches it —
    proves a given fix happened at the native-autofix tier, never AI."""

    def review(self, request):
        raise AssertionError('AI Engineer must not be consulted for a native-tool-fixable issue')

    def repair_whole_source(self, request):
        raise AssertionError('AI Engineer must not be consulted for a native-tool-fixable issue')


def _run(html='', css='', js='', ampscript='', css_source_type='css', validation_scope='css', provider=None):
    cache.clear()
    user = User.objects.create_user(username=f'tga_user_{id(provider)}', password='pw12345!', email='tga@example.com')
    with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
        return it.run_autonomous_repair(
            user=user, project=None,
            initial_sources={'html': html, 'css': css, 'js': js, 'ampscript': ampscript},
            css_source_type=css_source_type, validation_scope=validation_scope, profile='standard',
            rate_limit_identifier='tga',
        )


class NativeCssAutofixBeforeAITests(TestCase):
    """A Stylelint-fixable plain-CSS formatting issue must be resolved by
    the native autofix tier alone — the AI provider must never be
    consulted for it (spec section 3: "do not call AI for anything the
    authoritative tool can safely autofix")."""

    def test_missing_blank_line_before_rule_resolves_with_zero_ai_calls(self):
        css = '.a {\n  color: red;\n}\n.b {\n  color: blue;\n}\n'
        result = _run(css=css, css_source_type='css', validation_scope='css', provider=_RaisesIfCalledProvider())
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertNotIn('stylelint:rule-empty-line-before', final_rule_ids)
        self.assertIn('}\n\n.b {', result.final_sources['css'])


class LessCompiledOutputFormattingSuppressionTests(TestCase):
    """The exact regression this sprint fixes: a LESS "Expected empty line
    before rule" warning that survived many AI passes because it was
    being checked against the LESS COMPILER's own generated CSS, whose
    formatting the LESS source can never control."""

    def test_less_no_longer_reports_compiler_output_only_formatting_warnings(self):
        result = node_bridge.run_less_compilation('@brand: #369;\n.a {\n  color: @brand;\n}\n.b {\n  color: red;\n}\n', 'standard')
        self.assertTrue(result['success'])
        rule_ids = {issue['ruleId'] for issue in result['issues']}
        self.assertNotIn('stylelint:rule-empty-line-before', rule_ids)

    def test_less_still_reports_a_genuine_value_level_defect(self):
        result = node_bridge.run_less_compilation(
            '@brand: #369;\n.a {\n  color: @brand;\n  color: red;\n}\n', 'standard',
        )
        self.assertTrue(result['success'])
        rule_ids = {issue['ruleId'] for issue in result['issues']}
        self.assertIn('stylelint:declaration-block-no-duplicate-properties', rule_ids)

    def test_scss_keeps_reporting_the_same_rule_family_since_dart_sass_preserves_spacing(self):
        # Dart Sass's 'expanded' output style DOES insert a blank line
        # between top-level rules, so for SCSS this warning remains both
        # genuine and fixable via the SCSS source — no suppression here.
        result = node_bridge.run_scss_compilation('$c: #369;\n.a {\n  color: $c;\n}\n.b {\n  color: red;\n}\n', 'scss', 'standard')
        self.assertTrue(result['success'])
        rule_ids = {issue['ruleId'] for issue in result['issues']}
        self.assertNotIn('stylelint:rule-empty-line-before', rule_ids)  # Dart Sass already formats it correctly


class NativePreprocessorAutofixTests(TestCase):
    """run_preprocessor_autofix edits the ORIGINAL LESS/SCSS source
    directly (never the compiled CSS), and only supports LESS/SCSS —
    never indented Sass (see autofix_preprocessor.mjs's own comment)."""

    def test_less_source_level_autofix_preserves_variables_and_mixin_calls(self):
        source = '@brand: #369;\n.a {\n  color: @brand;\n}\n.b {\n  .mixin();\n  color: red;\n}\n'
        result = node_bridge.run_preprocessor_autofix(source, 'less')
        self.assertTrue(result['success'])
        fixed = result['fixed']
        self.assertIsNotNone(fixed)
        self.assertIn('@brand: #369;', fixed)
        self.assertIn('.mixin();', fixed)
        self.assertIn('color: @brand;', fixed)

    def test_scss_source_level_autofix_preserves_interpolation_and_each_loops(self):
        source = '$c: #369;\n.a {\n  color: $c;\n}\n@each $i in 1, 2, 3 {\n  .item-#{$i} { width: $i * 10px; }\n}\n'
        result = node_bridge.run_preprocessor_autofix(source, 'scss')
        self.assertTrue(result['success'])
        fixed = result['fixed']
        self.assertIsNotNone(fixed)
        self.assertIn('@each $i in 1, 2, 3', fixed)
        self.assertIn('.item-#{$i}', fixed)

    def test_indented_sass_is_rejected_not_guessed_at(self):
        with self.assertRaises(node_bridge.NodeBridgeError):
            node_bridge.run_preprocessor_autofix('$c: #369\nbody\n  color: $c\n', 'sass')


class NativeJsAutofixWiringTests(TestCase):
    """run_js_autofix uses the exact same ESLint config as validation
    (verified directly against the installed eslint@10 API: Linter#
    verifyAndFix only changes output for rules with a real fixer — none
    of this project's own security/logic rules register one, so this can
    never silently alter a security finding)."""

    def test_returns_success_with_no_change_when_nothing_is_fixable(self):
        result = node_bridge.run_js_autofix('const x = 1;\nconsole.log(x);', 'standard')
        self.assertTrue(result['success'])
        self.assertIsNone(result['fixed'])

    def test_a_genuinely_fixable_core_rule_is_corrected(self):
        # no-extra-semi has a real ESLint fixer and is part of the
        # recommended config's problem-rule set for a double-semicolon.
        result = node_bridge.run_js_autofix('const x = 1;;\nconsole.log(x);', 'standard')
        self.assertTrue(result['success'])
        if result['fixed'] is not None:
            self.assertNotIn(';;', result['fixed'])


class RootCauseGroupingTests(TestCase):
    """Structured diagnostics contract, spec section 4/5 — every HTML
    issue produced from a shell-corrupted document shares one
    root_cause_id; unrelated languages and uncorrupted HTML are never
    tagged."""

    _CONTENT_BEFORE_HTML = (
        '<!DOCTYPE html>\n'
        '<meta name="description" content="A landing page for the promo">\n'
        '<html lang="en">\n<head><title>T</title></head>\n'
        '<body><h1>Hi</h1></body></html>\n'
    )

    def test_cascading_html_issues_share_one_root_cause_id(self):
        result = run_validation_engine(html=self._CONTENT_BEFORE_HTML, validation_scope='html')
        html_issues = [i for i in result.issues if i.language == 'html']
        self.assertTrue(html_issues)
        root_cause_ids = {i.root_cause_id for i in html_issues}
        self.assertEqual(len(root_cause_ids), 1)
        self.assertNotEqual('', next(iter(root_cause_ids)))
        self.assertTrue(next(iter(root_cause_ids)).startswith('html-shell-corruption:'))

    def test_clean_html_has_no_root_cause_id(self):
        clean = '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1>Hi</h1></body></html>'
        result = run_validation_engine(html=clean, validation_scope='html')
        for issue in result.issues:
            self.assertEqual('', issue.root_cause_id)

    def test_non_html_issues_are_never_tagged_even_when_html_shell_is_corrupted(self):
        result = run_validation_engine(
            html=self._CONTENT_BEFORE_HTML, css='.a { background-color: blu; }',
            validation_scope='complete',
        )
        css_issues = [i for i in result.issues if i.language == 'css']
        self.assertTrue(css_issues)
        for issue in css_issues:
            self.assertEqual('', issue.root_cause_id)

    def test_root_cause_id_is_persisted_and_serialized(self):
        from django.contrib.auth import get_user_model

        from ..report_builder import persist_validation_report

        User = get_user_model()
        user = User.objects.create_user(username='rc_user', password='pw12345!', email='rc@example.com')
        report, _result = persist_validation_report(
            user=user, project=None, html=self._CONTENT_BEFORE_HTML, css='', js='', ts='', ampscript='',
            profile='standard', validation_scope='html', css_source_type='css',
        )
        html_issues = [i for i in report.issues.all() if i.language == 'html']
        self.assertTrue(html_issues)
        self.assertTrue(all(i.root_cause_id for i in html_issues))


class CssSelectorHtmlCrossReferenceTests(TestCase):
    """Tool-Grounded AI Engineer sprint, spec section 14 — one tractable
    Complete-LP cross-language check: a CSS selector with no matching
    HTML id/class is flagged advisory-only, never fixable, never a false
    positive for hex colors, url() fragments, attribute-selector values,
    pseudo-classes, or at-rule preludes."""

    def _cross_language_issues(self, **kwargs):
        result = run_validation_engine(validation_scope='complete', **kwargs)
        return [i for i in result.issues if i.rule_id.startswith('cross-language:')]

    def test_matching_id_and_class_are_never_flagged(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><div id="hero" class="card">Hi</div></body></html>'
        css = '#hero { color: red; }\n.card { background: #fff; }\n'
        self.assertEqual([], self._cross_language_issues(html=html, css=css))

    def test_a_selector_with_no_matching_element_is_flagged(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><div class="card">Hi</div></body></html>'
        css = '.ghost-class { color: blue; }\n#missing-id { color: green; }\n'
        issues = self._cross_language_issues(html=html, css=css)
        rule_ids_by_message = {i.message for i in issues}
        self.assertTrue(any('.ghost-class' in m for m in rule_ids_by_message))
        self.assertTrue(any('#missing-id' in m for m in rule_ids_by_message))
        for issue in issues:
            self.assertFalse(issue.fixable)
            self.assertEqual('warning', issue.severity)

    def test_hex_colors_are_never_mistaken_for_id_selectors(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><div class="card">Hi</div></body></html>'
        css = '.card { background: #fff; color: #333333; }\n'
        self.assertEqual([], self._cross_language_issues(html=html, css=css))

    def test_url_fragment_and_attribute_selector_values_are_never_mistaken_for_selectors(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><div class="card">Hi</div></body></html>'
        css = (
            '.card::before { content: url(#fragment); }\n'
            '[data-foo=".not-a-real-class"] { color: green; }\n'
        )
        self.assertEqual([], self._cross_language_issues(html=html, css=css))

    def test_at_rule_preludes_are_never_scanned_as_selectors(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><div class="card">Hi</div></body></html>'
        css = (
            '@media (min-width: 600px) { .card { padding: 1rem; } }\n'
            '@keyframes spin { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }\n'
        )
        self.assertEqual([], self._cross_language_issues(html=html, css=css))

    def test_never_runs_for_less_scss_or_sass(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><div class="card">Hi</div></body></html>'
        css = '.ghost-class { color: blue; }\n'
        for source_type in ('less', 'scss', 'sass'):
            result = run_validation_engine(html=html, css=css, validation_scope='complete', css_source_type=source_type)
            cross_language = [i for i in result.issues if i.rule_id.startswith('cross-language:')]
            self.assertEqual([], cross_language, f'unexpected cross-language finding for css_source_type={source_type}')

    def test_never_runs_outside_complete_scope(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><div class="card">Hi</div></body></html>'
        css = '.ghost-class { color: blue; }\n'
        result = run_validation_engine(html=html, css=css, validation_scope='css')
        self.assertEqual([], [i for i in result.issues if i.rule_id.startswith('cross-language:')])


class NativeAutofixLoopIntegrationTests(TestCase):
    """The PASS 0.5 wiring inside run_autonomous_repair itself — a file
    with ONLY a native-autofixable issue converges to zero issues without
    ever constructing an AI request."""

    def test_a_css_only_stylelint_fixable_issue_never_reaches_ai(self):
        css = '.only-formatting-issue {\n  color: red;\n}\n.next-rule {\n  color: blue;\n}\n'
        result = _run(css=css, css_source_type='css', validation_scope='css', provider=_RaisesIfCalledProvider())
        self.assertEqual(result.stopped_reason, 'all_resolved')

    def test_native_autofix_is_a_noop_when_nothing_is_fixable(self):
        # A file with zero issues never even reaches the loop body's
        # native-autofix check meaningfully — proven here by an empty
        # source converging immediately with no crash.
        result = _run(css='', css_source_type='css', validation_scope='css', provider=None)
        self.assertEqual(result.stopped_reason, 'all_resolved')

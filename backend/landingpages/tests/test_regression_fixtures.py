"""Permanent 'broken real-world LP' regression fixtures (AI Validate/Fix
functional-completion sprint, section 34). Each fixture under
tests/fixtures/regression/ is a realistic multi-defect source with known
EXPECTED ISSUE CLASSES (rule_id sets), not exact counts — deterministic
engines legitimately gain/lose findings as parser-recovery and cascade
behavior evolve after root-cause fixes land, so pinning exact counts here
would make this suite brittle for the wrong reasons. These tests run the
deterministic engine only (no AI Engineer, no network) so they stay fast
and hermetic enough for every CI run; the fixtures were also used, unchanged,
in this sprint's live Chrome acceptance pass for the HTML/Complete-LP scope.
"""

from pathlib import Path

from django.test import SimpleTestCase

from ..validation.engine import run as run_validation

_FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures' / 'regression'


def _load(name):
    return (_FIXTURES_DIR / name).read_text(encoding='utf-8')


class BrokenLpRegressionFixturesTests(SimpleTestCase):
    """Each test asserts the fixture's known defect classes are a SUBSET of
    what the current engine reports — new legitimate findings (e.g. an
    engine getting stricter) do not break the test; losing a known class
    would (that is the regression signal)."""

    def test_html_fixture_reports_expected_issue_classes(self):
        result = run_validation(
            html=_load('broken_lp.html'), css='', js='', ts='', ampscript='',
            profile='standard', validation_scope='html', project=None, css_source_type='css',
        )
        rule_ids = {issue.rule_id for issue in result.issues}
        expected = {
            'missing-charset', 'missing-lang', 'missing-meta-description', 'missing-viewport',
            'malformed-start-tag', 'duplicate-id', 'missing-form-label', 'missing-alt',
        }
        self.assertTrue(
            expected.issubset(rule_ids),
            f'Missing expected HTML issue classes: {expected - rule_ids}. Found: {sorted(rule_ids)}',
        )
        self.assertTrue(all(
            status.success for status in result.engine_status
            if status.engine_name != 'nu-html-checker'  # environment-dependent Java 11+ runtime, not a correctness signal
        ))

    def test_css_fixture_reports_expected_issue_classes(self):
        result = run_validation(
            html='', css=_load('broken_lp.css'), js='', ts='', ampscript='',
            profile='standard', validation_scope='css', project=None, css_source_type='css',
        )
        rule_ids = {issue.rule_id for issue in result.issues}
        expected = {'css-semantic:invalid-value', 'css-structure:parse-error', 'css-semantic:unknown-property'}
        self.assertTrue(
            expected.issubset(rule_ids),
            f'Missing expected CSS issue classes: {expected - rule_ids}. Found: {sorted(rule_ids)}',
        )

    def test_scss_fixture_reports_expected_issue_classes(self):
        result = run_validation(
            html='', css=_load('broken_lp.scss'), js='', ts='', ampscript='',
            profile='standard', validation_scope='css', project=None, css_source_type='scss',
        )
        rule_ids = {issue.rule_id for issue in result.issues}
        self.assertIn('scss:compile-error', rule_ids)
        self.assertTrue(any(status.engine_name == 'scss-compiler' for status in result.engine_status))

    def test_less_fixture_reports_expected_issue_classes(self):
        result = run_validation(
            html='', css=_load('broken_lp.less'), js='', ts='', ampscript='',
            profile='standard', validation_scope='css', project=None, css_source_type='less',
        )
        rule_ids = {issue.rule_id for issue in result.issues}
        expected = {'less:possibly-undefined-variable', 'less:missing-semicolon', 'less:compile-error'}
        self.assertTrue(
            expected.issubset(rule_ids),
            f'Missing expected LESS issue classes: {expected - rule_ids}. Found: {sorted(rule_ids)}',
        )
        self.assertTrue(any(status.engine_name == 'less-compiler' for status in result.engine_status))

    def test_javascript_fixture_reports_expected_issue_classes(self):
        result = run_validation(
            html='', css='', js=_load('broken_lp.js'), ts='', ampscript='',
            profile='standard', validation_scope='javascript', project=None, css_source_type='css',
        )
        rule_ids = {issue.rule_id for issue in result.issues}
        expected = {'no-eval', 'mdaiw-security/innerhtml-assignment', 'mdaiw-lp/unchecked-selector-access'}
        self.assertTrue(
            expected.issubset(rule_ids),
            f'Missing expected JavaScript issue classes: {expected - rule_ids}. Found: {sorted(rule_ids)}',
        )

    def test_ampscript_fixture_reports_expected_issue_classes(self):
        result = run_validation(
            html='', css='', js='', ts='', ampscript=_load('broken_lp.ampscript'),
            profile='standard', validation_scope='ampscript', project=None, css_source_type='css',
        )
        rule_ids = {issue.rule_id for issue in result.issues}
        expected = {'ampscript:if-without-endif', 'ampscript:variable-undeclared', 'ampscript:unknown-function'}
        self.assertTrue(
            expected.issubset(rule_ids),
            f'Missing expected AMPscript issue classes: {expected - rule_ids}. Found: {sorted(rule_ids)}',
        )

    def test_complete_lp_fixture_spans_all_four_languages(self):
        """Complete LP scope must run every applicable engine per populated
        language and must not let one language's failures erase another's
        findings (spec section: 'a failure in one engine must never erase
        another's findings')."""
        result = run_validation(
            html=_load('broken_lp.html'), css=_load('broken_lp.css'),
            js=_load('broken_lp.js'), ts='', ampscript=_load('broken_lp.ampscript'),
            profile='standard', validation_scope='complete', project=None, css_source_type='css',
        )
        languages = {issue.language for issue in result.issues}
        expected_languages = {'html', 'css', 'javascript', 'ampscript'}
        self.assertTrue(
            expected_languages.issubset(languages),
            f'Missing findings for languages: {expected_languages - languages}. Found: {sorted(languages)}',
        )
        self.assertTrue(all(
            status.success for status in result.engine_status
            if status.engine_name != 'nu-html-checker'  # environment-dependent Java 11+ runtime, not a correctness signal
        ))

"""Sprint CSS-A tests for inline `style="..."` attribute validation —
HtmlInlineStyleAdapter, HTML-position mapping, and its behaviour under
each validation scope."""

from django.test import TestCase

from ..validation.engine import run


def _inline_css_issues(result):
    return [
        issue for issue in result.issues
        if issue.language == 'css' and issue.source_context == 'html-inline-style'
    ]


class InlineStyleExtractionTests(TestCase):
    def test_valid_inline_style_produces_no_issues(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body>' \
               '<div style="color: red; margin: 0">hi</div></body></html>'
        result = run(html=html, validation_scope='html')
        self.assertEqual(_inline_css_issues(result), [])

    def test_invalid_property_name_reported(self):
        # "font- size" (a space inside the property name) is not merely a
        # lint warning — PostCSS cannot parse it as a declaration at all,
        # so it surfaces as a hard syntax error (same class of defect as
        # "color red" below, and the same behaviour the standalone CSS
        # engine already has for this input shape — see
        # test_css_validation.py's CASE_A_CSS).
        html = '<div style="font- size: 12px">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(any(issue.severity == 'error' for issue in issues), issues)

    def test_missing_colon_reported(self):
        html = '<div style="color red">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(any(issue.severity == 'error' for issue in issues), issues)

    def test_missing_value_reported(self):
        html = '<div style="color:">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(any(issue.severity in ('error', 'warning') for issue in issues), issues)

    def test_multiple_errors_in_one_style_attribute(self):
        # Every declaration here is independently syntactically valid (so
        # PostCSS parses the whole attribute), each flagged by a
        # different rule.
        html = '<div style="width: 1400px; margin: 0px">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertGreaterEqual(len(issues), 2, issues)

    def test_accurate_html_line_mapping(self):
        html = (
            '<html>\n'
            '<body>\n'
            '  <div style="color red">x</div>\n'
            '</body>\n'
            '</html>\n'
        )
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(issues)
        self.assertTrue(all(issue.line == 3 for issue in issues), issues)

    def test_accurate_html_column_mapping_for_single_line_value(self):
        html = '<div style="color red">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(issues)
        # column must land inside the style attribute value, not at column 1
        self.assertTrue(all(issue.column and issue.column > 12 for issue in issues), issues)

    def test_issue_editor_target_is_html(self):
        html = '<div style="color red">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(issues)
        self.assertTrue(all(issue.file == 'html' for issue in issues), issues)

    def test_inline_issue_does_not_appear_under_css_scope(self):
        result = run(html='<div style="color red">x</div>', css='.a { color: blue; }', validation_scope='css')
        self.assertEqual(_inline_css_issues(result), [])

    def test_unsafe_javascript_url_flagged(self):
        html = "<div style='background-image: url(\"javascript:alert(1)\")'>x</div>"
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(any('javascript:' in issue.message.lower() for issue in issues), issues)

    def test_large_fixed_width_flagged(self):
        html = '<div style="width: 1400px">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(any(issue.rule_id == 'css-custom:responsive-fixed-width-risk' for issue in issues), issues)

    def test_unnecessary_zero_unit_flagged(self):
        html = '<div style="margin: 0px">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(any('unit' in issue.message.lower() for issue in issues), issues)

    def test_duplicate_declarations_flagged(self):
        html = '<div style="color: red; color: blue">x</div>'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        self.assertTrue(any('duplicate' in issue.message.lower() for issue in issues), issues)

    def test_multiple_inline_styles_in_one_document_each_reported(self):
        html = (
            '<div style="color red">a</div>'
            '<span style="width: 1400px">b</span>'
        )
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)
        block_indices = {issue.source_block_index for issue in issues}
        self.assertEqual(block_indices, {0, 1}, issues)

    def test_empty_style_attribute_produces_no_issue(self):
        result = run(html='<div style="">x</div>', validation_scope='html')
        self.assertEqual(_inline_css_issues(result), [])


class InlineStyleAcceptanceCaseTests(TestCase):
    """Section 22's exact acceptance input.

    Note: "font- size" is itself unparseable (not merely invalid), so
    PostCSS reports it as a single hard syntax error and never reaches
    "color red" or "width: 1400px" in the same declaration list — the
    same one-error-per-unparseable-unit behaviour the standalone CSS
    engine already has (see test_css_validation.py's CASE_A_CSS). The
    fixed-width and missing-colon findings are verified independently
    above with syntactically-parseable input."""

    def test_acceptance_case(self):
        html = '<div class="container" style="font- size: 12px; color red; width: 1400px">'
        result = run(html=html, validation_scope='html')
        issues = _inline_css_issues(result)

        self.assertTrue(all(issue.severity in ('error', 'warning') for issue in issues), issues)
        self.assertTrue(any(issue.severity == 'error' for issue in issues), issues)
        self.assertTrue(all(issue.related_attribute == 'style' for issue in issues), issues)
        self.assertTrue(all(issue.related_element == 'div' for issue in issues), issues)


class InlineStyleScopeIntegrationTests(TestCase):
    def test_html_scope_runs_inline_style_validation(self):
        result = run(html='<div style="color red">x</div>', validation_scope='html')
        self.assertTrue(_inline_css_issues(result))

    def test_complete_scope_runs_inline_style_validation(self):
        result = run(html='<div style="color red">x</div>', validation_scope='complete')
        self.assertTrue(_inline_css_issues(result))

    def test_engine_status_reports_inline_style_engine(self):
        result = run(html='<div style="color red">x</div>', validation_scope='html')
        names = {status.engine_name for status in result.engine_status}
        self.assertIn('html-inline-style', names)

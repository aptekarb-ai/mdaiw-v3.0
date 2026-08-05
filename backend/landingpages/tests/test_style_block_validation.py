"""Sprint CSS-A tests for internal `<style>` block validation —
HtmlStyleBlockAdapter, HTML-position mapping, multi-block merging, and its
behaviour under each validation scope."""

from django.test import TestCase

from ..validation.engine import run


def _style_block_issues(result):
    return [
        issue for issue in result.issues
        if issue.language == 'css' and issue.source_context == 'html-style-block'
    ]


class StyleBlockExtractionTests(TestCase):
    def test_one_valid_style_block_produces_no_issues(self):
        html = '<html><head><style>.hero { color: red; }</style></head><body></body></html>'
        result = run(html=html, validation_scope='html')
        self.assertEqual(_style_block_issues(result), [])

    def test_one_invalid_style_block_reports_error(self):
        html = '<html><head><style>.hero { color red; }</style></head><body></body></html>'
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        self.assertTrue(any(issue.severity == 'error' for issue in issues), issues)

    def test_multiple_style_blocks_are_all_validated(self):
        html = (
            '<html><head>'
            '<style>.a { color red; }</style>'
            '<style>.b { width: 1400px; }</style>'
            '</head><body></body></html>'
        )
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        block_indices = {issue.source_block_index for issue in issues}
        self.assertEqual(block_indices, {0, 1}, issues)

    def test_multiple_findings_in_one_block_all_reported(self):
        # Every declaration here is independently syntactically valid, so
        # PostCSS parses the whole block; each is flagged by a different
        # rule. ("color red" alone would hard-fail the whole block's
        # parse — see the acceptance-case docstring below.)
        html = '<style>.hero { width: 1400px; margin: 0px; }</style>'
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        self.assertGreaterEqual(len(issues), 2, issues)

    def test_accurate_html_offset_mapping(self):
        html = (
            '<html>\n'
            '<head>\n'
            '<style>\n'
            '.hero {\n'
            '  color red;\n'
            '}\n'
            '</style>\n'
            '</head>\n'
            '</html>\n'
        )
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        self.assertTrue(issues)
        self.assertTrue(any(issue.line == 5 for issue in issues), issues)

    def test_css_block_findings_coexist_with_html_findings(self):
        html = (
            '<html><head><style>.hero { color red; }</style></head>'
            '<body><div><h1>Unclosed</div></body></html>'
        )
        result = run(html=html, validation_scope='html')
        css_issues = _style_block_issues(result)
        html_issues = [issue for issue in result.issues if issue.language == 'html']
        self.assertTrue(css_issues)
        self.assertTrue(html_issues)

    def test_empty_style_block_produces_no_issue(self):
        html = '<html><head><style></style></head><body></body></html>'
        result = run(html=html, validation_scope='html')
        self.assertEqual(_style_block_issues(result), [])

    def test_media_attribute_does_not_break_extraction(self):
        html = '<style media="print">.hero { color red; }</style>'
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        self.assertTrue(any(issue.severity == 'error' for issue in issues), issues)

    def test_unsafe_url_flagged_inside_style_block(self):
        html = '<style>.hero { background-image: url("javascript:alert(1)"); }</style>'
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        self.assertTrue(any('javascript:' in issue.message.lower() for issue in issues), issues)

    def test_valid_modern_css_in_style_block_produces_no_issues(self):
        html = (
            '<style>\n'
            ':root { --space: clamp(1rem, 2vw, 2rem); }\n'
            '.card { padding-inline: var(--space); }\n'
            '</style>\n'
        )
        result = run(html=html, validation_scope='html')
        self.assertEqual(_style_block_issues(result), [])

    def test_no_issue_loss_across_many_blocks(self):
        blocks = ''.join(f'<style>.b{i} {{ color red; }}</style>' for i in range(5))
        result = run(html=f'<html><head>{blocks}</head></html>', validation_scope='html')
        issues = _style_block_issues(result)
        block_indices = {issue.source_block_index for issue in issues}
        self.assertEqual(block_indices, set(range(5)), issues)

    def test_preprocessor_type_reported_as_notice_not_css_errors(self):
        html = '<style type="text/scss">$brand: red; .a { color: $brand invalid syntax }</style>'
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        self.assertTrue(any(issue.rule_id.endswith('preprocessor-not-compiled-in-browser') for issue in issues))
        self.assertFalse(any(issue.rule_id.startswith('stylelint:') for issue in issues), issues)
        self.assertFalse(any(issue.rule_id.startswith('postcss:') for issue in issues), issues)

    def test_issue_editor_target_is_html(self):
        html = '<style>.hero { color red; }</style>'
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)
        self.assertTrue(issues)
        self.assertTrue(all(issue.file == 'html' for issue in issues), issues)

    def test_style_block_issue_does_not_appear_under_css_scope(self):
        result = run(html='<style>.a { color red; }</style>', css='.b { color: blue; }', validation_scope='css')
        self.assertEqual(_style_block_issues(result), [])


class StyleBlockAcceptanceCaseTests(TestCase):
    """Section 23's exact acceptance input.

    Note: "color red" is itself unparseable (not merely invalid), so
    PostCSS reports it as a single hard syntax error and never reaches
    "margin: 0px" in the same block — the same one-error-per-unparseable-
    block behaviour the standalone CSS engine already has (see
    test_css_validation.py's CASE_A_CSS). The zero-unit warning is
    verified independently above (test_multiple_findings_in_one_block_
    all_reported) with syntactically-parseable input."""

    def test_acceptance_case(self):
        html = (
            '<style>\n'
            '.hero {\n'
            '  color red;\n'
            '  margin: 0px;\n'
            '}\n'
            '</style>\n'
        )
        result = run(html=html, validation_scope='html')
        issues = _style_block_issues(result)

        self.assertTrue(any(issue.severity == 'error' for issue in issues), issues)
        self.assertTrue(all(issue.file == 'html' for issue in issues), issues)
        self.assertTrue(all(3 <= issue.line <= 5 for issue in issues), issues)


class StyleBlockScopeIntegrationTests(TestCase):
    def test_html_scope_runs_style_block_validation(self):
        result = run(html='<style>.a { color red; }</style>', validation_scope='html')
        self.assertTrue(_style_block_issues(result))

    def test_complete_scope_runs_style_block_validation(self):
        result = run(html='<style>.a { color red; }</style>', validation_scope='complete')
        self.assertTrue(_style_block_issues(result))

    def test_engine_status_reports_style_block_engine(self):
        result = run(html='<style>.a { color red; }</style>', validation_scope='html')
        names = {status.engine_name for status in result.engine_status}
        self.assertIn('html-style-block', names)


class DedupIsolationTests(TestCase):
    """A coincidental line/column match between an embedded-CSS finding and
    an unrelated standalone-CSS-tab finding must never merge into one
    issue (see engine.py::_dedupe's `issue.file`-inclusive key)."""

    def test_style_block_and_standalone_css_findings_both_survive(self):
        html = '<html><head><style>.a { color red; }</style></head></html>'
        css = '.b { color red; }'  # same shape of defect, so both land at their own document's line 1
        result = run(html=html, css=css, validation_scope='complete')
        standalone = [i for i in result.issues if i.language == 'css' and i.source_context == '']
        embedded = _style_block_issues(result)
        self.assertTrue(standalone, result.issues)
        self.assertTrue(embedded, result.issues)
        self.assertNotEqual(
            {i.fingerprint for i in standalone}, {i.fingerprint for i in embedded}, 'must not collapse into one issue',
        )

"""Sprint CSS-A-2 tests — dedicated CSS structural-validation phase
(brace/string/comment balance) and semantic phase (css-tree's recovering
parser + standards-derived property/value lexer), replacing the old
"one generic postcss:css-syntax-error, everything else discarded"
behaviour. See validators_node/validate_css.mjs."""

from django.test import TestCase

from ..validation.engine import run


def _css_issues(result):
    return [issue for issue in result.issues if issue.language == 'css']


def _rule_ids(issues):
    return {issue.rule_id for issue in issues}


SAMPLE_CSS = (
    'body {\n'
    '  background-color: bright-blue;\n'
    '  color: #12345;\n'
    '  font-size: 50x;\n'
    '  margin 0px;\n'
    '  unreal-property: yes\n'
    '}\n'
    '\n'
    '.container {\n'
    '  width: 100percent;\n'
    '  padding: 20px\n'
    '  display: flexbox-invalid;\n'
    '}\n'
)

# The same sample with the body block's closing brace removed.
SAMPLE_CSS_UNCLOSED = (
    'body {\n'
    '  background-color: bright-blue;\n'
    '  color: #12345;\n'
    '  font-size: 50x;\n'
    '  margin 0px;\n'
    '  unreal-property: yes\n'
    '\n'
    '.container {\n'
    '  width: 100percent;\n'
    '  padding: 20px\n'
    '  display: flexbox-invalid;\n'
    '}\n'
)


class StructuralPhaseTests(TestCase):
    def test_missing_closing_brace(self):
        result = run(html='', css='.hero {\n  color: red;\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-structure:unclosed-block' for i in issues), issues)

    def test_extra_closing_brace(self):
        result = run(html='', css='.hero {\n  color: red;\n}}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-structure:unmatched-closing-brace' for i in issues), issues)

    def test_missing_colon(self):
        result = run(html='', css='.hero {\n  color red;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(
            any(i.rule_id == 'css-structure:parse-error' and i.start_line == 2 for i in issues), issues,
        )

    def test_missing_semicolon(self):
        result = run(html='', css='.hero {\n  color: red\n  margin: 0;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.category == 'structure' for i in issues), issues)

    def test_unclosed_comment(self):
        result = run(html='', css='.hero {\n  color: red;\n  /* never closed\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-structure:unclosed-comment' for i in issues), issues)

    def test_unclosed_string(self):
        result = run(html='', css='.hero {\n  content: "never closed;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-structure:unclosed-string' for i in issues), issues)

    def test_malformed_selector(self):
        result = run(html='', css='.hero[data-state {\n  color: red;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-structure:parse-error' for i in issues), issues)

    def test_malformed_at_rule(self):
        result = run(html='', css='@mediaaa (min-width: 40rem) {\n  .a { color: red; }\n}\n')
        issues = _css_issues(result)
        self.assertTrue(issues)

    def test_does_not_stop_after_first_error(self):
        # Two independent, unrelated structural defects — both must be
        # reported, not just the first one encountered.
        result = run(html='', css='.a {\n  color red;\n}\n.b {\n  margin 0;\n}\n')
        issues = [i for i in _css_issues(result) if i.rule_id == 'css-structure:parse-error']
        lines = {i.start_line for i in issues}
        self.assertIn(2, lines, issues)
        self.assertIn(5, lines, issues)


class SemanticPhaseTests(TestCase):
    def test_unknown_property(self):
        result = run(html='', css='.hero {\n  unreal-property: yes;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-semantic:unknown-property' for i in issues), issues)

    def test_invalid_property_value(self):
        result = run(html='', css='.hero {\n  width: 100percent;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-semantic:invalid-value' for i in issues), issues)

    def test_invalid_unit(self):
        result = run(html='', css='.hero {\n  font-size: 50x;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-semantic:invalid-value' for i in issues), issues)

    def test_invalid_color(self):
        result = run(html='', css='.hero {\n  color: #12345;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-semantic:invalid-value' for i in issues), issues)

    def test_invalid_color_keyword(self):
        result = run(html='', css='.hero {\n  background-color: bright-blue;\n}\n')
        issues = _css_issues(result)
        self.assertTrue(any(i.rule_id == 'css-semantic:invalid-value' for i in issues), issues)

    def test_valid_custom_property_definition_and_usage(self):
        css = ':root {\n  --brand: #369;\n}\n\n.hero {\n  color: var(--brand);\n}\n'
        result = run(html='', css=css)
        self.assertEqual(_css_issues(result), [])

    def test_valid_vendor_prefixed_property(self):
        css = '.hero {\n  -webkit-transform: rotate(5deg);\n  transform: rotate(5deg);\n}\n'
        result = run(html='', css=css)
        issues = _css_issues(result)
        self.assertFalse(any(i.rule_id == 'css-semantic:unknown-property' for i in issues), issues)

    def test_unrecognized_vendor_prefixed_property_is_compatibility_notice_not_error(self):
        css = '.hero {\n  -moz-totally-made-up-property: 1;\n}\n'
        result = run(html='', css=css)
        issues = _css_issues(result)
        self.assertTrue(any(i.category == 'compatibility' for i in issues), issues)
        self.assertFalse(any(i.rule_id == 'css-semantic:unknown-property' for i in issues), issues)

    def test_var_reference_is_not_flagged_as_invalid_value(self):
        # var()'s substituted value is not statically known — must never
        # be treated as a value-grammar mismatch.
        css = ':root {\n  --space: 1rem;\n}\n\n.hero {\n  padding-inline: var(--space);\n}\n'
        result = run(html='', css=css)
        self.assertEqual(_css_issues(result), [])


class MultipleErrorsAcceptanceTests(TestCase):
    """Section 9's exact required sample, and the same sample with the
    body block's closing brace removed."""

    def test_multiple_errors_across_multiple_blocks_all_reported(self):
        result = run(html='', css=SAMPLE_CSS, validation_scope='css')
        issues = _css_issues(result)
        rule_ids = _rule_ids(issues)

        self.assertIn('css-structure:parse-error', rule_ids)  # margin 0px (missing colon)
        self.assertIn('css-semantic:unknown-property', rule_ids)  # unreal-property
        self.assertIn('css-semantic:invalid-value', rule_ids)  # bright-blue / #12345 / 50x / 100percent
        self.assertGreaterEqual(len(issues), 5, issues)

        # Every reported line is within the actual 13-line source — the
        # exact "Line 53 on a 13-line document" defect this sprint fixes.
        max_line = len(SAMPLE_CSS.split('\n'))
        self.assertTrue(all(1 <= i.start_line <= max_line for i in issues), issues)

    def test_unclosed_block_variant_reports_unclosed_block_and_other_errors(self):
        result = run(html='', css=SAMPLE_CSS_UNCLOSED, validation_scope='css')
        issues = _css_issues(result)
        rule_ids = _rule_ids(issues)

        self.assertIn('css-structure:unclosed-block', rule_ids)
        unclosed = [i for i in issues if i.rule_id == 'css-structure:unclosed-block']
        self.assertTrue(any(i.start_line == 1 for i in unclosed), unclosed)

        # Still recovers enough to report at least one other, independent
        # defect — not just the unclosed block alone.
        self.assertGreaterEqual(len(issues), 2, issues)

        max_line = len(SAMPLE_CSS_UNCLOSED.split('\n'))
        self.assertTrue(all(1 <= i.start_line <= max_line for i in issues), issues)


class LinePositionMappingTests(TestCase):
    def test_correct_original_line_and_column_for_css_only_scope(self):
        css = (
            '.a { color: red; }\n'
            '.b {\n'
            '  color red;\n'
            '}\n'
        )
        result = run(html='', css=css, validation_scope='css')
        issues = [i for i in _css_issues(result) if i.rule_id == 'css-structure:parse-error']
        self.assertTrue(issues)
        self.assertTrue(all(i.start_line == 3 for i in issues), issues)
        max_line = len(css.split('\n'))
        self.assertTrue(all(i.start_line <= max_line for i in _css_issues(result)))

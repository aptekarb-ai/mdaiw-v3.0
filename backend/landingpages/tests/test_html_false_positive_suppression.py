"""engine.py::_suppress_false_missing_element_claims — Hybrid Validator +
AI Engineer architecture sprint, spec section 4. `html.parser`'s recovery
from a malformed start tag can make a structurally-present element vanish
from `HtmlStructureAdapter`'s `_seen_elements` set, producing a real,
misleading "Document is missing a required <head> element." finding on
source where <head> is visibly present. This asserts the fix: a
malformed-start-tag finding (independently detected by the raw-text
lexical scanner, never subject to parser recovery) takes priority — the
downstream "missing" claim is suppressed in favor of the honest root
cause, and ONLY when a malformed tag is genuinely present."""

from django.test import SimpleTestCase

from ..validation.engine import run as run_validation


def _validate_html(html):
    return run_validation(
        html=html, css='', js='', ts='', ampscript='', profile='standard',
        validation_scope='html', project=None, css_source_type='css',
    )


class MissingElementFalsePositiveTests(SimpleTestCase):
    def test_malformed_html_start_tag_suppresses_missing_head_claim(self):
        # The exact reported case: <head> is visibly present, but <html>
        # has no closing ">" — html.parser's recovery swallows <head> from
        # its own element-tracking, which used to surface a false
        # "Document is missing a required <head> element."
        html = '<!DOCTYPE html>\n<html\n<head>\n<title>T</title>\n</head>\n<body><p>hi</p></body>\n</html>\n'
        result = _validate_html(html)
        rule_ids = {issue.rule_id for issue in result.issues}
        self.assertNotIn('missing-head', rule_ids)
        self.assertNotIn('missing-html', rule_ids)
        # The real root cause must still be reported.
        self.assertIn('malformed-start-tag', rule_ids)

    def test_genuinely_missing_head_is_still_reported_when_no_tag_is_malformed(self):
        html = '<!DOCTYPE html><html><body><p>hi</p></body></html>'
        result = _validate_html(html)
        rule_ids = {issue.rule_id for issue in result.issues}
        self.assertIn('missing-head', rule_ids)
        self.assertIn('missing-title', rule_ids)
        self.assertNotIn('malformed-start-tag', rule_ids)

    def test_valid_html_reports_neither_missing_nor_malformed(self):
        html = (
            '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
            '<title>T</title></head><body><h1>Welcome</h1></body></html>'
        )
        result = _validate_html(html)
        rule_ids = {issue.rule_id for issue in result.issues}
        self.assertFalse({'missing-head', 'missing-html', 'missing-body', 'missing-title', 'malformed-start-tag'} & rule_ids)

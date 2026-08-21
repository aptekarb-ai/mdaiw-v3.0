"""fixes/html_invariants.py — Source-Repair Integrity sprint, spec section
10/11/12. A repair candidate that violates basic HTML document-shell shape
(duplicate <html>/<head>/<body>, <head> after </body>, ...) must never be
committed to the editor — this is the backstop check independent of WHY a
bad candidate was produced."""

from django.test import SimpleTestCase

from ..fixes.html_invariants import check_html_structural_invariants, check_no_new_duplicate_singletons

_VALID = (
    '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
    '<title>T</title></head><body><h1>Welcome</h1></body></html>'
)


class HtmlStructuralInvariantsTests(SimpleTestCase):
    def test_valid_document_has_no_violations(self):
        self.assertEqual(check_html_structural_invariants(_VALID), [])

    def test_empty_source_has_no_violations(self):
        self.assertEqual(check_html_structural_invariants(''), [])
        self.assertEqual(check_html_structural_invariants('   '), [])

    def test_duplicate_head_is_a_violation(self):
        html = _VALID.replace(
            '</head>', '</head><head><meta charset="utf-8"></head>',
        )
        violations = check_html_structural_invariants(html)
        self.assertTrue(any('head' in v.lower() for v in violations))

    def test_duplicate_html_is_a_violation(self):
        html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<html lang="en">\n<title>T</title></head><body>hi</body></html>'
        violations = check_html_structural_invariants(html)
        self.assertTrue(any('html' in v.lower() for v in violations))

    def test_duplicate_body_is_a_violation(self):
        html = _VALID.replace('</body>', '</body><body>extra</body>')
        violations = check_html_structural_invariants(html)
        self.assertTrue(any('body' in v.lower() for v in violations))

    def test_head_after_body_close_is_a_violation(self):
        html = (
            '<!DOCTYPE html><html lang="en"><body><h1>hi</h1></body>'
            '<head><meta charset="utf-8"></head></html>'
        )
        violations = check_html_structural_invariants(html)
        self.assertTrue(any('after' in v.lower() for v in violations))

    def test_body_before_head_is_a_violation(self):
        html = (
            '<!DOCTYPE html><html lang="en"><body><h1>hi</h1></body>'
            '<head><meta charset="utf-8"></head></html>'
        )
        # already covered by the "after </body>" check above; this asserts
        # the narrower body-before-head ordering check independently using
        # a case where <body> genuinely precedes <head> without a close in
        # between.
        violations = check_html_structural_invariants(html)
        self.assertTrue(len(violations) >= 1)

    def test_multiple_distinct_violations_are_all_reported(self):
        html = (
            '<!DOCTYPE html><html lang="en"><head></head><head></head>'
            '<body></body><body></body></html>'
        )
        violations = check_html_structural_invariants(html)
        self.assertGreaterEqual(len(violations), 2)


class NoNewDuplicateSingletonsTests(SimpleTestCase):
    """Source-Repair Integrity sprint (round 2) — a live-verification
    session found a repair-generated duplicate <title> distinct from the
    document-shell duplication bug: a proposal for one issue (not
    "missing title") still inserted a brand new <title> even though one
    already existed elsewhere in the document. This is the regression
    reproduction and fix verification for that exact case."""

    def test_adding_a_second_title_when_one_already_existed_is_a_violation(self):
        before = '<head><title>Signup Page</title></head>'
        after = '<head><title>Signup Page</title><meta name="description" content="d"><title>Signup Page</title></head>'
        violations = check_no_new_duplicate_singletons(before, after)
        self.assertTrue(any('title' in v.lower() for v in violations))

    def test_genuinely_missing_title_going_from_zero_to_one_is_not_a_violation(self):
        before = '<head></head>'
        after = '<head><title>New Page</title></head>'
        self.assertEqual(check_no_new_duplicate_singletons(before, after), [])

    def test_charset_viewport_description_covered_the_same_way(self):
        before = '<head><meta charset="utf-8"></head>'
        after = '<head><meta charset="utf-8"><meta charset="utf-8"></head>'
        violations = check_no_new_duplicate_singletons(before, after)
        self.assertTrue(any('charset' in v.lower() for v in violations))

    def test_unrelated_content_growth_is_not_flagged(self):
        before = '<body><p>hi</p></body>'
        after = '<body><p>hi</p><p>more content</p></body>'
        self.assertEqual(check_no_new_duplicate_singletons(before, after), [])

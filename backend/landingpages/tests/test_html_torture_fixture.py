"""AI Engineer Deep Validation + Autonomous Repair — Checkpoint 1 (HTML).

Proves the existing candidate-first, iterative, prevalidated repair
architecture actually converges a deliberately malformed HTML fixture
toward Validation Issues (0) — not by hiding/suppressing findings, but by
genuinely resolving them and revalidating with the real engines every
round (spec: AI Engineer Deep Validation + Autonomous Repair, sections
17/22/31). No real network call is made — `CompetentReviewProvider` below
stands in for a real AI provider, scripted to propose the SAME repair a
competent model grounded in this project's Rule Knowledge Registry
(validation/rules/html.py) would propose for each issue it is asked
about. This is an honest, smaller-scale (8 distinct rule instances, not
the full 30+) proof-of-concept for this checkpoint; scaling the fixture
up is tracked as future work, not claimed here.

One issue (empty-meta-description) is deliberately non-inferable business
content — the fixture proves it correctly lands in "requires input"
rather than being silently dropped or fabricated (section 1/17.B).
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from unittest.mock import patch

from ..ai_review.provider import AIReviewResult, ProposalDraft
from ..fixes import iterative as it

User = get_user_model()

# Eight distinct, real rule instances near the top, middle, and end of the
# document — deliberately malformed HTML, not a synthetic/trivial fixture.
TORTURE_HTML = (
    '<html>\n'
    '<head>\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<title>Signup</title>\n'
    '<title>Signup (duplicate)</title>\n'
    '<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width">\n'
    '<meta name="description" content="">\n'
    '</head>\n'
    '<body>\n'
    '<h1>Welcome</h1>\n'
    '<img src="hero.jpg">\n'
    '<div>\n'
    '<p>Unclosed section</p>\n'
    '</body>\n'
    '</html>\n'
)


class CompetentReviewProvider:
    """Returns one correct, targeted proposal per AI-eligible issue it is
    asked about — the deterministic catalogue already covers
    missing-doctype and unclosed-tag (see fixes/catalogue.py), so this
    only needs to cover the rules that require AI assistance: missing-lang,
    charset-declared-late, duplicate-title, multiple-viewport, missing-alt.
    empty-meta-description is answered with requires_configuration=True —
    a competent model correctly declines to fabricate business copy.

    charset-declared-late and duplicate-title share one physical region
    (the reordered head block also contains the duplicate <title>), so —
    per the "one logical region gets one coherent repair" principle — they
    are answered with ONE combined proposal rather than two proposals that
    would otherwise overlap the same source range and get mutually
    rejected as conflicting."""

    def __init__(self):
        self.seen_rule_ids = []

    def review(self, request):
        by_rule = {}
        for issue in request.issues:
            self.seen_rule_ids.append(issue.rule_id)
            by_rule.setdefault(issue.rule_id, issue)

        proposals = []
        if 'missing-lang' in by_rule:
            issue = by_rule['missing-lang']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='html', source_context='',
                explanation='Add lang to the existing <html> start tag.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='<html>', replacement_text='<html lang="en">',
                requires_configuration=False, assumptions=[],
            ))

        if 'charset-declared-late' in by_rule:
            charset_issue = by_rule['charset-declared-late']
            issue_ids = [charset_issue.issue_id]
            if 'duplicate-title' in by_rule:
                issue_ids.append(by_rule['duplicate-title'].issue_id)
            proposals.append(ProposalDraft(
                issue_ids=issue_ids, language='html', source_context='',
                explanation='Move the existing charset declaration to be first in <head>; drop the duplicate <title>.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text=(
                    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
                    '<title>Signup</title>\n<title>Signup (duplicate)</title>\n<meta charset="UTF-8">'
                ),
                replacement_text=(
                    '<meta charset="UTF-8">\n'
                    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Signup</title>'
                ),
                requires_configuration=False, assumptions=[],
            ))
        elif 'duplicate-title' in by_rule:
            issue = by_rule['duplicate-title']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='html', source_context='',
                explanation='Remove the duplicate <title>.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='<title>Signup (duplicate)</title>\n',
                replacement_text='', requires_configuration=False, assumptions=[],
            ))

        if 'multiple-viewport' in by_rule:
            issue = by_rule['multiple-viewport']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='html', source_context='',
                explanation='Remove the duplicate viewport meta tag.', risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text='<meta name="viewport" content="width=device-width">\n',
                replacement_text='', requires_configuration=False, assumptions=[],
            ))

        if 'missing-alt' in by_rule:
            issue = by_rule['missing-alt']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='html', source_context='',
                explanation='Infer alt text from the filename.', risk='low', confidence='possible',
                start_offset=0, end_offset=0, expected_text='<img src="hero.jpg">',
                replacement_text='<img src="hero.jpg" alt="Hero image">',
                requires_configuration=False, assumptions=['Alt text inferred from filename; review wording.'],
            ))

        if 'empty-meta-description' in by_rule:
            issue = by_rule['empty-meta-description']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='html', source_context='',
                explanation='A real description requires page-specific business copy that cannot be inferred.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text='<meta name="description" content="">',
                replacement_text='<meta name="description" content="">',
                requires_configuration=True,
                assumptions=['Description text requires business/marketing input.'],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class HtmlTortureFixtureTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='torture_user', password='pw12345!', email='t@example.com')

    def test_ai_fix_issues_converges_the_torture_fixture(self):
        provider = CompetentReviewProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': TORTURE_HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='torture',
            )

        final_rule_ids = sorted(issue.rule_id for issue in result.report.issues.all())

        # The one deliberately non-inferable finding is the ONLY thing
        # allowed to remain, and it must be correctly bucketed as
        # "requires input" — never silently dropped, never fabricated.
        self.assertEqual(final_rule_ids, ['empty-meta-description'])
        self.assertEqual(result.issues_requires_input_total, 1)
        self.assertIn(result.stopped_reason, ('no_actionable', 'max_iterations', 'no_progress'))

        # Every genuinely auto-repairable issue from the original fixture
        # is gone — proven by REAL revalidation, not by suppressing them.
        # issues_new_total is NOT asserted zero here: fingerprints are
        # line/column-based (schema.py::compute_fingerprint), so an early
        # structural insertion (e.g. adding the missing doctype) shifts
        # every later line by one, which legitimately changes the
        # fingerprint of every issue still below it between rounds even
        # though nothing new was actually introduced — final_rule_ids
        # above is the honest, position-independent check that nothing
        # unexpected survived.
        self.assertGreaterEqual(result.issues_resolved_total, 7)
        self.assertEqual(sum(1 for i in result.report.issues.all() if i.severity == 'error'), 0)

        final_html = result.final_sources['html']
        self.assertIn('<!DOCTYPE html>', final_html)
        self.assertIn('<html lang="en">', final_html)
        self.assertEqual(final_html.count('<title'), 1)
        self.assertEqual(final_html.count('name="viewport"'), 1)
        self.assertIn('alt="Hero image"', final_html)
        self.assertIn('</div>', final_html)
        # charset really did move to be first in <head>, not duplicated.
        self.assertEqual(final_html.count('charset='), 1)
        head_start = final_html.index('<head>')
        self.assertLess(final_html.index('charset='), final_html.index('<title', head_start))

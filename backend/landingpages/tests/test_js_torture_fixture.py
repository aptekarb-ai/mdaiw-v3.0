"""AI Engineer Deep Validation + Autonomous Repair — Checkpoint 3 (JavaScript).

Mirrors test_html_torture_fixture.py / test_css_torture_fixture.py's
proof for JavaScript: a deliberately malformed script, repaired by the
existing candidate-first, iterative, prevalidated architecture, converging
to Validation Issues (0) except one deliberately non-inferable finding.
No real network call is made, and the submitted JavaScript is never
executed — CompetentReviewProvider stands in for a real AI provider.

A fatal parse error at the top of the file hides every other ESLint
finding until it's fixed and the source is revalidated (spec section 7 —
"one parser error must not permanently hide the rest of the file"), so
this fixture also requires two real repair passes, same as the CSS one.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from unittest.mock import patch

from ..ai_review.provider import AIReviewResult, ProposalDraft
from ..fixes import iterative as it

User = get_user_model()

# Five distinct, real findings. javascript:parse-error hides the rest
# until fixed (see module docstring).
TORTURE_JS = (
    'function trackClick(\n'
    '  console.log("clicked");\n'
    '}\n'
    '\n'
    'const link = document.getElementById("cta-link");\n'
    'link.addEventListener("click", trackClick);\n'
    '\n'
    'setTimeout("trackClick()", 1000);\n'
    '\n'
    'window.postMessage("data", "*");\n'
    '\n'
    'fetch("http://example.com/api");\n'
)


class CompetentReviewProvider:
    """One correct, targeted proposal per AI-eligible issue — none of
    these rules have a deterministic catalogue handler today, so every
    fix goes through the AI path. mdaiw-security/wildcard-postmessage is
    answered with requires_configuration=True — a competent model
    correctly declines to invent the real expected origin."""

    def __init__(self):
        self.seen_rule_ids = []

    def review(self, request):
        by_rule = {}
        for issue in request.issues:
            self.seen_rule_ids.append(issue.rule_id)
            by_rule.setdefault(issue.rule_id, issue)

        proposals = []
        if 'javascript:parse-error' in by_rule:
            issue = by_rule['javascript:parse-error']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='Close the function parameter list.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='function trackClick(\n',
                replacement_text='function trackClick() {\n',
                requires_configuration=False, assumptions=[],
            ))

        if 'mdaiw-lp/unchecked-selector-access' in by_rule:
            issue = by_rule['mdaiw-lp/unchecked-selector-access']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='Guard the possibly-null selector result before use.', risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text='link.addEventListener("click", trackClick);',
                replacement_text='if (link) {\n  link.addEventListener("click", trackClick);\n}',
                requires_configuration=False, assumptions=[],
            ))

        if 'no-implied-eval' in by_rule:
            issue = by_rule['no-implied-eval']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='Pass a function reference instead of a string.', risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text='setTimeout("trackClick()", 1000);', replacement_text='setTimeout(trackClick, 1000);',
                requires_configuration=False, assumptions=[],
            ))

        if 'mdaiw-security/mixed-content-url' in by_rule:
            issue = by_rule['mdaiw-security/mixed-content-url']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='Use HTTPS for this request.', risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text='fetch("http://example.com/api");', replacement_text='fetch("https://example.com/api");',
                requires_configuration=False, assumptions=[],
            ))

        if 'mdaiw-security/wildcard-postmessage' in by_rule:
            issue = by_rule['mdaiw-security/wildcard-postmessage']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='The real expected origin is a deployment-specific decision that cannot be inferred.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text='window.postMessage("data", "*");', replacement_text='window.postMessage("data", "*");',
                requires_configuration=True,
                assumptions=['The real target origin must be supplied — never guess a security boundary.'],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class JsTortureFixtureTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='js_torture_user', password='pw12345!', email='j@example.com')

    def test_ai_fix_issues_converges_the_js_torture_fixture(self):
        provider = CompetentReviewProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': '', 'js': TORTURE_JS, 'ampscript': ''},
                css_source_type='css', validation_scope='javascript', profile='standard',
                rate_limit_identifier='js-torture',
            )

        final_rule_ids = sorted(issue.rule_id for issue in result.report.issues.all())

        self.assertEqual(final_rule_ids, ['mdaiw-security/wildcard-postmessage'])
        self.assertEqual(result.issues_requires_input_total, 1)
        self.assertGreaterEqual(len(result.iterations), 2)  # parse-error hides the rest for one round

        final_js = result.final_sources['js']
        self.assertIn('function trackClick() {', final_js)
        self.assertIn('if (link) {', final_js)
        self.assertIn('setTimeout(trackClick, 1000);', final_js)
        self.assertNotIn('setTimeout("trackClick()"', final_js)
        self.assertIn('https://example.com/api', final_js)

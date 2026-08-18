"""AI Engineer Deep Validation + Autonomous Repair — Checkpoint 2 (CSS).

Mirrors test_html_torture_fixture.py's proof for CSS: a deliberately
malformed stylesheet, repaired by the existing candidate-first, iterative,
prevalidated architecture, converging to Validation Issues (0) except one
deliberately non-inferable finding. No real network call is made —
CompetentReviewProvider stands in for a real AI provider.

Discovered while building this fixture: an unclosed block at the end of
the stylesheet makes PostCSS itself fail to parse the WHOLE document, so
stylelint/css-custom findings elsewhere in the SAME file are invisible
until the structural blocker is fixed and the source is revalidated —
this fixture is deliberately shaped to require two real repair passes
(spec section 15), not because of anything special about this test."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from unittest.mock import patch

from ..ai_review.provider import AIReviewResult, ProposalDraft
from ..fixes import iterative as it

User = get_user_model()

# Five distinct, real findings. css-structure:unclosed-block hides the
# rest until fixed (see module docstring) — the loop must run more than
# one round to reach them.
TORTURE_CSS = (
    '.header {\n'
    '  margin: 0px;\n'
    '  colr: red;\n'
    '}\n'
    '\n'
    '@media {\n'
    '  .header { display: none; }\n'
    '}\n'
    '\n'
    '.hero {\n'
    '  background: url(http://example.com/bg.jpg);\n'
    '}\n'
    '\n'
    '.footer {\n'
    '  padding: 10px;\n'
)


class CompetentReviewProvider:
    """One correct, targeted proposal per AI-eligible issue — the
    deterministic catalogue does not cover any of these CSS rules today
    (fixes/catalogue.py's CSS handler list is length-zero-no-unit only,
    and that one is intentionally routed through AI here too, to prove
    the AI path independently). css-custom:empty-at-rule-condition is
    answered with requires_configuration=True — a competent model
    correctly declines to invent the intended @media breakpoint."""

    def __init__(self):
        self.seen_rule_ids = []

    def review(self, request):
        by_rule = {}
        for issue in request.issues:
            self.seen_rule_ids.append(issue.rule_id)
            by_rule.setdefault(issue.rule_id, issue)

        proposals = []
        if 'css-structure:unclosed-block' in by_rule:
            issue = by_rule['css-structure:unclosed-block']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='css', source_context=issue.source_context,
                explanation='Close the unclosed .footer block.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='  padding: 10px;\n',
                replacement_text='  padding: 10px;\n}\n',
                requires_configuration=False, assumptions=[],
            ))

        if 'css-semantic:unknown-property' in by_rule:
            issue = by_rule['css-semantic:unknown-property']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='css', source_context=issue.source_context,
                explanation='Fix the property name typo.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='colr: red;', replacement_text='color: red;',
                requires_configuration=False, assumptions=[],
            ))

        if 'stylelint:length-zero-no-unit' in by_rule:
            issue = by_rule['stylelint:length-zero-no-unit']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='css', source_context=issue.source_context,
                explanation='Zero lengths do not need a unit.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='margin: 0px;', replacement_text='margin: 0;',
                requires_configuration=False, assumptions=[],
            ))

        if 'css-custom:insecure-external-url' in by_rule:
            issue = by_rule['css-custom:insecure-external-url']
            issue_ids = [issue.issue_id]
            # Tool-Grounded AI Engineer sprint — native Stylelint autofix
            # (PASS 0.5, iterative.py) may already have quoted this url()
            # argument in an EARLIER round, before this issue was ever
            # regionally patched (spec section 3: "do not call AI for
            # anything the authoritative tool can safely autofix"). A
            # real model reading the issue's CURRENT code_excerpt would
            # naturally see whichever shape is actually present; this
            # fake provider does the same rather than assuming the
            # pre-native-autofix shape unconditionally.
            already_quoted = 'stylelint:function-url-quotes' not in by_rule
            if not already_quoted:
                issue_ids.append(by_rule['stylelint:function-url-quotes'].issue_id)
            expected_text = (
                'background: url("http://example.com/bg.jpg");' if already_quoted
                else 'background: url(http://example.com/bg.jpg);'
            )
            proposals.append(ProposalDraft(
                issue_ids=issue_ids, language='css', source_context=issue.source_context,
                explanation='Use HTTPS and quote the url() argument.', risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text=expected_text,
                replacement_text='background: url("https://example.com/bg.jpg");',
                requires_configuration=False, assumptions=[],
            ))
        elif 'stylelint:function-url-quotes' in by_rule:
            issue = by_rule['stylelint:function-url-quotes']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='css', source_context=issue.source_context,
                explanation='Quote the url() argument.', risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text='background: url(http://example.com/bg.jpg);',
                replacement_text='background: url("http://example.com/bg.jpg");',
                requires_configuration=False, assumptions=[],
            ))

        if 'css-custom:empty-at-rule-condition' in by_rule:
            issue = by_rule['css-custom:empty-at-rule-condition']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='css', source_context=issue.source_context,
                explanation='The intended breakpoint is a business/design decision that cannot be inferred.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text='@media {', replacement_text='@media {',
                requires_configuration=True,
                assumptions=['The @media condition requires a real breakpoint decision.'],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class CssTortureFixtureTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='css_torture_user', password='pw12345!', email='c@example.com')

    def test_ai_fix_issues_converges_the_css_torture_fixture(self):
        provider = CompetentReviewProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': TORTURE_CSS, 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='css', profile='standard',
                rate_limit_identifier='css-torture',
            )

        final_rule_ids = sorted(issue.rule_id for issue in result.report.issues.all())

        self.assertEqual(final_rule_ids, ['css-custom:empty-at-rule-condition'])
        self.assertEqual(result.issues_requires_input_total, 1)
        self.assertGreaterEqual(len(result.iterations), 2)  # unclosed-block hides the rest for one round

        final_css = result.final_sources['css']
        self.assertIn('color: red;', final_css)
        self.assertNotIn('colr:', final_css)
        self.assertIn('margin: 0;', final_css)
        self.assertNotIn('margin: 0px', final_css)
        self.assertIn('https://example.com/bg.jpg', final_css)
        self.assertEqual(final_css.count('.footer'), 1)
        self.assertEqual(final_css.count('}'), final_css.count('{'))

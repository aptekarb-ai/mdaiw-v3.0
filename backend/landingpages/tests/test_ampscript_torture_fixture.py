"""AI Engineer Deep Validation + Autonomous Repair — Checkpoint 4 (AMPscript).

Mirrors the HTML/CSS/JS torture-fixture proofs for AMPscript: a
deliberately malformed script, repaired by the existing candidate-first,
iterative, prevalidated architecture, converging to Validation Issues (0)
except one deliberately non-inferable finding. No real network call is
made — CompetentReviewProvider stands in for a real AI provider.

Unlike the JS/CSS fixtures, this project's own hand-written AMPscript
analyzer (validation/ampscript/) is resilient — it does not abort the
whole document on one defect — so all findings are visible in a single
validate call; ampscript:if-without-endif already has a deterministic
catalogue fix (fixes/catalogue.py), which this fixture also exercises.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from unittest.mock import patch

from ..ai_review.provider import AIReviewResult, ProposalDraft
from ..fixes import iterative as it

User = get_user_model()

# Five distinct, real findings. ampscript:if-without-endif is fixed by
# the deterministic catalogue; the rest need AI assistance.
TORTURE_AMPSCRIPT = (
    '%%[\n'
    '  VAR name\n'
    '  SET @name = "World"\n'
    '  IF @name == "World" THEN\n'
    '    SET @greeting = "Hello"\n'
    ']%%\n'
    '%%=Concat(@greeting, ", ", @name, "!"=%%\n'
    '%%[\n'
    '  SET @destination = @name\n'
    '  RedirectTo(@destination)\n'
    ']%%\n'
)


class CompetentReviewProvider:
    """One correct, targeted proposal per AI-eligible issue —
    ampscript:if-without-endif is intentionally left to the deterministic
    catalogue (not answered here) to prove that path independently.
    ampscript:unsafe-redirect is answered with requires_configuration=True
    — a competent model correctly declines to invent an allowlist."""

    def __init__(self):
        self.seen_rule_ids = []

    def review(self, request):
        by_rule = {}
        for issue in request.issues:
            self.seen_rule_ids.append(issue.rule_id)
            by_rule.setdefault(issue.rule_id, issue)

        proposals = []
        if 'ampscript:variable-missing-at-prefix' in by_rule:
            issue = by_rule['ampscript:variable-missing-at-prefix']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='ampscript', source_context=issue.source_context,
                explanation='Add the missing "@" prefix.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='VAR name', replacement_text='VAR @name',
                requires_configuration=False, assumptions=[],
            ))

        if 'ampscript:missing-parenthesis' in by_rule:
            issue = by_rule['ampscript:missing-parenthesis']
            issue_ids = [issue.issue_id]
            if 'ampscript:function-parameter-count' in by_rule:
                issue_ids.append(by_rule['ampscript:function-parameter-count'].issue_id)
            proposals.append(ProposalDraft(
                issue_ids=issue_ids, language='ampscript', source_context=issue.source_context,
                explanation='Close the Concat() call — its arguments are otherwise well-formed.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text='Concat(@greeting, ", ", @name, "!"',
                replacement_text='Concat(@greeting, ", ", @name, "!")',
                requires_configuration=False, assumptions=[],
            ))

        if 'ampscript:unsafe-redirect' in by_rule:
            issue = by_rule['ampscript:unsafe-redirect']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='ampscript', source_context=issue.source_context,
                explanation='The real allowlist of valid redirect destinations is a deployment-specific decision that cannot be inferred.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text='RedirectTo(@destination)', replacement_text='RedirectTo(@destination)',
                requires_configuration=True,
                assumptions=['The redirect target must be validated against a real allowlist — never guess a security boundary.'],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class AmpscriptTortureFixtureTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='amp_torture_user', password='pw12345!', email='a@example.com')

    def test_ai_fix_issues_converges_the_ampscript_torture_fixture(self):
        provider = CompetentReviewProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': '', 'js': '', 'ampscript': TORTURE_AMPSCRIPT},
                css_source_type='css', validation_scope='ampscript', profile='standard',
                rate_limit_identifier='amp-torture',
            )

        final_rule_ids = sorted(issue.rule_id for issue in result.report.issues.all())

        self.assertEqual(final_rule_ids, ['ampscript:unsafe-redirect'])
        self.assertEqual(result.issues_requires_input_total, 1)
        # ampscript:if-without-endif must have been resolved by the
        # deterministic catalogue, without ever needing an AI proposal.
        self.assertNotIn('ampscript:if-without-endif', provider.seen_rule_ids)

        final_amp = result.final_sources['ampscript']
        self.assertIn('VAR @name', final_amp)
        self.assertIn('ENDIF', final_amp)
        self.assertIn('Concat(@greeting, ", ", @name, "!")', final_amp)

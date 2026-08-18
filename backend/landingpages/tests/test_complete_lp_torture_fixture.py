"""AI Engineer Deep Validation + Autonomous Repair — Checkpoint 5
(Complete LP / cross-language).

Populates HTML, CSS, JavaScript, and AMPscript together (validation_scope
='complete') with independent per-language defects PLUS one genuine
cross-language defect (an HTML element id and the JS selector that is
supposed to target it disagree — mdaiw-lp/missing-selector-target, which
only fires when HTML context is threaded into the JS adapter under
Complete LP scope; see adapters/html_js_context.py). Proves ONE click of
AI Fix Issues repairs every language's own authoritative source and the
cross-language issue together, converging to Validation Issues (0) except
one deliberately non-inferable remainder (CSS's @media with no
condition) — same candidate-first, iterative, prevalidated architecture
as every other checkpoint, no special-cased "Complete LP" code path.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from unittest.mock import patch

from ..ai_review.provider import AIReviewResult, ProposalDraft
from ..fixes import iterative as it

User = get_user_model()

TORTURE_HTML = (
    '<!DOCTYPE html>\n'
    '<html>\n'
    '<head>\n'
    '<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta name="description" content="Sign up for our newsletter.">\n'
    '<title>Signup</title>\n'
    '</head>\n'
    '<body>\n'
    '<h1>Sign up</h1>\n'
    '<button id="signup-btn">Sign up</button>\n'
    '</body>\n'
    '</html>\n'
)
TORTURE_CSS = (
    '.btn {\n'
    '  margin: 0px;\n'
    '}\n'
    '\n'
    '@media {\n'
    '  .btn { display: none; }\n'
    '}\n'
)
# Cross-language defect: this selector ("signup") does not match the real
# HTML id ("signup-btn") — mdaiw-lp/missing-selector-target.
TORTURE_JS = (
    'const btn = document.getElementById("signup");\n'
    'btn.addEventListener("click", function () {\n'
    '  fetch("http://example.com/api");\n'
    '});\n'
)
TORTURE_AMPSCRIPT = (
    '%%[\n'
    '  VAR name\n'
    '  SET @name = "World"\n'
    ']%%\n'
)


class CompetentReviewProvider:
    """One correct, targeted proposal per AI-eligible issue, spanning all
    four languages. css-custom:empty-at-rule-condition is answered with
    requires_configuration=True — the real intended breakpoint cannot be
    inferred."""

    def __init__(self):
        self.seen_rule_ids = []

    def review(self, request):
        by_rule = {}
        for issue in request.issues:
            self.seen_rule_ids.append((issue.language, issue.rule_id))
            by_rule.setdefault(issue.rule_id, issue)

        proposals = []
        if 'missing-lang' in by_rule:
            issue = by_rule['missing-lang']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='html', source_context=issue.source_context,
                explanation='Add lang to the existing <html> start tag.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='<html>', replacement_text='<html lang="en">',
                requires_configuration=False, assumptions=[],
            ))

        if 'mdaiw-lp/missing-selector-target' in by_rule:
            issue = by_rule['mdaiw-lp/missing-selector-target']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='Correct the selector to match the real HTML id.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='"signup"', replacement_text='"signup-btn"',
                requires_configuration=False, assumptions=[],
            ))

        if 'mdaiw-lp/unchecked-selector-access' in by_rule:
            issue = by_rule['mdaiw-lp/unchecked-selector-access']
            issue_ids = [issue.issue_id]
            if 'mdaiw-security/mixed-content-url' in by_rule:
                issue_ids.append(by_rule['mdaiw-security/mixed-content-url'].issue_id)
            proposals.append(ProposalDraft(
                issue_ids=issue_ids, language='javascript', source_context=issue.source_context,
                explanation='Guard the possibly-null selector result; use HTTPS for the request.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text='btn.addEventListener("click", function () {\n  fetch("http://example.com/api");\n});',
                replacement_text=(
                    'if (btn) {\n  btn.addEventListener("click", function () {\n'
                    '    fetch("https://example.com/api");\n  });\n}'
                ),
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

        if 'css-custom:empty-at-rule-condition' in by_rule:
            issue = by_rule['css-custom:empty-at-rule-condition']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='css', source_context=issue.source_context,
                explanation='The intended breakpoint is a design decision that cannot be inferred.',
                risk='low', confidence='definite', start_offset=0, end_offset=0,
                expected_text='@media {', replacement_text='@media {',
                requires_configuration=True,
                assumptions=['The @media condition requires a real breakpoint decision.'],
            ))

        if 'ampscript:variable-missing-at-prefix' in by_rule:
            issue = by_rule['ampscript:variable-missing-at-prefix']
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='ampscript', source_context=issue.source_context,
                explanation='Add the missing "@" prefix.', risk='low', confidence='definite',
                start_offset=0, end_offset=0, expected_text='VAR name', replacement_text='VAR @name',
                requires_configuration=False, assumptions=[],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class CompleteLpTortureFixtureTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='clp_torture_user', password='pw12345!', email='clp@example.com')

    def test_ai_fix_issues_converges_the_complete_lp_torture_fixture(self):
        provider = CompetentReviewProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={
                    'html': TORTURE_HTML, 'css': TORTURE_CSS, 'js': TORTURE_JS, 'ampscript': TORTURE_AMPSCRIPT,
                },
                css_source_type='css', validation_scope='complete', profile='standard',
                rate_limit_identifier='clp-torture',
            )

        final_by_language = {}
        for issue in result.report.issues.all():
            final_by_language.setdefault(issue.language, []).append(issue.rule_id)

        # The cross-language selector mismatch really was seen and fixed —
        # not by coincidence, but because HTML context was actually
        # threaded into the JS adapter under Complete LP scope.
        self.assertIn(('javascript', 'mdaiw-lp/missing-selector-target'), provider.seen_rule_ids)

        self.assertEqual(final_by_language.get('html', []), [])
        self.assertEqual(final_by_language.get('javascript', []), [])
        self.assertEqual(final_by_language.get('ampscript', []), [])
        # Tool-Grounded AI Engineer sprint — TORTURE_CSS's ".btn" selector
        # genuinely has no matching class anywhere in TORTURE_HTML (only
        # id="signup-btn" exists), so the new Complete-LP cross-language
        # check (validation/engine.py::_check_css_selectors_reference_
        # html, spec section 14) correctly flags it. Registered as
        # advisory-only in the Rule Knowledge Registry (validation/rules/
        # css.py) — never auto-resolvable (which side is wrong is a human
        # call), so it lands in issues_advisory_total, not
        # issues_requires_input_total.
        self.assertEqual(
            sorted(final_by_language.get('css', [])),
            ['cross-language:css-selector-missing-target', 'css-custom:empty-at-rule-condition'],
        )
        self.assertEqual(result.issues_requires_input_total, 1)
        self.assertEqual(result.issues_advisory_total, 1)

        final_sources = result.final_sources
        self.assertIn('<html lang="en">', final_sources['html'])
        self.assertIn('getElementById("signup-btn")', final_sources['js'])
        self.assertIn('if (btn) {', final_sources['js'])
        self.assertIn('https://example.com/api', final_sources['js'])
        self.assertIn('margin: 0;', final_sources['css'])
        self.assertIn('VAR @name', final_sources['ampscript'])

    # Consistent Validation Counts sprint, spec section 1/33/34 — every
    # issue present at the start must be accounted for as exactly one of
    # resolved/still-present/newly-exposed, and the lifecycle counts must
    # arithmetically reconcile: FINAL == INITIAL - RESOLVED + NEW. This is
    # the regression test guarding that arithmetic directly, independent
    # of what the specific final rule_ids happen to be.
    def test_lifecycle_counts_reconcile_for_the_complete_lp_torture_fixture(self):
        provider = CompetentReviewProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={
                    'html': TORTURE_HTML, 'css': TORTURE_CSS, 'js': TORTURE_JS, 'ampscript': TORTURE_AMPSCRIPT,
                },
                css_source_type='css', validation_scope='complete', profile='standard',
                rate_limit_identifier='clp-torture-counts',
            )

        self.assertEqual(
            result.issues_remaining_total,
            result.issues_before_total - result.issues_resolved_total + result.issues_new_total,
        )
        # The report actually persisted is the single source of truth for
        # "remaining" — never a running counter that could drift from it.
        self.assertEqual(result.issues_remaining_total, result.report.issues.count())
        self.assertEqual(
            result.issues_final_error_total + result.issues_final_warning_total
            + sum(1 for i in result.report.issues.all() if i.severity == 'info'),
            result.issues_remaining_total,
        )
        self.assertGreaterEqual(result.issues_before_error_total, 0)
        self.assertGreaterEqual(result.issues_before_warning_total, 0)
        # issues_unrepairable_total's own documented definition (see its
        # field comment on AutonomousFixResult) subtracts BOTH
        # requires-input AND advisory-only findings from remaining — this
        # fixture now has one of each (the .btn cross-language finding is
        # advisory-only; the @media breakpoint is requires-input), so the
        # full three-term formula is what actually holds, not the
        # two-term version that happened to coincide when this fixture
        # had zero advisory findings.
        self.assertEqual(
            result.issues_unrepairable_total,
            result.issues_remaining_total - result.issues_requires_input_total - result.issues_advisory_total,
        )

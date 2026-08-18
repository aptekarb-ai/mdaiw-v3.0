"""AI Engineer Autonomous Repair tests — Module 3 LP Validator & Fixer.
Unit tests inject a fake AI review provider (no real network call); API
tests exercise the full POST /api/v1/lp/ai-fix/run/ round trip. Clicking
"AI Fix Issues" is consent for the WHOLE operation (spec section 1/17/18)
— these tests specifically prove there is no per-issue pre-approval step:
every currently repairable issue is attempted automatically, every
iteration, until the source is valid or nothing more can be safely done.
See fixes/iterative.py's module docstring for the full safety model.
"""

import re
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ..ai_review.provider import AIReviewResult, ProposalDraft
from ..fixes import iterative as it
from ..report_builder import persist_validation_report

User = get_user_model()

_MALFORMED_TAG_HTML = (
    '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>T</title></head>\n'
    '<body>\n<div>\n  <img src="a.jpg" alt="a"\n  <a href="b.html">B</a>\n</div>\n</body>\n</html>\n'
)


class FixTagFakeProvider:
    """Fixes a malformed-start-tag issue by inserting '>' right after the
    exact tag named in the issue's own message. The excerpt window is
    centered on the issue's OWN line (see ai_review/excerpt.py), so when
    two malformed tags of the same kind are close together, each excerpt
    contains BOTH occurrences — picking "the first occurrence in the
    excerpt" for every issue alike would make two different issues collide
    on the identical proposal. Instead this picks the occurrence on the
    LINE closest to the excerpt's own center line, which is always the
    issue's own occurrence by construction of how the excerpt was built."""

    def __init__(self):
        self.calls = 0

    def review(self, request):
        self.calls += 1
        proposals = []
        for issue in request.issues:
            match = re.search(r'"<(\w+)" is missing its closing', issue.message)
            if not match:
                continue
            tag_name = match.group(1)
            needle = f'<{tag_name}'
            lines = issue.code_excerpt.split('\n')
            center_line = len(lines) // 2
            best_line_index, best_idx = None, None
            for line_index, line in enumerate(lines):
                col = line.find(needle)
                if col == -1:
                    continue
                if best_line_index is None or abs(line_index - center_line) < abs(best_line_index - center_line):
                    best_line_index, best_idx = line_index, col
            if best_line_index is None:
                continue
            offset_of_line = sum(len(lines[i]) + 1 for i in range(best_line_index))
            idx = offset_of_line + best_idx
            end = idx + len(needle)
            while end < len(issue.code_excerpt) and issue.code_excerpt[end] not in '<>':
                end += 1
            tag_text = issue.code_excerpt[idx:end]
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='html', source_context='',
                explanation='Insert the missing >.', risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text=tag_text, replacement_text=tag_text + '>',
                requires_configuration=False, assumptions=[],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class NullProvider:
    def review(self, request):
        return AIReviewResult(summary='', proposals=[])


class ExplodingProvider:
    def review(self, request):
        raise it.AIReviewUnavailable('simulated outage')


class ConfigNeededProvider:
    """Every proposal explicitly needs external configuration — proves
    those issues land in 'requires input', never silently auto-applied."""

    def review(self, request):
        proposals = [
            ProposalDraft(
                issue_ids=[issue.issue_id], language=issue.language, source_context='',
                explanation='Cannot resolve without real business data.', risk='high', confidence='possible',
                start_offset=0, end_offset=0,
                expected_text=issue.code_excerpt[:10] or 'x', replacement_text=(issue.code_excerpt[:10] or 'x') + 'FIXED',
                requires_configuration=True, assumptions=['Assumption: needs a real Data Extension name.'],
            )
            for issue in request.issues
        ]
        return AIReviewResult(summary='', proposals=proposals)


def _make_user(name='iter_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


class AdvisoryOnlyClassificationTests(TestCase):
    """Warning Auto-Repair sprint, spec section 6 — ADVISORY_ONLY findings
    (the Rule Knowledge Registry itself documents no repair strategy
    exists) never consume an AI request/recipe attempt; every other
    finding is unaffected regardless of severity."""

    def test_a_rule_documented_as_informational_only_is_advisory(self):
        issue = SimpleNamespace(rule_id='ampscript:too-many-regions', language='ampscript')
        self.assertTrue(it._is_advisory_only(issue))

    def test_a_normal_repairable_warning_is_not_advisory(self):
        issue = SimpleNamespace(rule_id='charset-declared-late', language='html')
        self.assertFalse(it._is_advisory_only(issue))

    def test_an_unknown_rule_id_is_not_advisory(self):
        issue = SimpleNamespace(rule_id='not-a-real-rule', language='html')
        self.assertFalse(it._is_advisory_only(issue))


class AdvisoryOnlyFinalCountTests(TestCase):
    """Closure spec section 12 — an advisory-only finding surfaces as its
    own count and is explicitly excluded from issues_unrepairable_total,
    never presented as a repair failure."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('advisory_user')

    def test_an_advisory_only_finding_is_counted_separately_not_as_unrepairable(self):
        # ampscript:too-many-regions fires past 500 regions in one source
        # (validation/ampscript/blocks.py::_MAX_REGIONS) — cheap, minimal
        # regions are enough to trip the resource bound.
        ampscript = '\n'.join('%%=1=%%' for _ in range(501))
        with patch.object(it, 'get_default_ai_review_provider', return_value=NullProvider()):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': '', 'js': '', 'ampscript': ampscript},
                css_source_type='css', validation_scope='ampscript', profile='standard',
                rate_limit_identifier='u',
            )
        final_rule_ids = [i.rule_id for i in result.report.issues.all()]
        self.assertIn('ampscript:too-many-regions', final_rule_ids)
        self.assertGreaterEqual(result.issues_advisory_total, 1)
        # The advisory finding must not inflate "unrepairable" — with
        # nothing else genuinely blocked, unrepairable stays at 0.
        self.assertEqual(result.issues_unrepairable_total, 0)


class RunAutonomousRepairMechanicsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user()

    def _run(self, html, provider, **overrides):
        kwargs = dict(
            user=self.user, project=None,
            initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
            css_source_type='css', validation_scope='html', profile='standard',
            rate_limit_identifier='u',
        )
        kwargs.update(overrides)
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            return it.run_autonomous_repair(**kwargs)

    def test_ai_assisted_issue_is_fixed_with_no_pre_approval_of_any_kind(self):
        # This is the core behavior change: NOTHING was pre-approved by a
        # user — the click itself is consent, and the AI-assisted fix for
        # a malformed tag is applied automatically.
        result = self._run(_MALFORMED_TAG_HTML, FixTagFakeProvider())
        self.assertGreaterEqual(result.iterations[0].fixes_applied, 1)
        self.assertIn('>', result.final_sources['html'].split('\n')[5])  # the img line, now terminated

    def test_newly_exposed_issue_is_fixed_automatically_across_iterations(self):
        # Two malformed <img> tags — whether the engine surfaces both at
        # once or the second is only exposed after the first is fixed,
        # BOTH must end up repaired with no user involvement beyond the
        # original "AI Fix Issues" click (autonomous mode attempts every
        # currently actionable issue every round, so this no longer
        # requires a specific iteration count to prove).
        html = (
            '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>T</title></head>\n'
            '<body>\n<div>\n  <img src="a.jpg" alt="a"\n  <img src="c.jpg" alt="c"\n  <p>done</p>\n</div>\n'
            '</body>\n</html>\n'
        )
        result = self._run(html, FixTagFakeProvider())
        final_html = result.final_sources['html']
        self.assertNotIn('alt="a"\n  <img', final_html)  # first img now properly terminated
        self.assertNotIn('alt="c"\n  <p', final_html)  # second img now properly terminated too
        self.assertGreaterEqual(len(result.iterations), 1)

    def test_stops_all_resolved_when_zero_issues_remain(self):
        html = (
            '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>T</title>\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="description" content="d"></head><body><h1>Welcome</h1><p>hi</p></body></html>\n'
        )
        result = self._run(html, NullProvider())
        self.assertEqual(result.stopped_reason, 'all_resolved')
        self.assertEqual(result.issues_remaining_total, 0)

    def test_stops_no_actionable_when_nothing_left_to_fix(self):
        # '<p>hi</p>' also happens to be missing a doctype, which IS
        # deterministically fixable — autonomous mode applies that
        # automatically (no approval needed), then genuinely runs out of
        # safe/provable moves for what's left (a fake provider that
        # proposes nothing), landing on 'no_actionable'.
        html = '<p>hi</p>'
        result = self._run(html, NullProvider())
        self.assertEqual(result.stopped_reason, 'no_actionable')
        self.assertGreater(result.issues_remaining_total, 0)

    def test_deterministic_only_fix_needs_no_ai_provider_at_all(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'  # missing-doctype is deterministically fixable
        result = self._run(html, None)
        self.assertGreaterEqual(result.fixes_applied_total, 1)
        # Autonomous mode also tries AI for whatever deterministic did NOT
        # cover (e.g. missing-lang) — with no provider configured, that
        # legitimately surfaces as "AI unavailable" even though the
        # deterministic fix itself succeeded without it.
        self.assertTrue(result.ai_unavailable_ever)

    def test_max_iterations_respected_and_final_state_is_authoritative(self):
        html = (
            '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>T</title></head>\n'
            '<body>\n<div>\n  <img src="a.jpg" alt="a"\n  <img src="c.jpg" alt="c"\n</div>\n</body>\n</html>\n'
        )
        with override_settings(LP_AI_FIX_MAX_ITERATIONS=1):
            result = self._run(html, FixTagFakeProvider())
        self.assertEqual(len(result.iterations), 1)
        self.assertIn(result.stopped_reason, ('max_iterations', 'all_resolved'))
        # The report returned must reflect a revalidation of the FINAL
        # sources, not the state right after the single applied patch.
        self.assertEqual(len(list(result.report.issues.all())), result.issues_remaining_total)

    def test_provider_unavailable_falls_back_to_deterministic_only_continuation(self):
        html = '<html>\n<body>\n<div>\n  <img src="a.jpg" alt="a"\n  <p>done</p>\n</div>\n</body>\n</html>\n'
        result = self._run(html, ExplodingProvider())
        self.assertTrue(result.ai_unavailable_ever)
        self.assertGreaterEqual(result.fixes_applied_total, 0)
        self.assertIsNotNone(result.report)

    def test_by_language_breakdown_covers_multiple_languages(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        css = '.a{color:red}'
        result = self._run(
            html, None,
            initial_sources={'html': html, 'css': css, 'js': '', 'ampscript': ''}, validation_scope='complete',
        )
        self.assertIn('html', result.by_language)

    def test_requires_input_is_reserved_for_proposals_needing_external_configuration(self):
        result = self._run('<p>hi</p>', ConfigNeededProvider())
        self.assertGreater(result.issues_requires_input_total, 0)
        self.assertLessEqual(result.issues_requires_input_total, result.issues_remaining_total)

    def test_ordinary_repairable_issues_do_not_land_in_requires_input(self):
        # The exact bug this sprint fixes: ordinary structure repairs must
        # never end up "requires input" just because nobody ticked a
        # checkbox — they should simply get fixed.
        result = self._run(_MALFORMED_TAG_HTML, FixTagFakeProvider())
        self.assertEqual(result.issues_requires_input_total, 0)

    def test_same_region_findings_are_merged_not_left_as_conflicts(self):
        # A document missing charset/viewport/meta-description all at once
        # — a real AI provider would anchor all three insertions on the
        # same literal "<head>" text. Without the region merge, the
        # three-way "same range" collision would leave every one of them
        # unresolved. With it, one combined repair covers all three.
        html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<title>T</title>\n</head>\n<body><h1>Welcome</h1></body>\n</html>\n'

        class HeadMetaProvider:
            def review(self, request):
                proposals = []
                for issue in request.issues:
                    if issue.rule_id == 'missing-charset':
                        proposals.append(ProposalDraft(
                            issue_ids=[issue.issue_id], language='html', source_context='',
                            explanation='Add charset.', risk='low', confidence='definite',
                            start_offset=0, end_offset=0, expected_text='<head>',
                            replacement_text='<head>\n<meta charset="UTF-8">',
                            requires_configuration=False, assumptions=[],
                        ))
                    elif issue.rule_id == 'missing-viewport':
                        proposals.append(ProposalDraft(
                            issue_ids=[issue.issue_id], language='html', source_context='',
                            explanation='Add viewport.', risk='low', confidence='definite',
                            start_offset=0, end_offset=0, expected_text='<head>',
                            replacement_text='<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">',
                            requires_configuration=False, assumptions=[],
                        ))
                    elif issue.rule_id == 'missing-meta-description':
                        proposals.append(ProposalDraft(
                            issue_ids=[issue.issue_id], language='html', source_context='',
                            explanation='Add description.', risk='low', confidence='definite',
                            start_offset=0, end_offset=0, expected_text='<head>',
                            replacement_text='<head>\n<meta name="description" content="T.">',
                            requires_configuration=False, assumptions=[],
                        ))
                return AIReviewResult(summary='', proposals=proposals)

        result = self._run(html, HeadMetaProvider())
        final_html = result.final_sources['html']
        self.assertIn('charset', final_html)
        self.assertIn('viewport', final_html)
        self.assertIn('description', final_html)
        self.assertEqual(result.issues_requires_input_total, 0)


class RunAutonomousRepairRegressionGuardTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user('regression_user')

    def test_a_worsening_iteration_is_reverted_and_the_loop_stops(self):
        # A provider that "fixes" missing-doctype by inserting garbage
        # that breaks parsing worse than before must never be allowed to
        # leave the editor in that worse state.
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'

        class SabotageProvider:
            def review(self, request):
                return AIReviewResult(summary='', proposals=[
                    ProposalDraft(
                        issue_ids=[issue.issue_id], language='html', source_context='',
                        explanation='Sabotage.', risk='low', confidence='definite',
                        start_offset=0, end_offset=0, expected_text='<html>',
                        replacement_text='<html <<< broken',
                        requires_configuration=False, assumptions=[],
                    )
                    for issue in request.issues if issue.rule_id == 'missing-doctype'
                ])

        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])):
            with patch.object(it, 'get_default_ai_review_provider', return_value=SabotageProvider()):
                result = it.run_autonomous_repair(
                    user=self.user, project=None,
                    initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                    css_source_type='css', validation_scope='html', profile='standard',
                    rate_limit_identifier='u',
                )
        # Fix-Application Correctness / Deep Validation spec section 16 —
        # caught a layer earlier now: this proposal never actually adds a
        # doctype (missing-doctype, its own targeted issue, still isn't
        # resolved in the candidate — it's also now malformed), so AI
        # Review's own candidate-prevalidation rejects it before the
        # regression guard ever needs to run.
        self.assertEqual(result.stopped_reason, 'no_actionable')
        # The editor must reflect the ORIGINAL source, not the sabotaged one.
        self.assertEqual(result.final_sources['html'], html)

    # Deep Validation spec section 7/15 — discovered live while building
    # the JS torture-fixture test: ESLint aborts the WHOLE file on one
    # fatal parse error, hiding every other finding. Genuinely fixing that
    # blocker can legitimately EXPOSE more error-severity findings next
    # round than were visible before (they were always there) — the naive
    # "error count increased" guard used to misread that as a regression
    # and revert the correct, working parse fix. Permanent regression
    # fixture for _round_resolved_a_parser_blocker.
    def test_resolving_a_parser_blocker_that_reveals_more_errors_is_not_reverted(self):
        js = (
            'function trackClick(\n'
            '  console.log("clicked");\n'
            '}\n'
            '\n'
            'eval(trackClick);\n'
            'new Function("trackClick()");\n'
        )

        class ParserRecoveryProvider:
            def review(self, request):
                proposals = []
                for issue in request.issues:
                    if issue.rule_id == 'javascript:parse-error':
                        proposals.append(ProposalDraft(
                            issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                            explanation='Close the parameter list.', risk='low', confidence='definite',
                            start_offset=0, end_offset=0, expected_text='function trackClick(\n',
                            replacement_text='function trackClick() {\n',
                            requires_configuration=False, assumptions=[],
                        ))
                return AIReviewResult(summary='', proposals=proposals)

        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])):
            with patch.object(it, 'get_default_ai_review_provider', return_value=ParserRecoveryProvider()):
                result = it.run_autonomous_repair(
                    user=self.user, project=None,
                    initial_sources={'html': '', 'css': '', 'js': js, 'ampscript': ''},
                    css_source_type='css', validation_scope='javascript', profile='standard',
                    rate_limit_identifier='u2',
                )

        # The parse fix must be KEPT — the two error-severity findings it
        # exposed (no-eval, no-new-func) were always there, revealing them
        # is correct progress, not a regression to revert.
        self.assertNotEqual(result.stopped_reason, 'regression_reverted')
        self.assertIn('function trackClick() {', result.final_sources['js'])
        final_rule_ids = sorted(issue.rule_id for issue in result.report.issues.all())
        self.assertNotIn('javascript:parse-error', final_rule_ids)


class RunAutonomousRepairStructuralIntegrityTests(TestCase):
    """Source-Repair Integrity sprint — a candidate that would introduce a
    duplicate document-shell element must never reach the editor, even
    when it comes from a single standalone proposal (not a same-anchor
    merge — fixes/regions.py's own merge-time guard is tested separately
    in test_regions.py; this exercises the independent, general backstop
    in fixes/html_invariants.py, wired into the loop itself)."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('integrity_user')

    def test_a_candidate_introducing_a_duplicate_head_is_rejected_before_commit(self):
        html = '<html><head><title>T</title></head><body><h1>Welcome</h1><p>hi</p></body></html>'

        class DuplicateHeadProvider:
            def review(self, request):
                return AIReviewResult(summary='', proposals=[
                    ProposalDraft(
                        issue_ids=[issue.issue_id], language='html', source_context='',
                        explanation='Badly-scoped repair.', risk='low', confidence='definite',
                        start_offset=0, end_offset=0, expected_text='<html>',
                        replacement_text='<html><head><meta name="injected" content="1"></head>',
                        requires_configuration=False, assumptions=[],
                    )
                    for issue in request.issues if issue.rule_id == 'missing-lang'
                ])

        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])):
            with patch.object(it, 'get_default_ai_review_provider', return_value=DuplicateHeadProvider()):
                result = it.run_autonomous_repair(
                    user=self.user, project=None,
                    initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                    css_source_type='css', validation_scope='html', profile='standard',
                    rate_limit_identifier='u',
                )
        # Fix-Application Correctness / Deep Validation spec section 16 —
        # caught a layer earlier now: this proposal never actually adds a
        # lang attribute (missing-lang, its own targeted issue, still
        # isn't resolved in the candidate), so AI Review's own candidate-
        # prevalidation rejects it before the structural-invariant
        # backstop ever needs to run. The safety guarantee (no duplicate
        # head reaches the editor) is unchanged.
        self.assertEqual(result.stopped_reason, 'no_actionable')
        self.assertEqual(result.final_sources['html'], html)
        self.assertEqual(result.final_sources['html'].count('<head'), 1)

    def test_a_candidate_reinserting_an_already_present_title_is_rejected(self):
        # The exact live-reproduced "duplicate-title" case: a proposal for
        # a DIFFERENT issue than "title is missing" still adds a brand new
        # <title>, even though one already exists elsewhere in the head.
        html = '<html lang="en"><head><title>Signup Page</title></head><body><h1>Welcome</h1><p>hi</p></body></html>'

        class DuplicateTitleProvider:
            def review(self, request):
                return AIReviewResult(summary='', proposals=[
                    ProposalDraft(
                        issue_ids=[issue.issue_id], language='html', source_context='',
                        explanation='Contextual suggestion, badly scoped.', risk='low', confidence='definite',
                        start_offset=0, end_offset=0, expected_text='<head>',
                        replacement_text='<head>\n<title>Signup Page</title>',
                        requires_configuration=False, assumptions=[],
                    )
                    for issue in request.issues if issue.rule_id == 'missing-charset'
                ])

        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])):
            with patch.object(it, 'get_default_ai_review_provider', return_value=DuplicateTitleProvider()):
                result = it.run_autonomous_repair(
                    user=self.user, project=None,
                    initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                    css_source_type='css', validation_scope='html', profile='standard',
                    rate_limit_identifier='u',
                )
        # Fix-Application Correctness / Deep Validation spec section 16 —
        # this badly-scoped proposal is now caught a layer earlier than
        # before: it never resolves its OWN targeted issue (missing-charset
        # — the candidate only injects a duplicate <title>, no charset at
        # all), so AI Review's own candidate-prevalidation rejects it
        # before the structural-invariant backstop ever needs to run.
        # Nothing actionable remains this round, hence 'no_actionable'
        # rather than 'candidate_rejected' — the safety guarantee below
        # (source untouched, no duplicate title) is unchanged.
        self.assertEqual(result.stopped_reason, 'no_actionable')
        self.assertEqual(result.final_sources['html'], html)
        self.assertEqual(result.final_sources['html'].count('<title'), 1)


@override_settings(LP_AI_REVIEW_PROVIDER='')
class AIFixIssuesRunApiTests(TestCase):
    """Forces AI review unavailable regardless of this machine's local
    .env — these tests exercise the deterministic-fix path specifically
    and must never depend on (or make) a real network call. AI-assisted
    autonomous-repair behavior is covered by the mocked-provider unit
    tests above."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('api_user')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _validate(self, html, **kwargs):
        payload = {'html': html, 'css': '', 'js': '', 'ampscript': '', 'validation_scope': 'html', 'profile': 'standard', 'css_source_type': 'css'}
        payload.update(kwargs)
        response = self.client.post('/api/v1/lp/validate/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_requires_auth(self):
        client = APIClient()
        response = client.post('/api/v1/lp/ai-fix/run/', {'report': 1, 'html': ''}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_no_issue_id_list_is_needed_the_click_itself_is_consent(self):
        # The request body carries no issue-id selection at all — this IS
        # the point of the sprint: there is no second approval step.
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        response = self.client.post('/api/v1/lp/ai-fix/run/', {
            'report': report_json['id'], 'html': html, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertGreaterEqual(body['fix_metrics']['fixes_applied'], 1)
        self.assertNotIn('missing-doctype', [i['rule_id'] for i in body['issues']])

    def test_cross_user_report_returns_404(self):
        report_json = self._validate('<html><body><h1>Welcome</h1><p>hi</p></body></html>')
        other = _make_user('other_user')
        other_client = APIClient()
        other_client.force_authenticate(other)
        response = other_client.post('/api/v1/lp/ai-fix/run/', {
            'report': report_json['id'],
            'html': '<html><body><h1>Welcome</h1><p>hi</p></body></html>', 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }, format='json')
        self.assertEqual(response.status_code, 404)

    def test_full_round_trip_resolves_deterministic_issue_and_returns_final_sources(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)

        response = self.client.post('/api/v1/lp/ai-fix/run/', {
            'report': report_json['id'], 'html': html, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }, format='json')

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertIn('final_sources', body)
        self.assertTrue(body['final_sources']['html'].startswith('<!DOCTYPE html>'))
        self.assertIn('fix_metrics', body)
        self.assertIn('issues_requires_input', body['fix_metrics'])
        self.assertGreaterEqual(body['fix_metrics']['fixes_applied'], 1)
        self.assertNotIn('missing-doctype', [i['rule_id'] for i in body['issues']])

    def test_same_operation_id_retried_returns_cached_result_without_a_second_mutation(self):
        # Source-Repair Integrity sprint, spec section 12 — a double-click,
        # browser retry, or duplicate submission carrying the SAME
        # operation_id for the SAME user must never mutate source twice.
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        payload = {
            'report': report_json['id'], 'operation_id': 'op-123', 'html': html, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }

        with patch('landingpages.views.run_autonomous_repair', wraps=it.run_autonomous_repair) as spy:
            first = self.client.post('/api/v1/lp/ai-fix/run/', payload, format='json')
            second = self.client.post('/api/v1/lp/ai-fix/run/', payload, format='json')

        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(first.json(), second.json())
        spy.assert_called_once()

    def test_a_different_operation_id_is_not_deduplicated(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)

        def _post(operation_id):
            return self.client.post('/api/v1/lp/ai-fix/run/', {
                'report': report_json['id'], 'operation_id': operation_id, 'html': html, 'css': '', 'js': '', 'ampscript': '',
                'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
            }, format='json')

        with patch('landingpages.views.run_autonomous_repair', wraps=it.run_autonomous_repair) as spy:
            _post('op-a')
            _post('op-b')
        self.assertEqual(spy.call_count, 2)

    def test_no_operation_id_never_deduplicates(self):
        # Omitting operation_id entirely preserves the original behavior —
        # every request executes (matches every other endpoint).
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        payload = {
            'report': report_json['id'], 'html': html, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }
        with patch('landingpages.views.run_autonomous_repair', wraps=it.run_autonomous_repair) as spy:
            self.client.post('/api/v1/lp/ai-fix/run/', payload, format='json')
            self.client.post('/api/v1/lp/ai-fix/run/', payload, format='json')
        self.assertEqual(spy.call_count, 2)

    def test_response_report_id_differs_from_the_original_confirming_a_fresh_revalidation(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        response = self.client.post('/api/v1/lp/ai-fix/run/', {
            'report': report_json['id'], 'html': html, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }, format='json')
        body = response.json()
        self.assertNotEqual(body['id'], report_json['id'])
        self.assertGreaterEqual(body['fix_metrics']['fixes_applied'], 1)

    def test_unexpected_exception_returns_safe_500(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        with patch('landingpages.views.run_autonomous_repair', side_effect=RuntimeError('boom')):
            response = self.client.post('/api/v1/lp/ai-fix/run/', {
                'report': report_json['id'], 'html': html, 'css': '', 'js': '', 'ampscript': '',
                'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
            }, format='json')
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('boom', response.content.decode())

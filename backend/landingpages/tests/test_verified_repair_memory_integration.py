"""Verified Repair Memory + Warning Auto-Repair sprint — proves the
fast-path/negative-memory wiring inside fixes/iterative.py's autonomous
repair loop, and the section-19 repeated-fixture learning comparison
(RUN 1 vs RUN 2 against the identical reset fixture).

Uses a fake AI review provider that RECORDS which rule_ids it was ever
asked about — the core claim under test is "a verified recipe is applied
without spending a fresh LLM reasoning call", which is only provable by
showing the provider was never consulted for the fingerprints the recipe
covered.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewResult
from ..fixes import iterative as it
from ..fixes import repair_memory, verified_recipes
from ..models import RepairKnowledgeRecord, RepairKnowledgeStatus
from ..report_builder import persist_validation_report

User = get_user_model()


class RecordingNullProvider:
    """Never proposes anything — records every rule_id it was asked
    about so a test can assert a given rule_id was NEVER sent to it
    (proof the verified-recipe/deterministic fast path handled it first)."""

    def __init__(self):
        self.seen_rule_ids: set[str] = set()
        self.calls = 0

    def review(self, request):
        self.calls += 1
        self.seen_rule_ids.update(issue.rule_id for issue in request.issues)
        return AIReviewResult(summary='', proposals=[])


def _make_user(name='memory_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


# Spec section 22's exact three-warning fixture: charset declared late,
# a font-family with no generic fallback, and a JS selector referencing
# an id that exists only under a different casing.
_THREE_WARNINGS_HTML = (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    '<meta name="description" content="A landing page.">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta charset="UTF-8">\n<title>Sign in</title>\n</head>\n'
    '<body>\n<input type="text" id="userName">\n<p>hi</p>\n</body>\n</html>\n'
)
_THREE_WARNINGS_CSS = 'body {\n  font-family: Arial;\n  color: #333;\n}\n'
_THREE_WARNINGS_JS = 'const el = document.getElementById("username");\nconsole.log(el);\n'


class VerifiedRecipeFastPathTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user('fastpath_user')

    def _run(self, provider):
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            return it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': _THREE_WARNINGS_HTML, 'css': _THREE_WARNINGS_CSS, 'js': _THREE_WARNINGS_JS, 'ampscript': ''},
                css_source_type='css', validation_scope='complete', profile='standard',
                rate_limit_identifier='u',
            )

    def test_all_three_warnings_resolved_without_a_single_ai_request_for_them(self):
        provider = RecordingNullProvider()
        result = self._run(provider)

        self.assertNotIn('charset-declared-late', provider.seen_rule_ids)
        self.assertNotIn('stylelint:font-family-no-missing-generic-family-keyword', provider.seen_rule_ids)
        self.assertNotIn('mdaiw-lp/missing-selector-target', provider.seen_rule_ids)

        final_rule_ids = {issue.rule_id for issue in result.report.issues.all()}
        self.assertNotIn('charset-declared-late', final_rule_ids)
        self.assertNotIn('stylelint:font-family-no-missing-generic-family-keyword', final_rule_ids)
        self.assertNotIn('mdaiw-lp/missing-selector-target', final_rule_ids)

        self.assertIn('Arial, sans-serif', result.final_sources['css'])
        self.assertIn('getElementById("userName")', result.final_sources['js'])
        self.assertEqual(result.final_sources['html'].count('meta charset'), 1)

    def test_each_strategy_is_recorded_as_verified_repair_knowledge(self):
        self._run(RecordingNullProvider())
        verified = RepairKnowledgeRecord.objects.filter(status=RepairKnowledgeStatus.VERIFIED)
        strategy_keys = set(verified.values_list('strategy_key', flat=True))
        self.assertIn('move-existing-charset-to-head-start', strategy_keys)
        self.assertIn('append-known-generic-family', strategy_keys)
        self.assertIn('rename-selector-to-existing-equivalent-id', strategy_keys)
        for record in verified:
            self.assertGreaterEqual(record.success_count, 1)
            self.assertIsNotNone(record.last_verified_at)


class NegativeMemoryTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user('negative_user')

    def test_a_strategy_already_rejected_in_this_exact_context_is_never_retried(self):
        # Derive the REAL context signature charset-declared-late produces
        # for this exact fixture (never hand-reconstructed — that would
        # risk silently testing a signature the real recipe never
        # produces), then pre-seed it as REJECTED — proving the fast path
        # skips a known-bad strategy rather than re-trying it.
        html = _THREE_WARNINGS_HTML
        report = persist_validation_report(
            user=self.user, project=None, html=html, css='', js='', ts='', ampscript='',
            profile='standard', validation_scope='html', css_source_type='css',
        )[0]
        issue = next(i for i in report.issues.all() if i.rule_id == 'charset-declared-late')
        probe = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        context_signature = repair_memory.compute_context_signature(probe.context_facts)
        repair_memory.record_attempt_result(
            language='html', rule_id='charset-declared-late', context_signature=context_signature,
            strategy_key='move-existing-charset-to-head-start', success=False,
            strategy_description='Pre-seeded rejection for this test.',
        )

        provider = RecordingNullProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )
        # The recipe was skipped (negative memory) — no NEW attempt was
        # recorded against the pre-seeded row beyond the one we seeded.
        record = RepairKnowledgeRecord.objects.get(
            language='html', rule_id='charset-declared-late', context_signature=context_signature,
            strategy_key='move-existing-charset-to-head-start',
        )
        self.assertEqual(record.attempt_count, 1)
        self.assertEqual(record.status, RepairKnowledgeStatus.REJECTED)


class RepeatedFixtureLearningTests(TestCase):
    """Spec section 19 — reset the identical fixture and run AI Fix Issues
    twice. Both runs must reach the same final correctness; the recipe
    system makes RUN 2 strictly no-worse in AI usage (both runs already
    skip the AI entirely for these three rule_ids via the recipe fast
    path — the interesting claim is that Verified Repair Memory rows
    accumulate additional confirmed successes rather than starting over)."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('repeat_user')

    def _run(self):
        provider = RecordingNullProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': _THREE_WARNINGS_HTML, 'css': _THREE_WARNINGS_CSS, 'js': _THREE_WARNINGS_JS, 'ampscript': ''},
                css_source_type='css', validation_scope='complete', profile='standard',
                rate_limit_identifier='u',
            )
        return result, provider

    def test_run_two_against_the_identical_reset_fixture_matches_or_beats_run_one(self):
        result_1, provider_1 = self._run()
        final_rule_ids_1 = {issue.rule_id for issue in result_1.report.issues.all()}

        # Reset EXACTLY — same fixture, fresh run, same user (memory persists
        # per-application, not per-operation). Clearing the cache here
        # simulates "a later, separate operation" rather than an
        # immediate identical re-click — the Low-Latency Performance
        # Optimization sprint's short-TTL no-op fast path (spec section
        # 36/37) deliberately short-circuits the LATTER (same source,
        # same user, within the TTL window) without spending a fresh AI
        # request, which is a different, narrower case than what this
        # test is proving (repair-memory accumulating across genuinely
        # separate operations).
        cache.clear()
        result_2, provider_2 = self._run()
        final_rule_ids_2 = {issue.rule_id for issue in result_2.report.issues.all()}

        self.assertEqual(final_rule_ids_1, final_rule_ids_2)
        # The three recipe-covered rule_ids never reach the AI provider on
        # EITHER run — the fixture's other, unrelated findings (this
        # sprint added no recipes for those) legitimately still use AI,
        # equally on both runs, since Verified Repair Memory here only
        # covers the three targeted rules.
        for rule_id in (
            'charset-declared-late', 'stylelint:font-family-no-missing-generic-family-keyword',
            'mdaiw-lp/missing-selector-target',
        ):
            self.assertNotIn(rule_id, provider_1.seen_rule_ids)
            self.assertNotIn(rule_id, provider_2.seen_rule_ids)
        self.assertLessEqual(provider_2.calls, provider_1.calls)

        for strategy_key in (
            'move-existing-charset-to-head-start', 'append-known-generic-family',
            'rename-selector-to-existing-equivalent-id',
        ):
            record = RepairKnowledgeRecord.objects.get(strategy_key=strategy_key, status=RepairKnowledgeStatus.VERIFIED)
            # Two independent runs against the same context -> at least
            # two accumulated successes on the same ledger row.
            self.assertGreaterEqual(record.success_count, 2)


# Closure spec section 14/15/17 — the fuller fixture: charset, generic
# font-family, a simple standalone selector mismatch, unsafe innerHTML
# plain dynamic text (standalone), unsafe innerHTML clear (EMBEDDED
# <script>), all inside one Complete LP source.
_SIX_CASE_HTML = (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    '<meta name="description" content="A landing page.">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta charset="UTF-8">\n<title>Sign in</title>\n</head>\n'
    '<body>\n<input type="text" id="userName">\n<p>hi</p>\n'
    '<script>\nfunction resetPanel() {\n  panel.innerHTML = "";\n}\n</script>\n'
    '</body>\n</html>\n'
)
_SIX_CASE_CSS = 'body {\n  font-family: Arial;\n  color: #333;\n}\n'
_SIX_CASE_JS = (
    'const el = document.getElementById("username");\n'
    'console.log(el);\n'
    'function greet(name) {\n  result.innerHTML = name;\n}\n'
)


class RepeatedFixtureLearningWithSecureJsTests(TestCase):
    """Closure spec section 14 — the SAME repeated-fixture comparison,
    extended to cover the secure-DOM recipes (standalone innerHTML plain-
    text, embedded innerHTML clear) alongside the three original
    recipes, all inside one Complete LP fixture."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('repeat_secure_js_user')

    def _run(self):
        provider = RecordingNullProvider()
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': _SIX_CASE_HTML, 'css': _SIX_CASE_CSS, 'js': _SIX_CASE_JS, 'ampscript': ''},
                css_source_type='css', validation_scope='complete', profile='standard',
                rate_limit_identifier='u',
            )
        return result, provider

    def test_run_two_matches_or_beats_run_one_across_all_six_recipe_covered_findings(self):
        result_1, provider_1 = self._run()
        final_rule_ids_1 = {issue.rule_id for issue in result_1.report.issues.all()}
        # See the identical comment in RepeatedFixtureLearningTests above
        # — clearing here simulates a later, separate operation rather
        # than the immediate-identical-retry case the new short-TTL
        # no-op fast path (spec section 36/37) deliberately short-
        # circuits.
        cache.clear()
        result_2, provider_2 = self._run()
        final_rule_ids_2 = {issue.rule_id for issue in result_2.report.issues.all()}

        self.assertEqual(final_rule_ids_1, final_rule_ids_2)

        covered_rule_ids = (
            'charset-declared-late', 'stylelint:font-family-no-missing-generic-family-keyword',
            'mdaiw-lp/missing-selector-target', 'mdaiw-security/innerhtml-assignment',
        )
        for rule_id in covered_rule_ids:
            self.assertNotIn(rule_id, provider_1.seen_rule_ids)
            self.assertNotIn(rule_id, provider_2.seen_rule_ids)
        self.assertLessEqual(provider_2.calls, provider_1.calls)

        covered_strategy_keys = (
            'move-existing-charset-to-head-start', 'append-known-generic-family',
            'rename-selector-to-existing-equivalent-id', 'innerhtml-clear-to-replacechildren',
            'innerhtml-dynamic-text-to-textcontent',
        )
        for strategy_key in covered_strategy_keys:
            record = RepairKnowledgeRecord.objects.get(strategy_key=strategy_key, status=RepairKnowledgeStatus.VERIFIED)
            self.assertGreaterEqual(record.success_count, 2)

        # Neither run left a dangerous sink where a recipe claimed success.
        for final_sources in (result_1.final_sources, result_2.final_sources):
            self.assertNotIn('innerHTML', final_sources['js'])
            self.assertNotIn('innerHTML', final_sources['html'])

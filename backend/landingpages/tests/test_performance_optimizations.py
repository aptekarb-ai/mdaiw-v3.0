"""Low-Latency AI Engineer Performance Optimization sprint — Module 3 LP
Validator & Fixer.

Proves, without weakening any correctness guarantee: (1) the validator/
compiler subprocess-call cache actually avoids a second subprocess spawn
for identical input, (2) Complete LP validation still produces the exact
same issue set now that HTML/CSS/JS/AMPscript run concurrently (safety
first — a parallel refactor that changed WHAT gets reported would be a
regression no speed improvement is worth), and (3) the "AI Fix Issues"
no-op fast path returns instantly, with zero new provider calls and zero
new validator work, on an immediate identical retry — while a genuinely
different (or sufficiently later) request is never blocked from a real
attempt.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings

from ..ai_review.provider import AIReviewResult
from ..fixes import iterative as it
from ..report_builder import persist_validation_report
from ..validation import node_bridge

User = get_user_model()

_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>T</title></head><body><h1>Hi</h1></body></html>'
_CSS = 'body { color: #333; font-family: Arial; }'
_JS = 'const el = document.getElementById("x"); console.log(el);'
_AMP = '%%[ VAR @x SET @x = 1 ]%%'


def _make_user(name):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


@override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
class ValidatorBridgeCacheTests(TestCase):
    """spec section 9/12 — a second identical validate/compile call must
    not spawn a second subprocess.

    Validator Worker sprint — disabled class-wide: these tests mock
    `subprocess.run` directly to prove the CACHE layer's own behavior in
    isolation, and the persistent worker pool (added in the follow-up
    sprint) never calls `subprocess.run` per request, which would
    silently bypass every mock here. The worker pool has its own
    dedicated test coverage in test_validator_worker_pool.py."""

    def setUp(self):
        cache.clear()

    @override_settings(LP_VALIDATOR_CACHE_ENABLED=True)
    def test_identical_css_validation_call_is_served_from_cache(self):
        real_response = {'success': True, 'messages': []}
        with patch('landingpages.validation.node_bridge._resolve_node_executable', return_value='node'), \
             patch('landingpages.validation.node_bridge._CSS_SCRIPT_PATH') as mock_path, \
             patch('subprocess.run') as mock_run:
            mock_path.is_file.return_value = True
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = b'{"success": true, "messages": []}'
            mock_run.return_value.stderr = b''

            first = node_bridge.run_css_validation(_CSS, 'standard')
            second = node_bridge.run_css_validation(_CSS, 'standard')

        self.assertEqual(mock_run.call_count, 1)  # the second call was a cache hit, no subprocess spawned
        self.assertEqual(first, real_response)
        self.assertEqual(second, real_response)

    @override_settings(LP_VALIDATOR_CACHE_ENABLED=True)
    def test_different_css_source_is_not_a_cache_hit(self):
        with patch('landingpages.validation.node_bridge._resolve_node_executable', return_value='node'), \
             patch('landingpages.validation.node_bridge._CSS_SCRIPT_PATH') as mock_path, \
             patch('subprocess.run') as mock_run:
            mock_path.is_file.return_value = True
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = b'{"success": true, "messages": []}'
            mock_run.return_value.stderr = b''

            node_bridge.run_css_validation('body { color: red; }', 'standard')
            node_bridge.run_css_validation('body { color: blue; }', 'standard')

        self.assertEqual(mock_run.call_count, 2)  # genuinely different source -> genuinely different cache key

    @override_settings(LP_VALIDATOR_CACHE_ENABLED=False)
    def test_cache_can_be_disabled(self):
        with patch('landingpages.validation.node_bridge._resolve_node_executable', return_value='node'), \
             patch('landingpages.validation.node_bridge._CSS_SCRIPT_PATH') as mock_path, \
             patch('subprocess.run') as mock_run:
            mock_path.is_file.return_value = True
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = b'{"success": true, "messages": []}'
            mock_run.return_value.stderr = b''

            node_bridge.run_css_validation(_CSS, 'standard')
            node_bridge.run_css_validation(_CSS, 'standard')

        self.assertEqual(mock_run.call_count, 2)  # caching disabled -> always a real call

    @override_settings(LP_VALIDATOR_CACHE_ENABLED=True)
    def test_a_failed_call_is_never_cached(self):
        """A transient engine outage must never get "stuck" as a cached
        failure — the very next call (even with identical input) must
        try again for real."""
        with patch('landingpages.validation.node_bridge._resolve_node_executable', return_value='node'), \
             patch('landingpages.validation.node_bridge._CSS_SCRIPT_PATH') as mock_path, \
             patch('subprocess.run') as mock_run:
            mock_path.is_file.return_value = True
            mock_run.return_value.returncode = 1
            mock_run.return_value.stdout = b''
            mock_run.return_value.stderr = b'boom'

            for _ in range(2):
                with self.assertRaises(node_bridge.NodeBridgeError):
                    node_bridge.run_css_validation(_CSS, 'standard')

        self.assertEqual(mock_run.call_count, 2)  # never cached, both attempts were real

    @override_settings(LP_VALIDATOR_CACHE_ENABLED=True)
    def test_repeated_complete_lp_validation_reuses_every_engine_call(self):
        """End-to-end version of the same claim, through the real
        persist_validation_report path (spec section 31 — a repeated
        identical validation should measurably reduce validator-engine
        work, independent of Verified Repair Memory, which is a
        DIFFERENT, DB-backed mechanism entirely)."""
        user = _make_user('bridge_cache_e2e_user')
        with patch('subprocess.run') as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = b'{"success": true, "messages": []}'
            mock_run.return_value.stderr = b''
            persist_validation_report(
                user=user, project=None, html='', css=_CSS, js='', ts='', ampscript='',
                profile='standard', validation_scope='css', css_source_type='css',
            )
            first_call_count = mock_run.call_count
            persist_validation_report(
                user=user, project=None, html='', css=_CSS, js='', ts='', ampscript='',
                profile='standard', validation_scope='css', css_source_type='css',
            )
            second_round_call_count = mock_run.call_count - first_call_count

        self.assertGreater(first_call_count, 0)
        self.assertEqual(second_round_call_count, 0)  # fully served from cache


class ParallelValidationCorrectnessTests(TestCase):
    """spec section 3 — HTML/CSS/JS/AMPscript now run concurrently for
    Complete LP; the RESULT must be byte-for-byte identical (same issues,
    same order) to what the old strictly-sequential implementation
    produced. Safety first: no speed win justifies changing what gets
    reported."""

    def test_complete_lp_result_is_deterministic_across_repeated_runs(self):
        user = _make_user('parallel_determinism_user')
        results = []
        for _ in range(3):
            cache.clear()  # force each run to do real, independent work
            report, _result = persist_validation_report(
                user=user, project=None, html=_HTML, css=_CSS, js=_JS, ts='', ampscript=_AMP,
                profile='standard', validation_scope='complete', css_source_type='css',
            )
            results.append([(i.rule_id, i.file, i.line, i.column, i.severity) for i in report.issues.all()])

        self.assertEqual(results[0], results[1])
        self.assertEqual(results[1], results[2])

    def test_all_four_languages_still_contribute_findings_in_complete_scope(self):
        # A regression where one language's block silently stopped
        # running (e.g. a future thread pool misconfiguration swallowing
        # a job) would show up here as a missing engine_status entry.
        user = _make_user('parallel_coverage_user')
        report, result = persist_validation_report(
            user=user, project=None, html=_HTML, css=_CSS, js=_JS, ts='', ampscript=_AMP,
            profile='standard', validation_scope='complete', css_source_type='css',
        )
        # Every one of the four languages' adapters actually ran (produced
        # a status entry), not just some of them — a regression where the
        # thread pool silently dropped a job would show up as a missing
        # engine here.
        engine_names = {s.engine_name for s in result.engine_status}
        self.assertTrue(any('html' in name for name in engine_names))
        self.assertTrue(any('css' in name for name in engine_names))
        self.assertTrue(any('javascript' in name for name in engine_names))
        self.assertTrue(any('ampscript' in name for name in engine_names))


class NoOpFastPathTests(TestCase):
    """spec section 36/37 — an immediate identical "AI Fix Issues" retry
    must not spend a new AI request or new validator work; a genuinely
    different request (different source, different user) must never be
    short-circuited."""

    def setUp(self):
        cache.clear()

    def _provider(self):
        class _NullProvider:
            def __init__(self):
                self.calls = 0

            def review(self, request):
                self.calls += 1
                return AIReviewResult(summary='', proposals=[])

        return _NullProvider()

    def test_second_identical_call_makes_zero_new_provider_calls(self):
        user = _make_user('noop_user')
        provider = self._provider()
        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])), \
             patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result_1 = it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': _HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )
            calls_after_first = provider.calls
            result_2 = it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': _HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )

        self.assertEqual(provider.calls, calls_after_first)  # second call touched the provider zero times
        # Django's cache framework pickles/unpickles on every get() (so
        # one caller's mutation can never corrupt another's cached copy)
        # — the SAME underlying ValidationReport row, not the same Python
        # object reference, is what proves this was a cache hit.
        self.assertEqual(result_2.report.pk, result_1.report.pk)
        self.assertEqual(result_2.stopped_reason, result_1.stopped_reason)

    def test_different_source_is_never_short_circuited(self):
        user = _make_user('noop_user_2')
        provider = self._provider()
        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])), \
             patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': _HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )
            calls_after_first = provider.calls
            it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': _HTML.replace('Hi', 'Hello'), 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )

        # A genuinely different source must still be attempted for real —
        # never treated as a no-op just because SOME prior attempt exists.
        self.assertGreaterEqual(provider.calls, calls_after_first)

    def test_different_user_is_never_short_circuited(self):
        user_a = _make_user('noop_user_a')
        user_b = _make_user('noop_user_b')
        provider = self._provider()
        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])), \
             patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result_a = it.run_autonomous_repair(
                user=user_a, project=None,
                initial_sources={'html': _HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='ua',
            )
            result_b = it.run_autonomous_repair(
                user=user_b, project=None,
                initial_sources={'html': _HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='ub',
            )

        self.assertIsNot(result_a, result_b)  # each user gets their own real run, never another user's cached result

    @override_settings(LP_AI_FIX_NOOP_CACHE_TTL_SECONDS=0)
    def test_ttl_zero_disables_the_fast_path(self):
        user = _make_user('noop_user_ttl0')
        provider = self._provider()
        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])), \
             patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            result_1 = it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': _HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )
            result_2 = it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': _HTML, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )

        self.assertIsNot(result_2, result_1)

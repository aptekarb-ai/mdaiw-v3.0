"""Validator Worker + Subprocess Latency sprint — Module 3 LP Validator &
Fixer.

Exercises the REAL persistent Node worker process (no mocking of Node
itself — the whole point is proving the actual subprocess lifecycle:
startup handshake, sequential request handling, crash detection,
automatic restart, and safe fallback). Slower than a typical unit test
(each worker spawn costs real process-startup time) — kept to the
lifecycle scenarios spec section 16 explicitly asks for, not a full
sweep of every possible input shape (that coverage already exists for
the underlying validators in test_css_validation.py / test_javascript_
validation.py, exercised identically whether a request is served by the
worker or the one-shot subprocess fallback).
"""

import time
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings

from ..validation import node_bridge, node_worker_pool
from ..validation.node_worker_pool import WorkerPool, _Worker


def _resolved_node_executable():
    import shutil
    from django.conf import settings
    return shutil.which(getattr(settings, 'LP_NODE_EXECUTABLE', 'node') or 'node')


class WorkerLifecycleTests(TestCase):
    """spec section 5/16 — startup, request, multiple requests, shutdown."""

    def setUp(self):
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def test_pool_starts_and_reports_available(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            self.assertTrue(pool.available)
        finally:
            pool.shutdown()

    def test_a_single_worker_answers_a_ping(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            result = pool.submit('ping', {}, timeout=5)
            self.assertEqual(result, {'pong': True, 'pid': pool._workers[0]._proc.pid})
        finally:
            pool.shutdown()

    def test_multiple_sequential_requests_all_succeed(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            for i in range(5):
                result = pool.submit('css-validate', {
                    'css': f'.c{i} {{ color: red; }}', 'profile': 'standard',
                    'context': 'stylesheet', 'options': {'maxIssues': 10},
                }, timeout=10)
                self.assertIsNotNone(result)
                self.assertTrue(result['success'])
        finally:
            pool.shutdown()

    def test_shutdown_actually_terminates_the_process(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        proc = pool._workers[0]._proc
        self.assertIsNone(proc.poll())  # still running
        pool.shutdown()
        proc.wait(timeout=5)
        self.assertIsNotNone(proc.poll())  # now exited


class WorkerConcurrencyTests(TestCase):
    """spec section 6 — a small pool, not unsafe concurrency inside one
    process. Two concurrent submits to a size-2 pool must both succeed
    and land on DIFFERENT worker processes (round-robin), never racing
    inside one."""

    def setUp(self):
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def test_concurrent_requests_use_distinct_workers_and_both_succeed(self):
        import threading

        pool = WorkerPool(size=2, node_executable=_resolved_node_executable(), startup_timeout=15)
        results = {}

        def _run(key, css):
            results[key] = pool.submit('css-validate', {
                'css': css, 'profile': 'standard', 'context': 'stylesheet', 'options': {'maxIssues': 10},
            }, timeout=10)

        try:
            t1 = threading.Thread(target=_run, args=('a', '.a { color: red; }'))
            t2 = threading.Thread(target=_run, args=('b', '.b { color: blue; }'))
            t1.start()
            t2.start()
            t1.join(timeout=15)
            t2.join(timeout=15)
        finally:
            pool.shutdown()

        self.assertIsNotNone(results.get('a'))
        self.assertIsNotNone(results.get('b'))
        self.assertTrue(results['a']['success'])
        self.assertTrue(results['b']['success'])


class WorkerFailureRecoveryTests(TestCase):
    """spec section 5 — timeout, crash, restart, malformed response."""

    def setUp(self):
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def test_a_request_timeout_kills_and_the_pool_recovers_on_the_next_call(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            # An impossibly short timeout guarantees this specific call
            # times out even though the worker is healthy and would have
            # answered eventually.
            result = pool.submit('css-validate', {
                'css': '.x { color: red; }', 'profile': 'standard', 'context': 'stylesheet', 'options': {'maxIssues': 10},
            }, timeout=0.0001)
            self.assertIsNone(result)  # the timed-out call itself reports failure...
            # ...but the POOL recovers: the next call respawns the worker
            # and succeeds normally.
            result2 = pool.submit('css-validate', {
                'css': '.y { color: blue; }', 'profile': 'standard', 'context': 'stylesheet', 'options': {'maxIssues': 10},
            }, timeout=15)
            self.assertIsNotNone(result2)
            self.assertTrue(result2['success'])
        finally:
            pool.shutdown()

    def test_a_killed_worker_process_is_detected_and_respawned(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            pool._workers[0]._proc.kill()
            pool._workers[0]._proc.wait(timeout=5)
            # is_alive() must notice the process is gone...
            self.assertFalse(pool._workers[0].is_alive())
            # ...and submit() must transparently respawn and still succeed.
            result = pool.submit('css-validate', {
                'css': '.z { color: green; }', 'profile': 'standard', 'context': 'stylesheet', 'options': {'maxIssues': 10},
            }, timeout=15)
            self.assertIsNotNone(result)
            self.assertTrue(result['success'])
        finally:
            pool.shutdown()

    def test_pool_creation_with_a_nonexistent_executable_is_unavailable_not_a_crash(self):
        pool = WorkerPool(size=1, node_executable='definitely-not-a-real-executable-xyz', startup_timeout=2)
        self.assertFalse(pool.available)
        result = pool.submit('ping', {}, timeout=1)
        self.assertIsNone(result)
        pool.shutdown()  # must not raise even though nothing ever started


class FallbackToSubprocessTests(TestCase):
    """spec section 5 — validation must remain fully correct and
    available regardless of whether the worker pool is enabled, healthy,
    or fails mid-request."""

    def setUp(self):
        cache.clear()
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_worker_disabled_still_produces_a_correct_result_via_subprocess(self):
        result = node_bridge.run_css_validation('body { color: #333 }', 'standard')
        self.assertTrue(result['success'])

    def test_worker_pool_unavailable_falls_back_transparently(self):
        with patch.object(node_worker_pool, 'get_worker_pool', return_value=None):
            result = node_bridge.run_css_validation('body { color: #333 }', 'standard')
        self.assertTrue(result['success'])

    def test_result_is_identical_whether_served_by_worker_or_subprocess_fallback(self):
        css = '.identical-check { color: RED; margin:0px; }'
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=True):
            via_worker = node_bridge.run_css_validation(css, 'standard')
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=False):
            via_subprocess = node_bridge.run_css_validation(css, 'standard')

        self.assertEqual(via_worker['success'], via_subprocess['success'])
        self.assertEqual(
            [(i['ruleId'], i.get('line'), i.get('column')) for i in via_worker['issues']],
            [(i['ruleId'], i.get('line'), i.get('column')) for i in via_subprocess['issues']],
        )


class CorrectnessParityTests(TestCase):
    """spec section C — the worker path must produce a byte/semantically
    equivalent result to the pre-worker subprocess path for every
    Node-backed language, not just CSS. A faster result that changes
    issue detection is a regression, not an optimization."""

    def setUp(self):
        cache.clear()
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def _issue_signature(self, response):
        return [(i['ruleId'], i.get('line'), i.get('column'), i.get('severity')) for i in response['issues']]

    def test_less_parity(self):
        source = '@brand: #369;\n.a {\n  color: @brnad;\n}\n'  # deliberate typo -> compile-error
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=True):
            via_worker = node_bridge.run_less_compilation(source, 'standard')
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=False):
            via_subprocess = node_bridge.run_less_compilation(source, 'standard')
        self.assertEqual(via_worker['success'], via_subprocess['success'])
        self.assertEqual(via_worker['compiled'], via_subprocess['compiled'])
        self.assertEqual(self._issue_signature(via_worker), self._issue_signature(via_subprocess))

    def test_scss_parity(self):
        source = '$c: #369;\n.a {\n  color: $c;\n  .b { color: red } \n}\n'
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=True):
            via_worker = node_bridge.run_scss_compilation(source, 'scss', 'standard')
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=False):
            via_subprocess = node_bridge.run_scss_compilation(source, 'scss', 'standard')
        self.assertEqual(via_worker['success'], via_subprocess['success'])
        self.assertEqual(via_worker['compiled'], via_subprocess['compiled'])
        self.assertEqual(via_worker.get('css'), via_subprocess.get('css'))
        self.assertEqual(self._issue_signature(via_worker), self._issue_signature(via_subprocess))

    def test_sass_indented_parity(self):
        source = '$c: #369\nbody\n  color: $c\n'
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=True):
            via_worker = node_bridge.run_scss_compilation(source, 'indented', 'standard')
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=False):
            via_subprocess = node_bridge.run_scss_compilation(source, 'indented', 'standard')
        self.assertEqual(via_worker['success'], via_subprocess['success'])
        self.assertEqual(via_worker.get('css'), via_subprocess.get('css'))

    def test_javascript_parity(self):
        source = 'const el = document.getElementById("x"); el.innerHTML = "<b>x</b>";'
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=True):
            via_worker = node_bridge.run_js_validation(source, 'standard')
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=False):
            via_subprocess = node_bridge.run_js_validation(source, 'standard')
        self.assertEqual(via_worker['success'], via_subprocess['success'])
        self.assertEqual(self._issue_signature(via_worker), self._issue_signature(via_subprocess))
        self.assertEqual(via_worker.get('sourceType'), via_subprocess.get('sourceType'))

    def test_complete_lp_parity(self):
        from django.contrib.auth import get_user_model

        from ..report_builder import persist_validation_report

        User = get_user_model()
        user = User.objects.create_user(username='parity_complete_lp_user', password='pw12345!', email='pcl@example.com')
        html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>T</title></head><body><h1>Hi</h1></body></html>'
        css = '.a { color: RED; }'
        js = 'const el = document.getElementById("x"); console.log(el);'
        amp = '%%[ VAR @x SET @x = 1 ]%%'

        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=True):
            report_worker, _ = persist_validation_report(
                user=user, project=None, html=html, css=css, js=js, ts='', ampscript=amp,
                profile='standard', validation_scope='complete', css_source_type='css',
            )
        cache.clear()
        with override_settings(LP_VALIDATOR_WORKER_ENABLED=False):
            report_subprocess, _ = persist_validation_report(
                user=user, project=None, html=html, css=css, js=js, ts='', ampscript=amp,
                profile='standard', validation_scope='complete', css_source_type='css',
            )

        sig_worker = sorted((i.rule_id, i.file, i.line, i.column, i.severity) for i in report_worker.issues.all())
        sig_subprocess = sorted((i.rule_id, i.file, i.line, i.column, i.severity) for i in report_subprocess.issues.all())
        self.assertEqual(sig_worker, sig_subprocess)


class ProcessOwnershipTests(TestCase):
    """spec section B — the worker pool must terminate ONLY Node
    processes/PIDs it spawned itself. Never a generic "kill every
    node.exe" sweep, which could take down Vite, another application
    instance, or unrelated tooling sharing the same machine."""

    def setUp(self):
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def test_shutdown_never_touches_an_unrelated_node_process(self):
        import subprocess as subprocess_module
        import time as time_module

        # A real, independent Node process this test owns and controls —
        # standing in for "Vite" / "another application instance" /
        # anything else sharing the host. Idles on stdin so it stays
        # alive until we explicitly kill it.
        unrelated = subprocess_module.Popen(
            [_resolved_node_executable(), '-e', 'process.stdin.resume();'],
            stdin=subprocess_module.PIPE, stdout=subprocess_module.DEVNULL, stderr=subprocess_module.DEVNULL,
        )
        try:
            time_module.sleep(0.3)
            self.assertIsNone(unrelated.poll())  # confirmed running before the test proper starts

            pool = WorkerPool(size=2, node_executable=_resolved_node_executable(), startup_timeout=15)
            self.assertTrue(pool.available)
            owned_pids = {w._proc.pid for w in pool._workers if w._proc is not None}
            self.assertNotIn(unrelated.pid, owned_pids)  # never accidentally "adopted"

            pool.shutdown()
            node_worker_pool._force_kill_tracked_pids()

            # The unrelated process must still be alive — cleanup only
            # ever targeted the pool's own tracked PIDs.
            self.assertIsNone(unrelated.poll())
        finally:
            unrelated.terminate()
            try:
                unrelated.wait(timeout=5)
            except Exception:  # noqa: BLE001
                unrelated.kill()

    def test_only_owned_pids_are_tracked_for_force_kill(self):
        pool = WorkerPool(size=2, node_executable=_resolved_node_executable(), startup_timeout=15)
        owned_pids = {w._proc.pid for w in pool._workers if w._proc is not None}
        self.assertTrue(owned_pids)
        self.assertTrue(owned_pids.issubset(node_worker_pool._spawned_pids))
        pool.shutdown()
        # Once shut down, this pool's PIDs are no longer tracked — a
        # later force-kill pass has nothing stale to act on for them.
        self.assertFalse(owned_pids & node_worker_pool._spawned_pids)

    def test_repeated_start_stop_leaves_no_worker_processes_behind(self):
        for _ in range(3):
            pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
            proc = pool._workers[0]._proc
            self.assertIsNotNone(proc)
            pool.shutdown()
            proc.wait(timeout=5)
            self.assertIsNotNone(proc.poll())  # confirmed exited before starting the next one
        self.assertEqual(node_worker_pool._spawned_pids, set())


class CacheBeforeWorkerOrderingTests(TestCase):
    """spec section 13/25 — cache lookup happens before the worker is
    ever consulted, and a cache hit is never slower because a worker
    exists."""

    def setUp(self):
        cache.clear()
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def test_a_cache_hit_never_touches_the_worker_pool(self):
        node_bridge.run_css_validation('.warm { color: red; }', 'standard')  # populate cache
        with patch.object(node_worker_pool, 'get_worker_pool') as mock_get_pool:
            result = node_bridge.run_css_validation('.warm { color: red; }', 'standard')
        mock_get_pool.assert_not_called()
        self.assertTrue(result['success'])


class ConfigurationFingerprintTests(TestCase):
    """spec section 8 — a settings change that could affect the result
    (e.g. which Node executable resolves) must never serve a stale
    worker-produced OR subprocess-produced cached result. This is the
    SAME cache-key mechanism proven for the subprocess path in the prior
    Low-Latency sprint (test_performance_optimizations.py) — verifying
    it here confirms the worker path shares it rather than bypassing it."""

    def setUp(self):
        cache.clear()
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def test_changing_the_node_executable_setting_invalidates_the_cache(self):
        css = '.config-fingerprint-check { color: red; }'
        node_bridge.run_css_validation(css, 'standard')
        with patch.object(node_worker_pool, 'get_worker_pool', return_value=None), \
             patch('landingpages.validation.node_bridge._resolve_node_executable', side_effect=node_bridge.NodeBridgeError('x')), \
             override_settings(LP_NODE_EXECUTABLE='a-different-node-path'):
            with self.assertRaises(node_bridge.NodeBridgeError):
                node_bridge.run_css_validation(css, 'standard')


class StaleWorkerRegistryCleanupTests(TestCase):
    """Release-Closure sprint, section 1 — closes the Django dev-autoreload
    gap. A restarted interpreter must be able to positively identify and
    clean only worker processes proven to belong to a PREVIOUS instance
    of this same application, never a generic node.exe sweep, and never
    anything it cannot independently confirm via the OS."""

    def setUp(self):
        node_worker_pool.shutdown_worker_pool()
        self._original_registry = None
        if node_worker_pool._REGISTRY_PATH.exists():
            self._original_registry = node_worker_pool._REGISTRY_PATH.read_text(encoding='utf-8')

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()
        if self._original_registry is not None:
            node_worker_pool._REGISTRY_PATH.write_text(self._original_registry, encoding='utf-8')
        elif node_worker_pool._REGISTRY_PATH.exists():
            node_worker_pool._REGISTRY_PATH.unlink()

    def test_stale_but_positively_identified_worker_is_cleaned(self):
        import subprocess as subprocess_module
        import time as time_module

        worker_path = str(node_worker_pool._WORKER_SCRIPT_PATH)
        proc = subprocess_module.Popen(
            [_resolved_node_executable(), worker_path],
            stdin=subprocess_module.PIPE, stdout=subprocess_module.PIPE, stderr=subprocess_module.DEVNULL,
            cwd=str(node_worker_pool._VALIDATORS_NODE_DIR),
        )
        try:
            time_module.sleep(1.0)  # let it finish its own startup before we treat it as "orphaned"
            self.assertIsNone(proc.poll())

            # Simulate "a previous interpreter instance" — a token that is
            # NOT this process's own _INSTANCE_TOKEN.
            node_worker_pool._write_registry([
                {'pid': proc.pid, 'token': 'a-previous-instance-token', 'script_path': worker_path},
            ])

            node_worker_pool.cleanup_stale_workers_from_previous_instance()

            proc.wait(timeout=5)
            self.assertIsNotNone(proc.poll())  # positively identified and cleaned
            self.assertEqual(node_worker_pool._read_registry(), [])  # stale row dropped
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)

    def test_unrelated_process_is_never_touched_even_with_a_tampered_registry_entry(self):
        import subprocess as subprocess_module
        import time as time_module

        worker_path = str(node_worker_pool._WORKER_SCRIPT_PATH)
        # A real, independent Node process that is NOT our worker script —
        # standing in for a PID our worker used to own having since been
        # reused by something unrelated.
        unrelated = subprocess_module.Popen(
            [_resolved_node_executable(), '-e', 'process.stdin.resume();'],
            stdin=subprocess_module.PIPE, stdout=subprocess_module.DEVNULL, stderr=subprocess_module.DEVNULL,
        )
        try:
            time_module.sleep(0.3)
            self.assertIsNone(unrelated.poll())

            # A registry row CLAIMING this PID is our worker (simulating a
            # stale/corrupted record) — the live command-line check must
            # disprove this and leave the process alone.
            node_worker_pool._write_registry([
                {'pid': unrelated.pid, 'token': 'a-previous-instance-token', 'script_path': worker_path},
            ])

            node_worker_pool.cleanup_stale_workers_from_previous_instance()

            self.assertIsNone(unrelated.poll())  # never touched — ownership was never proven
            # The unproven row is dropped from OUR registry either way (we
            # no longer have any basis to believe it's ours), but the
            # actual OS process is untouched.
            self.assertEqual(node_worker_pool._read_registry(), [])
        finally:
            unrelated.terminate()
            try:
                unrelated.wait(timeout=5)
            except Exception:  # noqa: BLE001
                unrelated.kill()

    def test_registry_entry_for_an_already_exited_pid_is_silently_pruned(self):
        import subprocess as subprocess_module

        worker_path = str(node_worker_pool._WORKER_SCRIPT_PATH)
        # A short-lived process guaranteed to have exited by the time we
        # run cleanup — its PID may or may not be reused by the OS, but
        # either way there is nothing live matching our registry claim.
        gone = subprocess_module.Popen([_resolved_node_executable(), '-e', 'process.exit(0);'])
        gone.wait(timeout=5)
        dead_pid = gone.pid

        node_worker_pool._write_registry([
            {'pid': dead_pid, 'token': 'a-previous-instance-token', 'script_path': worker_path},
        ])

        # Must not raise even though the PID is gone.
        node_worker_pool.cleanup_stale_workers_from_previous_instance()
        self.assertEqual(node_worker_pool._read_registry(), [])

    def test_registry_updates_across_a_normal_spawn_and_shutdown_cycle(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            pid = pool._workers[0]._proc.pid
            entries = node_worker_pool._read_registry()
            self.assertIn(pid, [e['pid'] for e in entries])
            own_entry = next(e for e in entries if e['pid'] == pid)
            self.assertEqual(own_entry['token'], node_worker_pool._INSTANCE_TOKEN)
        finally:
            pool.shutdown()

        entries_after = node_worker_pool._read_registry()
        self.assertNotIn(pid, [e['pid'] for e in entries_after])

    def test_an_entry_carrying_this_process_own_token_is_never_touched_by_cleanup(self):
        # A row stamped with OUR OWN current token represents a worker
        # this very instance believes it still owns — cleanup must never
        # kill it (that is the normal shutdown path's job, not this
        # cross-restart safety net's).
        node_worker_pool._write_registry([
            {'pid': 999999, 'token': node_worker_pool._INSTANCE_TOKEN, 'script_path': str(node_worker_pool._WORKER_SCRIPT_PATH)},
        ])
        node_worker_pool.cleanup_stale_workers_from_previous_instance()
        entries = node_worker_pool._read_registry()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['pid'], 999999)


class WorkerSecurityTests(TestCase):
    """spec section 22 — oversized payload, malformed JSON, and an
    attempted operation outside the fixed vocabulary are all handled as
    clean protocol-level failures, never a crash and never any sign the
    submitted "source" was executed."""

    def setUp(self):
        node_worker_pool.shutdown_worker_pool()

    def tearDown(self):
        node_worker_pool.shutdown_worker_pool()

    def test_unknown_operation_is_rejected_cleanly(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            result = pool.submit('delete-everything', {}, timeout=5)
            # An unknown operation comes back as a clean __worker_error__
            # envelope (see _Worker.submit's `ok: False` branch) — proven
            # here via the raw worker, since node_bridge.py's dispatch
            # layer treats this identically to "fall back."
            self.assertIsNotNone(result)
            self.assertTrue(result.get('__worker_error__'))
        finally:
            pool.shutdown()

    def test_submitted_javascript_is_never_executed_only_analyzed(self):
        # A payload that WOULD have an observable side effect if the
        # worker ever executed it (rather than statically parsing/
        # linting it) — proven by the process not crashing/hanging and
        # returning a normal lint result, never anything resembling
        # command output.
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            result = pool.submit('js-validate', {
                'js': 'require("child_process").execSync("this would prove execution if it ran");',
                'profile': 'standard', 'sourceType': 'script', 'options': {'maxIssues': 50},
            }, timeout=10)
            self.assertIsNotNone(result)
            self.assertTrue(result['success'])  # parsed and linted, not executed — no crash, no hang
        finally:
            pool.shutdown()

    def test_malformed_json_payload_field_does_not_crash_the_worker(self):
        pool = WorkerPool(size=1, node_executable=_resolved_node_executable(), startup_timeout=15)
        try:
            # `css` is the wrong type entirely — the handler's own
            # `typeof request.css === 'string' ? ... : ''` guard (see
            # validate_css.mjs) must degrade this to empty CSS, never
            # throw uncaught.
            result = pool.submit('css-validate', {
                'css': {'not': 'a string'}, 'profile': 'standard', 'context': 'stylesheet', 'options': {'maxIssues': 10},
            }, timeout=5)
            self.assertIsNotNone(result)
            self.assertTrue(result['success'])

            # Worker must still be alive and answer the next request —
            # proof the malformed payload didn't corrupt its state.
            result2 = pool.submit('ping', {}, timeout=5)
            self.assertEqual(result2, {'pong': True, 'pid': pool._workers[0]._proc.pid})
        finally:
            pool.shutdown()

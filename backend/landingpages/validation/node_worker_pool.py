"""Validator Worker + Subprocess Latency sprint — a small pool of
long-lived Node worker processes (validators_node/worker_server.mjs)
that keep ESLint/Stylelint/PostCSS/Dart-Sass/Less loaded in memory
across many requests, avoiding the module-load cost every one-shot
`subprocess.run(['node', script])` call in node_bridge.py otherwise pays
on every single request (profiled at ~85-95% of total wall-clock — see
this sprint's final report).

Each worker is a SEPARATE OS process handling ONE request at a time,
strictly sequentially (never concurrently within one process) — ESLint
and Stylelint are not documented as safe for genuinely overlapping calls
sharing their internal module-level caches, and this project does not
guess about that (spec section 6). A small POOL of such workers is how
this module gets real concurrency (e.g. Complete LP's CSS and JS jobs,
already running on separate Python threads since the prior Low-Latency
sprint, can now also run on two DIFFERENT worker processes at once)
without ever letting two requests race inside the same Node process.

This module owns ONLY the worker processes themselves — it receives a
plain (operation, payload) request and returns a plain result dict, never
a Django model, never `project`, never anything DB-shaped (spec section
12 — the prior parallel-validation sprint found a real Django DB-
visibility bug from moving DB-touching work off the main thread; a
process boundary makes that mistake structurally impossible to repeat
here, since a subprocess has no Django ORM connection to begin with).

FALLBACK IS ALWAYS SAFE: `submit()` returns `None` for ANY failure — pool
unavailable, worker crashed, request timed out, malformed response.
Every caller in node_bridge.py treats `None` as "use the existing
one-shot subprocess path for this one call" and never surfaces a
different error to the user because this optimization didn't apply.
Validation itself can never become unavailable because the worker
pool did (spec section 5).
"""

from __future__ import annotations

import atexit
import json
import logging
import os
import queue
import signal
import subprocess
import threading
import uuid
from pathlib import Path

from django.conf import settings

from .. import perf_metrics

logger = logging.getLogger('landingpages.validation.node_worker_pool')

_VALIDATORS_NODE_DIR = Path(__file__).resolve().parent.parent / 'validators_node'
_WORKER_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'worker_server.mjs'

# spec section 15 — every PID this module has ever spawned, tracked
# independently of the `_Worker`/`WorkerPool` object graph so the
# last-resort OS-level cleanup below (`_force_kill_tracked_pids`) can
# still find and kill them even if that richer object graph is in some
# unexpected state (e.g. late in interpreter shutdown). Removed once a
# worker's normal `_shutdown_locked()` path confirms it's gone.
_spawned_pids: set[int] = set()

# Release-closure sprint — closes the Django dev-autoreload gap: a
# restarted interpreter's OWN atexit/signal handlers (above) only ever
# run IN that interpreter; if it gets replaced abruptly enough that they
# don't get a chance to (a known autoreload/CPython-shutdown-ordering
# risk, not specific to this module), the NEW interpreter has no way to
# know those old PIDs even exist without SOME cross-process record.
# `_REGISTRY_PATH` is that record — a small JSON file, project-local
# (never a system temp dir shared with unrelated software), holding
# {pid, instance_token, script_path} for every worker CURRENTLY believed
# alive. `_INSTANCE_TOKEN` is a fresh random id generated once per
# interpreter — any registry entry carrying a DIFFERENT token is, by
# definition, left over from a previous instance. Positive identification
# never rests on the registry alone: `_pid_command_line_contains_worker`
# below independently asks the OS what that PID's live command line
# actually is, and only a PID whose CURRENT command line still names our
# exact worker_server.mjs path is ever touched — a reused/foreign PID
# with an unrelated command line is left strictly alone, matching "if
# ownership cannot be proven, leave the process alone."
_REGISTRY_PATH = _VALIDATORS_NODE_DIR / '.worker_registry.json'
_INSTANCE_TOKEN = uuid.uuid4().hex
_stale_cleanup_attempted = False


def _minimal_env() -> dict:
    # Identical posture to node_bridge.py's _minimal_env() — no inherited
    # os.environ passthrough, nothing credential-shaped.
    env = {'PATH': os.environ.get('PATH', ''), 'NODE_ENV': 'production'}
    system_root = os.environ.get('SystemRoot')
    if system_root:
        env['SystemRoot'] = system_root
    return env


def _read_registry() -> list:
    """Best-effort read — a missing/corrupt/unwritable registry means
    "nothing known about a previous instance," never an error. Matches
    the "if ownership cannot be proven, leave the process alone" fallback
    posture: no registry means no cross-restart cleanup happens at all."""
    try:
        raw = _REGISTRY_PATH.read_text(encoding='utf-8')
        entries = json.loads(raw)
        if not isinstance(entries, list):
            return []
        return [e for e in entries if isinstance(e, dict) and isinstance(e.get('pid'), int) and isinstance(e.get('token'), str)]
    except (OSError, ValueError, json.JSONDecodeError):
        return []


def _write_registry(entries: list) -> None:
    try:
        _REGISTRY_PATH.write_text(json.dumps(entries, separators=(',', ':')), encoding='utf-8')
    except OSError:
        logger.debug('landingpages.validation.node_worker_pool.registry_write_failed', exc_info=True)


def _registry_add(pid: int) -> None:
    entries = _read_registry()
    entries = [e for e in entries if e.get('pid') != pid]
    entries.append({'pid': pid, 'token': _INSTANCE_TOKEN, 'script_path': str(_WORKER_SCRIPT_PATH)})
    _write_registry(entries)


def _registry_remove(pid: int) -> None:
    entries = _read_registry()
    remaining = [e for e in entries if e.get('pid') != pid]
    if len(remaining) != len(entries):
        _write_registry(remaining)


def _pid_command_line_contains_worker(pid: int) -> bool:
    """Independent OS-level confirmation that a still-running PID's OWN
    live command line still names our exact worker_server.mjs path — the
    registry alone is never trusted as proof (a PID can be reused by an
    unrelated process after the process we registered has exited). Any
    failure to positively confirm (tool missing, timeout, empty/garbled
    output, PID not found) returns False — "cannot be proven" always
    means "leave it alone," never "assume guilty.\""""
    worker_path = str(_WORKER_SCRIPT_PATH)
    try:
        if os.name == 'nt':
            result = subprocess.run(
                ['wmic', 'process', 'where', f'ProcessId={pid}', 'get', 'CommandLine'],
                capture_output=True, timeout=5, shell=False,
            )
            if result.returncode != 0:
                return False
            text = result.stdout.decode('utf-8', errors='replace')
            return worker_path in text
        else:
            cmdline_path = Path(f'/proc/{pid}/cmdline')
            if not cmdline_path.is_file():
                return False
            text = cmdline_path.read_bytes().decode('utf-8', errors='replace')
            return worker_path in text
    except Exception:  # noqa: BLE001 - unverifiable is treated identically to "not ours"
        return False


def cleanup_stale_workers_from_previous_instance() -> None:
    """Closes the Django dev-autoreload gap (Release-Closure sprint,
    section 1): runs ONCE, right before this interpreter's first
    WorkerPool is created, and only ever acts on registry entries that
    are BOTH (a) stamped with a DIFFERENT instance token than this
    process's own — proving they were never something this process is
    itself tracking — and (b) independently confirmed by the OS, right
    now, to still be a live process whose command line names our exact
    worker_server.mjs script. Anything short of both checks is left
    completely alone. Never enumerates node.exe processes in general —
    only ever inspects the small, closed set of PIDs this application's
    own registry already named."""
    entries = _read_registry()
    if not entries:
        return
    kept = []
    for entry in entries:
        pid = entry.get('pid')
        token = entry.get('token')
        if token == _INSTANCE_TOKEN:
            # Ours, from this very instance — never touched here; the
            # normal spawn/shutdown paths own this entry's lifecycle.
            kept.append(entry)
            continue
        if entry.get('script_path') != str(_WORKER_SCRIPT_PATH):
            # Doesn't even claim to be OUR worker script — cannot be
            # positively identified, so it and its registry row are both
            # left as-is rather than guessed about.
            kept.append(entry)
            continue
        if not _pid_command_line_contains_worker(pid):
            # Either the PID is no longer running (nothing to clean — the
            # process is already gone) or it IS running but its live
            # command line no longer proves it's our worker (a foreign
            # process may have reused the PID) — either way, ownership is
            # not proven for a still-running foreign process, so only the
            # stale registry row is dropped; the PID itself is untouched.
            continue
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/PID', str(pid)], capture_output=True, timeout=3, shell=False)
            else:
                os.kill(pid, 9)
            logger.info('landingpages.validation.node_worker_pool.stale_worker_cleaned pid=%s', pid)
        except Exception:  # noqa: BLE001 - best-effort; the process may have exited between the check and the kill
            pass
        # Positively identified and handled — drop the row either way.
    _write_registry(kept)


class _WorkerCrashed(Exception):
    """Internal — signals the calling code to respawn this worker slot."""


class _Worker:
    """One persistent Node process. `_lock` serializes access — a worker
    only ever has ONE request in flight (spec section 6); the pool above
    is what provides real concurrency across MULTIPLE worker instances."""

    def __init__(self, node_executable: str):
        self._node_executable = node_executable
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._line_queue: queue.Queue = queue.Queue()
        self._reader_thread: threading.Thread | None = None
        self.healthy = False

    def start(self, startup_timeout: float) -> bool:
        with self._lock:
            return self._start_locked(startup_timeout)

    def _start_locked(self, startup_timeout: float) -> bool:
        self._shutdown_locked()
        try:
            self._proc = subprocess.Popen(
                [self._node_executable, str(_WORKER_SCRIPT_PATH)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                cwd=str(_VALIDATORS_NODE_DIR), env=_minimal_env(),
                text=True, encoding='utf-8', bufsize=1, shell=False,
            )
            _spawned_pids.add(self._proc.pid)
            _registry_add(self._proc.pid)
        except OSError:
            logger.warning('landingpages.validation.node_worker_pool.spawn_failed', exc_info=True)
            self.healthy = False
            return False

        self._line_queue = queue.Queue()
        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._reader_thread.start()

        try:
            ready_line = self._line_queue.get(timeout=startup_timeout)
        except queue.Empty:
            logger.warning('landingpages.validation.node_worker_pool.startup_timeout')
            self._shutdown_locked()
            self.healthy = False
            return False

        try:
            ready = json.loads(ready_line)
        except (json.JSONDecodeError, TypeError):
            ready = None
        if not isinstance(ready, dict) or not ready.get('ok') or not ready.get('result', {}).get('ready'):
            logger.warning('landingpages.validation.node_worker_pool.startup_handshake_invalid')
            self._shutdown_locked()
            self.healthy = False
            return False

        self.healthy = True
        return True

    def _read_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            for line in proc.stdout:
                line = line.rstrip('\n')
                if line:
                    self._line_queue.put(line)
        except (ValueError, OSError):
            pass  # pipe closed underneath us — the next submit()/is_alive() check will notice

    def is_alive(self) -> bool:
        return self.healthy and self._proc is not None and self._proc.poll() is None

    def submit(self, operation: str, payload: dict, timeout: float) -> dict | None:
        with self._lock:
            if not self.is_alive():
                return None
            request_id = uuid.uuid4().hex
            line = json.dumps({'request_id': request_id, 'operation': operation, 'payload': payload}, separators=(',', ':'))
            try:
                assert self._proc is not None and self._proc.stdin is not None
                self._proc.stdin.write(line + '\n')
                self._proc.stdin.flush()
            except (OSError, ValueError):
                self.healthy = False
                return None

            try:
                response_line = self._line_queue.get(timeout=timeout)
            except queue.Empty:
                logger.warning('landingpages.validation.node_worker_pool.request_timeout operation=%s', operation)
                perf_metrics.record('validator_worker_timeouts')
                self._shutdown_locked()  # do not trust a worker's internal state after a timeout — kill it
                self.healthy = False
                return None

            try:
                envelope = json.loads(response_line)
            except json.JSONDecodeError:
                logger.warning('landingpages.validation.node_worker_pool.malformed_response')
                self._shutdown_locked()
                self.healthy = False
                return None

            if not isinstance(envelope, dict) or envelope.get('request_id') != request_id:
                # Either a structurally wrong response or one that doesn't
                # match what we just asked for — proof of protocol
                # corruption (spec section 5), never trusted as this
                # request's answer.
                logger.warning('landingpages.validation.node_worker_pool.request_id_mismatch')
                self._shutdown_locked()
                self.healthy = False
                return None

            if not envelope.get('ok'):
                # A clean, well-formed per-request failure (e.g. this
                # exact operation's own engine-unavailable/parse-error
                # response) — the worker itself is still healthy and
                # stays in the pool; the CALLER decides whether that
                # failure shape means "fall back" (node_bridge.py already
                # raises NodeBridgeError for the equivalent one-shot
                # failure, so the worker path mirrors it).
                return {'__worker_error__': True, 'error': envelope.get('error')}

            return envelope.get('result')

    def _shutdown_locked(self) -> None:
        proc, self._proc = self._proc, None
        self.healthy = False
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
        except (OSError, ValueError):
            pass
        if proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:  # noqa: BLE001 - best-effort cleanup, never let this raise
                try:
                    proc.kill()
                    proc.wait(timeout=2)
                except Exception:  # noqa: BLE001
                    pass
        _spawned_pids.discard(proc.pid)
        _registry_remove(proc.pid)

    def shutdown(self) -> None:
        with self._lock:
            self._shutdown_locked()


class WorkerPool:
    """A fixed-size round-robin pool of `_Worker` instances. `submit()`
    tries workers in order starting from a rotating offset; a dead worker
    is respawned in place before being given up on for this call."""

    def __init__(self, size: int, node_executable: str, startup_timeout: float):
        self._workers = [_Worker(node_executable) for _ in range(size)]
        self._next_index = 0
        self._index_lock = threading.Lock()
        self._startup_timeout = startup_timeout
        self.available = False
        started = [w.start(startup_timeout) for w in self._workers]
        self.available = any(started)
        if not self.available:
            logger.warning('landingpages.validation.node_worker_pool.pool_unavailable')

    def _pick_order(self) -> list[int]:
        with self._index_lock:
            start = self._next_index
            self._next_index = (self._next_index + 1) % len(self._workers)
        return [(start + i) % len(self._workers) for i in range(len(self._workers))]

    def submit(self, operation: str, payload: dict, timeout: float) -> dict | None:
        if not self.available:
            return None
        perf_metrics.record('validator_worker_requests')
        for index in self._pick_order():
            worker = self._workers[index]
            if not worker.is_alive():
                perf_metrics.record('validator_worker_restarts')
                if not worker.start(self._startup_timeout):
                    perf_metrics.record('validator_worker_failures')
                    continue
            result = worker.submit(operation, payload, timeout)
            if result is not None:
                return result
            perf_metrics.record('validator_worker_failures')
        perf_metrics.record('validator_worker_fallbacks')
        return None

    def shutdown(self) -> None:
        for worker in self._workers:
            worker.shutdown()


_pool: WorkerPool | None = None
_pool_lock = threading.Lock()
_pool_init_attempted = False


def get_worker_pool() -> WorkerPool | None:
    """Lazily creates the process-wide pool on first real use — a Django
    dev-server autoreload or a management command that never validates
    anything never pays the worker-startup cost. Returns None (never
    raises) if the feature is disabled or the pool failed to start;
    every caller already treats None as "use the one-shot fallback.\""""
    global _pool, _pool_init_attempted
    if not settings.LP_VALIDATOR_WORKER_ENABLED:
        return None
    if _pool_init_attempted:
        return _pool if _pool is not None and _pool.available else None
    with _pool_lock:
        if _pool_init_attempted:
            return _pool if _pool is not None and _pool.available else None
        global _stale_cleanup_attempted
        if not _stale_cleanup_attempted:
            _stale_cleanup_attempted = True
            try:
                cleanup_stale_workers_from_previous_instance()
            except Exception:  # noqa: BLE001 - this is a best-effort safety net, never a hard dependency of pool startup
                logger.debug('landingpages.validation.node_worker_pool.stale_cleanup_failed', exc_info=True)

        node_executable = getattr(settings, 'LP_NODE_EXECUTABLE', 'node') or 'node'
        import shutil
        resolved = shutil.which(node_executable)
        _pool_init_attempted = True
        if not resolved or not _WORKER_SCRIPT_PATH.is_file():
            return None
        pool = WorkerPool(
            size=settings.LP_VALIDATOR_WORKER_POOL_SIZE,
            node_executable=resolved,
            startup_timeout=settings.LP_VALIDATOR_WORKER_STARTUP_TIMEOUT_SECONDS,
        )
        _pool = pool
        return pool if pool.available else None


def shutdown_worker_pool() -> None:
    """Explicit teardown — registered via atexit/signal handlers below,
    and callable directly from tests (spec section 16's deterministic
    test mode) so a test suite run never leaves an orphan Node process
    behind."""
    global _pool, _pool_init_attempted
    with _pool_lock:
        if _pool is not None:
            _pool.shutdown()
        _pool = None
        _pool_init_attempted = False


def _force_kill_tracked_pids() -> None:
    """Last-resort, OS-level-only cleanup — deliberately independent of
    `_pool`/`_Worker`'s own Python object graph. `atexit` handlers that
    fire very late in interpreter shutdown are a known, long-standing
    CPython hazard for subprocess cleanup specifically: by that point
    some of the `subprocess` module's own internal state may already be
    torn down, so a normal `proc.terminate()`/`proc.wait()` call can fail
    in ways that are silently swallowed. This only needs a bare integer
    PID — no Popen object, no pipes, no threads — making it far less
    likely to be affected by whatever else has already been finalized."""
    for pid in list(_spawned_pids):
        try:
            if os.name == 'nt':
                subprocess.run(
                    ['taskkill', '/F', '/PID', str(pid)],
                    capture_output=True, timeout=3, shell=False,
                )
            else:
                os.kill(pid, 9)
        except Exception:  # noqa: BLE001 - absolute best-effort; the process may already be gone
            pass
    _spawned_pids.clear()


def _cleanup_on_exit() -> None:
    shutdown_worker_pool()
    _force_kill_tracked_pids()  # belt-and-suspenders — see its own docstring


_original_sigint_handler = None
_original_sigterm_handler = None


def _install_signal_handlers() -> None:
    """spec section 15/16 — a plain `atexit` registration alone proved
    insufficient in practice: CPython's interpreter-shutdown ordering can
    run `atexit` callbacks late enough that `subprocess` cleanup silently
    fails (a known, long-standing class of issue, not specific to this
    module — reproduced empirically during this sprint's own
    verification). SIGINT/SIGTERM handlers run promptly, BEFORE that
    teardown begins, and cover the most common real shutdown trigger (an
    operator or process manager sending a graceful-stop signal — e.g.
    Ctrl+C on `runserver`) far more reliably. Each handler chains to
    whatever handler was already installed (Django's own, or Python's
    default) after cleaning up, so this never changes the process's
    actual exit behavior — only adds a cleanup step in front of it."""
    global _original_sigint_handler, _original_sigterm_handler

    def _handler(sig, frame):
        _cleanup_on_exit()
        original = _original_sigint_handler if sig == signal.SIGINT else _original_sigterm_handler
        if callable(original):
            original(sig, frame)
        else:
            raise SystemExit(1)

    try:
        _original_sigint_handler = signal.signal(signal.SIGINT, _handler)
        if hasattr(signal, 'SIGTERM'):
            _original_sigterm_handler = signal.signal(signal.SIGTERM, _handler)
    except (ValueError, OSError):
        # signal.signal() only works on the main thread — a worker
        # thread/WSGI setup that imports this module off the main thread
        # simply keeps relying on atexit (still registered below), rather
        # than crashing import.
        logger.debug('landingpages.validation.node_worker_pool.signal_handlers_unavailable', exc_info=True)


atexit.register(_cleanup_on_exit)
_install_signal_handlers()

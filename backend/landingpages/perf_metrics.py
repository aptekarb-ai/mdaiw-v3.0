"""Low-Latency AI Engineer Performance Optimization sprint, spec section
32/33 — lightweight, structured performance observability. Every counter
here is a name + integer count (plus, for durations, a millisecond
figure) — NEVER source content, business copy, or anything derived from a
customer's submitted code. Logged via the standard logger (this project's
existing convention — see repair_memory.py/research.py's identical
`logger.info('landingpages.x.y field=%s ...')` shape) rather than a new
metrics database, which would be over-engineering for what this project
actually needs right now: a way to SEE the effect of the caching/
parallelization work in this sprint, in existing logs and in tests.

Never surfaced to the end-user UI (spec section 32's own instruction) —
nothing in this module is wired into any API response.
"""

from __future__ import annotations

import logging
import threading

logger = logging.getLogger('landingpages.perf_metrics')

_COUNTER_NAMES = (
    'validator_cache_hits', 'validator_cache_misses',
    'compile_cache_hits', 'compile_cache_misses',
    'repair_recipe_hits', 'knowledge_cache_hits',
    'online_research_calls', 'ai_requests', 'ai_calls_avoided',
    'validator_calls', 'compiler_calls',
    'repair_passes',
    # Validator Worker + Subprocess Latency sprint
    'validator_worker_requests', 'validator_worker_restarts',
    'validator_worker_failures', 'validator_worker_timeouts',
    'validator_worker_fallbacks',
)

_local = threading.local()


def _counters() -> dict:
    store = getattr(_local, 'counters', None)
    if store is None:
        store = {name: 0 for name in _COUNTER_NAMES}
        _local.counters = store
    return store


def reset() -> None:
    """Zeroes this thread's counters — call at the start of one logical
    operation (a single validate/repair request) so `snapshot()` reports
    only that operation's activity, not a whole worker process's
    lifetime total."""
    _local.counters = {name: 0 for name in _COUNTER_NAMES}


def record(name: str, amount: int = 1) -> None:
    counters = _counters()
    if name not in counters:
        counters[name] = 0
    counters[name] += amount


def snapshot() -> dict:
    return dict(_counters())


def log_operation_summary(operation: str, *, duration_ms: int, **extra_fields) -> None:
    """One structured log line per completed validate/repair operation —
    counts and a hash/id-only `extra_fields` (e.g. `source_hash=...`,
    never raw source), matching spec requirement 33."""
    counters = _counters()
    parts = ' '.join(f'{key}={value}' for key, value in sorted({**counters, **extra_fields}.items()))
    logger.info(
        'landingpages.perf.operation_summary operation=%s duration_ms=%s %s',
        operation, duration_ms, parts,
    )

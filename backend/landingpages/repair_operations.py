"""Real-Time Progress UX sprint — lightweight, cache-backed operation
status tracking for "AI Fix Issues" so the frontend can poll for real
in-progress state instead of blocking on one long request.

Deliberately NOT Celery/Redis/a task queue (this project's own MVP
constraints rule those out — see the Module-1 master prompt's
infrastructure exclusions, which this sprint follows too): the repair
itself still runs in-process, just on a background `threading.Thread`
spawned by the request that starts it, updating a cache record the
status-polling endpoint reads. This is a real, working MVP-level
mechanism, not a production-grade job queue — see the module docstring
in views.py for the honest tradeoff this implies under worker recycling.
"""

import logging
import time
import uuid

from django.core.cache import cache
from django.db import connections

logger = logging.getLogger('landingpages.repair_operations')

_OPERATION_CACHE_TTL_SECONDS = 600

STAGE_ANALYZING = 'analyzing'
STAGE_REPAIRING = 'repairing'
STAGE_REVALIDATING = 'revalidating'
# AI Engineer Formatting + Documentation sprint, spec section 27/28 — two
# new stages emitted once, after the repair loop converges. 'documenting'
# deliberately does not claim comments ARE being added (spec section 28
# — "Checking code documentation…", never "Adding comments…", since the
# AI Engineer may correctly decide none are needed).
STAGE_FORMATTING = 'formatting'
STAGE_DOCUMENTING = 'documenting'
STAGE_FINALIZING = 'finalizing'

STAGE_LABELS = {
    STAGE_ANALYZING: 'Analyzing your complete landing page…',
    STAGE_REPAIRING: 'AI Engineer is repairing your code…',
    STAGE_REVALIDATING: 'Revalidating repaired code…',
    STAGE_FORMATTING: 'Formatting repaired code…',
    STAGE_DOCUMENTING: 'Checking code documentation…',
    STAGE_FINALIZING: 'Finalizing validation results…',
}


def new_operation_id() -> str:
    return uuid.uuid4().hex


def _cache_key(user_id, operation_id: str) -> str:
    return f'lp-ai-fix-operation-status:{user_id}:{operation_id}'


def create_operation(user_id, operation_id: str, issues_initial: int) -> dict:
    record = {
        'operation_id': operation_id,
        'status': 'running',  # 'running' | 'completed' | 'failed'
        'stage': STAGE_ANALYZING,
        'stage_label': STAGE_LABELS[STAGE_ANALYZING],
        'percent': 0,
        'current_language': None,
        'current_iteration': 0,
        'issues_initial': issues_initial,
        'issues_resolved': 0,
        'issues_remaining': issues_initial,
        'issues_new': 0,
        # fingerprint -> 'pending' | 'fixing' | 'revalidating' | 'resolved'
        # | 'requires_input' | 'newly_exposed' | 'failed'. Accumulates
        # across polls (see update_operation's merge below) rather than
        # being wholesale-replaced each emit, since any single round only
        # reports the fingerprints it touched, not every fingerprint ever
        # seen.
        'issue_updates': {},
        'started_at': time.time(),
        'updated_at': time.time(),
        'failure_reason': None,
        'response_body': None,
        'response_status': None,
    }
    cache.set(_cache_key(user_id, operation_id), record, timeout=_OPERATION_CACHE_TTL_SECONDS)
    return record


def update_operation(user_id, operation_id: str, **fields) -> None:
    key = _cache_key(user_id, operation_id)
    record = cache.get(key)
    if record is None:
        # Expired (TTL) or never created — nothing meaningful to update;
        # the polling endpoint will correctly report "not found" either way.
        return
    # issue_updates is per-fingerprint history, not a snapshot — merge
    # rather than let the generic .update() below overwrite it wholesale,
    # or every earlier round's fingerprint statuses would vanish as soon
    # as a later, smaller round-level emit arrives.
    incoming_issue_updates = fields.pop('issue_updates', None)
    if incoming_issue_updates:
        record['issue_updates'] = {**record.get('issue_updates', {}), **incoming_issue_updates}
    record.update(fields)
    record['updated_at'] = time.time()
    cache.set(key, record, timeout=_OPERATION_CACHE_TTL_SECONDS)


def get_operation(user_id, operation_id: str) -> dict | None:
    return cache.get(_cache_key(user_id, operation_id))


# Never let progress-percentage arithmetic claim 100% while the operation
# is still 'running' — spec section 2/7 ("progress must never lie"). 100
# is reserved for the view's OWN final update, made only after the real
# final ValidationReport exists.
_MAX_RUNNING_PERCENT = 95


def compute_percent(issues_initial: int, issues_remaining: int) -> int:
    if issues_initial <= 0:
        return 0
    resolved_fraction = max(0.0, min(1.0, (issues_initial - issues_remaining) / issues_initial))
    return min(_MAX_RUNNING_PERCENT, round(resolved_fraction * 100))


def run_in_background(target, *args, **kwargs) -> None:
    """Spawns `target(*args, **kwargs)` on a daemon thread and guarantees
    the thread's Django DB connection is closed when the callable returns
    or raises — a background thread never gets Django's normal per-request
    connection-close hook, so an unclosed connection would otherwise leak
    for the lifetime of the worker process."""

    def _wrapped():
        try:
            target(*args, **kwargs)
        except Exception:  # noqa: BLE001 - a background thread has no caller to propagate to; log and stop
            logger.exception('landingpages.repair_operations.background_thread_failed')
        finally:
            connections.close_all()

    import threading
    thread = threading.Thread(target=_wrapped, daemon=True)
    thread.start()

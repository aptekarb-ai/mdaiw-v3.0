"""AI Validate Code Live Progress sprint — lightweight, cache-backed
operation status tracking for "AI Validate Code" (spec section 21-25),
same MVP-level mechanism as repair_operations.py (background
`threading.Thread`, no Celery/Redis — see that module's docstring for
the honest tradeoff this implies). Deliberately a SEPARATE cache
namespace and stage vocabulary from repair_operations.py: Validate and
Fix are different operations with different real backend checkpoints,
and Validate must stay strictly read-only (spec section 2) — this module
never applies a patch or mutates source, it only reports progress on the
SAME read-only `persist_validation_report` call ValidateView already made
synchronously before this sprint.
"""

import logging
import uuid

from django.core.cache import cache

from .repair_operations import run_in_background  # shared threading/connection-close helper

logger = logging.getLogger('landingpages.validate_operations')

_OPERATION_CACHE_TTL_SECONDS = 600

STAGE_PREPARING = 'preparing'
STAGE_VALIDATING_HTML = 'validating_html'
STAGE_VALIDATING_CSS = 'validating_css'
STAGE_VALIDATING_JS = 'validating_js'
STAGE_VALIDATING_AMPSCRIPT = 'validating_ampscript'
STAGE_AI_ANALYSIS = 'ai_analysis'
STAGE_NORMALIZING = 'normalizing'
STAGE_FINALIZING = 'finalizing'

STAGE_LABELS = {
    STAGE_PREPARING: 'Preparing source…',
    STAGE_VALIDATING_HTML: 'Validating HTML…',
    STAGE_VALIDATING_CSS: 'Validating CSS…',
    STAGE_VALIDATING_JS: 'Validating JavaScript…',
    STAGE_VALIDATING_AMPSCRIPT: 'Validating AMPscript…',
    STAGE_AI_ANALYSIS: 'AI Engineer analyzing your code and cross-language relationships…',
    STAGE_NORMALIZING: 'Normalizing findings…',
    STAGE_FINALIZING: 'Finalizing validation report…',
}

# The full, ordered stage sequence for a Complete-LP scope — used to
# compute a REAL completed/total fraction (spec section 23: "never a fake
# elapsed-time percentage"). A narrower scope (e.g. 'javascript' only)
# uses the subset of this list its own `on_progress` callbacks actually
# emit — see `stages_for_scope` below.
_ALL_STAGES_ORDERED = [
    STAGE_PREPARING, STAGE_VALIDATING_HTML, STAGE_VALIDATING_CSS, STAGE_VALIDATING_JS,
    STAGE_VALIDATING_AMPSCRIPT, STAGE_AI_ANALYSIS, STAGE_NORMALIZING, STAGE_FINALIZING,
]

_SCOPE_LANGUAGE_STAGES = {
    'complete': [STAGE_VALIDATING_HTML, STAGE_VALIDATING_CSS, STAGE_VALIDATING_JS, STAGE_VALIDATING_AMPSCRIPT],
    'html': [STAGE_VALIDATING_HTML],
    'css': [STAGE_VALIDATING_CSS],
    'javascript': [STAGE_VALIDATING_JS],
    'ampscript': [STAGE_VALIDATING_AMPSCRIPT],
}


def stages_for_scope(validation_scope: str) -> list:
    """The exact ordered stage list this scope's `on_progress` callbacks
    will emit — spec section 22's closing line: 'Individual scope should
    show only relevant stages.'"""
    language_stages = _SCOPE_LANGUAGE_STAGES.get(validation_scope, _SCOPE_LANGUAGE_STAGES['complete'])
    return [STAGE_PREPARING, *language_stages, STAGE_AI_ANALYSIS, STAGE_NORMALIZING, STAGE_FINALIZING]


def new_operation_id() -> str:
    return uuid.uuid4().hex


def _cache_key(user_id, operation_id: str) -> str:
    return f'lp-ai-validate-operation-status:{user_id}:{operation_id}'


def create_operation(user_id, operation_id: str, validation_scope: str) -> dict:
    total_stages = stages_for_scope(validation_scope)
    record = {
        'operation_id': operation_id,
        'status': 'running',  # 'running' | 'completed' | 'failed'
        'stage': STAGE_PREPARING,
        'stage_label': STAGE_LABELS[STAGE_PREPARING],
        'percent': 0,
        'total_stages': len(total_stages),
        'completed_stages': 0,
        'stage_checklist': {stage: 'pending' for stage in total_stages},
        'response_body': None,
        'response_status': None,
        'failure_reason': None,
    }
    cache.set(_cache_key(user_id, operation_id), record, timeout=_OPERATION_CACHE_TTL_SECONDS)
    return record


# Reserved for the view's own final update, made only after the real
# final ValidationReport exists — never claimed mid-run (spec section 23).
_MAX_RUNNING_PERCENT = 95


def _advance(record: dict, stage: str) -> dict:
    checklist = dict(record.get('stage_checklist', {}))
    # Every stage strictly before `stage` in this operation's own ordered
    # list is now known-complete too — a checkpoint firing for stage N
    # is proof stage N-1's work already finished, even if no explicit
    # update was recorded for it (e.g. a zero-issue HTML pass is still a
    # real completed stage).
    ordered = [s for s in _ALL_STAGES_ORDERED if s in checklist]
    completed = 0
    reached_current = False
    for s in ordered:
        if s == stage:
            checklist[s] = 'active'
            reached_current = True
            continue
        if not reached_current:
            checklist[s] = 'done'
            completed += 1
        else:
            checklist.setdefault(s, 'pending')
    total = max(1, record.get('total_stages', len(ordered)))
    percent = min(_MAX_RUNNING_PERCENT, round((completed / total) * 100))
    record['stage'] = stage
    record['stage_label'] = STAGE_LABELS.get(stage, stage)
    record['stage_checklist'] = checklist
    record['completed_stages'] = completed
    record['percent'] = percent
    return record


def update_operation_stage(user_id, operation_id: str, stage: str) -> None:
    key = _cache_key(user_id, operation_id)
    record = cache.get(key)
    if record is None:
        return
    record = _advance(record, stage)
    cache.set(key, record, timeout=_OPERATION_CACHE_TTL_SECONDS)


def complete_operation(user_id, operation_id: str, *, response_body: dict, response_status: int) -> None:
    key = _cache_key(user_id, operation_id)
    record = cache.get(key)
    if record is None:
        return
    checklist = {stage: 'done' for stage in record.get('stage_checklist', {})}
    record.update({
        'status': 'completed',
        'stage': STAGE_FINALIZING,
        'stage_label': STAGE_LABELS[STAGE_FINALIZING],
        'percent': 100,
        'stage_checklist': checklist,
        'completed_stages': record.get('total_stages', len(checklist)),
        'response_body': response_body,
        'response_status': response_status,
    })
    cache.set(key, record, timeout=_OPERATION_CACHE_TTL_SECONDS)


def fail_operation(user_id, operation_id: str, *, failure_reason: str, response_body: dict, response_status: int) -> None:
    key = _cache_key(user_id, operation_id)
    record = cache.get(key)
    if record is None:
        return
    record.update({
        'status': 'failed', 'failure_reason': failure_reason,
        'response_body': response_body, 'response_status': response_status,
    })
    cache.set(key, record, timeout=_OPERATION_CACHE_TTL_SECONDS)


def get_operation(user_id, operation_id: str) -> dict | None:
    return cache.get(_cache_key(user_id, operation_id))


__all__ = [
    'run_in_background', 'new_operation_id', 'create_operation', 'update_operation_stage',
    'complete_operation', 'fail_operation', 'get_operation', 'stages_for_scope',
    'STAGE_LABELS', 'STAGE_PREPARING', 'STAGE_VALIDATING_HTML', 'STAGE_VALIDATING_CSS',
    'STAGE_VALIDATING_JS', 'STAGE_VALIDATING_AMPSCRIPT', 'STAGE_AI_ANALYSIS',
    'STAGE_NORMALIZING', 'STAGE_FINALIZING',
]

"""Verified Repair Memory — application-level learning (NOT OpenAI model
retraining) for the LP Validator & Fixer's AI Engineer.

The idea: once a repair strategy for a given rule, in a given GENERALIZED
structural context, has been proven by a real authoritative revalidation
(issue disappeared, no regression), remember that fact so a future
operation encountering the SAME rule/context can skip a fresh LLM
reasoning call and go straight to a local, still-validator-gated,
candidate. A strategy proven NOT to work in a context is remembered too,
so it is never proposed again in that same context (negative memory).

Deliberately narrow surface: this module only ever stores/reads small
generalized facts (rule_id, language, a hash of a handful of booleans/
counts, a strategy name) — never raw source, never a diff/patch, never
anything a customer would consider their content. See
RepairKnowledgeRecord's docstring in models.py for the full rationale.

Every recipe this memory ever recommends is still run through the SAME
authoritative validator as any other candidate before being accepted —
this module only decides "try this deterministically first", never
"trust this without checking"."""

import hashlib
import json
import logging

from django.utils import timezone

from ..models import RepairKnowledgeRecord, RepairKnowledgeStatus

logger = logging.getLogger('landingpages.fixes.repair_memory')


# Regional/Whole-Source AI Outcome-Recording Symmetry sprint — a SINGLE
# strategy_key shared by every AI-produced candidate (regional, via either
# "AI Fix Issues" or "AI Fix This Issue", and whole-source), so a failure
# in one entry point/mode negatively affects the SAME generalized
# strategy/context the other modes would consult, and a success in one
# becomes visible to the others — never a separate ledger row per UI
# entry point or repair mode (spec requirement 4/5/6). AI proposals have
# no code-registered executable the way a verified recipe does, so unlike
# RepairKnowledgeRecord rows for real recipes, a VERIFIED 'ai-repair' row
# is never looked up to skip a live AI call — it only ever (a) feeds
# negative guidance into the prompt when REJECTED (see
# rejected_strategy_descriptions, already wired into every AI request via
# knowledge/hints.py in a later change) and (b) accumulates confidence/
# outcome history for observability.
AI_STRATEGY_KEY = 'ai-repair'


def compute_generic_context_signature(*, severity: str, source_context: str, file: str) -> str:
    """Coarse, deliberately conservative structural signature for an
    AI-sourced repair attempt (spec requirement 7 — generalized structural
    facts only). Unlike a verified recipe's `context_facts` (which a
    specific, code-authored recipe controls and can safely extract richer
    structure from — e.g. a normalized selector), an AI proposal's target
    issue is not owned by any one recipe's extraction logic, so this
    intentionally uses ONLY fields already proven safe elsewhere in this
    codebase: `severity` (a fixed enum), `source_context` (a short
    CATEGORICAL label like 'standalone-css' or 'inline-style-block' —
    never raw source, see validation/adapters/*.py), and `file` (a fixed
    enum). Coarser than a recipe's signature means less precise
    deduplication across subtly different structural contexts of the same
    rule_id — an accepted, documented trade-off favoring privacy over
    precision."""
    return compute_context_signature({'severity': severity, 'source_context': source_context or '', 'file': file})


def compute_context_signature(facts: dict) -> str:
    """`facts` must be a small dict of JSON-safe booleans/ints/short
    strings describing the STRUCTURE around an issue (e.g. "one <head>,
    one charset meta, charset not first") — never a source excerpt. Order-
    independent (keys sorted) so equivalent contexts always hash the same."""
    canonical = json.dumps(facts, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def find_verified_recipe(*, language: str, rule_id: str, context_signature: str) -> RepairKnowledgeRecord | None:
    """The most CONFIDENT (not merely most successful — see
    RepairKnowledgeRecord.confidence) VERIFIED strategy for this exact
    rule/context, if one exists. Returns None if nothing is known yet, or
    everything known for this context has been rejected. Ordering is
    computed in Python (over a small, context-scoped candidate set — a
    strategy is looked up per rule/context, never globally) since
    `confidence` is a derived property, not a stored/indexable column."""
    candidates = list(
        RepairKnowledgeRecord.objects
        .filter(language=language, rule_id=rule_id, context_signature=context_signature, status=RepairKnowledgeStatus.VERIFIED)
    )
    if not candidates:
        return None
    return max(candidates, key=lambda record: (record.confidence, record.success_count, record.updated_at))


def is_rejected_strategy(*, language: str, rule_id: str, context_signature: str, strategy_key: str) -> bool:
    """True if this exact strategy has already been proven NOT to work in
    this exact context — negative memory (spec section 11). A DIFFERENT
    strategy_key for the same rule/context is unaffected."""
    return RepairKnowledgeRecord.objects.filter(
        language=language, rule_id=rule_id, context_signature=context_signature,
        strategy_key=strategy_key, status=RepairKnowledgeStatus.REJECTED,
    ).exists()


def rejected_strategy_descriptions(*, language: str, rule_id: str, context_signature: str) -> list[str]:
    """Human-readable descriptions of every strategy already known to fail
    in this context — meant to be fed into the AI prompt as negative
    guidance (repair_hint) so a freeform AI reasoning pass doesn't
    re-propose a strategy this application has already disproven."""
    return list(
        RepairKnowledgeRecord.objects
        .filter(language=language, rule_id=rule_id, context_signature=context_signature, status=RepairKnowledgeStatus.REJECTED)
        .values_list('strategy_description', flat=True)
    )


# Confidence-based promotion/demotion policy (closure spec section 9 —
# "do not let ONE success or ONE failure completely flip strategy
# trust"). Exact policy, applied on every record_attempt_result call:
#
#   1. CATASTROPHIC: this attempt itself caused a rollback (a candidate
#      shipped, then had to be reverted because it made validation
#      worse — see fixes/iterative.py's regression-revert path) ->
#      REJECTED immediately, regardless of prior history. A shipped
#      regression is qualitatively worse than "didn't resolve the
#      issue" and must not wait for confidence to drift down.
#   2. Otherwise, recompute confidence = (success_count + 1) /
#      (attempt_count + 2) — Laplace-smoothed so a single data point
#      never swings status on its own (see RepairKnowledgeRecord.
#      confidence): >= _PROMOTION_THRESHOLD -> VERIFIED, otherwise
#      REJECTED. A first success (1/1 -> 0.67) promotes immediately;
#      one isolated plain failure after a broadly successful history
#      (e.g. 20 successes + 1 failure -> 0.91) stays VERIFIED; a
#      strategy that keeps failing converges below threshold and
#      becomes REJECTED (spec: "repeatedly failing strategy becomes
#      rejected").
_PROMOTION_THRESHOLD = 0.5


def record_attempt_result(
    *, language: str, rule_id: str, context_signature: str, strategy_key: str,
    success: bool, strategy_description: str = '', environment: dict | None = None,
    rolled_back: bool = False,
) -> RepairKnowledgeRecord:
    """Upserts the ledger row for (language, rule_id, context_signature,
    strategy_key) and applies the confidence-based promotion/demotion
    policy documented above. attempt/success/failure/rollback counters
    accumulate across the strategy's whole history regardless of status."""
    record, _created = RepairKnowledgeRecord.objects.get_or_create(
        language=language, rule_id=rule_id, context_signature=context_signature, strategy_key=strategy_key,
        defaults={'status': RepairKnowledgeStatus.VERIFIED if success else RepairKnowledgeStatus.REJECTED},
    )
    record.attempt_count += 1
    if success:
        record.success_count += 1
        record.last_verified_environment = environment or {}
        record.last_verified_at = timezone.now()
    else:
        record.failure_count += 1
    if rolled_back:
        record.rollback_count += 1

    if rolled_back:
        record.status = RepairKnowledgeStatus.REJECTED
    elif record.confidence >= _PROMOTION_THRESHOLD:
        record.status = RepairKnowledgeStatus.VERIFIED
    else:
        record.status = RepairKnowledgeStatus.REJECTED

    if strategy_description:
        record.strategy_description = strategy_description
    record.save()
    logger.info(
        'landingpages.fixes.repair_memory.recorded language=%s rule_id=%s strategy=%s success=%s '
        'rolled_back=%s confidence=%.2f status=%s',
        language, rule_id, strategy_key, success, rolled_back, record.confidence, record.status,
    )
    return record

"""Feature 14 V3 Sub-phase 8 — Safe Self-Learning / Memory (repair-signal
ranking only; composition/template-pattern learning is explicitly OUT of
scope for this sub-phase — see the approved pre-implementation report).

Hard invariants this module (and every caller) must preserve — violating
ANY of these is a regression, not a design choice:

  1. Ranking/advisory ONLY. Never alters, weakens, replaces, or overrides
     KnowledgeRule content/confidence, validateEmail() output, fixType,
     safeFix, or whether confirmation is required. This module has no
     access to a ValidationIssue at all — only a bare signature string —
     so it structurally CANNOT touch any of those.
  2. Per-user only. Every query here is scoped by `user`; there is no
     cross-user aggregate, no "project" (Module-4 has no project concept
     — see EmailDocument/EmailAsset/SavedEmailModule, all direct
     per-user ownership, same convention followed here).
  3. Zero-token, zero-network. Pure ORM + arithmetic — no OpenAI/local-AI
     call is ever made or required to record a signal or compute ranking.
  4. Fails closed. Any error computing ranking must let the CALLER (the
     view) return an empty ranking rather than raise past this module in
     a way that could ever block a repair/validation flow — see
     views.py's own try/except around compute_ranking.
  5. Durable idempotency, not a cache debounce. record_signal() uses a
     database uniqueness constraint (user, event_id) via get_or_create —
     retrying the exact same client request (same event_id) can NEVER
     create a second row or move the evidence count. The cache-based
     rate limit in views.py is abuse protection ONLY; it is never relied
     on for correctness.
"""

import re
from datetime import timedelta

from django.db import IntegrityError
from django.db.models import Count
from django.utils import timezone

from .models import LearnedRepairSignal, RepairSignalOutcome

# Only events within this rolling window count toward ranking — recency
# handling is a hard window (not a continuous decay curve) so it stays
# deterministic and easy to state in the UI ("based on your last 90
# days"). Older rows are NOT deleted at this boundary — see
# RETENTION_DAYS below for the separate hard-delete boundary.
RANKING_WINDOW_DAYS = 90

# Below this many total (accepted + rejected) events for a signature,
# ranking makes NO adjustment at all — the issue list order is byte-
# identical to the zero-learned-data case. This is what makes "existing
# deterministic behavior remains fully functional with zero learned
# data" true for every signature individually, not just in aggregate.
MIN_EVIDENCE_THRESHOLD = 3

# A row older than this is eligible for permanent deletion by the
# cleanup_learning_signals management command. IMPORTANT — this
# repository has no scheduler (no Celery/cron runner is bundled, per the
# MVP infrastructure constraint every other Module-4 sub-phase has
# followed). The application itself cannot guarantee this deletion
# happens at the 365-day mark; the command must be invoked by an
# external scheduler (OS cron / Windows Task Scheduler / a deployment
# platform's scheduled-job feature). Do not read this constant as an
# application-enforced SLA — see cleanup_learning_signals.py's own
# docstring and the closure report for the same disclosure.
RETENTION_DAYS = 365

# Bounded format check only — "<category>:<rule-slug>", lowercase kebab
# segments, matching the stable prefix every ValidationIssue.id in
# emailValidation.ts already uses (see repairEngine.ts's
# signatureForIssueId()). Deliberately NOT a hand-maintained allow-list
# of every real frontend signature — the approved report's reasoning:
# ranking is per-user, display-order-only, and restricted to already-
# safe-fixable issues, so the blast radius of an out-of-band signature
# string is "this one user's own suggestion order looks odd," never a
# safety or cross-user concern. A stricter allow-list would need a
# second manifest kept in lockstep with the frontend's issue ids for a
# proportionally small safety gain.
SIGNATURE_PATTERN = re.compile(r'^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')
MAX_SIGNATURE_LENGTH = 160
MAX_EVENT_ID_LENGTH = 64


def is_valid_signature(value):
    return isinstance(value, str) and 0 < len(value) <= MAX_SIGNATURE_LENGTH and bool(SIGNATURE_PATTERN.match(value))


def is_valid_event_id(value):
    return isinstance(value, str) and 0 < len(value) <= MAX_EVENT_ID_LENGTH


def record_signal(user, event_id, signature, outcome, source):
    """Idempotently persists one (user, event_id) learning event.
    get_or_create's own atomic INSERT ... ON CONFLICT-equivalent path
    (via the (user, event_id) unique constraint) is the durable
    correctness mechanism — a genuine concurrent double-submit of the
    SAME event_id races safely: exactly one row is ever created, the
    IntegrityError from the loser of that race is caught and treated as
    "already recorded," never surfaced as an error. Returns
    (signal_or_None, created_bool). Never raises for a duplicate."""
    try:
        signal, created = LearnedRepairSignal.objects.get_or_create(
            user=user, event_id=event_id,
            defaults={'signature': signature, 'outcome': outcome, 'source': source},
        )
        return signal, created
    except IntegrityError:
        # Lost a concurrent race for the same (user, event_id) — the
        # winner's row is the durable record; re-fetch it rather than
        # treating this as a failure.
        signal = LearnedRepairSignal.objects.filter(user=user, event_id=event_id).first()
        return signal, False


def compute_ranking(user):
    """{signature: {'score': float, 'evidenceCount': int, 'accepted': int,
    'rejected': int}} for every signature this user has at least
    MIN_EVIDENCE_THRESHOLD events for, within the rolling ranking window.
    A signature with fewer events is simply absent from the result — the
    caller (frontend) treats "absent" identically to "no learned data",
    which is what keeps the zero/low-evidence case byte-identical to
    pre-Sub-phase-8 behavior. Never raises; the view wraps this in a
    try/except regardless, as defense in depth (invariant 4 above)."""
    cutoff = timezone.now() - timedelta(days=RANKING_WINDOW_DAYS)
    rows = (
        LearnedRepairSignal.objects
        .filter(user=user, created_at__gte=cutoff)
        .values('signature', 'outcome')
        .annotate(count=Count('id'))
    )

    counts = {}
    for row in rows:
        bucket = counts.setdefault(row['signature'], {'accepted': 0, 'rejected': 0})
        if row['outcome'] == RepairSignalOutcome.ACCEPTED:
            bucket['accepted'] = row['count']
        elif row['outcome'] == RepairSignalOutcome.REJECTED:
            bucket['rejected'] = row['count']

    ranking = {}
    for signature, bucket in counts.items():
        accepted, rejected = bucket['accepted'], bucket['rejected']
        evidence = accepted + rejected
        if evidence < MIN_EVIDENCE_THRESHOLD:
            continue
        # Laplace/add-one smoothing — regresses toward the neutral 0.5
        # until real evidence accumulates, deterministic, no ML weights.
        score = (accepted + 1) / (evidence + 2)
        ranking[signature] = {
            'score': score, 'evidenceCount': evidence, 'accepted': accepted, 'rejected': rejected,
        }
    return ranking


def clear_signals_for_user(user):
    """Immediate, synchronous, user-initiated deletion of ALL of this
    user's learned signals — the "Clear learned preferences" control.
    Returns the number of rows deleted."""
    deleted_count, _ = LearnedRepairSignal.objects.filter(user=user).delete()
    return deleted_count

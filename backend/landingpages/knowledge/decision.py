"""Self-decision engine levels (spec section 20/21) — a FORMALIZATION of
distinctions the repair pipeline already makes structurally (deterministic
catalogue/recipe fixes vs. AI-proposed-then-validated patches vs. findings
that stay `requires_manual_review`), not a new gate. Nothing in
fixes/iterative.py needs to change its actual behavior for this to be
correct; `classify_decision_level` exists so that behavior can be reported
on and reasoned about explicitly, and so future call sites have one
authoritative place to ask "which level is this?" rather than re-deriving
the same three-way split ad hoc.
"""

from __future__ import annotations

from django.db import models


class DecisionLevel(models.TextChoices):
    # Deterministic auto-repair: a catalogue fixer or a VERIFIED repair-
    # memory recipe applies a mechanical, provably-safe transform. No AI
    # reasoning involved in producing the candidate.
    DETERMINISTIC_AUTO_REPAIR = 'A', 'Deterministic auto-repair'
    # AI proposes a candidate; the SAME authoritative validators used
    # everywhere else confirm it actually resolves the issue without
    # regression before it is ever published. AI reasoning, validator-
    # gated acceptance.
    VALIDATOR_CONFIRMED_AI_REPAIR = 'B', 'Validator-confirmed AI repair'
    # The fix requires information only the business/user has (a real
    # URL, copy, a personalization value, a design decision) — must
    # return "Requires Input" and must never be guessed at any level.
    BUSINESS_INTENT_REQUIRED = 'C', 'Requires input'


def classify_decision_level(
    *, has_deterministic_fix: bool, has_verified_recipe: bool,
    requires_manual_review: bool, ai_candidate_available: bool,
) -> DecisionLevel:
    """Pure classification over flags the caller already has on hand
    (ValidationIssue.fixable/deterministic_fix, repair_memory's verified-
    recipe lookup, ValidationIssue.requires_manual_review, and whether an
    AI-produced-and-validator-confirmed candidate exists for this
    fingerprint). `requires_manual_review` always wins — an issue the
    Rule Knowledge Registry or a provider explicitly flagged as needing
    business input is Level C regardless of what else is true, per spec
    section 21: "never guess.\""""
    if requires_manual_review:
        return DecisionLevel.BUSINESS_INTENT_REQUIRED
    if has_deterministic_fix or has_verified_recipe:
        return DecisionLevel.DETERMINISTIC_AUTO_REPAIR
    if ai_candidate_available:
        return DecisionLevel.VALIDATOR_CONFIRMED_AI_REPAIR
    return DecisionLevel.BUSINESS_INTENT_REQUIRED

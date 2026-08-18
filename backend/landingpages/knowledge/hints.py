"""Single entry point both AI-request-building call sites use to get a
rule's repair hint (spec section 5) — the local Rule Knowledge Registry
first, an online-sourced supplement only when the registry has nothing.
Replaces the old inline `rule.repair_strategy if rule else ''` at each
call site with the SAME return contract (plain string, '' when nothing is
known) — every existing caller keeps working unchanged when there is
local knowledge, exactly as before this sprint; only the "nothing local"
branch gained a new source of guidance.
"""

from __future__ import annotations

import logging

from django.conf import settings

from ..validation.rules.registry import get_rule
from . import research
from .prompt import build_reference_data_block

logger = logging.getLogger('landingpages.knowledge.hints')


def get_repair_hint(*, language: str, rule_id: str) -> str:
    rule = get_rule(rule_id, language)
    if rule is not None:
        return rule.repair_strategy

    if not settings.LP_KNOWLEDGE_ONLINE_RESEARCH_ENABLED:
        return ''

    try:
        # Rate-limit key is the rule itself, not the caller — the point is
        # to bound repeat fetch attempts for the SAME rule across a time
        # window regardless of which of the two call sites (regional
        # review, whole-source repair) triggered it.
        record = research.research_rule(
            language=language, rule_id=rule_id, rate_limit_identifier=f'{language}:{rule_id}',
        )
    except Exception:  # noqa: BLE001 — online research must never break the repair pipeline
        logger.warning('landingpages.knowledge.hints.research_failed language=%s rule_id=%s', language, rule_id, exc_info=True)
        return ''

    if record is None:
        return ''
    return build_reference_data_block(record)

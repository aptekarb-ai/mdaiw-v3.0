"""Research-trigger orchestration (spec section 5/8/9) — the WRITE side of
the knowledge ledger. Deliberately separate from `hints.get_repair_hint`
(the READ side, used inline on every repair-hint build): a fetch is a
real network call, so it only ever runs when `should_research` proves the
local Rule Knowledge Registry genuinely has nothing AND no still-fresh
cached record exists either — never on every validation (spec section 8).

Every failure mode here (network, allowlist, rate limit, disabled by
settings) degrades to "no online knowledge this time", never an
exception that reaches the repair pipeline — see fixes/iterative.py and
ai_review/__init__.py, neither of which import this module directly (they
go through hints.py) and neither of which may ever hard-fail because a
web request failed.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from ..models import AuthoritativeKnowledgeRecord, AuthoritativeKnowledgeStatus
from ..validation.rules.registry import get_rule
from .fetch import KnowledgeFetchBlocked, KnowledgeFetchError, fetch_authoritative_content
from .sources import sources_for_language

logger = logging.getLogger('landingpages.knowledge.research')

_RATE_LIMIT_CACHE_PREFIX = 'landingpages:knowledge:research_rate_limit'


def _is_fresh(record: AuthoritativeKnowledgeRecord) -> bool:
    age = timezone.now() - record.retrieved_at
    return age.days < settings.LP_KNOWLEDGE_FRESHNESS_DAYS


def cached_knowledge(*, language: str, rule_id: str) -> AuthoritativeKnowledgeRecord | None:
    """Best available cached record for (language, rule_id), if any —
    prefers VERIFIED over CANDIDATE, then highest confidence, then most
    recently retrieved. Never returns a REJECTED or SUPERSEDED record."""
    candidates = list(
        AuthoritativeKnowledgeRecord.objects.filter(
            language=language, rule_id=rule_id,
            status__in=(AuthoritativeKnowledgeStatus.VERIFIED, AuthoritativeKnowledgeStatus.CANDIDATE),
        )
    )
    if not candidates:
        return None
    status_rank = {AuthoritativeKnowledgeStatus.VERIFIED: 1, AuthoritativeKnowledgeStatus.CANDIDATE: 0}
    return max(candidates, key=lambda record: (status_rank[record.status], record.confidence, record.retrieved_at))


def should_research(*, language: str, rule_id: str) -> bool:
    """True only when the local, code-authored registry has no entry for
    this rule AND no still-fresh cached record exists — the two
    conditions spec section 8 names as "genuinely needed.\""""
    if get_rule(rule_id, language) is not None:
        return False
    existing = cached_knowledge(language=language, rule_id=rule_id)
    if existing is not None and _is_fresh(existing):
        return False
    return True


def _rate_limited(identifier: str) -> bool:
    key = f'{_RATE_LIMIT_CACHE_PREFIX}:{identifier}'
    if cache.get(key):
        return True
    cache.set(key, 1, timeout=settings.LP_KNOWLEDGE_RATE_LIMIT_WINDOW_SECONDS)
    return False


def research_rule(*, language: str, rule_id: str, rate_limit_identifier: str) -> AuthoritativeKnowledgeRecord | None:
    """Best-effort: fetches the first applicable allowlisted source for
    `language`, stores a CANDIDATE record, and returns it. Returns None
    (never raises) for any of: research not needed, feature disabled,
    rate-limited, no applicable source, or the fetch itself failing."""
    if not settings.LP_KNOWLEDGE_ONLINE_RESEARCH_ENABLED:
        return None
    if not should_research(language=language, rule_id=rule_id):
        return cached_knowledge(language=language, rule_id=rule_id)
    if _rate_limited(rate_limit_identifier):
        return None

    applicable_sources = sources_for_language(language)
    if not applicable_sources:
        return None
    source = applicable_sources[0]

    try:
        fetched = fetch_authoritative_content(source)
    except (KnowledgeFetchBlocked, KnowledgeFetchError) as exc:
        logger.info(
            'landingpages.knowledge.research.fetch_unavailable language=%s rule_id=%s reason=%s',
            language, rule_id, type(exc).__name__,
        )
        return None

    existing = AuthoritativeKnowledgeRecord.objects.filter(
        language=language, rule_id=rule_id, source_url=source.reference_url,
    ).first()
    if existing is not None and existing.content_hash != fetched.content_hash:
        existing.status = AuthoritativeKnowledgeStatus.SUPERSEDED
        existing.save(update_fields=['status', 'updated_at'])
        existing = None

    record, _created = AuthoritativeKnowledgeRecord.objects.update_or_create(
        language=language, rule_id=rule_id, source_url=source.reference_url,
        defaults={
            'source_name': source.name,
            'source_title': fetched.title,
            'excerpt': fetched.text,
            'content_hash': fetched.content_hash,
            'retrieved_at': fetched.fetched_at,
            'status': AuthoritativeKnowledgeStatus.CANDIDATE,
        },
    )
    if existing is not None:
        record.superseded_by = None
    logger.info(
        'landingpages.knowledge.research.recorded language=%s rule_id=%s source=%s',
        language, rule_id, source.name,
    )
    return record


def record_outcome(record: AuthoritativeKnowledgeRecord, *, helped: bool) -> None:
    """Called after a real authoritative revalidation that used this
    record's excerpt as part of an AI prompt (spec section 33/35) —
    mirrors repair_memory's promote/reject spirit, but for a fetched
    reference rather than a code strategy. `helped=True` means the issue
    this record was consulted for was actually resolved and the
    revalidated result was accepted; `helped=False` means it was not."""
    record.attempt_count += 1
    if helped:
        record.success_count += 1
        record.confidence = min(0.95, (record.success_count + 1) / (record.attempt_count + 2))
        record.status = AuthoritativeKnowledgeStatus.VERIFIED
    else:
        record.confidence = (record.success_count + 1) / (record.attempt_count + 2)
        if record.confidence < 0.3 and record.attempt_count >= 3:
            record.status = AuthoritativeKnowledgeStatus.REJECTED
    record.save(update_fields=['attempt_count', 'success_count', 'confidence', 'status', 'updated_at'])

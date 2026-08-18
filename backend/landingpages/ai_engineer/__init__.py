"""AI Engineer full-source analysis — orchestrates the second phase of
"AI Validate Code": after the deterministic engines (validation/engine.py)
have produced their authoritative findings, `analyze()` independently
reads the COMPLETE applicable source for the selected scope, looking for
issues those engines structurally cannot see. It never replaces or
weakens a deterministic finding — see `_merge_or_append` below, which
only ever adds ai_metadata/composites source_engine onto an EXISTING
deterministic issue, never touches its message/rule_id/severity/fix data.

Failure isolation is the same principle as validation/engine.py's
_run_adapters: any AI Engineer failure (provider unavailable, timeout,
rate limit, malformed output) degrades to "AI Engineer analysis
unavailable" for the affected language and NEVER raises — deterministic
validation's success never depends on this module. See views.py::
ValidateView, which calls `analyze()` in its own try/except purely as
defense in depth on top of that.

FIXABILITY SEMANTICS — read before assuming what fixable=False means:
Every AI Engineer issue is created with `fixable=False` and
`requires_manual_review=True`. This means ONLY "this finding was never
independently verified as a safe, mechanically-correct DETERMINISTIC
patch, so it is never eligible for automatic/bulk apply without a human
or a second AI pass reviewing it." It does NOT mean "this finding can
never receive an AI-generated fix at all." AI Fix This Issue / AI Fix
Issues (ai_review/) treat ANY current ValidationIssue — deterministic or
AI Engineer-sourced alike — as eligible input; that SEPARATE pipeline
independently re-verifies the issue against the current source, generates
its own proposal, checks expected_text/offsets against the real document,
classifies risk, and still requires explicit user acceptance before
anything is applied. See `ai_metadata['ai_fix_pipeline_eligible']` below,
which makes this explicit per-issue rather than leaving it implicit in a
single overloaded boolean.

SYNTAX-CONTRADICTION GUARD — see `_deterministic_syntax_confirmed_valid`:
when a deterministic engine has already confirmed a language's source has
no syntax-category errors, an AI-only `category='syntax'` finding for
that SAME language is dropped rather than shown — a live-verification run
caught gpt-4o-mini hallucinating "unmatched braces" against CSS a real
compiler had already parsed cleanly. The guard is categorical (any
`category='syntax'` claim, not a specific message), and only fires when
the deterministic signal is confident; it never suppresses non-syntax
(accessibility/semantic/maintainability/security/etc.) findings, and
never suppresses a syntax finding that CORRELATES with a real
deterministic error (that case is ordinary same-line merging instead).
"""

import dataclasses
import hashlib
import logging
import time

from django.conf import settings
from django.core.cache import cache

from ..ai_review.redaction import redact
from ..validation.schema import CONFIDENCE_POSSIBLE, EngineStatus, SEVERITY_INFO, ValidationIssueData
from .chunking import chunk_source
from .location import resolve_evidence_location
from .provider import (
    AIEngineerChunk,
    AIEngineerChunkRequest,
    AIEngineerUnavailable,
    CrossLanguageRequest,
    DeterministicFindingRef,
    get_default_ai_engineer_provider,
)

logger = logging.getLogger('landingpages.ai_engineer')

_LANGUAGE_ORDER = ('html', 'css', 'javascript', 'ampscript')
_SCOPE_TO_LANGUAGES = {
    'complete': _LANGUAGE_ORDER,
    'html': ('html',),
    'css': ('css',),
    'javascript': ('javascript',),
    'ampscript': ('ampscript',),
}
_MAX_KNOWN_FINDINGS_PER_CHUNK = 20
_CROSS_LANGUAGE_EXCERPT_CHARS = 4000
_STANDARDS_REFERENCE = ''  # AI Engineer never fabricates one — see spec section 33.
# Languages AI Engineer ever produces a finding for — always a real editor
# tab (never 'cdn'/'typescript', which have no source to analyze at all),
# so an AI-only finding is always structurally eligible to be routed
# through the SEPARATE AI Fix This Issue / AI Fix Issues pipeline (see
# `ai_metadata['ai_fix_pipeline_eligible']` below and the module docstring
# note on fixable=False).
_AI_ENGINEER_LANGUAGES = frozenset({'html', 'css', 'javascript', 'ampscript'})


@dataclasses.dataclass
class AIEngineerAnalysisResult:
    issues: list  # ValidationIssueData — the FULL replacement issue list (deterministic + merged + new)
    coverage: dict
    engine_status: EngineStatus


def _language_cache_key(language, source, validation_scope, css_source_type, profile):
    digest = hashlib.sha256(source.encode('utf-8')).hexdigest()[:24]
    return (
        f'lp-ai-engineer-lang:{language}:{digest}:{validation_scope}:'
        f'{css_source_type}:{profile}:{settings.LP_AI_ENGINEER_MODEL}'
    )


def _draft_to_dict(draft):
    return {
        'category': draft.category, 'severity': draft.severity, 'message': draft.message,
        'evidence': draft.evidence, 'reasoning': draft.reasoning, 'suggested_fix': draft.suggested_fix,
        'confidence': draft.confidence, 'risk': draft.risk, 'verifiable': draft.verifiable,
        'cross_language': draft.cross_language,
    }


def _dict_to_draft(data):
    from .provider import AIFindingDraft

    return AIFindingDraft(**data)


def _findings_in_range(deterministic_issues, language, start_line, end_line):
    matches = [
        DeterministicFindingRef(
            rule_id=issue.rule_id, message=issue.message, severity=issue.severity, line=issue.start_line,
        )
        for issue in deterministic_issues
        if issue.language == language and start_line <= issue.start_line <= end_line
    ]
    return matches[:_MAX_KNOWN_FINDINGS_PER_CHUNK]


def _find_merge_target(issues, language, start_line):
    for index, issue in enumerate(issues):
        if issue.language == language and issue.start_line == start_line:
            return index
    return None


def _deterministic_syntax_confirmed_valid(deterministic_issues, language):
    """True when NO deterministic engine reported a category='syntax'
    error-severity finding anywhere in this language's source — a
    reasonably strong, general proxy for "the authoritative parser/
    compiler already confirmed this source is syntactically valid",
    usable to reject a contradictory AI-only syntax claim. Deliberately
    conservative: any real syntax error anywhere in the language (even on
    an unrelated line) withholds this signal, so the guard below only
    ever fires when deterministic validation is genuinely clean — never a
    per-line judgment call that could itself be wrong."""
    return not any(
        issue.language == language and issue.category == 'syntax' and issue.severity == 'error'
        for issue in deterministic_issues
    )


def _draft_to_issue_data(
    draft, *, language, editor_target, source_context, start_line, start_column, end_line, end_column,
    chunk_index, total_chunks, cross_language,
):
    severity = draft.severity
    # Section 12 — a speculative ("possible") finding must not read as an
    # alarming actionable error; it is still shown, just de-emphasized.
    if draft.confidence == CONFIDENCE_POSSIBLE and severity != SEVERITY_INFO:
        severity = SEVERITY_INFO
    engine_name = 'ai-engineer-cross-language' if cross_language else 'ai-engineer'
    return ValidationIssueData(
        language=language,
        source_engine=engine_name,
        engine_version=settings.LP_AI_ENGINEER_MODEL,
        rule_id=f'ai-engineer:{draft.category}',
        category=draft.category,
        severity=severity,
        message=draft.message,
        start_line=start_line,
        start_column=start_column,
        end_line=end_line,
        end_column=end_column,
        standards_reference=_STANDARDS_REFERENCE,
        confidence=draft.confidence,
        suggestion=draft.suggested_fix,
        code_excerpt=draft.evidence,
        fixable=False,
        requires_manual_review=True,
        editor_target=editor_target,
        source_context=source_context,
        ai_metadata={
            'reasoning': draft.reasoning,
            'evidence': draft.evidence,
            'cross_language': cross_language,
            'verifiable': draft.verifiable,
            'chunk_index': chunk_index,
            'total_chunks': total_chunks,
            'ai_fix_pipeline_eligible': language in _AI_ENGINEER_LANGUAGES,
        },
        risk=draft.risk,
    )


def _merge_or_append(issues, draft, *, language, editor_target, source_context, location, chunk_index, total_chunks):
    start_line, start_column, end_line, end_column = location
    merge_index = _find_merge_target(issues, language, start_line)
    if merge_index is not None:
        existing = issues[merge_index]
        composite_engine = existing.source_engine if 'ai-engineer' in existing.source_engine else f'{existing.source_engine}+ai-engineer'
        issues[merge_index] = dataclasses.replace(
            existing,
            source_engine=composite_engine,
            ai_metadata={
                'reasoning': draft.reasoning, 'evidence': draft.evidence, 'cross_language': False,
                'verifiable': draft.verifiable, 'chunk_index': chunk_index, 'total_chunks': total_chunks,
                'ai_message': draft.message, 'ai_confidence': draft.confidence,
                'ai_fix_pipeline_eligible': language in _AI_ENGINEER_LANGUAGES,
            },
        )
        return
    issues.append(_draft_to_issue_data(
        draft, language=language, editor_target=editor_target, source_context=source_context,
        start_line=start_line, start_column=start_column, end_line=end_line, end_column=end_column,
        chunk_index=chunk_index, total_chunks=total_chunks, cross_language=False,
    ))


def _analyze_language(
    *, provider, language, source, editor_target, source_context, validation_scope, target_platform,
    profile, css_source_type, rate_limit_identifier, deterministic_issues, issues, budget_remaining,
    syntax_confirmed_valid,
):
    """Returns (coverage_entry, requests_used, cache_hits, cache_misses).
    Mutates `issues` in place — merging AI findings onto matching
    deterministic issues or appending new standalone ones."""
    source_lines = source.count('\n') + 1 if source.strip() else 0
    if not source.strip():
        return {'source_lines': 0, 'engine': 'not-applicable', 'ai': 'skipped-empty', 'chunks': 0}, 0, 0, 0

    if len(source) > settings.LP_AI_ENGINEER_MAX_SOURCE_CHARS:
        return {'source_lines': source_lines, 'engine': 'complete', 'ai': 'skipped-too-large', 'chunks': 0}, 0, 0, 0

    if budget_remaining <= 0:
        return {'source_lines': source_lines, 'engine': 'complete', 'ai': 'partial', 'chunks': 0,
                'failure_reason': 'AI request budget exhausted for this validation.'}, 0, 0, 0

    chunks, chunking_truncated = chunk_source(
        language, source, settings.LP_AI_ENGINEER_MAX_CHUNK_CHARS, settings.LP_AI_ENGINEER_MAX_CHUNKS_PER_LANGUAGE,
    )
    if not chunks:
        return {'source_lines': source_lines, 'engine': 'complete', 'ai': 'skipped-empty', 'chunks': 0}, 0, 0, 0

    cache_key = _language_cache_key(language, source, validation_scope, css_source_type, profile)
    cached = cache.get(cache_key)

    requests_used = 0
    cache_hits = 0
    cache_misses = 0
    any_unavailable = False
    covered_chunks = 0
    contradictions_dropped = 0

    for chunk in chunks:
        cache_entry = cached.get(chunk.chunk_index) if cached else None
        if cache_entry is not None:
            drafts = [_dict_to_draft(item) for item in cache_entry]
            cache_hits += 1
        else:
            cache_misses += 1
            # A cache hit costs no budget (see above); only a REAL provider
            # call needs to respect the remaining request budget — checked
            # here, not before the cache lookup, so a partial old cache
            # (fewer chunks than are configured now) can never bypass it.
            if requests_used >= budget_remaining:
                break
            findings_in_range = _findings_in_range(deterministic_issues, language, chunk.start_line, chunk.end_line)
            request = AIEngineerChunkRequest(
                chunk=AIEngineerChunk(
                    language=language, text=redact(chunk.text), start_line=chunk.start_line,
                    end_line=chunk.end_line, chunk_index=chunk.chunk_index, total_chunks=chunk.total_chunks,
                    source_context=source_context, findings_in_range=findings_in_range,
                    deterministic_syntax_confirmed_valid=syntax_confirmed_valid,
                ),
                validation_scope=validation_scope, target_platform=target_platform,
                rate_limit_identifier=rate_limit_identifier,
            )
            try:
                result = provider.analyze_chunk(request)
                requests_used += 1
            except AIEngineerUnavailable as exc:
                logger.warning('landingpages.ai_engineer.unavailable language=%s reason=%s', language, str(exc))
                any_unavailable = True
                break
            drafts = result.findings
            if cached is None:
                cached = {}
            cached[chunk.chunk_index] = [_draft_to_dict(draft) for draft in drafts]

        covered_chunks += 1
        for draft in drafts:
            if draft.category == 'syntax' and syntax_confirmed_valid:
                # See _deterministic_syntax_confirmed_valid's docstring and
                # the module docstring's "SYNTAX-CONTRADICTION GUARD" note
                # — a syntax-level claim contradicting an already-confirmed
                # -valid authoritative parse is dropped, never shown.
                contradictions_dropped += 1
                logger.info(
                    'landingpages.ai_engineer.contradiction_dropped language=%s chunk=%s',
                    language, chunk.chunk_index,
                )
                continue
            location = resolve_evidence_location(draft.evidence, chunk.text, chunk.start_line)
            if location is None:
                continue
            _merge_or_append(
                issues, draft, language=language, editor_target=editor_target, source_context=source_context,
                location=location, chunk_index=chunk.chunk_index, total_chunks=chunk.total_chunks,
            )

    if cached is not None and not any_unavailable:
        cache.set(cache_key, cached, timeout=settings.LP_AI_ENGINEER_CACHE_TTL_SECONDS)

    if any_unavailable:
        ai_status = 'unavailable'
    elif chunking_truncated or covered_chunks < len(chunks):
        ai_status = 'partial'
    else:
        ai_status = 'complete'

    coverage_entry = {
        'source_lines': source_lines, 'engine': 'complete', 'ai': ai_status, 'chunks': len(chunks),
    }
    if ai_status == 'partial':
        coverage_entry['failure_reason'] = (
            'Source required more structural chunks than the configured maximum.' if chunking_truncated
            else 'AI request budget exhausted for this validation.'
        )
    if contradictions_dropped:
        coverage_entry['contradictions_dropped'] = contradictions_dropped
    return coverage_entry, requests_used, cache_hits, cache_misses


def _run_cross_language(
    provider, *, populated, validation_scope, target_platform, rate_limit_identifier, issues,
    syntax_confirmed_valid_by_language,
):
    excerpt_sources = [
        (language, redact(source[:_CROSS_LANGUAGE_EXCERPT_CHARS]))
        for language, source in populated
    ]
    request = CrossLanguageRequest(
        sources=excerpt_sources, validation_scope=validation_scope,
        target_platform=target_platform, rate_limit_identifier=rate_limit_identifier,
    )
    result = provider.analyze_cross_language(request)
    full_source_by_language = dict(populated)
    for draft in result.findings:
        language = draft.language
        if language not in full_source_by_language:
            continue
        if draft.category == 'syntax' and syntax_confirmed_valid_by_language.get(language, False):
            logger.info('landingpages.ai_engineer.contradiction_dropped language=%s chunk=cross-language', language)
            continue
        full_source = full_source_by_language[language]
        location = resolve_evidence_location(draft.evidence, full_source, 1)
        if location is None:
            continue
        start_line, start_column, end_line, end_column = location
        issues.append(_draft_to_issue_data(
            draft, language=language, editor_target='', source_context='',
            start_line=start_line, start_column=start_column, end_line=end_line, end_column=end_column,
            chunk_index=0, total_chunks=1, cross_language=True,
        ))


def analyze(
    *, sources: dict, deterministic_issues: list, validation_scope: str, css_source_type: str,
    profile: str, rate_limit_identifier: str,
) -> AIEngineerAnalysisResult:
    started = time.perf_counter()
    provider = get_default_ai_engineer_provider()
    if provider is None:
        return AIEngineerAnalysisResult(
            issues=list(deterministic_issues), coverage={},
            engine_status=EngineStatus(
                engine_name='ai-engineer', success=False, duration_ms=0, issue_count=0,
                message='AI Engineer analysis unavailable.',
            ),
        )

    languages = _SCOPE_TO_LANGUAGES.get(validation_scope, ())
    populated = [
        (language, sources.get(language, '') or '') for language in languages if (sources.get(language, '') or '').strip()
    ]
    target_platform = 'sfmc-cloudpages' if any(language == 'ampscript' for language, _ in populated) else None

    issues = list(deterministic_issues)
    coverage: dict = {}
    total_requests_budget = settings.LP_AI_ENGINEER_MAX_REQUESTS_PER_VALIDATION
    reserve_for_cross_language = validation_scope == 'complete' and len(populated) >= 2
    if reserve_for_cross_language:
        total_requests_budget = max(0, total_requests_budget - 1)

    requests_used_total = 0
    cache_hits_total = 0
    cache_misses_total = 0
    any_language_unavailable = False
    syntax_confirmed_valid_by_language = {
        language: _deterministic_syntax_confirmed_valid(deterministic_issues, language) for language in languages
    }

    for language in languages:
        source = sources.get(language, '') or ''
        editor_target = ''
        source_context = css_source_type if language == 'css' else ''
        entry, used, cache_hits, cache_misses = _analyze_language(
            provider=provider, language=language, source=source, editor_target=editor_target,
            source_context=source_context, validation_scope=validation_scope, target_platform=target_platform,
            profile=profile, css_source_type=css_source_type, rate_limit_identifier=rate_limit_identifier,
            deterministic_issues=deterministic_issues, issues=issues,
            budget_remaining=total_requests_budget - requests_used_total,
            syntax_confirmed_valid=syntax_confirmed_valid_by_language[language],
        )
        coverage[language] = entry
        requests_used_total += used
        cache_hits_total += cache_hits
        cache_misses_total += cache_misses
        if entry['ai'] == 'unavailable':
            any_language_unavailable = True

    if reserve_for_cross_language:
        # This reservation is structural, not best-effort: total_requests_budget
        # above already excludes 1 slot from what the per-language loop could
        # ever spend, so cross_budget here is guaranteed >= 1 regardless of
        # how many chunks/languages ran, UNLESS the per-language loop itself
        # ran over its allotted budget (a bug) — see test_ai_engineer.py's
        # dedicated reservation test.
        cross_budget = settings.LP_AI_ENGINEER_MAX_REQUESTS_PER_VALIDATION - requests_used_total
        if cross_budget > 0:
            try:
                _run_cross_language(
                    provider, populated=populated, validation_scope=validation_scope,
                    target_platform=target_platform, rate_limit_identifier=rate_limit_identifier, issues=issues,
                    syntax_confirmed_valid_by_language=syntax_confirmed_valid_by_language,
                )
                coverage['cross_language'] = {'status': 'complete'}
                requests_used_total += 1
            except AIEngineerUnavailable as exc:
                logger.warning('landingpages.ai_engineer.cross_language_unavailable reason=%s', str(exc))
                coverage['cross_language'] = {'status': 'unavailable'}
        else:
            coverage['cross_language'] = {'status': 'skipped', 'failure_reason': 'AI request budget exhausted.'}

    duration_ms = int((time.perf_counter() - started) * 1000)
    new_ai_issue_count = sum(
        1 for issue in issues if issue.source_engine in ('ai-engineer', 'ai-engineer-cross-language')
    )
    # A rough top-level summary flag only — the real per-language picture
    # is `coverage` above. False whenever ANY populated language's AI pass
    # genuinely failed (as opposed to being skipped for size/budget
    # reasons, which is expected, bounded behavior, not a failure).
    overall_success = not any_language_unavailable
    # Diagnostic/perf telemetry only — see spec section 7: measured here,
    # never surfaced in the normal end-user UI (analysis_coverage exposes
    # chunk counts and status, not raw request/cache counts or timing).
    logger.info(
        'landingpages.ai_engineer.validation_summary duration_ms=%d requests=%d cache_hits=%d cache_misses=%d '
        'languages=%d issues_added=%d',
        duration_ms, requests_used_total, cache_hits_total, cache_misses_total, len(populated), new_ai_issue_count,
    )
    return AIEngineerAnalysisResult(
        issues=issues,
        coverage=coverage,
        engine_status=EngineStatus(
            engine_name='ai-engineer', success=overall_success, duration_ms=duration_ms,
            issue_count=new_ai_issue_count,
            message='' if overall_success else 'AI Engineer analysis was unavailable for part of this request.',
        ),
    )

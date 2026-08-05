"""Validation orchestrator — Sprint 1C (HTML) / Sprint 1D (CSS).

Runs every enabled adapter for each submitted language, merges their
output into the unified issue schema, and returns a ValidationRunResult
(issues + per-engine status). A single adapter crashing never discards
results from the others — each adapter call is individually timed and
exception-guarded, and this applies identically across languages: a CSS
engine failure cannot delete HTML findings, and vice versa.

JS/TS adapters do not exist yet (Sprint 1E) — the `js`/`ts` parameters are
accepted for API-contract stability but are not validated.
"""

import dataclasses
import logging
import time

from .adapters.css_conformance import CssConformanceAdapter
from .adapters.html_accessibility import HtmlAccessibilityStaticAdapter
from .adapters.html_conformance import HtmlConformanceAdapter
from .adapters.html_inline_style import HtmlInlineStyleAdapter
from .adapters.html_responsive import HtmlResponsiveAdapter
from .adapters.html_seo import HtmlSeoAdapter
from .adapters.html_structure import HtmlStructureAdapter
from .adapters.html_style_block import HtmlStyleBlockAdapter
from .profiles import (
    DEFAULT_PROFILE,
    DEFAULT_SCOPE,
    ValidationScope,
    apply_severity_override,
    is_known_profile,
    is_known_scope,
)
from .schema import (
    CONFIDENCE_DEFINITE,
    EngineStatus,
    SEVERITY_ERROR,
    ValidationIssueData,
    ValidationRunResult,
    severity_rank,
)

logger = logging.getLogger(__name__)

# Resource limits. Input character-length is enforced earlier, at the
# request-serializer layer (a clean 400 rather than partial processing) —
# these bound what happens once a request has already passed that check.
MAX_LINE_COUNT = 20_000
MAX_ISSUES = 300
GLOBAL_TIME_BUDGET_SECONDS = 8.0
_MAX_EXCERPT_LENGTH = 200

_CONFIDENCE_RANK = {'definite': 0, 'likely': 1, 'possible': 2}

_HTML_ADAPTERS = (
    HtmlConformanceAdapter(),
    HtmlStructureAdapter(),
    HtmlAccessibilityStaticAdapter(),
    HtmlSeoAdapter(),
    HtmlResponsiveAdapter(),
    # CSS embedded directly in the HTML source (Sprint CSS-A) — these run
    # whenever HTML itself runs (html scope and complete scope alike),
    # never as part of the separate standalone CSS-tab adapters below,
    # per "HTML-only CSS validation applies only to CSS embedded in the
    # HTML source."
    HtmlInlineStyleAdapter(),
    HtmlStyleBlockAdapter(),
)
_CSS_ADAPTERS = (
    CssConformanceAdapter(),
)
# No JavaScript/TypeScript adapters exist yet (Sprint 1E) — these stay
# empty tuples, not removed entirely, so the scope-dispatch table below
# has one stable shape regardless of which engines exist yet.
_JAVASCRIPT_ADAPTERS: tuple = ()
_TYPESCRIPT_ADAPTERS: tuple = ()


def _truncate_lines(source: str) -> tuple[str, bool]:
    lines = source.split('\n')
    if len(lines) <= MAX_LINE_COUNT:
        return source, False
    return '\n'.join(lines[:MAX_LINE_COUNT]), True


def _excerpt_for(source_lines: list[str], line: int) -> str:
    if line and 1 <= line <= len(source_lines):
        return source_lines[line - 1].strip()[:_MAX_EXCERPT_LENGTH]
    return ''


def _run_adapters(
    adapters: tuple, source: str, profile: str, deadline: float,
) -> tuple[list[ValidationIssueData], list[EngineStatus]]:
    issues: list[ValidationIssueData] = []
    statuses: list[EngineStatus] = []
    source_lines = source.split('\n')

    for adapter in adapters:
        if time.perf_counter() > deadline:
            statuses.append(EngineStatus(
                engine_name=adapter.engine_name,
                success=False,
                duration_ms=0,
                issue_count=0,
                message='Skipped — validation time budget exceeded.',
            ))
            continue

        started_at = time.perf_counter()
        try:
            raw_issues = adapter.validate(source, profile)
        except Exception:  # noqa: BLE001 - never let one adapter's crash take down the others
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            logger.exception('landingpages.validate.adapter_failed engine=%s', adapter.engine_name)
            statuses.append(EngineStatus(
                engine_name=adapter.engine_name,
                success=False,
                duration_ms=duration_ms,
                issue_count=0,
                message='This check could not complete.',
            ))
            continue

        duration_ms = int((time.perf_counter() - started_at) * 1000)
        enriched = [
            dataclasses.replace(
                issue,
                code_excerpt=issue.code_excerpt or _excerpt_for(source_lines, issue.start_line),
                severity=apply_severity_override(issue.rule_id, issue.severity, profile),
            )
            for issue in raw_issues
        ]
        issues.extend(enriched)
        statuses.append(EngineStatus(
            engine_name=adapter.engine_name,
            success=True,
            duration_ms=duration_ms,
            issue_count=len(enriched),
        ))

    return issues, statuses


def _dedupe(issues: list[ValidationIssueData]) -> list[ValidationIssueData]:
    # Stage 1: exact-duplicate removal via fingerprint (same engine, rule,
    # location, and message — never by line number alone).
    seen: set[str] = set()
    unique: list[ValidationIssueData] = []
    for issue in issues:
        fingerprint = issue.fingerprint
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        unique.append(issue)

    # Stage 2: conservative cross-engine merge. Only collapses two issues
    # from DIFFERENT engines that land at the exact same language, line,
    # column, and category — anything less precise stays separate, so two
    # genuinely different defects (even on the same line) are never
    # accidentally combined. Keeps the higher-confidence / better-detailed
    # of the two.
    merged: dict[tuple, ValidationIssueData] = {}
    order: list[tuple] = []
    for issue in unique:
        # `issue.file` (editor_target-or-language) is included so an
        # inline-style/style-block finding — mapped onto HTML line/column
        # ranges — can never merge with an unrelated standalone-CSS-tab
        # finding just because both happen to land on the same line/column
        # of their own, entirely different, documents (see Sprint CSS-A).
        # For every pre-existing adapter `file == language` always, so this
        # is a no-op change to their merge behaviour.
        key = (issue.language, issue.file, issue.start_line, issue.start_column, issue.category)
        existing = merged.get(key)
        if existing is None:
            merged[key] = issue
            order.append(key)
            continue
        if existing.source_engine == issue.source_engine:
            # Same engine at the same exact spot with a different
            # fingerprint means a genuinely different finding — keep both
            # by not merging (fall through to appending under a
            # disambiguated key).
            order.append(key + (issue.fingerprint,))
            merged[key + (issue.fingerprint,)] = issue
            continue
        existing_rank = _CONFIDENCE_RANK.get(existing.confidence, 9)
        new_rank = _CONFIDENCE_RANK.get(issue.confidence, 9)
        existing_score = (existing_rank, -len(existing.suggestion), -len(existing.standards_reference))
        new_score = (new_rank, -len(issue.suggestion), -len(issue.standards_reference))
        merged[key] = issue if new_score < existing_score else existing

    return [merged[key] for key in order]


def _required_html_issue() -> ValidationIssueData:
    # Complete-LP mode treats a blank HTML source as one landing-page-level
    # defect, not an invitation to run all 5 HTML adapters against an empty
    # string (which would otherwise report ~6 separate document-structure
    # errors for a document that was never meant to exist yet).
    return ValidationIssueData(
        language='html',
        source_engine='orchestrator',
        engine_version='',
        rule_id='html-required-for-complete-validation',
        category='syntax',
        severity=SEVERITY_ERROR,
        message='Complete landing-page validation requires HTML source.',
        start_line=1,
        start_column=1,
        confidence=CONFIDENCE_DEFINITE,
        suggestion='Add HTML source, or switch to a single-language validation scope.',
        requires_manual_review=False,
    )


def _sort_key(issue: ValidationIssueData):
    return (
        issue.language,
        issue.start_line,
        issue.start_column or 0,
        severity_rank(issue.severity),
        issue.rule_id,
    )


def run(
    html: str,
    css: str = '',
    js: str = '',
    ts: str = '',
    profile: str = DEFAULT_PROFILE,
    validation_scope: str = DEFAULT_SCOPE,
) -> ValidationRunResult:
    if not is_known_profile(profile):
        profile = DEFAULT_PROFILE
    if not is_known_scope(validation_scope):
        validation_scope = DEFAULT_SCOPE

    deadline = time.perf_counter() + GLOBAL_TIME_BUDGET_SECONDS
    html = html or ''
    css = css or ''
    truncated_html, html_was_truncated = _truncate_lines(html)
    truncated_css, css_was_truncated = _truncate_lines(css)
    input_was_truncated = html_was_truncated or css_was_truncated

    issues: list[ValidationIssueData] = []
    statuses: list[EngineStatus] = []

    run_html = validation_scope in (ValidationScope.COMPLETE, ValidationScope.HTML)
    run_css = validation_scope in (ValidationScope.COMPLETE, ValidationScope.CSS)

    if run_html:
        if validation_scope == ValidationScope.COMPLETE and not truncated_html.strip():
            # One clear landing-page-level defect, not ~6 document-structure
            # errors generated by running every HTML adapter against ''.
            issues.append(_required_html_issue())
            statuses.append(EngineStatus(
                engine_name='html-required', success=True, duration_ms=0, issue_count=1,
            ))
        else:
            html_issues, html_statuses = _run_adapters(_HTML_ADAPTERS, truncated_html, profile, deadline)
            issues.extend(html_issues)
            statuses.extend(html_statuses)

    if run_css:
        css_issues, css_statuses = _run_adapters(_CSS_ADAPTERS, truncated_css, profile, deadline)
        issues.extend(css_issues)
        statuses.extend(css_statuses)

    if validation_scope in (ValidationScope.JAVASCRIPT, ValidationScope.TYPESCRIPT):
        # No engine exists yet (Sprint 1E) — the frontend must never offer
        # this scope as selectable while unavailable, but a direct API
        # caller still gets a safe, honest status rather than silently
        # running nothing with no explanation, or running HTML by mistake.
        statuses.append(EngineStatus(
            engine_name=f'{validation_scope}-conformance', success=False, duration_ms=0, issue_count=0,
            message='This validation engine is not available yet.',
        ))
    # js/ts sources are otherwise unused in Sprint 1D — accepted for
    # contract stability (Sprint 1E), intentionally not validated here.
    _ = js, ts

    issues = _dedupe(issues)
    issues.sort(key=_sort_key)

    truncated_issue_count = 0
    if len(issues) > MAX_ISSUES:
        truncated_issue_count = len(issues) - MAX_ISSUES
        issues = issues[:MAX_ISSUES]

    if input_was_truncated:
        statuses.append(EngineStatus(
            engine_name='input-limits', success=True, duration_ms=0, issue_count=0,
            message=f'Input truncated to the first {MAX_LINE_COUNT} lines before validation.',
        ))
    if truncated_issue_count:
        statuses.append(EngineStatus(
            engine_name='input-limits', success=True, duration_ms=0, issue_count=0,
            message=f'{truncated_issue_count} additional issue(s) were truncated (limit {MAX_ISSUES}).',
        ))

    return ValidationRunResult(
        issues=issues,
        engine_status=statuses,
        truncated=input_was_truncated or truncated_issue_count > 0,
        truncated_issue_count=truncated_issue_count,
        validation_scope=validation_scope,
    )

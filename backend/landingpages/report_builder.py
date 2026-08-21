"""Shared validation-report persistence — runs deterministic validation +
AI Engineer full-source analysis and persists a ValidationReport + its
ValidationIssue rows. Extracted from ValidateView.post() (AI Fix Issues
functional-completion sprint) so the iterative AI Fix Issues orchestration
(fixes/iterative.py) can create a fresh, REAL persisted report at the
start of every iteration — compute_patches_for_issues/build_issue_context
operate on real ValidationIssue model rows (`.id`, `.fingerprint`), not
bare ValidationIssueData dataclasses, so there is no cheaper/leaner way to
give the fix pipeline something it can act on. ValidateView itself is now
a thin wrapper around `persist_validation_report` — this is a pure
extract-function refactor, no behavior change for the existing endpoint.
"""

import logging
import time

from .ai_engineer import analyze as run_ai_engineer_analysis
from .models import ValidationIssue, ValidationReport
from .validation.engine import run as run_validation

logger = logging.getLogger(__name__)


def persist_validation_report(
    *, user, project, html, css, js, ts, ampscript, profile, validation_scope, css_source_type,
    on_progress=None,
):
    """Returns (report, result) — `report` is the persisted ValidationReport
    (its `.issues` related rows are freshly created, real DB objects);
    `result` is the raw ValidationRunResult (used for the generated_css
    transient fields ValidateView's response includes but the model
    doesn't persist). Never raises for an AI Engineer failure — see the
    try/except below, identical in spirit to ValidateView's original
    inline version. CAN raise for a genuine unexpected error; callers
    (ValidateView, fixes/iterative.py) each own their own outer safety net
    appropriate to their response shape.

    `on_progress`, when given, is called as `on_progress(stage=...)` at
    each real checkpoint (AI Validate Code Live Progress sprint) — passed
    straight through to the deterministic engine for its own per-language
    checkpoints, plus this function's own 'ai_analysis' and 'finalizing'
    checkpoints around the AI Engineer full-source analysis step below."""
    def _emit(stage):
        if on_progress is None:
            return
        try:
            on_progress(stage=stage)
        except Exception:  # noqa: BLE001 - a progress-reporting failure must never abort persistence
            logger.warning('landingpages.report_builder.on_progress_failed', exc_info=True)

    started_at = time.perf_counter()
    result = run_validation(
        html=html, css=css, js=js, ts=ts, ampscript=ampscript,
        profile=profile, validation_scope=validation_scope, project=project,
        css_source_type=css_source_type, on_progress=on_progress,
    )
    duration_ms = int((time.perf_counter() - started_at) * 1000)
    issues = result.issues
    engine_statuses = list(result.engine_status)
    analysis_coverage = {}

    _emit('ai_analysis')
    try:
        ai_result = run_ai_engineer_analysis(
            sources={'html': html, 'css': css, 'javascript': js, 'ampscript': ampscript},
            deterministic_issues=issues,
            validation_scope=result.validation_scope,
            css_source_type=result.css_source_type,
            profile=profile,
            rate_limit_identifier=str(user.pk),
        )
        issues = ai_result.issues
        analysis_coverage = ai_result.coverage
        if ai_result.coverage:
            engine_statuses.append(ai_result.engine_status)
    except Exception:  # noqa: BLE001 - AI Engineer is additive; never let it break deterministic validation
        logger.exception('landingpages.ai_engineer.unexpected_error')
        engine_statuses.append({
            'engine_name': 'ai-engineer', 'success': False, 'duration_ms': 0, 'issue_count': 0,
            'message': 'AI Engineer analysis unavailable.',
        })
    _emit('finalizing')

    error_count = sum(1 for issue in issues if issue.severity == 'error')
    warning_count = sum(1 for issue in issues if issue.severity == 'warning')
    info_count = sum(1 for issue in issues if issue.severity == 'info')

    report = ValidationReport.objects.create(
        user=user,
        project=project,
        duration_ms=duration_ms,
        profile=profile,
        validation_scope=result.validation_scope,
        css_source_type=result.css_source_type,
        engine_status=[
            {
                'engine_name': status_entry.engine_name,
                'success': status_entry.success,
                'duration_ms': status_entry.duration_ms,
                'issue_count': status_entry.issue_count,
                'message': status_entry.message,
            }
            if not isinstance(status_entry, dict) else status_entry
            for status_entry in engine_statuses
        ],
        analysis_coverage=analysis_coverage,
        error_count=error_count,
        warning_count=warning_count,
        info_count=info_count,
    )
    ValidationIssue.objects.bulk_create(
        ValidationIssue(
            report=report,
            severity=issue.severity,
            category=issue.category,
            rule_id=issue.rule_id,
            message=issue.message,
            file=issue.file,
            language=issue.language,
            line=issue.line,
            column=issue.column,
            suggestion=issue.suggestion,
            auto_fixable=issue.auto_fixable,
            risk=issue.risk,
            fingerprint=issue.fingerprint,
            source_engine=issue.source_engine,
            engine_version=issue.engine_version,
            standards_reference=issue.standards_reference,
            confidence=issue.confidence,
            end_line=issue.end_line,
            end_column=issue.end_column,
            code_excerpt=issue.code_excerpt,
            fix_type=issue.fix_type,
            deterministic_fix=issue.deterministic_fix,
            requires_manual_review=issue.requires_manual_review,
            related_element=issue.related_element,
            related_attribute=issue.related_attribute,
            source_context=issue.source_context,
            source_block_index=issue.source_block_index,
            source_asset_id=issue.source_asset_id,
            generated_start_line=issue.generated_start_line,
            generated_start_column=issue.generated_start_column,
            ai_metadata=issue.ai_metadata,
            root_cause_id=issue.root_cause_id,
        )
        for issue in issues
    )
    return report, result

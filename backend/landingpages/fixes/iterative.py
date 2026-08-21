"""AI Engineer Autonomous Repair — Module 3 LP Validator & Fixer.

"AI Fix Issues" means: AI Engineer, repair all currently repairable issues
in the selected scope, revalidate, discover newly exposed issues, and
continue repairing until the source is valid or no safe/provable repair can
be made. Clicking the button IS the user's consent for this whole
operation — there is no second per-issue approval dialog for ordinary
repairs (spec section 1/17/18). `Undo Applied Fixes` remains the rollback
mechanism.

Every iteration re-validates from a REAL, freshly persisted
ValidationReport (via report_builder.persist_validation_report) — the same
deterministic-engines-plus-AI-Engineer pipeline "AI Validate Code" itself
uses — never trusting a prior iteration's in-memory issue list. Malformed
source routinely hides secondary defects behind a root error (a parser
recovers past `<html` missing its `>` and never sees `<head>` at all — see
html_lexical.py); fixing the root defect and revalidating is often the ONLY
way later defects (including a JS/CSS parser-blocking syntax error hiding
downstream lint findings — spec section 10) ever become visible/fixable at
all. This loop gets that "fix root cause, reparse, find more, fix those"
behavior for free from re-persisting fresh every round — no special-cased
recovery pass is needed.

EVERY iteration attempts EVERY currently actionable issue — deterministic-
safe fixes first (free, always trustworthy), then AI-assisted fixes for
whatever remains (errors prioritized over warnings — spec section 23).
Same-region compatible findings are merged into one coherent structural
repair before conflict detection (fixes/regions.py) — genuine TRUE
conflicts (incompatible rewrites of the same source range) and proposals
that explicitly require external configuration/business data are recorded
as "requires input" and left alone; everything else is applied immediately,
no waiting for a human to tick a box.

REGRESSION GUARD (spec section 15/16): an iteration's applied changes are
only kept if the freshly revalidated error count does not INCREASE versus
before that iteration's patches were applied. A regressing iteration is
rolled back to its pre-iteration source and the loop stops there — the
editor is never left worse than it started.
"""

import dataclasses
import hashlib
import json
import logging

from django.conf import settings
from django.core.cache import cache

from .. import perf_metrics
from . import apply_patches_to_source, compute_patches_for_issues, detect_conflicts
from . import documentation, formatting, repair_memory, shell_recovery, verified_recipes
from .html_invariants import check_html_structural_invariants, check_no_new_duplicate_singletons
from .regions import merge_compatible_insertions
from ..ai_review import build_issue_context, validate_proposals
from ..ai_review.provider import (
    AIReviewRequest as AIReviewProviderRequest,
    AIReviewUnavailable,
    WholeSourceIssueSummary,
    WholeSourceRepairRequest,
    get_default_ai_review_provider,
)
from ..knowledge import research
from ..knowledge.hints import get_repair_hint
from ..report_builder import persist_validation_report
from ..validation.rules import get_rule

logger = logging.getLogger('landingpages.fixes.iterative')

_MAX_ISSUES_PER_ITERATION = 100  # mirrors the frontend's MAX_DETERMINISTIC_BATCH
_MAX_AI_ISSUES_PER_ITERATION = 30  # mirrors MAX_AI_BATCH / MAX_AI_REVIEW_ISSUE_IDS

# Deep Validation spec section 7/15 — a parser/compiler that aborts the
# WHOLE document on one blocking defect (ESLint's fatal parse errors,
# PostCSS's parse abort, the Sass/LESS compilers) hides every other
# finding in that file until the blocker itself is fixed. Genuinely
# resolving one of these can legitimately EXPOSE more error-severity
# findings next round than were visible before — that is progress, not a
# regression, and must never be reverted by the naive "error count went
# up" guard below (see _round_resolved_a_parser_blocker).
_PARSER_BLOCKING_RULE_IDS = frozenset({
    'javascript:parse-error', 'css-structure:parse-error', 'parser-error',
    'scss:compile-error', 'sass:compile-error', 'less:compile-error',
})
_PARSER_BLOCKING_PREFIXES = ('html5lib:', 'nu:')


def _is_parser_blocking_rule(rule_id: str) -> bool:
    if rule_id in _PARSER_BLOCKING_RULE_IDS:
        return True
    return rule_id.startswith(_PARSER_BLOCKING_PREFIXES)


def _round_resolved_a_parser_blocker(previous_issues, current_issues) -> bool:
    current_fingerprints = {issue.fingerprint for issue in current_issues}
    return any(
        issue.fingerprint not in current_fingerprints and _is_parser_blocking_rule(issue.rule_id)
        for issue in previous_issues
    )


# Deep Validation spec section 4/10/11, Checkpoint 6 — Whole-Source AI
# Repair. Reserved for genuinely document-shell-malformed cases where
# regional patching has ALREADY failed to make progress this run (see the
# 'no_actionable' branch in run_autonomous_repair) — never the default
# path, and never available to "AI Fix This Issue" (spec section 12),
# which never calls into this module's whole-source machinery at all.
_WHOLE_SOURCE_ELIGIBLE_EXTRA_RULE_IDS = frozenset({'missing-html', 'missing-head', 'missing-body', 'malformed-start-tag'})
_FILE_TO_SOURCE_KEY = {'html': 'html', 'css': 'css', 'javascript': 'js', 'ampscript': 'ampscript'}


def _is_whole_source_eligible_rule(rule_id: str) -> bool:
    return _is_parser_blocking_rule(rule_id) or rule_id in _WHOLE_SOURCE_ELIGIBLE_EXTRA_RULE_IDS


def _files_eligible_for_whole_source_repair(current_issues) -> set[str]:
    return {
        _FILE_TO_SOURCE_KEY[issue.file]
        for issue in current_issues
        if issue.file in _FILE_TO_SOURCE_KEY and _is_whole_source_eligible_rule(issue.rule_id)
    }


@dataclasses.dataclass
class AIRepairMetaEntry:
    """Regional/Whole-Source AI Outcome-Recording Symmetry sprint —
    everything needed to record ONE AI-produced repair attempt's outcome
    once a real authoritative revalidation proves whether it helped,
    regardless of which of the four entry points (AI Fix Issues batch,
    AI Fix This Issue, whole-source repair, Complete LP repair — all of
    which funnel through this same module) produced it. `knowledge_records`
    holds the actual AuthoritativeKnowledgeRecord objects consulted for
    this attempt (for an immediate `research.record_outcome` call); their
    ids are ALSO in `environment_extra['consulted_knowledge_ids']` so the
    fact is visible in the RepairKnowledgeRecord's own persisted
    `last_verified_environment` (spec requirement 2), without adding a new
    model field."""

    rule_id: str
    language: str
    context_signature: str
    strategy_key: str
    strategy_description: str
    environment_extra: dict
    knowledge_records: list = dataclasses.field(default_factory=list)


def _build_ai_repair_meta(issue) -> 'AIRepairMetaEntry':
    """Coarse, generalized (never content-bearing — spec requirement 7)
    outcome-tracking entry for one issue an AI-produced candidate targets.
    `strategy_description` is a FIXED, rule_id-keyed template, never the
    model's own freeform explanation text — that text could echo source
    content, and this ledger only ever stores generalized facts (same
    privacy posture as repair_memory.py's recipe outcomes)."""
    context_signature = repair_memory.compute_generic_context_signature(
        severity=issue.severity, source_context=issue.source_context or '', file=issue.file,
    )
    knowledge_records = []
    if get_rule(issue.rule_id, issue.language) is None:
        record = research.cached_knowledge(language=issue.language, rule_id=issue.rule_id)
        if record is not None:
            knowledge_records.append(record)
    return AIRepairMetaEntry(
        rule_id=issue.rule_id, language=issue.language, context_signature=context_signature,
        strategy_key=repair_memory.AI_STRATEGY_KEY,
        strategy_description=f'AI-generated repair for {issue.rule_id}',
        environment_extra={'consulted_knowledge_ids': [record.id for record in knowledge_records]},
        knowledge_records=knowledge_records,
    )


def _is_rejected_ai_strategy(issue) -> bool:
    """A read-only observability lookup — True when the generalized
    (language, rule_id, context) this issue belongs to already has a
    REJECTED ai-repair strategy on record. NOT used to gate whether AI is
    attempted (spec requirement 8's "must not be retried blindly" is
    honored by NEVER replaying/caching raw AI output in the first place —
    there is nothing FOR a future attempt to blindly reuse; see
    AI_STRATEGY_KEY's docstring). An earlier version of this sprint used
    this to SKIP a same-run retry, which was wrong: unlike a deterministic
    recipe (same code, same input, provably the same result every time),
    a single round's non-resolution of an AI proposal is often transient
    (a same-anchor conflict with another patch that round, a candidate
    needing a later round's OTHER fix first, ...) — gating on it broke
    real repairs that would have succeeded on a later iteration of the
    SAME run (regression caught by test_css_torture_fixture.py /
    test_ampscript_torture_fixture.py). Kept as a pure query for callers
    that want to know the ledger's current verdict without acting on it."""
    context_signature = repair_memory.compute_generic_context_signature(
        severity=issue.severity, source_context=issue.source_context or '', file=issue.file,
    )
    return repair_memory.is_rejected_strategy(
        language=issue.language, rule_id=issue.rule_id, context_signature=context_signature,
        strategy_key=repair_memory.AI_STRATEGY_KEY,
    )


def _record_ai_repair_outcomes(meta_by_fingerprint: dict, resolved_fingerprints: set, *, profile, rolled_back=False) -> None:
    """The single outcome-recording path for EVERY AI-produced candidate,
    regional or whole-source (spec requirement 1/3) — never called until a
    real authoritative revalidation has run; `resolved_fingerprints` comes
    from the SAME fingerprint-diff machinery every other repair stream in
    this module already uses (_diff_counts/_fingerprint_status_diff for
    regional, a direct before/after fingerprint-set diff for whole-source
    — see its call sites), so "success" here always means what spec
    requirement 3 defines it as: the target issue's fingerprint is
    confirmed gone from a freshly persisted, authoritative
    ValidationReport, never merely that the AI call returned."""
    for fingerprint, meta in meta_by_fingerprint.items():
        success = fingerprint in resolved_fingerprints
        repair_memory.record_attempt_result(
            language=meta.language, rule_id=meta.rule_id, context_signature=meta.context_signature,
            strategy_key=meta.strategy_key, success=success, strategy_description=meta.strategy_description,
            environment={'profile': profile, **meta.environment_extra}, rolled_back=rolled_back,
        )
        for record in meta.knowledge_records:
            research.record_outcome(record, helped=success)


def _try_accept_whole_source_candidate(
    *, file_key, language, user, project, sources, corrected, css_source_type, validation_scope, profile,
    current_error_count, previous_issues=(),
):
    """Generalized Full-Source Repair sprint, spec section 1/16/17/34 —
    the SAME candidate-acceptance gate for a whole-source candidate in
    ANY language, wherever one is considered (deterministic recovery,
    the whole-source AI fallback, or the "no actionable regional patch"
    fallback): no content-preservation fact may be lost, and the
    resulting error count must not exceed what the source had before —
    UNLESS the candidate resolved a parser/compiler-blocking defect
    (JavaScript Source-Recovery Architecture sprint, spec section 2/5/13,
    extending the SAME exemption `_round_resolved_a_parser_blocker`
    already grants the regional path). A source that no longer aborts
    parsing routinely EXPOSES real findings a fatal syntax error was
    hiding — going from "1 error (unparseable, everything else hidden)"
    to "3 errors (parses, and now honestly reports what was always
    there)" is objective progress, not regression; naively comparing raw
    error counts here rejected exactly that progress and left the editor
    stuck on the original parse error forever (the reported "Resolved 0,
    Remaining 1" symptom). HTML additionally must pass its own document-
    shell structural invariants (a concept that only makes sense for
    HTML). Returns (accepted, candidate_sources, candidate_report,
    candidate_result) — the last three are None when accepted is False."""
    if corrected is None or corrected == sources.get(file_key, ''):
        return False, None, None, None
    if file_key == 'html':
        violations = check_html_structural_invariants(corrected)
        violations += check_no_new_duplicate_singletons(sources.get('html', ''), corrected)
        if violations:
            logger.warning(
                'landingpages.fixes.whole_source_repair.structural_invariant_rejected violations=%s', violations,
            )
            return False, None, None, None
    if not shell_recovery.content_preserved_for_language(language, sources.get(file_key, ''), corrected):
        logger.warning(
            'landingpages.fixes.whole_source_repair.content_not_preserved file_key=%s', file_key,
        )
        return False, None, None, None
    candidate_sources = dict(sources)
    candidate_sources[file_key] = corrected
    candidate_report, candidate_result = persist_validation_report(
        user=user, project=project,
        html=candidate_sources['html'], css=candidate_sources['css'], js=candidate_sources['js'],
        ts='', ampscript=candidate_sources['ampscript'],
        profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
    )
    candidate_issues = list(candidate_report.issues.all())
    candidate_error_count = sum(1 for issue in candidate_issues if issue.severity == 'error')
    resolved_a_parser_blocker = _round_resolved_a_parser_blocker(previous_issues, candidate_issues)
    if candidate_error_count > current_error_count and not resolved_a_parser_blocker:
        logger.warning(
            'landingpages.fixes.whole_source_repair.worse_rejected file_key=%s before_errors=%s after_errors=%s',
            file_key, current_error_count, candidate_error_count,
        )
        return False, None, None, None
    return True, candidate_sources, candidate_report, candidate_result


def _attempt_whole_source_repair(file_key, sources, current_issues, css_source_type, rate_limit_identifier):
    """Returns `(corrected_source_or_None, ai_meta_by_fingerprint)`.
    `corrected_source` is None if the provider is unavailable, the source
    is too large for this mode, the provider declined, or nothing was
    actually returned. NEVER validates or applies anything itself — the
    caller (run_autonomous_repair) is solely responsible for the
    candidate-first revalidate/compare/publish-or-reject decision, exactly
    like every regional patch.

    `ai_meta_by_fingerprint` (Regional/Whole-Source AI Outcome-Recording
    Symmetry sprint, extending the Controlled Self-Learning sprint's spec
    section 33/35) is an `{issue.fingerprint: AIRepairMetaEntry}` map for
    every issue this request targeted — including which
    AuthoritativeKnowledgeRecord(s), if any, supplemented this issue's
    repair_hint because the local Rule Knowledge Registry had nothing for
    it. The caller records every entry's outcome once the real
    authoritative revalidation result is known (see
    _record_ai_repair_outcomes) — never speculatively here, and using the
    SAME strategy_key/context-signature scheme regional repair uses, so a
    whole-source success or failure for a rule/context is visible to
    future regional attempts at that same rule/context and vice versa."""
    provider = get_default_ai_review_provider()
    if provider is None:
        return None, {}
    source = sources.get(file_key, '')
    if not source or len(source) > settings.LP_AI_REPAIR_WHOLE_SOURCE_MAX_INPUT_LENGTH:
        return None, {}
    language = next((issue.language for issue in current_issues if _FILE_TO_SOURCE_KEY.get(issue.file) == file_key), None)
    if language is None:
        return None, {}
    file_issues = [issue for issue in current_issues if _FILE_TO_SOURCE_KEY.get(issue.file) == file_key]
    issue_summaries = []
    ai_meta_by_fingerprint = {}
    for issue in file_issues:
        hint = get_repair_hint(language=issue.language, rule_id=issue.rule_id)
        ai_meta_by_fingerprint[issue.fingerprint] = _build_ai_repair_meta(issue)
        issue_summaries.append(WholeSourceIssueSummary(
            issue_id=issue.id, rule_id=issue.rule_id, message=issue.message,
            severity=issue.severity, line=issue.line, repair_hint=hint,
        ))
    target_platform = 'sfmc-cloudpages' if language == 'ampscript' else None

    # HTML Whole-Document Structural Recovery sprint, spec section 7/8/9
    # — every embedded <style>/<script> region and AMPscript block is
    # protected behind an opaque placeholder before the model ever sees
    # this document, so shell-repair reasoning can never reinterpret
    # CSS/JS tokens or split an AMPscript delimiter. Only applied for
    # 'html' — the other file_keys ARE the embedded language itself.
    placeholders: dict = {}
    request_source = source
    if file_key == 'html':
        request_source, placeholders = shell_recovery.protect_embedded_regions(source)

    try:
        result = provider.repair_whole_source(WholeSourceRepairRequest(
            file_key=file_key, language=language, source=request_source, issues=issue_summaries,
            css_source_type=css_source_type, target_platform=target_platform,
            rate_limit_identifier=rate_limit_identifier,
        ))
    except AIReviewUnavailable:
        return None, {}
    except (AttributeError, NotImplementedError):
        # This provider does not (yet) implement whole-source repair —
        # an optional capability, not a hard requirement of the
        # AIReviewProvider interface. Treat exactly like "declined."
        return None, {}

    corrected = result.corrected_source
    if corrected is None:
        return None, {}
    if file_key == 'html' and placeholders:
        # Spec section 12 — a candidate that dropped/duplicated/altered
        # even one protected placeholder is proof it corrupted an
        # embedded region; reject outright rather than guess a repair.
        restored = shell_recovery.restore_embedded_regions(corrected, placeholders)
        if restored is None:
            logger.warning('landingpages.fixes.whole_source_repair.embedded_region_corrupted')
            return None, {}
        return restored, ai_meta_by_fingerprint
    return corrected, ai_meta_by_fingerprint


_LANGUAGE_GROUP = {
    'html': 'html', 'css': 'css', 'javascript': 'javascript',
    'ampscript': 'ampscript', 'typescript': 'javascript', 'cdn': 'html',
}


@dataclasses.dataclass
class IterationRecord:
    iteration: int
    issues_before: int
    fix_candidates_generated: int
    fixes_applied: int
    issues_resolved: int
    issues_new: int
    ai_requested: bool
    ai_unavailable: bool


@dataclasses.dataclass
class AutonomousFixResult:
    report: object  # final, freshly persisted ValidationReport (real DB row)
    result: object  # final raw ValidationRunResult — carries generated_css* transient fields
    final_sources: dict  # {'html', 'css', 'js', 'ampscript'}
    iterations: list  # list[IterationRecord]
    issues_before_total: int
    fix_candidates_generated_total: int
    fixes_applied_total: int
    issues_resolved_total: int
    issues_remaining_total: int
    issues_new_total: int
    issues_requires_input_total: int
    # Consistent Validation Counts sprint, section 1/2/33 — the explicit
    # lifecycle breakdown a caller needs to reconcile
    # FINAL == INITIAL - RESOLVED + NEW without re-deriving it from
    # issues_before_total/before_error/before_warning by hand every time.
    issues_before_error_total: int
    issues_before_warning_total: int
    issues_final_error_total: int
    issues_final_warning_total: int
    issues_unrepairable_total: int  # remaining minus requires-input minus advisory-only (nothing durable blocked these; a future run may still resolve them)
    # Closure spec section 12 — an ADVISORY_ONLY finding (Rule Knowledge
    # Registry documents no repair strategy exists at all) is NOT a
    # repair failure and must not be counted as "unrepairable" alongside
    # a genuinely-attempted-and-blocked issue — issues_unrepairable_total
    # now excludes these (a small, deliberate refinement of what
    # "unrepairable" means, not a breaking count change:
    # issues_remaining_total is untouched, and advisory issues were never
    # counted in issues_requires_input_total either).
    issues_advisory_total: int
    by_language: dict  # {'html': {'before':N,'resolved':N,'remaining':N,'new':N}, ...}
    stopped_reason: str
    # 'all_resolved' | 'no_actionable' | 'no_progress' | 'max_iterations' |
    # 'regression_reverted' | 'candidate_rejected' | 'structural_recovery_failed'
    ai_unavailable_ever: bool


def _diff_counts(previous_issues, current_issues):
    """Fingerprint-based, never by issue id (a new report's rows always
    have new ids — see persist_validation_report)."""
    previous_fp = {issue.fingerprint for issue in previous_issues}
    current_fp = {issue.fingerprint for issue in current_issues}
    resolved = len(previous_fp - current_fp)
    new = len(current_fp - previous_fp)
    return resolved, new


# Live Validation + Fix Progress sprint, section 5/6/25/26 — per-card
# status, keyed by the SAME stable issue.fingerprint the frontend already
# uses everywhere else (never a DB row id, which is always fresh per
# persist_validation_report call). 'resolved' is only ever assigned once
# revalidation has actually confirmed the fingerprint is gone (section 6:
# "green means verified resolved") — never at proposal-generation time.
def _fingerprint_status_diff(previous_issues, current_issues):
    previous_fps = {issue.fingerprint for issue in previous_issues}
    current_fps = {issue.fingerprint for issue in current_issues}
    updates = {fp: 'resolved' for fp in previous_fps - current_fps}
    updates.update({fp: 'newly_exposed' for fp in current_fps - previous_fps})
    return updates


# AI Engineer Formatting + Documentation sprint — see its call site in
# run_autonomous_repair for why this exists: reindenting the whole
# document shifts every issue's line/column, and fingerprints include
# line/column, so a fingerprint captured before formatting no longer
# matches the SAME finding afterward. Matches purely on (rule_id, file,
# message) — never on position — and only within same-key groups, paired
# in encounter order; genuinely ambiguous cases (more than one identical
# rule_id/file/message pair blocked at once) get a best-effort pairing
# rather than a guaranteed-exact one, which is an acceptable, rare
# imprecision here (this only affects "requires input" bucketing
# metadata, never which patches were applied or the actual source).
def _build_fingerprint_remap(old_issues, new_issues) -> dict:
    def _key(issue):
        return (issue.rule_id, issue.file, issue.message)

    old_by_key: dict = {}
    for issue in old_issues:
        old_by_key.setdefault(_key(issue), []).append(issue.fingerprint)
    new_by_key: dict = {}
    for issue in new_issues:
        new_by_key.setdefault(_key(issue), []).append(issue.fingerprint)

    remap = {}
    for key, old_fingerprints in old_by_key.items():
        new_fingerprints = new_by_key.get(key)
        if not new_fingerprints:
            continue
        for old_fp, new_fp in zip(old_fingerprints, new_fingerprints):
            if old_fp != new_fp:
                remap[old_fp] = new_fp
    return remap


def _record_recipe_outcomes(recipe_meta, resolved_fingerprints, *, profile, rolled_back=False):
    """Verified Repair Memory sprint — the caller supplies `recipe_meta`
    (the fingerprint->strategy metadata a PRIOR round's
    _attempt_verified_recipes returned) and `resolved_fingerprints` (the
    'resolved' set from the diff between that round's before/after issue
    lists). Every recipe-attempted fingerprint is recorded as a success
    if it disappeared, a failure otherwise — this is the ONLY place a
    recipe's outcome is ever written to repair_memory, and it only ever
    runs after a real authoritative revalidation, never speculatively."""
    for fingerprint, (rule_id, language, context_signature, strategy_key, strategy_description, environment_extra) in recipe_meta.items():
        repair_memory.record_attempt_result(
            language=language, rule_id=rule_id, context_signature=context_signature, strategy_key=strategy_key,
            success=fingerprint in resolved_fingerprints, strategy_description=strategy_description,
            environment={'profile': profile, **environment_extra}, rolled_back=rolled_back,
        )


# Warning Auto-Repair sprint, spec section 6 — a coarse, reporting-and-
# efficiency classification layered on the Rule Knowledge Registry's
# existing fields, NOT a new gate on whether repair is attempted (that
# remains the real, live 'requires_configuration'/conflict signal a
# proposal itself returns): ADVISORY_ONLY means the registry itself
# documents no repair strategy exists at all (e.g.
# 'ampscript:too-many-regions' — "Informational only.") — there is
# nothing to fix, so this only saves a pointless AI request/recipe
# attempt for it, never blocks a real repairable finding.
def _is_advisory_only(issue):
    rule = get_rule(issue.rule_id, issue.language)
    return rule is not None and rule.repair_strategy.strip().lower() == 'informational only.'


def _round_target_issue_statuses(det_applicable, ai_applicable, blocked):
    """'fixing' for every issue a candidate is actually being attempted
    for this round; 'requires_input' for anything blocked (a true
    conflict, or a proposal that explicitly needs external
    configuration/business data — see _autonomous_round_patches). Both
    keyed by the patch's own `.fingerprint`, which is always copied from
    the originating issue's fingerprint (fixes/catalogue.py and
    ai_review/validation.py both set it that way)."""
    updates = {
        patch.fingerprint: 'fixing'
        for patch in (*det_applicable, *ai_applicable)
        if patch.fingerprint
    }
    updates.update({fingerprint: 'requires_input' for fingerprint in blocked})
    return updates


def _by_language_snapshot(issues):
    counts = {}
    for issue in issues:
        group = _LANGUAGE_GROUP.get(issue.language, issue.language)
        counts[group] = counts.get(group, 0) + 1
    return counts


def _request_ai_proposals(
    issue_ids, current_issues, sources_for_context, css_source_type, validation_scope, profile, rate_limit_identifier,
):
    """Returns (proposals: list[ai_review.validation.AIProposal], requested:
    bool, unavailable: bool) — every status ('safe', 'conflict', 'rejected')
    is included so callers can tell WHY an issue wasn't fixed, not just
    whether it was."""
    if not issue_ids:
        return [], False, False
    provider = get_default_ai_review_provider()
    if provider is None:
        return [], False, True
    issues_by_id = {issue.id: issue for issue in current_issues}
    issue_contexts = [
        context for context in (
            build_issue_context(issues_by_id[iid], sources_for_context) for iid in issue_ids if iid in issues_by_id
        ) if context is not None
    ]
    if not issue_contexts:
        return [], False, False
    target_platform = 'sfmc-cloudpages' if any(c.language == 'ampscript' for c in issue_contexts) else None
    try:
        ai_result = provider.review(AIReviewProviderRequest(
            issues=issue_contexts, css_source_type=css_source_type, validation_scope=validation_scope,
            target_platform=target_platform, rate_limit_identifier=rate_limit_identifier,
        ))
    except AIReviewUnavailable:
        return [], True, True
    proposals, _not_reviewed = validate_proposals(
        ai_result.proposals, current_issues, issue_ids, sources_for_context,
        profile=profile, css_source_type=css_source_type,
    )
    return proposals, True, False


def _apply_selected(sources, patches):
    """Applies `patches` (already conflict-filtered, spanning possibly
    several source files) and returns (new_sources, applied_count)."""
    by_file: dict[str, list] = {}
    for patch in patches:
        by_file.setdefault(patch.file, []).append(patch)
    new_sources = dict(sources)
    applied_count = 0
    for file_key, file_patches in by_file.items():
        new_source, file_results = apply_patches_to_source(sources[file_key], file_patches)
        if new_source is not None:
            new_sources[file_key] = new_source
            applied_count += sum(1 for entry in file_results if entry.status == 'applied')
    return new_sources, applied_count


def _try_native_autofix(sources, css_source_type, profile, current_issues):
    """Tool-Grounded AI Engineer sprint, spec section 3/6/7 — the tier
    between raw validation and Verified Repair Memory/AI: the SAME rule
    engine that just reported an issue (Stylelint for CSS/LESS/SCSS,
    ESLint for JS) is asked to fix whatever it can fix itself, before
    anything else is even attempted. Returns an updated sources dict if
    ANY file actually changed, else None — a None return falls straight
    through to the existing recipe/AI tiers unchanged. Never raises: a
    NodeBridgeError here means "skip native autofix for this round," not
    a whole-run failure, exactly like every other deterministic-tier
    helper in this module treats a transport-level failure."""
    changed = False
    new_sources = dict(sources)

    css_populated = bool(sources.get('css', '').strip())
    if css_populated and any(issue.file == 'css' for issue in current_issues):
        fixed_css = _try_css_family_native_autofix(sources['css'], css_source_type)
        if fixed_css is not None and fixed_css != sources['css']:
            new_sources['css'] = fixed_css
            changed = True

    js_populated = bool(sources.get('js', '').strip())
    if js_populated and any(issue.file == 'javascript' for issue in current_issues):
        fixed_js = _try_js_native_autofix(sources['js'], profile)
        if fixed_js is not None and fixed_js != sources['js']:
            new_sources['js'] = fixed_js
            changed = True

    return new_sources if changed else None


def _try_css_family_native_autofix(css, css_source_type):
    from ..validation import node_bridge

    try:
        if css_source_type == 'css':
            result = node_bridge.run_css_autofix(css)
        elif css_source_type in ('less', 'scss'):
            result = node_bridge.run_preprocessor_autofix(css, css_source_type)
        else:
            # 'sass' (indented syntax) has no source-level autofix path —
            # see validators_node/autofix_preprocessor.mjs's own comment
            # on why: no comparably maintained official postcss custom-
            # syntax package exists, and the syntax is whitespace-
            # significant, so this project declines rather than risk
            # silently corrupting meaning.
            return None
    except node_bridge.NodeBridgeError:
        return None
    if not isinstance(result, dict) or not result.get('success'):
        return None
    return result.get('fixed')


def _try_js_native_autofix(js, profile):
    from ..validation import node_bridge

    try:
        result = node_bridge.run_js_autofix(js, profile)
    except node_bridge.NodeBridgeError:
        return None
    if not isinstance(result, dict) or not result.get('success'):
        return None
    return result.get('fixed')


def _attempt_verified_recipes(current_issues, ids_to_try, sources, css_source_type, profile):
    """Verified Repair Memory sprint — the priority tier between
    deterministic catalogue fixes and AI Engineer reasoning (spec section
    10: deterministic -> Verified Repair Knowledge -> AI). Every recipe
    is cheap/local (no LLM call); negative memory is checked before a
    candidate is accepted so a strategy already proven NOT to work in
    this exact structural context is never retried (spec section 11).

    Returns a list of (issue_id, context_signature, RecipeResult) — the
    caller runs the SAME conflict detection on the flattened patches as
    every other candidate stream, then accepts each RecipeResult
    ATOMICALLY: if conflict detection would drop ANY one of its patches
    (a "move" needs both its insert and remove patches), ALL of that
    result's patches are dropped rather than applied partially, which
    would corrupt the source rather than repair it."""
    issues_by_id = {issue.id: issue for issue in current_issues}
    attempts = []
    for issue_id in ids_to_try:
        issue = issues_by_id.get(issue_id)
        if issue is None or issue.rule_id not in verified_recipes.known_rule_ids():
            continue
        result = verified_recipes.generate_recipe_result(issue, sources, css_source_type, profile)
        if result is None or not result.patches:
            continue
        context_signature = repair_memory.compute_context_signature(result.context_facts)
        if repair_memory.is_rejected_strategy(
            language=result.patches[0].language, rule_id=issue.rule_id,
            context_signature=context_signature, strategy_key=result.strategy_key,
        ):
            continue
        attempts.append((issue_id, context_signature, result))
    return attempts


def _autonomous_round_patches(current_issues, sources, css_source_type, profile, validation_scope, *, rate_limit_identifier):
    """Every currently actionable issue is attempted this round — no
    per-issue pre-approval gate (the "AI Fix Issues" click already IS
    consent for the whole operation). Deterministic-safe fixes are always
    free and trustworthy, then Verified Repair Knowledge recipes (also
    free/local — spec section 10), then AI-assisted fixes for whatever
    remains, errors prioritized over warnings (spec section 23), capped
    per iteration for cost control.

    Returns (det_applicable_patches, ai_applicable_patches, blocked:
    dict[fingerprint -> reason], ai_requested, ai_unavailable,
    recipe_meta: dict[fingerprint -> tuple]) — det_applicable already
    includes any accepted verified-recipe patches (both are local,
    no-LLM-call candidates); recipe_meta identifies which of
    det_applicable's fingerprints came from a recipe, for the caller to
    record success/failure into repair_memory once revalidated.
    det_applicable/ai_applicable are kept as TWO separate lists (not one
    combined batch) so the caller can apply them in two separate passes:
    a single wrong/stale AI proposal must never block an unrelated,
    always-trustworthy deterministic fix from landing just because
    `apply_patches_to_source` is all-or-nothing per batch (spec section
    16 — never leave the editor worse, or LESS fixed, than a safe subset
    of this round's work could have made it)."""
    all_ids = [issue.id for issue in current_issues][:_MAX_ISSUES_PER_ITERATION]
    if not all_ids:
        return [], [], {}, False, False

    # Same-region merge applies to the DETERMINISTIC stream too — the
    # deterministic catalogue can independently generate several
    # same-anchor insertions (e.g. missing-charset + missing-viewport, both
    # via html_seo.py) that collide with each other exactly like AI
    # proposals used to (spec section 2/4/7). Merge BEFORE conflict
    # detection so a resolvable collision becomes one safe patch instead
    # of silently blocking two issues that were never actually AI-eligible.
    raw_det_patches, _raw_conflict_ids, _review_required, _not_found = compute_patches_for_issues(
        current_issues, all_ids, sources, css_source_type, profile,
    )
    det_patches, _det_consumed, det_merges = merge_compatible_insertions(raw_det_patches)
    det_conflict_ids = detect_conflicts(det_patches)
    det_safe = [patch for patch in det_patches if patch.fix_id not in det_conflict_ids]

    # Which ORIGINAL issue ids deterministic coverage actually resolved
    # (safely) this round — a merged patch resolves every one of its
    # member issues, not just its own representative issue_id. An issue
    # deterministic only ever produced a CONFLICTING attempt for is NOT
    # "covered" — it stays eligible for an AI-assisted fallback below.
    patch_member_issue_ids: dict[str, set] = {patch.fix_id: {patch.issue_id} for patch in raw_det_patches}
    for merged_patch, members in det_merges:
        patch_member_issue_ids[merged_patch.fix_id] = {member.issue_id for member in members}
    det_covered_issue_ids: set = set()
    for patch in det_safe:
        det_covered_issue_ids |= patch_member_issue_ids.get(patch.fix_id, {patch.issue_id})

    issues_by_id = {issue.id: issue for issue in current_issues}
    remaining_after_det = [iid for iid in all_ids if iid not in det_covered_issue_ids]

    # Verified Repair Knowledge tier (spec section 10) — cheap/local,
    # tried before ever spending an AI request. A recipe result's patches
    # are only ever accepted as a complete atomic unit (see
    # _attempt_verified_recipes); a patch that collides with another
    # candidate's range drops its ENTIRE recipe result, falling through
    # to AI rather than being force-applied or applied partially.
    recipe_attempts = _attempt_verified_recipes(
        current_issues, remaining_after_det, sources, css_source_type, profile,
    )
    recipe_precheck_conflict_ids = detect_conflicts([
        patch for _iid, _sig, result in recipe_attempts for patch in result.patches
    ])
    recipe_attempts = [
        attempt for attempt in recipe_attempts
        if not any(patch.fix_id in recipe_precheck_conflict_ids for patch in attempt[2].patches)
    ]
    recipe_safe = [patch for _iid, _sig, result in recipe_attempts for patch in result.patches]
    recipe_safe_covered_ids = {issue_id for issue_id, _sig, _result in recipe_attempts}

    remaining_ids = [
        iid for iid in remaining_after_det
        if iid not in recipe_safe_covered_ids and not _is_advisory_only(issues_by_id[iid])
    ]
    remaining_ids.sort(key=lambda iid: 0 if issues_by_id[iid].severity == 'error' else 1)
    ai_eligible_ids = remaining_ids[:_MAX_AI_ISSUES_PER_ITERATION]

    sources_for_context = {'html': sources['html'], 'css': sources['css'], 'js': sources['js'], 'ampscript': sources['ampscript']}
    ai_proposals, ai_requested, ai_unavailable = _request_ai_proposals(
        ai_eligible_ids, current_issues, sources_for_context, css_source_type, validation_scope, profile,
        rate_limit_identifier,
    )

    blocked: dict[str, str] = {}
    ai_safe_patches = []
    for proposal in ai_proposals:
        patch = proposal.patch
        if proposal.status == 'safe' and not proposal.requires_configuration:
            ai_safe_patches.append(patch)
        elif proposal.status == 'safe' and proposal.requires_configuration:
            blocked[patch.fingerprint] = 'Requires business or configuration information that cannot be inferred automatically.'
        elif proposal.status == 'conflict':
            blocked[patch.fingerprint] = proposal.rejection_reason or 'Two proposals modify the same source range and require individual review.'
        # 'rejected' (stale/unsupported/etc.) — not a durable "needs input"
        # reason; the issue simply stays unresolved this round and is
        # reattempted fresh next iteration if it's still present.

    # Cross-stream safety net: a deterministic/recipe patch and an AI
    # patch could still collide on the same range (the same-anchor MERGE
    # above only ever runs within validate_proposals's own AI-proposal
    # set). Rare in practice, still checked so nothing is ever double-
    # applied to one range.
    combined = det_safe + recipe_safe + ai_safe_patches
    conflict_ids = detect_conflicts(combined)
    det_applicable = [patch for patch in det_safe if patch.fix_id not in conflict_ids]
    ai_applicable = [patch for patch in ai_safe_patches if patch.fix_id not in conflict_ids]
    # Recipe results are accepted ATOMICALLY here too, same as the
    # pre-check above — a partial "move" (only the insert or only the
    # remove surviving) would corrupt the source rather than repair it.
    recipe_attempts = [
        attempt for attempt in recipe_attempts
        if not any(patch.fix_id in conflict_ids for patch in attempt[2].patches)
    ]
    det_applicable = det_applicable + [patch for _iid, _sig, result in recipe_attempts for patch in result.patches]
    for patch in combined:
        if patch.fix_id in conflict_ids and patch.fingerprint not in blocked:
            blocked[patch.fingerprint] = 'Two proposals modify the same source range and require individual review.'
    recipe_meta = {
        result.patches[0].fingerprint: (
            issues_by_id[issue_id].rule_id, result.patches[0].language, context_signature,
            result.strategy_key, result.strategy_description, result.environment_extra,
        )
        for issue_id, context_signature, result in recipe_attempts
    }
    # Regional/Whole-Source AI Outcome-Recording Symmetry sprint — one
    # AIRepairMetaEntry per AI-applied patch this round, keyed by the
    # SAME fingerprint the caller's fingerprint-diff machinery already
    # uses to know whether the underlying issue actually resolved.
    ai_meta = {
        patch.fingerprint: _build_ai_repair_meta(issues_by_id[patch.issue_id])
        for patch in ai_applicable
        if patch.issue_id in issues_by_id
    }

    return det_applicable, ai_applicable, blocked, ai_requested, ai_unavailable, recipe_meta, ai_meta


_NOOP_ATTEMPT_CACHE_PREFIX = 'landingpages:ai_fix:recent_attempt'


def _source_signature(initial_sources, css_source_type, validation_scope, profile) -> str:
    payload = json.dumps({
        'html': initial_sources.get('html', ''), 'css': initial_sources.get('css', ''),
        'js': initial_sources.get('js', ''), 'ampscript': initial_sources.get('ampscript', ''),
        'css_source_type': css_source_type, 'validation_scope': validation_scope, 'profile': profile,
    }, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def run_autonomous_repair(
    *, user, project, initial_sources, css_source_type, validation_scope, profile, rate_limit_identifier,
    on_progress=None,
):
    """Low-Latency AI Engineer Performance Optimization sprint, spec
    section 36/37 — a THIN cache wrapper around `_run_autonomous_repair`
    (the actual detect-fix-revalidate loop, unchanged below). If THIS
    user submitted this EXACT (html, css, js, ampscript, css_source_type,
    validation_scope, profile) tuple within the last
    `LP_AI_FIX_NOOP_CACHE_TTL_SECONDS` and already got a result for it —
    whether that result was "nothing to fix," "fully repaired," or
    "repaired what it safely could, N issues remain" — a second identical
    request within that window returns the SAME result immediately: no
    new validation pass, no new AI request, no new rate-limit slot spent.
    This is deliberately SHORT-lived (not a durable strategy cache like
    RepairKnowledgeRecord) — it only ever protects against the literal
    "clicked the button again against unchanged source" case (an
    accidental double-click, or a user re-checking a result), never a
    substitute for a genuinely later, deliberate retry once the TTL has
    passed."""
    signature = _source_signature(initial_sources, css_source_type, validation_scope, profile)
    cache_key = f'{_NOOP_ATTEMPT_CACHE_PREFIX}:{getattr(user, "pk", "anon")}:{signature}'
    cached_result = cache.get(cache_key)
    if cached_result is not None:
        ai_requests_avoided = sum(1 for record in cached_result.iterations if record.ai_requested)
        perf_metrics.record('ai_calls_avoided', amount=max(ai_requests_avoided, 1))
        logger.info(
            'landingpages.fixes.autonomous_repair.noop_cache_hit issues_remaining=%s stopped_reason=%s',
            cached_result.issues_remaining_total, cached_result.stopped_reason,
        )
        return cached_result

    result = _run_autonomous_repair(
        user=user, project=project, initial_sources=initial_sources, css_source_type=css_source_type,
        validation_scope=validation_scope, profile=profile, rate_limit_identifier=rate_limit_identifier,
        on_progress=on_progress,
    )
    cache.set(cache_key, result, timeout=settings.LP_AI_FIX_NOOP_CACHE_TTL_SECONDS)
    return result


def _run_autonomous_repair(
    *, user, project, initial_sources, css_source_type, validation_scope, profile, rate_limit_identifier,
    on_progress=None,
):
    """`initial_sources`: {'html', 'css', 'js', 'ampscript'} — the CURRENT
    editor values. Returns an AutonomousFixResult; never raises for AI
    Engineer/AI Review unavailability — only an unexpected bug propagates,
    for the caller's own outer safety net.

    `on_progress`, when given, is called as `on_progress(**fields)` at
    each meaningful checkpoint (Real-Time Progress UX sprint) — never
    required for correctness, so any exception it raises is caught and
    logged rather than allowed to abort a real repair in progress."""
    def _emit(**fields):
        if on_progress is None:
            return
        try:
            on_progress(**fields)
        except Exception:  # noqa: BLE001 - a progress-reporting failure must never abort the repair itself
            logger.warning('landingpages.fixes.autonomous_repair.on_progress_failed', exc_info=True)

    max_iterations = settings.LP_AI_FIX_MAX_ITERATIONS
    sources = dict(initial_sources)
    iterations: list[IterationRecord] = []
    seen_fingerprint_snapshots = []
    fixes_applied_total = 0
    fix_candidates_generated_total = 0
    issues_before_total = 0
    issues_before_error_total = 0
    issues_before_warning_total = 0
    issues_resolved_total = 0
    issues_new_total = 0
    ai_unavailable_ever = False
    previous_issues = None
    previous_error_count = None
    pre_iteration_sources = None
    last_applied_count = 0
    last_candidate_count = 0
    by_language_before = {}
    report = None
    result = None
    stopped_reason = 'max_iterations'
    ever_blocked_fingerprints: set[str] = set()
    attempted_whole_source_files: set[str] = set()
    retried_fingerprint_snapshots: set = set()
    # Verified Repair Memory sprint — recipe_meta from the round just
    # applied, carried forward one iteration so its outcome can be
    # recorded once the NEXT authoritative revalidation (or a regression
    # revert) proves whether it actually worked. Never speculative.
    pending_recipe_meta: dict = {}
    # Regional/Whole-Source AI Outcome-Recording Symmetry sprint — same
    # deferred-until-proven pattern as pending_recipe_meta, for AI-applied
    # regional patches (whole-source records its own outcome immediately,
    # since its own acceptance check already IS the authoritative
    # revalidation — see _attempt_whole_source_repair's call sites).
    pending_ai_meta: dict = {}

    _emit(stage='analyzing', iteration=0, issues_resolved=0, issues_remaining=None, issues_new=0)

    for iteration_index in range(1, max_iterations + 1):
        report, result = persist_validation_report(
            user=user, project=project,
            html=sources['html'], css=sources['css'], js=sources['js'], ts='', ampscript=sources['ampscript'],
            profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
        )
        current_issues = list(report.issues.all())
        current_error_count = sum(1 for issue in current_issues if issue.severity == 'error')
        if iteration_index == 1:
            issues_before_total = len(current_issues)
            issues_before_error_total = current_error_count
            _emit(
                stage='analyzing', iteration=iteration_index,
                issues_resolved=0, issues_remaining=issues_before_total, issues_new=0,
                issue_updates={issue.fingerprint: 'pending' for issue in current_issues},
            )
            issues_before_warning_total = sum(1 for issue in current_issues if issue.severity == 'warning')
            by_language_before = _by_language_snapshot(current_issues)

        if previous_issues is not None:
            resolved_a_parser_blocker = _round_resolved_a_parser_blocker(previous_issues, current_issues)
            if (
                previous_error_count is not None and current_error_count > previous_error_count
                and not resolved_a_parser_blocker
            ):
                # This iteration's applied patches made things worse —
                # revert to the pre-iteration source and stop rather than
                # leave the editor in a worse state (spec section 15/16).
                # Skipped when the round resolved a parser/compiler-
                # blocking issue: that can legitimately EXPOSE more
                # error-severity findings that were always there but
                # hidden behind the abort — not a regression (section 7).
                sources = pre_iteration_sources
                report, result = persist_validation_report(
                    user=user, project=project,
                    html=sources['html'], css=sources['css'], js=sources['js'], ts='', ampscript=sources['ampscript'],
                    profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
                )
                current_issues = list(report.issues.all())
                fixes_applied_total -= last_applied_count
                fix_candidates_generated_total -= last_candidate_count
                if iterations:
                    iterations.pop()
                # Every recipe-driven patch from the just-reverted round
                # was rolled back along with everything else — record
                # failure (not a mere "didn't resolve", an actual
                # rollback) so repeated failures demote the strategy
                # faster (spec section 12).
                if pending_recipe_meta:
                    _record_recipe_outcomes(pending_recipe_meta, set(), profile=profile, rolled_back=True)
                    pending_recipe_meta = {}
                if pending_ai_meta:
                    # spec requirement 8/E — the whole round (including any
                    # AI-applied patch) was shipped, then reverted because
                    # it made things worse; a rollback is catastrophic, not
                    # a mere non-resolution, and demotes the strategy
                    # immediately regardless of prior confidence.
                    _record_ai_repair_outcomes(pending_ai_meta, set(), profile=profile, rolled_back=True)
                    pending_ai_meta = {}
                stopped_reason = 'regression_reverted'
                break
            resolved, new = _diff_counts(previous_issues, current_issues)
            issues_resolved_total += resolved
            issues_new_total += new
            fingerprint_status_diff = _fingerprint_status_diff(previous_issues, current_issues)
            if pending_recipe_meta:
                resolved_fingerprints = {fp for fp, status in fingerprint_status_diff.items() if status == 'resolved'}
                _record_recipe_outcomes(pending_recipe_meta, resolved_fingerprints, profile=profile)
                pending_recipe_meta = {}
            if pending_ai_meta:
                resolved_fingerprints = {fp for fp, status in fingerprint_status_diff.items() if status == 'resolved'}
                _record_ai_repair_outcomes(pending_ai_meta, resolved_fingerprints, profile=profile)
                pending_ai_meta = {}
            _emit(
                stage='revalidating', iteration=iteration_index,
                issues_resolved=issues_resolved_total, issues_remaining=len(current_issues), issues_new=issues_new_total,
                issue_updates=fingerprint_status_diff,
            )

        if not current_issues:
            stopped_reason = 'all_resolved'
            break

        fingerprint_snapshot = frozenset(issue.fingerprint for issue in current_issues)
        if fingerprint_snapshot in seen_fingerprint_snapshots:
            stopped_reason = 'no_progress'
            break
        seen_fingerprint_snapshots.append(fingerprint_snapshot)

        # Tool-Grounded AI Engineer sprint, spec section 3/6/7 — PASS 0.5:
        # native compiler/linter autofix (Stylelint `fix: true` for CSS/
        # LESS/SCSS against the ORIGINAL source, ESLint `verifyAndFix`
        # for JS) runs BEFORE any deterministic recipe or AI proposal is
        # even attempted this round — "do not call AI for anything the
        # authoritative tool can safely autofix" (spec section 3). Only
        # attempted when this round's own current_issues include
        # something in that file, so a clean file never gets a pointless
        # autofix call. Mirrors the whole-source-repair branch's own
        # bookkeeping pattern below: publish, record the iteration, set
        # previous_issues/previous_error_count, and let the top of the
        # loop persist a fresh authoritative report next iteration — the
        # regression guard already above treats this exactly like any
        # other applied round.
        native_fix = _try_native_autofix(sources, css_source_type, profile, current_issues)
        if native_fix is not None:
            pre_iteration_sources = dict(sources)
            sources = native_fix
            fix_candidates_generated_total += 1
            fixes_applied_total += 1
            iterations.append(IterationRecord(
                iteration=iteration_index, issues_before=len(current_issues),
                fix_candidates_generated=1, fixes_applied=1,
                issues_resolved=0, issues_new=0,
                ai_requested=False, ai_unavailable=False,
            ))
            last_applied_count = 1
            last_candidate_count = 1
            previous_issues = current_issues
            previous_error_count = current_error_count
            continue

        # HTML Whole-Document Structural Recovery sprint, spec section
        # 1/2/16 — PASS 1: a corrupted document shell is detected and
        # addressed FIRST, before any per-issue regional patch is even
        # attempted. The html5lib/Nu cascade a corrupted shell produces
        # is not a set of independent findings to patch one by one (spec
        # section 2/5/14) — regional patching against it is exactly what
        # produced the reported "7 passes, still 15 errors" failure.
        shell_corruption = shell_recovery.classify_shell_corruption(sources.get('html', ''))
        if shell_corruption:
            recovered_html = None
            strategy_was_ai = False
            if shell_corruption == frozenset({shell_recovery.CORRUPTION_PREMATURE_HTML_CLOSE}):
                recovered_html = shell_recovery.attempt_premature_html_close_recovery(sources['html'])
            elif shell_corruption == frozenset({shell_recovery.CORRUPTION_CONTENT_BEFORE_HTML}):
                # Correctness regression sprint, spec section A — real
                # content (e.g. a stray <meta>) sitting before the literal
                # <html> tag, which the HTML5 parsing algorithm's implicit
                # element synthesis turns into a document-shell-corruption
                # class this project's structural checkers otherwise never
                # see (only one literal <html>/<head> exists in the raw
                # source). Same deterministic-first, whole-source-AI-
                # fallback pattern as every other shell-corruption class.
                recovered_html = shell_recovery.attempt_content_before_html_recovery(sources['html'])

            accepted, candidate_sources, candidate_report, candidate_result = _try_accept_whole_source_candidate(
                file_key='html', language='html', user=user, project=project, sources=sources,
                corrected=recovered_html, css_source_type=css_source_type, validation_scope=validation_scope,
                profile=profile, current_error_count=current_error_count, previous_issues=current_issues,
            )

            ai_was_available = 'html' not in attempted_whole_source_files
            if not accepted and ai_was_available:
                attempted_whole_source_files.add('html')
                ai_corrected, ai_meta = _attempt_whole_source_repair(
                    'html', sources, current_issues, css_source_type, rate_limit_identifier,
                )
                accepted, candidate_sources, candidate_report, candidate_result = _try_accept_whole_source_candidate(
                    file_key='html', language='html', user=user, project=project, sources=sources,
                    corrected=ai_corrected, css_source_type=css_source_type, validation_scope=validation_scope,
                    profile=profile, current_error_count=current_error_count, previous_issues=current_issues,
                )
                strategy_was_ai = accepted
                if accepted:
                    # JavaScript/Whole-Source Cascade sprint, spec section
                    # 6 — a SUCCESSFUL whole-source repair must not
                    # permanently exhaust this file_key for the rest of
                    # the run; a later, genuinely NEW defect (exposed only
                    # now that this one is fixed) deserves its own fresh
                    # whole-source attempt, not silent exclusion. Only a
                    # DECLINED/failed attempt stays excluded (never
                    # blindly retried without new information).
                    attempted_whole_source_files.discard('html')
                if ai_meta:
                    # Whole-source's own acceptance check already froze a
                    # freshly persisted, authoritative post-candidate
                    # report — no need to defer to the next iteration the
                    # way regional patches must (spec requirement 3: real
                    # revalidation, never "the AI call returned").
                    resolved_fps = (
                        {issue.fingerprint for issue in current_issues} - {issue.fingerprint for issue in candidate_report.issues.all()}
                        if accepted else set()
                    )
                    _record_ai_repair_outcomes(ai_meta, resolved_fps, profile=profile)

            if accepted:
                pre_iteration_sources = dict(sources)
                sources = candidate_sources
                report, result = candidate_report, candidate_result
                fix_candidates_generated_total += 1
                fixes_applied_total += 1
                iterations.append(IterationRecord(
                    iteration=iteration_index, issues_before=len(current_issues),
                    fix_candidates_generated=1, fixes_applied=1,
                    issues_resolved=0, issues_new=0,
                    ai_requested=strategy_was_ai, ai_unavailable=False,
                ))
                last_applied_count = 1
                last_candidate_count = 1
                previous_issues = current_issues
                previous_error_count = current_error_count
                continue

            # Spec section 17/18 — never fall through to regional
            # patching against a shell that is STILL corrupted: neither
            # the deterministic recipe nor a genuine whole-source AI
            # attempt (when one was actually available this round)
            # produced an accepted candidate, and nothing about that
            # will change on a later iteration of the SAME run (the
            # source is unchanged, and 'html' is now permanently in
            # `attempted_whole_source_files`) — stop immediately and
            # honestly rather than burn the rest of the iteration budget
            # nibbling at the cascade one symptom at a time.
            stopped_reason = 'structural_recovery_failed'
            break

        det_applicable, ai_applicable, blocked, ai_requested, ai_unavailable, round_recipe_meta, round_ai_meta = _autonomous_round_patches(
            current_issues, sources, css_source_type, profile, validation_scope,
            rate_limit_identifier=rate_limit_identifier,
        )
        ever_blocked_fingerprints.update(blocked.keys())
        ai_unavailable_ever = ai_unavailable_ever or ai_unavailable
        applicable_count = len(det_applicable) + len(ai_applicable)
        fix_candidates_generated_total += applicable_count
        _emit(
            stage='repairing', iteration=iteration_index,
            issues_resolved=issues_resolved_total, issues_remaining=len(current_issues), issues_new=issues_new_total,
            issue_updates=_round_target_issue_statuses(det_applicable, ai_applicable, blocked),
        )

        if not applicable_count and ai_requested and not ai_unavailable and fingerprint_snapshot not in retried_fingerprint_snapshots:
            # Consistent Validation Counts + Verified Learning sprint,
            # section 9 — a real, non-deterministic model call can return
            # zero usable proposals for the current remaining issue(s) on
            # one attempt even for an issue class this project has already
            # proven repairable (e.g. charset-declared-late — see the Rule
            # Knowledge Registry and this project's own regression suite).
            # A single unlucky empty response must not end the whole run;
            # retry the identical regional AI request exactly once per
            # distinct issue-set before falling back further.
            retried_fingerprint_snapshots.add(fingerprint_snapshot)
            det_applicable, ai_applicable, blocked, ai_requested, ai_unavailable, round_recipe_meta, round_ai_meta = _autonomous_round_patches(
                current_issues, sources, css_source_type, profile, validation_scope,
                rate_limit_identifier=rate_limit_identifier,
            )
            ever_blocked_fingerprints.update(blocked.keys())
            ai_unavailable_ever = ai_unavailable_ever or ai_unavailable
            applicable_count = len(det_applicable) + len(ai_applicable)
            fix_candidates_generated_total += applicable_count
            _emit(
                stage='repairing', iteration=iteration_index,
                issues_resolved=issues_resolved_total, issues_remaining=len(current_issues), issues_new=issues_new_total,
                issue_updates=_round_target_issue_statuses(det_applicable, ai_applicable, blocked),
            )

        if not applicable_count:
            # Deep Validation spec section 4/10/11, Checkpoint 6 — before
            # giving up, try Whole-Source AI Repair for any file whose
            # remaining issues include a document/structure-shell-class
            # defect regional patching is unsafe for (spec section 4's
            # own example: a doctype/meta tag placed before <html>).
            # Candidate-first, exactly like a regional patch: the
            # corrected source is fully revalidated and structural-
            # invariant-checked before ever being published, and never
            # published if it is not at least as good as what it replaced.
            whole_source_applied = False
            for file_key in _files_eligible_for_whole_source_repair(current_issues) - attempted_whole_source_files:
                attempted_whole_source_files.add(file_key)
                corrected, ai_meta = _attempt_whole_source_repair(
                    file_key, sources, current_issues, css_source_type, rate_limit_identifier,
                )
                language = next(
                    (issue.language for issue in current_issues if _FILE_TO_SOURCE_KEY.get(issue.file) == file_key),
                    file_key,
                )
                accepted, candidate_sources, candidate_report, _candidate_result = _try_accept_whole_source_candidate(
                    file_key=file_key, language=language, user=user, project=project, sources=sources,
                    corrected=corrected, css_source_type=css_source_type, validation_scope=validation_scope,
                    profile=profile, current_error_count=current_error_count, previous_issues=current_issues,
                )
                if ai_meta:
                    resolved_fps = (
                        {issue.fingerprint for issue in current_issues} - {issue.fingerprint for issue in candidate_report.issues.all()}
                        if accepted else set()
                    )
                    _record_ai_repair_outcomes(ai_meta, resolved_fps, profile=profile)
                if not accepted:
                    continue
                # spec section 6 — see the identical comment on the HTML
                # shell-recovery branch above: a successful whole-source
                # repair must not permanently exhaust this file_key for
                # the rest of the run, so a later, genuinely NEW parser
                # blocker in the same file (exposed only now that this
                # one is fixed) gets its own fresh cascade attempt.
                attempted_whole_source_files.discard(file_key)
                # Accepted — publish and let the top of the loop persist a
                # fresh, fully authoritative report next iteration (same
                # "fix root cause, reparse, find more" behavior every
                # other repair path in this loop already gets for free).
                # pre_iteration_sources captured NOW (not left stale from
                # an earlier round) so the regression guard can correctly
                # revert exactly this publish if the NEXT round regresses.
                pre_iteration_sources = dict(sources)
                sources = candidate_sources
                fix_candidates_generated_total += 1
                fixes_applied_total += 1
                iterations.append(IterationRecord(
                    iteration=iteration_index, issues_before=len(current_issues),
                    fix_candidates_generated=1, fixes_applied=1,
                    issues_resolved=0, issues_new=0,
                    ai_requested=True, ai_unavailable=False,
                ))
                last_applied_count = 1
                last_candidate_count = 1
                previous_issues = current_issues
                previous_error_count = current_error_count
                whole_source_applied = True
                break
            if whole_source_applied:
                continue
            stopped_reason = 'no_actionable'
            break

        pre_iteration_sources = dict(sources)
        # Applied in two separate passes — deterministic first, then AI —
        # not one combined batch. apply_patches_to_source is all-or-nothing
        # PER SOURCE FILE; a single AI proposal that fails re-verification
        # (a real, if uncommon, possibility — see validate_proposals) must
        # never block an unrelated, always-trustworthy deterministic fix
        # from landing in the same round.
        sources_after_det, applied_det = _apply_selected(sources, det_applicable)
        sources_after_ai, applied_ai = _apply_selected(sources_after_det, ai_applicable)
        new_sources, applied_this_round = sources_after_ai, applied_det + applied_ai

        # Source-Repair Integrity sprint (spec section 10-12) — reject the
        # WHOLE round's candidate before it ever reaches the editor if it
        # violates basic HTML document-shell shape (duplicate <head>, a
        # <head> after </body>, ...). This is a backstop independent of
        # WHY a bad candidate was produced — the targeted fix (a same-
        # anchor merge refusing to absorb a mis-scoped nested document-
        # shell tag) lives in fixes/regions.py; this catches anything that
        # gets past it. Checked before commit, not after — the editor
        # source is never mutated by a candidate that fails this check.
        structural_violations = check_html_structural_invariants(new_sources.get('html', ''))
        structural_violations += check_no_new_duplicate_singletons(sources.get('html', ''), new_sources.get('html', ''))
        if structural_violations:
            logger.warning(
                'landingpages.fixes.autonomous_repair.structural_invariant_rejected iteration=%s violations=%s',
                iteration_index, structural_violations,
            )
            fix_candidates_generated_total -= applicable_count
            # This round's candidate never reached the editor — any
            # recipe or AI-produced patch among it is a genuine failure
            # (never applied), not a rollback.
            if round_recipe_meta:
                _record_recipe_outcomes(round_recipe_meta, set(), profile=profile)
            if round_ai_meta:
                _record_ai_repair_outcomes(round_ai_meta, set(), profile=profile)
            stopped_reason = 'candidate_rejected'
            break

        iterations.append(IterationRecord(
            iteration=iteration_index, issues_before=len(current_issues),
            fix_candidates_generated=applicable_count, fixes_applied=applied_this_round,
            issues_resolved=0, issues_new=0,  # retrospectively filled via the diff at the top of the NEXT loop
            ai_requested=ai_requested, ai_unavailable=ai_unavailable,
        ))
        last_applied_count = applied_this_round
        last_candidate_count = applicable_count
        fixes_applied_total += applied_this_round
        previous_issues = current_issues
        previous_error_count = current_error_count

        if applied_this_round == 0:
            # Nothing in this round actually landed — including any
            # recipe patch, which was computed fresh against the current
            # source moments ago, so this should be rare. Record it as a
            # failure now rather than carrying it forward: there is no
            # next iteration to resolve it against.
            if round_recipe_meta:
                _record_recipe_outcomes(round_recipe_meta, set(), profile=profile)
            if round_ai_meta:
                _record_ai_repair_outcomes(round_ai_meta, set(), profile=profile)
            stopped_reason = 'no_progress'
            break

        # Carried to the top of the NEXT iteration, where the real
        # authoritative revalidation actually proves whether each
        # recipe-driven/AI-driven fingerprint disappeared.
        pending_recipe_meta = round_recipe_meta
        pending_ai_meta = round_ai_meta

        sources = new_sources
        _emit(
            stage='revalidating', iteration=iteration_index,
            issues_resolved=issues_resolved_total, issues_remaining=len(current_issues), issues_new=issues_new_total,
        )

        if iteration_index == max_iterations:
            report, result = persist_validation_report(
                user=user, project=project,
                html=sources['html'], css=sources['css'], js=sources['js'], ts='', ampscript=sources['ampscript'],
                profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
            )
            final_issues = list(report.issues.all())
            resolved, new = _diff_counts(previous_issues, final_issues)
            issues_resolved_total += resolved
            issues_new_total += new
            if pending_recipe_meta:
                final_fingerprint_diff = _fingerprint_status_diff(previous_issues, final_issues)
                resolved_fingerprints = {fp for fp, status in final_fingerprint_diff.items() if status == 'resolved'}
                _record_recipe_outcomes(pending_recipe_meta, resolved_fingerprints, profile=profile)
                pending_recipe_meta = {}
            if pending_ai_meta:
                final_fingerprint_diff = _fingerprint_status_diff(previous_issues, final_issues)
                resolved_fingerprints = {fp for fp, status in final_fingerprint_diff.items() if status == 'resolved'}
                _record_ai_repair_outcomes(pending_ai_meta, resolved_fingerprints, profile=profile)
                pending_ai_meta = {}
            stopped_reason = 'all_resolved' if not final_issues else 'max_iterations'
            break

    # AI Engineer Formatting + Documentation sprint, spec section 3/4 —
    # runs exactly once, after the structural/security repair loop above
    # has fully converged, never interleaved with it (formatting badly
    # malformed code before it is structurally repaired can hide or
    # distort the real problem — spec section 4). Both sub-passes are
    # candidate-first, exactly like every other repair candidate in this
    # function: independently re-validated, and discarded (never
    # published) if the result is not at least as good as what it
    # replaced.
    # Never format/document a document that still has an unrepaired
    # structural/parser-blocking defect (spec section 4's own rule,
    # reused here rather than re-derived): a document this loop tried and
    # failed to safely repair — 'declined', 'worse candidate rejected',
    # a structural-invariant-rejected candidate — is exactly a document
    # that still doesn't reliably parse. Formatting on top of that is
    # unsafe AND would silently violate the "a declined/rejected repair
    # leaves the source completely untouched" guarantee every other
    # repair path in this loop already honors.
    any_source_populated = any(sources.get(key, '').strip() for key in ('html', 'css', 'js', 'ampscript'))
    structural_defect_remains = bool(report is not None and (
        _files_eligible_for_whole_source_repair(list(report.issues.all()))
        or any(_is_parser_blocking_rule(issue.rule_id) for issue in report.issues.all())
    ))
    if report is not None and any_source_populated and not structural_defect_remains:
        # compute_fingerprint (schema.py) includes line/column — reindenting
        # the WHOLE document (this pass's entire point) shifts EVERY
        # issue's line/column, so a formerly-blocked issue's fingerprint
        # changes even though it is still the exact same finding. Without
        # remapping, `ever_blocked_fingerprints` below would silently stop
        # matching it post-format and it would be misclassified as a plain
        # "unrepairable" issue instead of "requires input" (spec section
        # 9/18). Captured before the pass and remapped once, right after.
        pre_pass_issues = list(report.issues.all())
        pre_pass_error_count = sum(1 for issue in pre_pass_issues if issue.severity == 'error')

        # Closure spec section 7 — comments are added BEFORE formatting
        # runs (repair -> comments -> formatter -> validators): the
        # formatter is what's responsible for preserving a comment's
        # placement once it exists, not the other way around. See
        # formatting.py's trailing-comment protection for the HTML/CSS/
        # JS beautifiers that would otherwise displace one.
        _emit(
            stage='documenting', iteration=len(iterations), issues_resolved=issues_resolved_total,
            issues_remaining=len(list(report.issues.all())), issues_new=issues_new_total,
        )
        target_platform = 'sfmc-cloudpages' if sources.get('ampscript', '').strip() else None
        documented_sources, documented_files = documentation.apply_documentation_pass(
            sources, css_source_type, target_platform, rate_limit_identifier,
        )
        if documented_files:
            candidate_report, candidate_result = persist_validation_report(
                user=user, project=project,
                html=documented_sources['html'], css=documented_sources['css'], js=documented_sources['js'],
                ts='', ampscript=documented_sources['ampscript'],
                profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
            )
            candidate_error_count = sum(1 for issue in candidate_report.issues.all() if issue.severity == 'error')
            doc_violations = check_html_structural_invariants(documented_sources.get('html', ''))
            doc_violations += check_no_new_duplicate_singletons(sources.get('html', ''), documented_sources.get('html', ''))
            if candidate_error_count <= pre_pass_error_count and not doc_violations:
                sources = documented_sources
                report, result = candidate_report, candidate_result
            else:
                logger.warning('landingpages.fixes.autonomous_repair.documentation_candidate_rejected')

        _emit(
            stage='formatting', iteration=len(iterations), issues_resolved=issues_resolved_total,
            issues_remaining=len(list(report.issues.all())), issues_new=issues_new_total,
        )
        pre_format_error_count = sum(1 for issue in report.issues.all() if issue.severity == 'error')
        formatted_sources, formatted_files = formatting.format_all_sources(sources, css_source_type)
        if formatted_files:
            candidate_report, candidate_result = persist_validation_report(
                user=user, project=project,
                html=formatted_sources['html'], css=formatted_sources['css'], js=formatted_sources['js'],
                ts='', ampscript=formatted_sources['ampscript'],
                profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
            )
            candidate_error_count = sum(1 for issue in candidate_report.issues.all() if issue.severity == 'error')
            format_violations = check_html_structural_invariants(formatted_sources.get('html', ''))
            format_violations += check_no_new_duplicate_singletons(sources.get('html', ''), formatted_sources.get('html', ''))
            if candidate_error_count <= pre_format_error_count and not format_violations:
                sources = formatted_sources
                report, result = candidate_report, candidate_result
            else:
                logger.warning('landingpages.fixes.autonomous_repair.formatting_candidate_rejected')

        post_pass_issues = list(report.issues.all()) if report is not None else []
        fingerprint_remap = _build_fingerprint_remap(pre_pass_issues, post_pass_issues)
        ever_blocked_fingerprints = {fingerprint_remap.get(fp, fp) for fp in ever_blocked_fingerprints}

    final_issues = list(report.issues.all()) if report is not None else []
    _emit(
        stage='finalizing', iteration=len(iterations),
        issues_resolved=issues_resolved_total, issues_remaining=len(final_issues), issues_new=issues_new_total,
        # A complete final snapshot for every issue still present — closes
        # the gap for any fingerprint an intermediate round-level emit
        # never happened to touch (e.g. capped out of an AI batch).
        issue_updates={
            issue.fingerprint: ('requires_input' if issue.fingerprint in ever_blocked_fingerprints else 'pending')
            for issue in final_issues
        },
    )
    # A remaining issue counts as "requires input" only if a repair attempt
    # in THIS run actually blocked on it for a durable reason (a true
    # conflict, or an AI proposal that explicitly needs external
    # configuration/business data) — never from a static per-rule
    # "a human should review this" flag on the issue itself (spec section
    # 18 — ordinary structure repairs must not default into this bucket
    # just because nobody ticked a checkbox).
    issues_requires_input_total = sum(
        1 for issue in final_issues if issue.fingerprint in ever_blocked_fingerprints
    )
    issues_final_error_total = sum(1 for issue in final_issues if issue.severity == 'error')
    issues_final_warning_total = sum(1 for issue in final_issues if issue.severity == 'warning')
    issues_advisory_total = sum(1 for issue in final_issues if _is_advisory_only(issue))
    issues_unrepairable_total = max(0, len(final_issues) - issues_requires_input_total - issues_advisory_total)

    # Consistent Validation Counts sprint, section 1/33 — the lifecycle
    # arithmetic must reconcile: FINAL == INITIAL - RESOLVED + NEW. This
    # never blocks the response (a caller still gets its real, authoritative
    # final report either way) — it is a diagnostic tripwire so a genuine
    # future accounting bug is caught in logs instead of silently shipping
    # a banner/panel mismatch (spec section 2).
    expected_final = issues_before_total - issues_resolved_total + issues_new_total
    if expected_final != len(final_issues):
        logger.warning(
            'landingpages.fixes.autonomous_repair.count_invariant_violated '
            'initial=%s resolved=%s new=%s expected_final=%s actual_final=%s',
            issues_before_total, issues_resolved_total, issues_new_total, expected_final, len(final_issues),
        )

    by_language_after = _by_language_snapshot(final_issues)
    by_language = {}
    for group in set(by_language_before) | set(by_language_after):
        before = by_language_before.get(group, 0)
        remaining = by_language_after.get(group, 0)
        by_language[group] = {
            'before': before, 'remaining': remaining,
            'resolved': max(0, before - remaining), 'new': max(0, remaining - before),
        }

    return AutonomousFixResult(
        report=report, result=result, final_sources=sources, iterations=iterations,
        issues_before_total=issues_before_total,
        fix_candidates_generated_total=fix_candidates_generated_total,
        fixes_applied_total=fixes_applied_total,
        issues_resolved_total=issues_resolved_total,
        issues_remaining_total=len(final_issues),
        issues_new_total=issues_new_total,
        issues_requires_input_total=issues_requires_input_total,
        issues_before_error_total=issues_before_error_total,
        issues_before_warning_total=issues_before_warning_total,
        issues_final_error_total=issues_final_error_total,
        issues_final_warning_total=issues_final_warning_total,
        issues_unrepairable_total=issues_unrepairable_total,
        issues_advisory_total=issues_advisory_total,
        by_language=by_language,
        stopped_reason=stopped_reason,
        ai_unavailable_ever=ai_unavailable_ever,
    )

"""Turns raw, not-yet-trusted `ProposalDraft`s (see provider.py) into
either a verified `AIProposal` (safe to show/apply) or a rejection reason
— every check here runs regardless of what the provider claimed, exactly
mirroring how ../fixes/catalogue.py never trusts a stored `deterministic_fix`
without re-verifying it against the CURRENT source.
"""

import uuid
from dataclasses import dataclass

from ..fixes.catalogue import Patch
from ..fixes.offsets import line_starts, offset_to_line_col
from ..fixes.regions import merge_compatible_insertions
from ..security_verifier import introduces_new_dangerous_sink
from ..validation.engine import run as run_validation
from .excerpt import excerpt_window

# Issue.file ('javascript') -> the sources[] dict key the request body uses
# ('js') — same mapping the frontend's FIX_SOURCE_FILE_TO_LANGUAGE table
# uses in reverse (see LandingPageValidatorPage.tsx).
_FILE_TO_SOURCE_KEY = {'html': 'html', 'css': 'css', 'javascript': 'js', 'ampscript': 'ampscript'}

MAX_PROPOSAL_TEXT_LENGTH = 20_000

# A live-verification session found the AI provider sometimes returns
# multiple valid alternative fixes for the SAME issue (e.g. "use
# textContent" vs. "build a text node" for one unsafe-innerHTML finding).
# The original conflict detector (fixes.detect_conflicts) has no concept
# of issue identity — it only sees two patches landing on the same source
# range — so it marked every such pair 'conflict' and excluded both from
# bulk apply. That was SAFE (nothing wrong ever got auto-applied) but not
# the desired UX: the user should see "2 AI fix options, choose one" for
# their own issue, not two unrelated-looking conflict badges. See
# _dedupe_and_cap_alternatives / _mark_conflicts_excluding_same_issue
# below, and AIReviewApplyView in views.py for the matching server-side
# guarantee that at most one alternative per issue can ever be applied.
MAX_AI_ALTERNATIVES_PER_ISSUE = 3

_RISK_ORDER = {'low': 0, 'medium': 1, 'high': 2}
_CONFIDENCE_ORDER = {'definite': 0, 'likely': 1, 'possible': 2}


@dataclass(frozen=True)
class AIProposal:
    patch: Patch
    explanation: str
    assumptions: list[str]
    requires_configuration: bool
    status: str  # 'safe' | 'conflict' | 'rejected'
    rejection_reason: str = ''


def _find_all(source, needle):
    positions = []
    start = 0
    while True:
        index = source.find(needle, start)
        if index == -1:
            break
        positions.append(index)
        start = index + 1
    return positions


# Below this length a line is too generic to trust as a duplication
# signal on its own (e.g. "});", "}", "  return;" — real, legitimately
# repeated in most files) — only a longer, more distinctive line is
# treated as evidence the patch duplicated real logic.
_MIN_SIGNIFICANT_LINE_LENGTH = 20


def _introduces_duplicate_of_existing_line(source, start_offset, end_offset, expected_text, replacement_text):
    expected_lines = {line.strip() for line in expected_text.splitlines()}
    new_significant_lines = [
        stripped for stripped in (line.strip() for line in replacement_text.splitlines())
        if len(stripped) >= _MIN_SIGNIFICANT_LINE_LENGTH and stripped not in expected_lines
    ]
    if not new_significant_lines:
        return False
    remainder = source[:start_offset] + source[end_offset:]
    remainder_lines = {line.strip() for line in remainder.splitlines()}
    return any(line in remainder_lines for line in new_significant_lines)


def _reject(draft, reason):
    return AIProposal(
        patch=Patch(
            fix_id=str(uuid.uuid4()), issue_id=(draft.issue_ids or [0])[0], fingerprint='',
            language=draft.language, source_context=draft.source_context, file='',
            start_offset=0, end_offset=0, start_line=0, start_column=0, end_line=0, end_column=0,
            original_text='', replacement_text='', description=draft.explanation,
            risk=draft.risk if draft.risk in ('low', 'medium', 'high') else 'high',
            confidence=draft.confidence if draft.confidence in ('definite', 'likely', 'possible') else 'possible',
        ),
        explanation=draft.explanation, assumptions=list(draft.assumptions),
        requires_configuration=draft.requires_configuration, status='rejected', rejection_reason=reason,
    )


def _alternative_sort_key(proposal):
    patch = proposal.patch
    return (
        _RISK_ORDER.get(patch.risk, 99),
        _CONFIDENCE_ORDER.get(patch.confidence, 99),
        len(patch.replacement_text),
    )


def _dedupe_and_cap_alternatives(safe_proposals):
    """Groups SAFE proposals by issue_id. Within a group: drops exact
    duplicates (identical range + identical expected/replacement text —
    the provider returned the same patch twice), then keeps at most
    MAX_AI_ALTERNATIVES_PER_ISSUE, preferring lower risk, then higher
    confidence, then a smaller patch. Dropped proposals are removed
    entirely (never shown, not even as 'rejected') — the goal is keeping
    the review UI from being flooded, not explaining every drop. Multi-
    issue proposals are grouped by their PRIMARY issue only (Patch.
    issue_id), matching how they're already treated everywhere else in
    this module — no special-casing needed. Returns the fix_ids to KEEP.
    """
    by_issue: dict[int, list] = {}
    for proposal in safe_proposals:
        by_issue.setdefault(proposal.patch.issue_id, []).append(proposal)

    keep_ids = set()
    for group in by_issue.values():
        seen_signatures = set()
        deduped = []
        for proposal in group:
            patch = proposal.patch
            signature = (patch.start_offset, patch.end_offset, patch.original_text, patch.replacement_text)
            if signature in seen_signatures:
                continue
            seen_signatures.add(signature)
            deduped.append(proposal)
        deduped.sort(key=_alternative_sort_key)
        for proposal in deduped[:MAX_AI_ALTERNATIVES_PER_ISSUE]:
            keep_ids.add(proposal.patch.fix_id)
    return keep_ids


def _mark_conflicts_excluding_same_issue(safe_proposals):
    """Same pairwise same-range/overlap check as fixes.detect_conflicts,
    scoped per target file exactly like it — except a pair belonging to
    the SAME issue_id is never marked conflicting with each other, since
    those are alternative fixes for one issue (see AIReviewDialog's
    grouped radio UI), not two independent patches that happen to land on
    the same range. A pair from DIFFERENT issues is still marked exactly
    as fixes.detect_conflicts would mark it.

    Deliberately a separate function rather than teaching issue-awareness
    to fixes.detect_conflicts itself: that function also backs the
    deterministic Apply Safe Fixes path, where every patch already
    belongs to a distinct issue by construction, so the exclusion would
    never fire there — adding it would be dead complexity for that
    caller, and would blur a shared, security-relevant primitive with a
    concern that only applies to the AI proposal's alternates. Cross-
    issue conflicts among the finally SELECTED patches are still
    re-verified with the real fixes.detect_conflicts at apply time (see
    AIReviewApplyView) — this function only shapes what gets shown before
    the user has chosen anything.
    """
    by_file: dict[str, list] = {}
    for proposal in safe_proposals:
        by_file.setdefault(proposal.patch.file, []).append(proposal)

    conflict_ids = set()
    for file_proposals in by_file.values():
        for i in range(len(file_proposals)):
            for j in range(i + 1, len(file_proposals)):
                a, b = file_proposals[i].patch, file_proposals[j].patch
                if a.issue_id == b.issue_id:
                    continue
                same_range = a.start_offset == b.start_offset and a.end_offset == b.end_offset
                overlapping = a.start_offset < b.end_offset and b.start_offset < a.end_offset
                if same_range or overlapping:
                    conflict_ids.add(a.fix_id)
                    conflict_ids.add(b.fix_id)
    return conflict_ids


def _issue_resolved_by_candidate(issue, candidate_source, file_key, sources, profile, css_source_type):
    """Re-runs the REAL validators against the candidate — never the
    model's own claim — scoped to the issue's own language so this stays
    one narrow re-run per proposal, not a full Complete LP validate. This
    is what 'the validator is the judge' (Fix-Application Correctness /
    Deep Validation spec section 16/19/20) means for AI Review: a
    proposal is never offered as a normal selectable fix if a pre-check
    already shows it does not actually make the selected issue go away —
    the exact 'Option A / Option B, then Apply Fix fails anyway' pattern
    live-reproduced against this dialog. A prevalidation crash is treated
    as 'cannot confirm this resolves it' (proposal withheld), never as
    silent success."""
    candidate_sources = dict(sources)
    candidate_sources[file_key] = candidate_source
    scope = issue.file if issue.file in ('html', 'css', 'javascript', 'ampscript') else 'complete'
    try:
        result = run_validation(
            html=candidate_sources.get('html', ''), css=candidate_sources.get('css', ''),
            js=candidate_sources.get('js', ''), ampscript=candidate_sources.get('ampscript', ''),
            profile=profile, validation_scope=scope, css_source_type=css_source_type,
        )
    except Exception:  # noqa: BLE001 - never let a prevalidation crash surface as a 500; withhold the proposal instead
        return False
    same_file = [candidate_issue for candidate_issue in result.issues if candidate_issue.file == issue.file]
    if any(candidate_issue.fingerprint == issue.fingerprint for candidate_issue in same_file):
        return False
    # rule_id + line + column, not line alone — a minified/single-line
    # source can carry several distinct instances of the same rule on the
    # same line (e.g. two <img> tags missing alt on one line); matching
    # by line alone would treat an untouched SIBLING instance as "this
    # issue is still present" and wrongly reject a proposal that
    # genuinely fixed the one it targeted.
    return not any(
        candidate_issue.rule_id == issue.rule_id
        and candidate_issue.start_line == issue.line
        and candidate_issue.start_column == issue.column
        for candidate_issue in same_file
    )


def validate_proposals(drafts, report_issues, requested_issue_ids, sources, profile='standard', css_source_type='css'):
    """Returns (proposals: list[AIProposal], not_reviewed_issue_ids: list[int]).

    `report_issues` are the CURRENT report's real ValidationIssue rows
    (ownership + freshness already established by the caller — see
    views.py — exactly like the deterministic /fixes/preview/ endpoint).
    """
    issues_by_id = {issue.id: issue for issue in report_issues}
    requested = set(requested_issue_ids)
    verified_patches = []

    for draft in drafts:
        primary_issue_id = draft.issue_ids[0] if draft.issue_ids else None

        if primary_issue_id not in requested:
            verified_patches.append(_reject(draft, 'Proposal targets an issue that was not requested.'))
            continue

        issue = issues_by_id.get(primary_issue_id)
        if issue is None:
            verified_patches.append(_reject(draft, 'Issue is no longer present on this report.'))
            continue

        if draft.language != issue.language:
            verified_patches.append(_reject(draft, 'Proposal language does not match the issue.'))
            continue

        # `source_context` only carries real meaning for CSS-preprocessor
        # issues (disambiguating "standalone-scss" from "standalone-less"
        # etc. — see excerpt.py/build_issue_context) — for every other
        # issue it is always '' by construction. A live-verification
        # session (Hybrid Validator + AI Engineer architecture sprint)
        # found the model sometimes echoes a large chunk of the source
        # excerpt into this field for HTML issues instead of leaving it
        # empty — since `issue.source_context` is '' for those, the OLD
        # check ("any non-empty draft value that doesn't match") rejected
        # every one of those proposals outright, even though nothing about
        # WHICH source they targeted was actually ambiguous. The check now
        # only enforces a match when the issue itself has a real,
        # non-empty source_context to disambiguate against — the exact
        # cross-preprocessor-context leakage this exists to prevent.
        if issue.source_context and draft.source_context != issue.source_context:
            verified_patches.append(_reject(draft, 'Proposal source context does not match the issue.'))
            continue

        file_key = _FILE_TO_SOURCE_KEY.get(issue.file)
        if file_key is None or file_key not in sources:
            verified_patches.append(_reject(draft, 'Unsupported target file.'))
            continue

        source = sources[file_key]
        if (
            len(draft.expected_text) > MAX_PROPOSAL_TEXT_LENGTH
            or len(draft.replacement_text) > MAX_PROPOSAL_TEXT_LENGTH
        ):
            verified_patches.append(_reject(draft, 'Proposal exceeds the maximum size.'))
            continue

        # Live verification found that while the model reliably reproduces
        # `expected_text` character-for-character, its own start_offset/
        # end_offset arithmetic is NOT reliable (LLMs cannot precisely
        # count characters) — even after correctly translating its
        # excerpt-relative offsets to real source offsets (see
        # excerpt.py), the translated range routinely did not equal
        # `expected_text`'s actual length. Rather than trust the model's
        # arithmetic for *locating* the text, the server locates
        # `expected_text` itself via exact substring search — offsets are
        # only ever used as a same-source-context hint to disambiguate
        # when the exact text occurs more than once. The safety property
        # is unchanged: a proposal is only ever accepted when
        # `expected_text` matches something byte-for-byte real in the
        # CURRENT source; nothing here weakens that.
        #
        # A pure insertion used to be exempted from this — located purely
        # by the model's raw (translated) offsets, with only a bounds
        # check. A live-verification session found this let a genuinely
        # miscounted insertion offset land mid-token in unrelated text
        # (observed: a `lang="en"` insertion for `<html>` landing inside
        # the literal string "<!DOCTYPE html>", splitting it into
        # "<!DOCT lang=\"en\"YPE html>" — the model's offset arithmetic is
        # exactly as unreliable for insertions as for replacements, and
        # nothing caught it because insertions had no anchor to verify
        # against). Insertions are now required to supply `expected_text`
        # as a short real anchor (see the updated provider prompt) and are
        # located through the identical verified substring search below —
        # no proposal of either kind can ever be located from unverified
        # offsets.
        if not draft.expected_text:
            verified_patches.append(_reject(
                draft, 'Proposal is missing an anchor (expected_text) for its insertion point.',
            ))
            continue

        occurrences = _find_all(source, draft.expected_text)
        if not occurrences:
            verified_patches.append(_reject(draft, 'Code changed after validation. Validate again before applying fixes.'))
            continue
        if len(occurrences) == 1:
            start_offset = occurrences[0]
        else:
            _excerpt, excerpt_start_offset = excerpt_window(source, issue.line)
            hint = excerpt_start_offset + draft.start_offset
            start_offset = min(occurrences, key=lambda candidate: abs(candidate - hint))
        end_offset = start_offset + len(draft.expected_text)

        # Deep Validation spec Checkpoint 7 — a real live-verification run
        # found the model can propose a technically well-anchored patch
        # (expected_text genuinely matches, offsets genuinely correct)
        # whose replacement_text nonetheless ADDS a statement that
        # duplicates code left untouched elsewhere in the file — e.g. "wrap
        # this call in an if-guard" implemented by inserting a NEW guarded
        # copy of the call alongside the anchor line, while the original,
        # unguarded call three lines further down was never removed. This
        # is the same class of defect check_no_new_duplicate_singletons
        # catches for HTML document-shell elements, generalized to any
        # language: reject a candidate whose newly-added content
        # (replacement_text minus whatever was already in expected_text)
        # reproduces a significant line verbatim from the UNTOUCHED
        # remainder of the source.
        if _introduces_duplicate_of_existing_line(source, start_offset, end_offset, draft.expected_text, draft.replacement_text):
            verified_patches.append(_reject(
                draft, 'Proposal would duplicate a statement that already exists elsewhere in the source.',
            ))
            continue

        # Deterministic Secure-DOM verifier (closure spec section 5) — a
        # JavaScript candidate must never introduce a NEW dangerous DOM
        # sink (innerHTML/outerHTML/insertAdjacentHTML/document.write/
        # eval/Function/javascript: URL), including one that wasn't there
        # before at all, or one substituted for a different dangerous
        # sink the proposal claims to be fixing. Never a "trust the
        # model" decision — this is a hard, pattern-based gate over the
        # actual resulting text, independent of what the proposal's own
        # `explanation` claims it did.
        if draft.language == 'javascript':
            candidate_source = source[:start_offset] + draft.replacement_text + source[end_offset:]
            new_sinks = introduces_new_dangerous_sink(source, candidate_source)
            if new_sinks:
                verified_patches.append(_reject(
                    draft,
                    'Proposal introduces a dangerous DOM sink ('
                    + ', '.join(sorted(new_sinks))
                    + ') that was not already present — rejected by the secure-DOM verifier.',
                ))
                continue

        starts = line_starts(source)
        start_line, start_column = offset_to_line_col(start_offset, starts)
        end_line, end_column = offset_to_line_col(end_offset, starts)
        patch = Patch(
            fix_id=str(uuid.uuid4()), issue_id=issue.id, fingerprint=issue.fingerprint,
            language=draft.language, source_context=issue.source_context or '', file=file_key,
            start_offset=start_offset, end_offset=end_offset,
            start_line=start_line, start_column=start_column, end_line=end_line, end_column=end_column,
            original_text=draft.expected_text, replacement_text=draft.replacement_text,
            description=draft.explanation, risk=draft.risk, confidence=draft.confidence,
        )
        verified_patches.append(AIProposal(
            patch=patch, explanation=draft.explanation, assumptions=list(draft.assumptions),
            requires_configuration=draft.requires_configuration, status='safe',
        ))

    # Alternative grouping happens BEFORE conflict detection: drop exact
    # duplicates and cap each issue at MAX_AI_ALTERNATIVES_PER_ISSUE first,
    # so conflict detection (and everything downstream) only ever sees the
    # alternatives that will actually be shown to the user.
    safe_before_grouping = [proposal for proposal in verified_patches if proposal.status == 'safe']
    keep_ids = _dedupe_and_cap_alternatives(safe_before_grouping)
    verified_patches = [
        proposal for proposal in verified_patches
        if proposal.status != 'safe' or proposal.patch.fix_id in keep_ids
    ]

    # COMPATIBLE same-region merge (AI Engineer Autonomous Repair sprint,
    # spec section 2/4/7) — BEFORE conflict detection, so proposals that
    # were only ever "conflicting" because they land on the identical
    # anchor (missing charset + viewport + meta description all inserting
    # right after the same "<head>" text, say) become ONE combined
    # structural repair instead of N proposals excluding each other. See
    # fixes/regions.py for the additive-only safety condition; anything
    # that doesn't qualify is left completely untouched here and still
    # goes through the same conflict detector as before.
    safe_proposals = [proposal for proposal in verified_patches if proposal.status == 'safe']
    _merged_patches, consumed_fix_ids, merges = merge_compatible_insertions(
        [proposal.patch for proposal in safe_proposals],
    )
    if merges:
        proposal_by_fix_id = {proposal.patch.fix_id: proposal for proposal in safe_proposals}
        merged_proposals = []
        for merged_patch, member_patches in merges:
            members = [proposal_by_fix_id[member.fix_id] for member in member_patches if member.fix_id in proposal_by_fix_id]
            explanations = list(dict.fromkeys(member.explanation for member in members if member.explanation))
            assumptions = list(dict.fromkeys(
                assumption for member in members for assumption in member.assumptions
            ))
            merged_proposals.append(AIProposal(
                patch=merged_patch,
                explanation=(
                    'Combined structural repair addressing: ' + '; '.join(explanations)
                    if explanations else merged_patch.description
                ),
                assumptions=assumptions,
                requires_configuration=any(member.requires_configuration for member in members),
                status='safe',
            ))
        kept_non_safe = [proposal for proposal in verified_patches if proposal.status != 'safe']
        kept_safe = [proposal for proposal in safe_proposals if proposal.patch.fix_id not in consumed_fix_ids]
        verified_patches = kept_non_safe + kept_safe + merged_proposals
        safe_proposals = kept_safe + merged_proposals

    conflict_ids = _mark_conflicts_excluding_same_issue(safe_proposals)
    proposals = [
        proposal if proposal.patch.fix_id not in conflict_ids else AIProposal(
            patch=proposal.patch, explanation=proposal.explanation, assumptions=proposal.assumptions,
            requires_configuration=proposal.requires_configuration, status='conflict',
            rejection_reason='Two proposals modify the same source range and require individual review.',
        )
        for proposal in verified_patches
    ]

    # Fix-Application Correctness / Deep Validation spec section 16 — a
    # candidate that text-verified fine (expected_text really is in the
    # source) can still fail to actually resolve the issue it claims to
    # fix. Never show that as a normal selectable option; the user must
    # not be able to pick a proposal, click Apply Fix, and be told it
    # didn't work. requires_configuration proposals are skipped here —
    # they are already never auto-applied and re-validating a candidate
    # the model itself flagged as needing external input adds cost for no
    # safety benefit.
    final_proposals = []
    for proposal in proposals:
        if proposal.status != 'safe' or proposal.requires_configuration:
            final_proposals.append(proposal)
            continue
        issue = issues_by_id.get(proposal.patch.issue_id)
        if issue is None:
            final_proposals.append(proposal)
            continue
        patch = proposal.patch
        file_key = patch.file
        candidate_source = (
            sources[file_key][:patch.start_offset] + patch.replacement_text + sources[file_key][patch.end_offset:]
        )
        if _issue_resolved_by_candidate(issue, candidate_source, file_key, sources, profile, css_source_type):
            final_proposals.append(proposal)
        else:
            final_proposals.append(AIProposal(
                patch=patch, explanation=proposal.explanation, assumptions=proposal.assumptions,
                requires_configuration=proposal.requires_configuration, status='rejected',
                rejection_reason='AI Engineer generated a repair, but validation still reports this issue. It was not offered as a fix option.',
            ))
    proposals = final_proposals

    # "Addressed" means the AI produced SOME proposal for the issue,
    # regardless of whether it survived verification — a rejected proposal
    # still represents an attempt, distinct from an issue the AI never
    # touched at all (which is what `not_reviewed` is actually for).
    addressed_issue_ids = {proposal.patch.issue_id for proposal in proposals}
    not_reviewed = [issue_id for issue_id in requested_issue_ids if issue_id not in addressed_issue_ids]
    return proposals, not_reviewed

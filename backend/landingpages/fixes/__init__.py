"""Deterministic Apply Safe Fixes engine — Module 3 LP Validator & Fixer.

A "safe fix" here is never inferred from severity or from the
`ValidationIssue.auto_fixable`/`fix_type`/`deterministic_fix` columns alone
(one of those, `missing-doctype`, has `fixable=True` with an EMPTY
`deterministic_fix`; another, `missing-alt`, has `fixable=True` with
`requires_manual_review=True` — proof those columns are not, by themselves,
a trustworthy "apply this automatically" signal). Instead, every patch is
regenerated fresh, on the CURRENT submitted source, by re-running the exact
same validator adapter that originally reported the issue (see
catalogue.py) and matching its freshly-computed fingerprint against the
persisted issue's fingerprint. A match proves three things at once: the
defect is still present, its position is still accurate, and the source
has not drifted since — the same check IS the staleness check.
"""

from dataclasses import dataclass

from .catalogue import generate_patch
from .offsets import line_starts


@dataclass(frozen=True)
class PatchResult:
    fix_id: str
    issue_id: int
    file: str
    status: str  # 'applied' | 'failed'
    reason: str = ''


def compute_patches_for_issues(report_issues, issue_ids, sources, css_source_type, profile):
    """Returns (patches, conflict_fix_ids, review_required_issue_ids, not_found_issue_ids).

    `patches` includes every successfully generated patch, safe or
    conflicting alike — callers filter by `conflict_fix_ids` membership.
    """
    issues_by_id = {issue.id: issue for issue in report_issues}
    patches = []
    review_required = []
    not_found = []
    for issue_id in issue_ids:
        issue = issues_by_id.get(issue_id)
        if issue is None:
            not_found.append(issue_id)
            continue
        patch = generate_patch(issue, sources, css_source_type, profile)
        if patch is None:
            review_required.append(issue_id)
        else:
            patches.append(patch)
    conflict_fix_ids = detect_conflicts(patches)
    return patches, conflict_fix_ids, review_required, not_found


def detect_conflicts(patches):
    """Pairwise overlap/same-range detection, scoped per target source file
    (an HTML patch and a CSS patch can never conflict with each other).
    Deliberately O(n^2) — n is the number of patches in one fix batch,
    bounded well below any size where this matters."""
    conflict_ids = set()
    by_file: dict[str, list] = {}
    for patch in patches:
        by_file.setdefault(patch.file, []).append(patch)
    for file_patches in by_file.values():
        for i in range(len(file_patches)):
            for j in range(i + 1, len(file_patches)):
                a, b = file_patches[i], file_patches[j]
                same_range = a.start_offset == b.start_offset and a.end_offset == b.end_offset
                overlapping = a.start_offset < b.end_offset and b.start_offset < a.end_offset
                if same_range or overlapping:
                    conflict_ids.add(a.fix_id)
                    conflict_ids.add(b.fix_id)
    return conflict_ids


def apply_patches_to_source(source: str, patches: list) -> tuple[str | None, list[PatchResult]]:
    """Applies `patches` (all targeting the same source string) highest
    start_offset first, so an earlier edit never shifts a later patch's
    recorded position. Re-verifies `original_text` against the CURRENT
    source immediately before every single splice — not just once at the
    top — so a patch invalidated by an *earlier* patch in this same batch
    (should never happen for non-conflicting patches, but is checked
    regardless) is caught rather than silently mis-applied.

    All-or-nothing per source: if any patch fails verification, no patch
    in this batch is applied to this source (returns `None`) — the
    per-patch PatchResult list still reports exactly which one(s) failed
    and which would otherwise have succeeded, so the caller never has to
    guess or pretend partial success.
    """
    ordered = sorted(patches, key=lambda p: p.start_offset, reverse=True)
    working = source
    results: list[PatchResult] = []
    failed = False
    for patch in ordered:
        actual = working[patch.start_offset:patch.end_offset]
        if actual != patch.original_text:
            results.append(PatchResult(
                fix_id=patch.fix_id, issue_id=patch.issue_id, file=patch.file, status='failed',
                reason='Code changed after validation. Validate again before applying fixes.',
            ))
            failed = True
            continue
        working = working[:patch.start_offset] + patch.replacement_text + working[patch.end_offset:]
        results.append(PatchResult(fix_id=patch.fix_id, issue_id=patch.issue_id, file=patch.file, status='applied'))
    if failed:
        # Report every patch in this source as not-committed — "applied"
        # above described verification succeeding in isolation, not that
        # its edit survived; downgrade all to keep the response honest.
        results = [
            PatchResult(fix_id=r.fix_id, issue_id=r.issue_id, file=r.file, status='failed',
                        reason=r.reason or 'Not applied — another fix in the same batch failed verification.')
            for r in results
        ]
        return None, results
    return working, results


__all__ = ['compute_patches_for_issues', 'detect_conflicts', 'apply_patches_to_source', 'PatchResult', 'line_starts']

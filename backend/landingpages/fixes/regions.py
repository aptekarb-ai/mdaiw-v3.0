"""Same-region COMPATIBLE-insertion merging — AI Engineer Autonomous Repair
sprint (section 2/4/7). Multiple independent findings that each want to add
new content at the exact same anchor point (e.g. missing charset + missing
viewport + missing meta description, all anchored on the literal "<head>"
text already in the source) are not automatically a conflict just because
they land on the same source range. If every proposal in the group is
PURELY ADDITIVE at that shared anchor — the anchor's own text survives
unchanged, only new content is appended immediately before or after it —
they are combined into ONE patch that keeps the anchor and inserts every
distinct addition once, in a stable, HTML-convention-aligned order
(charset before viewport before title before meta description before
anything else — this also keeps the merge from re-triggering this app's own
`charset-declared-late` check).

This function only ever REMOVES same-range pairs from consideration by
folding them into one coherent patch; it never invents a new conflict.
Anything that is NOT purely additive at a shared range — e.g. two different
proposed rewrites of the anchor's own content, such as `<html>` versus
`<html data-x="1">` for the same "fix <html>" issue — is left completely
untouched here and falls through to the existing pairwise conflict detector
(fixes.detect_conflicts / ai_review.validation._mark_conflicts_excluding_same_issue),
which is the correct, conservative outcome for a genuine same-range rewrite
conflict (spec section 4, category C — TRUE CONFLICTS)."""

import re
import uuid
from dataclasses import replace

_RISK_ORDER = {'low': 0, 'medium': 1, 'high': 2}
_CONFIDENCE_ORDER = {'definite': 0, 'likely': 1, 'possible': 2}

# Source-repair-integrity sprint — a live-verification session found a
# proposal for one issue (missing-lang) anchored on the SAME "<head>" text
# as three unrelated metadata insertions, with a badly-scoped replacement
# that itself contained a second, nested "<html lang="en">" start tag. The
# additive-shape check alone (anchor preserved, only new text appended)
# happily swallowed it — nothing there checks WHAT the new text actually
# is. A legitimate additive fragment for a small attribute/metadata fix
# never contains another document-shell element's start tag; if it does,
# the proposal is a mis-scoped structural rewrite masquerading as an
# insertion and must never be folded into a same-anchor merge — see
# _is_disqualified_extra below.
_DISQUALIFYING_TAG_PATTERN = re.compile(r'<\s*(!doctype|html|head|body)\b', re.IGNORECASE)


def _is_disqualified_extra(extra_text):
    return bool(_DISQUALIFYING_TAG_PATTERN.search(extra_text))

# Lower sorts first. An insertion whose content doesn't match any of these
# keeps its relative discovery order (stable sort) — only charset/viewport/
# title/description have a convention-driven position worth enforcing.
_INSERTION_PRIORITY = (
    ('charset', 0),
    ('viewport', 1),
    ('<title', 2),
    ('name="description"', 3),
    ("name='description'", 3),
)


def _priority(extra_text):
    lowered = extra_text.lower()
    for needle, rank in _INSERTION_PRIORITY:
        if needle in lowered:
            return rank
    return len(_INSERTION_PRIORITY)


def merge_compatible_insertions(patches):
    """`patches`: list[fixes.catalogue.Patch], all computed against the SAME
    current source snapshot (same offsets are only meaningful together when
    that holds — every caller in this codebase already guarantees it).

    Returns (result_patches, consumed_fix_ids, merges):
      - result_patches: every patch NOT folded into a merge, plus one new
        synthesized Patch per successful merge (brand-new fix_id — never
        collides with an input patch's id).
      - consumed_fix_ids: the original fix_ids that were folded away (never
        present in result_patches).
      - merges: [(merged_patch, [original_member_patches, ...]), ...] — for
        callers that need to rebuild proposal-level metadata (explanation,
        assumptions, requires_configuration) for the synthesized patch.
    """
    groups: dict[tuple, list] = {}
    for patch in patches:
        groups.setdefault((patch.file, patch.start_offset, patch.end_offset), []).append(patch)

    consumed: set[str] = set()
    synthesized = []
    merges = []
    for group in groups.values():
        if len(group) < 2:
            continue
        anchor = group[0].original_text
        parts_before = []  # (patch, extra_text) — extra goes BEFORE the anchor
        parts_after = []  # extra goes AFTER the anchor
        seen_extra = set()
        exact_duplicates = set()
        additive_ok = True
        for patch in group:
            if patch.original_text != anchor:
                additive_ok = False  # defensive — same offsets must mean same text; stay safe if not
                break
            replacement = patch.replacement_text
            if anchor and replacement.startswith(anchor):
                extra, bucket = replacement[len(anchor):], parts_after
            elif anchor and replacement.endswith(anchor):
                extra, bucket = replacement[:len(replacement) - len(anchor)], parts_before
            else:
                additive_ok = False
                break
            if not extra.strip():
                additive_ok = False
                break
            if _is_disqualified_extra(extra):
                # This member's own "addition" is itself another document-
                # shell start tag — never a legitimate additive fragment.
                # Drop only THIS member (never merged, never applied
                # silently); it is left out of `consumed` so it falls
                # through to normal conflict detection against whatever
                # DOES get merged from the rest of the group.
                continue
            if extra in seen_extra:
                exact_duplicates.add(patch.fix_id)  # same addition proposed twice — drop the duplicate, not a conflict
                continue
            seen_extra.add(extra)
            bucket.append((patch, extra))

        if not additive_ok or (len(parts_before) + len(parts_after)) < 2:
            continue

        parts_before.sort(key=lambda pair: _priority(pair[1]))
        parts_after.sort(key=lambda pair: _priority(pair[1]))
        combined_replacement = (
            ''.join(extra for _, extra in parts_before) + anchor
            + ''.join(extra for _, extra in parts_after)
        )
        members = [patch for patch, _ in parts_before] + [patch for patch, _ in parts_after]
        worst_risk = max(members, key=lambda member: _RISK_ORDER.get(member.risk, 99)).risk
        worst_confidence = max(members, key=lambda member: _CONFIDENCE_ORDER.get(member.confidence, 99)).confidence
        descriptions = list(dict.fromkeys(member.description for member in members if member.description))
        merged_patch = replace(
            members[0],
            fix_id=str(uuid.uuid4()),
            replacement_text=combined_replacement,
            description=(
                'Combined structural repair: ' + '; '.join(descriptions) if descriptions else members[0].description
            ),
            risk=worst_risk,
            confidence=worst_confidence,
        )
        synthesized.append(merged_patch)
        merges.append((merged_patch, members))
        consumed.update(member.fix_id for member in members)
        consumed.update(exact_duplicates)

    untouched = [patch for patch in patches if patch.fix_id not in consumed]
    return untouched + synthesized, consumed, merges


__all__ = ['merge_compatible_insertions']

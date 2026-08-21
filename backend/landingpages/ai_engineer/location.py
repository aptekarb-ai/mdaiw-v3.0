"""Evidence-text -> authoritative source location. The provider is asked
for `evidence` (exact quoted current source text) rather than a line/
column or absolute offset — LLMs cannot reliably count characters (the
same lesson ai_review/validation.py already encodes for fix proposals).
This module is the server-side verification step spec section 9/10
requires: a finding is only ever accepted once its evidence is proven to
exist, character-for-character, in the real chunk it claims to describe.
"""

from ..validation.adapters.embedded_css import line_starts, offset_to_line_col

MIN_EVIDENCE_LENGTH = 3
MAX_EVIDENCE_LENGTH = 400


def resolve_evidence_location(evidence: str, chunk_text: str, chunk_start_line: int):
    """Returns (start_line, start_column, end_line, end_column) 1-indexed,
    or None if `evidence` cannot be reliably located in `chunk_text` — the
    caller must drop the finding rather than guess a location (spec
    section 9: "mark finding as requiring review rather than guessing";
    for a fully-unverifiable finding that means not creating an issue at
    all, since a validation issue with no real location is not
    reviewable).

    Ambiguous evidence (occurs more than once) still resolves — to its
    FIRST occurrence — rather than being dropped: unlike a fix proposal
    (which mutates source and so must be exact), a finding's location is
    only ever used to point a human at roughly the right place, so the
    first match is an honest, non-guessed answer among genuinely
    equivalent candidates.
    """
    if not evidence or not (MIN_EVIDENCE_LENGTH <= len(evidence) <= MAX_EVIDENCE_LENGTH):
        return None

    offset = chunk_text.find(evidence)
    if offset == -1:
        return None

    chunk_starts = line_starts(chunk_text)
    rel_start_line, start_column = offset_to_line_col(offset, chunk_starts)
    rel_end_line, end_column = offset_to_line_col(offset + len(evidence) - 1, chunk_starts)

    # chunk-relative line -> global line: the chunk's own first line IS
    # chunk_start_line, so a chunk-relative line 1 maps to chunk_start_line
    # exactly, and each further chunk-relative line adds one.
    start_line = chunk_start_line + (rel_start_line - 1)
    end_line = chunk_start_line + (rel_end_line - 1)
    return start_line, start_column, end_line, end_column + 1

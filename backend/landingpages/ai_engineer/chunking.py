"""Structural source chunking — splits one language's complete source into
bounded pieces along natural boundaries (never mid-token) when it exceeds
`max_chunk_chars`. A source that fits in one chunk returns exactly one
chunk covering the whole thing — chunking only happens when actually
required (spec section 7/8).

Each language gets its own boundary-finder returning a sorted list of
0-indexed character offsets that are safe split points (the start of a
top-level construct). `_split_at_boundaries` then greedily groups
consecutive constructs into chunks up to `max_chunk_chars`, so a single
oversized construct (a huge function, a huge rule) becomes its own
over-budget chunk rather than being cut in half.
"""

import re
from dataclasses import dataclass

from ..validation.adapters.embedded_css import line_starts, offset_to_line_col

# HTML: split before each top-level (not nested inside another tag we've
# already opened) major structural/semantic element start tag.
_HTML_BOUNDARY_RE = re.compile(
    r'<(?:head|body|header|nav|main|section|article|aside|footer|form|div|style|script)\b',
    re.IGNORECASE,
)
# CSS/SCSS/Sass/LESS: split before each top-level rule or at-rule start —
# a selector or @-rule beginning at column 0 of a logical line (source is
# never re-indented before this runs, so top-level rules in
# conventionally-formatted source start at the left margin).
_CSS_BOUNDARY_RE = re.compile(r'(?:^|\n)(?=[.#\w\[:&@*])', re.MULTILINE)
# JavaScript: split before each top-level function/class/const-arrow
# declaration.
_JS_BOUNDARY_RE = re.compile(
    r'(?:^|\n)(?=\s*(?:function\s+\w|class\s+\w|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|export\s+))',
)
# AMPscript: split before each %%[ ... ]%% or %%= ... =%% block boundary.
_AMPSCRIPT_BOUNDARY_RE = re.compile(r'%%\[|%%=')

_BOUNDARY_RE_BY_LANGUAGE = {
    'html': _HTML_BOUNDARY_RE,
    'css': _CSS_BOUNDARY_RE,
    'javascript': _JS_BOUNDARY_RE,
    'ampscript': _AMPSCRIPT_BOUNDARY_RE,
}


@dataclass(frozen=True)
class SourceChunk:
    text: str
    start_line: int  # 1-indexed, inclusive
    end_line: int  # 1-indexed, inclusive
    chunk_index: int
    total_chunks: int


def _boundary_offsets(language: str, source: str) -> list[int]:
    pattern = _BOUNDARY_RE_BY_LANGUAGE.get(language)
    if pattern is None:
        return [0]
    offsets = sorted({0, *(match.start() for match in pattern.finditer(source))})
    return offsets


def chunk_source(
    language: str, source: str, max_chunk_chars: int, max_chunks: int,
) -> tuple[list[SourceChunk], bool]:
    """Returns (chunks, truncated). `truncated` is True only when the
    source needed MORE than `max_chunks` structural groups to cover in
    full — in that case, exactly `max_chunks` chunks covering the source
    FROM THE START are returned (never a silently-dropped middle region;
    the caller records this as incomplete AI coverage, per spec section
    6/29, rather than pretending the tail was scanned)."""
    if not source.strip():
        return [], False

    if len(source) <= max_chunk_chars:
        starts = line_starts(source)
        end_line, _ = offset_to_line_col(max(0, len(source) - 1), starts)
        return [SourceChunk(text=source, start_line=1, end_line=end_line, chunk_index=0, total_chunks=1)], False

    boundaries = _boundary_offsets(language, source)
    starts = line_starts(source)

    groups: list[tuple[int, int]] = []  # (start_offset, end_offset) exclusive
    group_start = boundaries[0]
    for index, offset in enumerate(boundaries):
        next_offset = boundaries[index + 1] if index + 1 < len(boundaries) else len(source)
        if offset != group_start and (next_offset - group_start) > max_chunk_chars:
            groups.append((group_start, offset))
            group_start = offset
    groups.append((group_start, len(source)))

    truncated = len(groups) > max_chunks
    kept_groups = groups[:max_chunks]

    chunks = []
    for chunk_index, (start_offset, end_offset) in enumerate(kept_groups):
        text = source[start_offset:end_offset]
        start_line, _ = offset_to_line_col(start_offset, starts)
        end_line, _ = offset_to_line_col(max(start_offset, end_offset - 1), starts)
        chunks.append(SourceChunk(
            text=text, start_line=start_line, end_line=end_line,
            chunk_index=chunk_index, total_chunks=len(kept_groups),
        ))
    return chunks, truncated

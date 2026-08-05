"""Shared helpers for extracting and validating CSS embedded inside HTML —
inline `style="..."` attributes and internal `<style>` blocks (see
html_inline_style.py / html_style_block.py). Both need the same two
primitives:

1. Exact absolute-offset <-> line/column conversion against the raw HTML
   source, so extracted CSS text can be sliced and its findings mapped
   back without any entity-decoding or re-scanning ambiguity.
2. Batching every extracted CSS unit from one document into a single
   validate_css.mjs subprocess call rather than one call per unit — a
   document with a dozen inline styles must not spawn a dozen Node
   processes.
"""

import bisect

from ..node_bridge import run_css_validation


def line_starts(text: str) -> list[int]:
    """Character offset (0-based) at which each line begins. `starts[0]`
    is always 0; `starts[i]` is the offset just past the i-th newline."""
    starts = [0]
    for index, char in enumerate(text):
        if char == '\n':
            starts.append(index + 1)
    return starts


def line_col_to_offset(line: int, column: int, starts: list[int]) -> int:
    """1-based (line, column) -> 0-based absolute character offset."""
    line = max(1, min(line, len(starts)))
    return starts[line - 1] + max(0, column - 1)


def offset_to_line_col(offset: int, starts: list[int]) -> tuple[int, int]:
    """0-based absolute character offset -> 1-based (line, column)."""
    index = max(0, bisect.bisect_right(starts, offset) - 1)
    return index + 1, offset - starts[index] + 1


def validate_css_units(units: list[str], profile: str, *, context: str = 'stylesheet') -> list[dict]:
    """Validates every unit in `units`, in one subprocess call in the
    common case. Returns one result dict per unit, each shaped like a
    single run_css_validation() response (`success`, `issues` with
    unit-relative `line`/`column`, `engineVersion`) so callers can treat
    each entry exactly like a normal single-unit result. A shared engine
    failure (Node unavailable, timeout, ...) applies identically to every
    unit — callers see `success: False` on all of them, matching what a
    single adapter-level failure would look like to the orchestrator.
    """
    if not units:
        return []

    joined, unit_start_lines = _join_units(units)
    result = run_css_validation(joined, profile, context=context)

    if not result.get('success'):
        return [result for _ in units]

    if result.get('parseFailed'):
        # PostCSS parses the joined document as ONE tree — a hard syntax
        # error anywhere in it aborts the whole parse, which would
        # otherwise silently discard every other unit's valid findings
        # (see Sprint CSS-A). Falling back to one call per unit trades a
        # few extra subprocess calls — only on this failure path, never
        # the common case — for the isolation the spec requires: one
        # broken unit must never hide another's results.
        return [run_css_validation(unit, profile, context=context) for unit in units]

    per_unit_issues: list[list[dict]] = [[] for _ in units]
    for raw in result.get('issues', []):
        css_line = raw.get('line') or 1
        unit_index = max(0, bisect.bisect_right(unit_start_lines, css_line) - 1)
        relative_line = css_line - unit_start_lines[unit_index] + 1
        per_unit_issues[unit_index].append({**raw, 'line': relative_line})

    return [
        {'success': True, 'engineVersion': result.get('engineVersion') or '', 'issues': issues}
        for issues in per_unit_issues
    ]


def _join_units(units: list[str]) -> tuple[str, list[int]]:
    joined_parts: list[str] = []
    unit_start_lines: list[int] = []
    current_line = 1
    for unit in units:
        unit_start_lines.append(current_line)
        joined_parts.append(unit)
        current_line += unit.count('\n') + 2  # the unit's own lines, then one blank separator line
    return '\n\n'.join(joined_parts), unit_start_lines

"""Static AMPscript preview simulator — Module 3 LP Preview.

AMPscript cannot execute in a browser and this app never executes it
against Salesforce Marketing Cloud (no network call, no CloudPages API, no
Data Extension access — see the module-level security contract repeated in
views.py). This module recognizes exactly one shape of AMPscript and
nothing else: a literal `SET @var = "..."` (or a number) inside a `%%[ ]%%`
block, referenced later by a bare `%%=v(@var)=%%` inline expression. Every
other construct — function calls, conditionals, loops, DE lookups,
anything requiring real evaluation — renders a clearly-labelled placeholder
instead of being silently dropped or (worse) guessed at.

Uses ../validation/ampscript/blocks.find_regions for delimiter scanning
(the same linear, backtracking-safe scanner the validator already uses)
so this module never re-implements delimiter matching, only the
literal-substitution step on top of it.
"""

import re

from ..validation.ampscript.blocks import find_regions

PLACEHOLDER = '[AMPscript output — simulated, not evaluated]'

_SET_RE = re.compile(
    r'\bSET\s+@([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|(-?\d+(?:\.\d+)?))',
    re.IGNORECASE,
)
_V_CALL_RE = re.compile(r'^\s*v\s*\(\s*@([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$', re.IGNORECASE)


def extract_variables(text: str, seed: dict[str, str] | None = None) -> dict[str, str]:
    """Scans every `%%[ ... ]%%` block in `text` for literal `SET @x = ...`
    assignments and returns a variable table, starting from `seed` (e.g.
    user-supplied preview-only mock values, or variables already collected
    from a different source this document also contains) — a `SET` in
    `text` overrides a same-named entry already in `seed`, matching normal
    top-to-bottom precedence."""
    variables: dict[str, str] = dict(seed or {})
    regions, _delimiter_issues = find_regions(text)
    for region in regions:
        if region.kind != 'block':
            continue
        inner = text[region.inner_start:region.inner_end]
        for match in _SET_RE.finditer(inner):
            name = match.group(1)
            literal = match.group(2)
            if literal is None:
                literal = match.group(3)
            if literal is None:
                literal = match.group(4)
            if literal is not None:
                variables[name] = literal
    return variables


def substitute(text: str, variables: dict[str, str]) -> tuple[str, list[str]]:
    """Removes every AMPscript region from the visible text: `%%[ ]%%`
    blocks render nothing themselves (only their SET side-effects, already
    folded into `variables` by extract_variables), and each `%%=v(@x)=%%`
    inline expression becomes `variables[x]` when known, else PLACEHOLDER.
    Returns (result_text, variable_names_actually_referenced)."""
    regions, _delimiter_issues = find_regions(text)
    if not regions:
        return text, []

    pieces: list[str] = []
    used: list[str] = []
    cursor = 0
    for region in regions:
        pieces.append(text[cursor:region.outer_start])
        if region.kind == 'inline':
            expr = text[region.inner_start:region.inner_end]
            match = _V_CALL_RE.match(expr)
            name = match.group(1) if match else None
            if name is not None and name in variables:
                pieces.append(variables[name])
                if name not in used:
                    used.append(name)
            else:
                pieces.append(PLACEHOLDER)
        cursor = region.outer_end
    pieces.append(text[cursor:])
    return ''.join(pieces), used


def simulate(text: str, mock_values: dict[str, str] | None = None) -> tuple[str, list[str]]:
    """Convenience wrapper over extract_variables + substitute for a
    single self-contained AMPscript text (used directly by tests and by
    any single-source caller)."""
    variables = extract_variables(text, mock_values)
    return substitute(text, variables)


__all__ = ['simulate', 'extract_variables', 'substitute', 'PLACEHOLDER']

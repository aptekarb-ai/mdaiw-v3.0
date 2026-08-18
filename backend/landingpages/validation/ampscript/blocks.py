"""Finds every `%%[ ... ]%%` block and `%%= ... =%%` inline-output region in
a text (either a dedicated AMPscript-tab source, or a whole HTML document —
this scanner does not care which; it only looks for the four delimiter
markers). Also reports delimiter-level defects (unterminated block,
mismatched/overlapping delimiters, empty inline expression) that live
outside any single region's own grammar.

The scan is a single linear pass over `re.finditer` matches of a fixed
4-alternative literal pattern (no quantifiers, no nested groups) followed by
a small state machine — deliberately not a hand-rolled recursive parser, so
it cannot exhibit catastrophic backtracking and stays O(n) in text length.
"""

import re
from dataclasses import dataclass

_DELIM_RE = re.compile(r'%%\[|\]%%|%%=|=%%')

_MAX_REGIONS = 500  # resource bound


@dataclass(frozen=True)
class Region:
    kind: str  # 'block' | 'inline'
    index: int
    outer_start: int
    outer_end: int  # exclusive, end of the closing delimiter
    inner_start: int
    inner_end: int  # exclusive, start of the closing delimiter


@dataclass(frozen=True)
class DelimiterIssue:
    rule_id: str
    severity: str
    message: str
    offset: int


def find_regions(text: str) -> tuple[list[Region], list[DelimiterIssue]]:
    regions: list[Region] = []
    issues: list[DelimiterIssue] = []

    state = None  # None | 'block' | 'inline'
    pending_start = None
    pending_inner_start = None

    for match in _DELIM_RE.finditer(text):
        token = match.group(0)
        offset = match.start()

        if len(regions) >= _MAX_REGIONS:
            issues.append(DelimiterIssue(
                'ampscript:too-many-regions', 'info',
                f'More than {_MAX_REGIONS} AMPscript regions were found; remaining content was not analyzed.',
                offset,
            ))
            break

        if state is None:
            if token == '%%[':
                state = 'block'
                pending_start = offset
                pending_inner_start = match.end()
            elif token == '%%=':
                state = 'inline'
                pending_start = offset
                pending_inner_start = match.end()
            elif token == ']%%':
                issues.append(DelimiterIssue(
                    'ampscript:unexpected-closing-delimiter', 'error',
                    '"]%%" was found without a matching "%%[".', offset,
                ))
            elif token == '=%%':
                issues.append(DelimiterIssue(
                    'ampscript:unexpected-closing-delimiter', 'error',
                    '"=%%" was found without a matching "%%=".', offset,
                ))
            continue

        if state == 'block':
            if token == ']%%':
                inner_end = offset
                inner_text = text[pending_inner_start:inner_end]
                if not inner_text.strip():
                    issues.append(DelimiterIssue(
                        'ampscript:empty-block', 'warning',
                        '"%%[ ]%%" block has no AMPscript content.', pending_start,
                    ))
                regions.append(Region('block', len(regions), pending_start, match.end(), pending_inner_start, inner_end))
                state = None
                pending_start = None
            elif token == '%%[':
                issues.append(DelimiterIssue(
                    'ampscript:overlapping-block', 'error',
                    '"%%[" was found before the previous block was closed with "]%%".', offset,
                ))
            elif token in ('%%=', '=%%'):
                issues.append(DelimiterIssue(
                    'ampscript:invalid-nested-delimiter', 'error',
                    f'"{token}" is not valid inside a "%%[ ]%%" block.', offset,
                ))
            continue

        if state == 'inline':
            if token == '=%%':
                inner_end = offset
                inner_text = text[pending_inner_start:inner_end]
                if not inner_text.strip():
                    issues.append(DelimiterIssue(
                        'ampscript:empty-inline-expression', 'error',
                        '"%%= =%%" has no expression.', pending_start,
                    ))
                regions.append(Region('inline', len(regions), pending_start, match.end(), pending_inner_start, inner_end))
                state = None
                pending_start = None
            elif token in ('%%[', '%%='):
                issues.append(DelimiterIssue(
                    'ampscript:invalid-nested-delimiter', 'error',
                    f'"{token}" is not valid inside a "%%= =%%" inline expression.', offset,
                ))
            elif token == ']%%':
                issues.append(DelimiterIssue(
                    'ampscript:invalid-nested-delimiter', 'error',
                    '"]%%" is not valid inside a "%%= =%%" inline expression.', offset,
                ))
            continue

    if state == 'block':
        issues.append(DelimiterIssue(
            'ampscript:unterminated-block', 'error',
            'This "%%[" block is missing its closing "]%%".', pending_start,
        ))
    elif state == 'inline':
        issues.append(DelimiterIssue(
            'ampscript:unterminated-inline-expression', 'error',
            'This "%%=" expression is missing its closing "=%%".', pending_start,
        ))

    return regions, issues

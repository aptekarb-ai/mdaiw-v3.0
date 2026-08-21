"""Pure-Python AMPscript static analyzer. No external execution
environment, no Salesforce API calls, and the submitted source is never
treated as Python/JavaScript/shell/template code — it is only ever tokenized
and pattern-matched as plain text (see tokenizer.py).

Public entry point: `analyze(source)`, used identically by the dedicated
AMPscript-tab adapter (called on the tab's own source) and the
embedded-in-HTML adapter (called on the whole HTML document) — see
adapters/ampscript_conformance.py and adapters/html_embedded_ampscript.py.
"""

import bisect
from dataclasses import dataclass

from .blocks import find_regions
from .parser import analyze_region_text
from .variables import VariableScope


@dataclass(frozen=True)
class AmpscriptDocumentIssue:
    rule_id: str
    severity: str
    category: str
    message: str
    line: int
    column: int
    region_kind: str | None  # 'block' | 'inline' | None (delimiter-level)
    region_index: int | None


@dataclass(frozen=True)
class AnalysisResult:
    issues: list[AmpscriptDocumentIssue]
    region_count: int


def _line_starts(text: str) -> list[int]:
    starts = [0]
    for index, char in enumerate(text):
        if char == '\n':
            starts.append(index + 1)
    return starts


def _line_col_to_offset(line: int, column: int, starts: list[int]) -> int:
    line = max(1, min(line, len(starts)))
    return starts[line - 1] + max(0, column - 1)


def _offset_to_line_col(offset: int, starts: list[int]) -> tuple[int, int]:
    index = max(0, bisect.bisect_right(starts, offset) - 1)
    return index + 1, offset - starts[index] + 1


def analyze(source: str) -> AnalysisResult:
    if not source or not source.strip():
        return AnalysisResult(issues=[], region_count=0)

    source_starts = _line_starts(source)
    regions, delimiter_issues = find_regions(source)

    issues: list[AmpscriptDocumentIssue] = []

    for delim_issue in delimiter_issues:
        line, column = _offset_to_line_col(delim_issue.offset, source_starts)
        issues.append(AmpscriptDocumentIssue(
            delim_issue.rule_id, delim_issue.severity, 'syntax', delim_issue.message,
            line, column, None, None,
        ))

    scope = VariableScope()
    for region in regions:
        inner_text = source[region.inner_start:region.inner_end]
        inner_starts = _line_starts(inner_text)
        region_issues = analyze_region_text(inner_text, region.kind, scope)
        for issue in region_issues:
            rel_offset = _line_col_to_offset(issue.line, issue.column, inner_starts)
            abs_offset = region.inner_start + rel_offset
            abs_line, abs_col = _offset_to_line_col(abs_offset, source_starts)
            issues.append(AmpscriptDocumentIssue(
                issue.rule_id, issue.severity, issue.category, issue.message,
                abs_line, abs_col, region.kind, region.index,
            ))

    return AnalysisResult(issues=issues, region_count=len(regions))

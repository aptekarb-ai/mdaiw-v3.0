"""Extracts and validates `%%[ ... ]%%` blocks and `%%= ... =%%` inline
expressions found directly inside the HTML source (Complete LP and HTML-only
scope). Mirrors html_inline_style.py/html_style_block.py's "find it, map it
back to the real HTML position" shape, but AMPscript's analyzer scans the
whole HTML text directly for its own delimiters (see
validation/ampscript/blocks.py) rather than needing an HTML-parser-based
extraction step — `%%[`/`]%%`/`%%=`/`=%%` are never valid HTML/attribute
syntax, so a plain text scan cannot false-positive on real markup.

`editor_target='html'` (language stays 'ampscript') — same "language vs.
file" split used for embedded CSS, see schema.py::ValidationIssueData.
"""

from .base import ValidatorAdapter
from ..ampscript import analyze
from ..schema import ValidationIssueData

_ENGINE_NAME = 'html-embedded-ampscript'
_SOURCE_CONTEXT = 'html-embedded-ampscript'
_POSSIBLE_CONFIDENCE_RULES = frozenset({'ampscript:unknown-function', 'ampscript:missing-comma'})


class HtmlEmbeddedAmpscriptAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'ampscript'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        result = analyze(source)
        issues: list[ValidationIssueData] = []
        for issue in result.issues:
            confidence = 'possible' if (issue.category == 'security' or issue.rule_id in _POSSIBLE_CONFIDENCE_RULES) else 'definite'
            issues.append(ValidationIssueData(
                language='ampscript',
                editor_target='html',
                source_context=_SOURCE_CONTEXT,
                source_block_index=issue.region_index,
                source_engine=issue.rule_id.split(':', 1)[0] if ':' in issue.rule_id else _ENGINE_NAME,
                engine_version='',
                rule_id=issue.rule_id,
                category=issue.category,
                severity=issue.severity,
                message=issue.message,
                start_line=issue.line,
                start_column=issue.column,
                confidence=confidence,
                fixable=False,
                requires_manual_review=True,
                risk='high' if issue.severity == 'error' else ('medium' if issue.severity == 'warning' else 'low'),
            ))
        return issues

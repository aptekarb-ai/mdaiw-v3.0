"""Validates the dedicated AMPscript-tab source. Reuses the same static
analyzer as the embedded-in-HTML adapter (see html_embedded_ampscript.py) —
both call validation.ampscript.analyze() on their own, separate source text,
so the same content is never analyzed twice (see that module's docstring).
"""

from .base import ValidatorAdapter
from ..ampscript import analyze
from ..schema import ValidationIssueData

_ENGINE_NAME = 'ampscript-conformance'
_SOURCE_CONTEXT = 'ampscript-source'
_POSSIBLE_CONFIDENCE_RULES = frozenset({'ampscript:unknown-function', 'ampscript:missing-comma'})


class AmpscriptConformanceAdapter(ValidatorAdapter):
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

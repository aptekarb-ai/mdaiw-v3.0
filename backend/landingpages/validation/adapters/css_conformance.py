"""CSS conformance, quality, security, accessibility, and responsive
adapter — backed by the controlled Node bridge (PostCSS for AST/syntax,
Stylelint for rule-based findings, plus a small set of project-owned
AST-based checks not covered by either — see
validators_node/validate_css.mjs for what actually runs). This class only
normalizes that script's JSON output into the unified
ValidationIssueData schema; it contains no validation logic of its own.
"""

from ..node_bridge import NodeBridgeError, run_css_validation
from ..schema import ValidationIssueData
from .base import ValidatorAdapter

_ENGINE_NAME = 'css-conformance'


class CssConformanceAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'css'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        result = run_css_validation(source, profile)  # NodeBridgeError propagates to the orchestrator as an adapter failure

        if not result.get('success'):
            error = result.get('error') or {}
            raise NodeBridgeError(error.get('message') or 'CSS validation could not be completed.')

        engine_version = result.get('engineVersion') or ''

        issues = []
        for raw in result.get('issues', []):
            rule_id = raw.get('ruleId') or 'css:unknown'
            source_engine = rule_id.split(':', 1)[0] if ':' in rule_id else 'css'
            severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
            issues.append(ValidationIssueData(
                language='css',
                # Sprint CSS-C: explicit context, matching
                # standalone-scss/standalone-sass, so Complete LP's
                # "every finding identifies its source context" holds
                # for plain CSS too (see spec section 7's context list).
                source_context='standalone-css',
                source_engine=source_engine,
                engine_version=engine_version,
                rule_id=rule_id,
                category=raw.get('category') or 'syntax',
                severity=severity,
                message=raw.get('message') or '',
                start_line=raw.get('line') or 1,
                start_column=raw.get('column'),
                end_line=raw.get('endLine'),
                end_column=raw.get('endColumn'),
                standards_reference='',
                confidence=raw.get('confidence') or 'definite',
                suggestion=raw.get('suggestion') or '',
                code_excerpt=raw.get('codeExcerpt') or '',
                fixable=False,
                fix_type='',
                deterministic_fix=None,
                requires_manual_review=True,
                related_element='',
                related_attribute=raw.get('relatedAttribute') or '',
                risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
            ))
        return issues

"""JavaScript conformance, quality, and security adapter — backed by the
controlled Node bridge (ESLint's `Linter` class for AST/syntax and rule-
based findings, plus a small set of project-owned custom ESLint rules for
security and landing-page-specific checks not covered by ESLint's own
rule set — see validators_node/js_engine.mjs for what actually runs). This
class only normalizes that script's JSON output into the unified
ValidationIssueData schema; it contains no validation logic of its own.

`known_element_ids`/`duplicate_ids` are optional cross-language context —
only ever populated by engine.py when the standalone JS tab is validated
under Complete LP scope alongside real HTML source (see engine.py's
dispatch and adapters/html_js_context.py). Left `None` (the default, used
whenever the `javascript`-only scope runs this adapter through the generic
`_run_adapters` loop), the `mdaiw-lp/missing-selector-target` rule stays
entirely off — this adapter never guesses at HTML that was not provided.
"""

from ..node_bridge import NodeBridgeError, run_js_validation
from ..schema import ValidationIssueData
from .base import ValidatorAdapter

_ENGINE_NAME = 'javascript-conformance'


class JsConformanceAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'javascript'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def __init__(self, known_element_ids: set[str] | None = None, duplicate_ids: set[str] | None = None):
        self.known_element_ids = sorted(known_element_ids) if known_element_ids is not None else None
        self.duplicate_ids = sorted(duplicate_ids) if duplicate_ids else []

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        result = run_js_validation(  # NodeBridgeError propagates to the orchestrator as an adapter failure
            source, profile, known_element_ids=self.known_element_ids, duplicate_ids=self.duplicate_ids,
        )

        if not result.get('success'):
            error = result.get('error') or {}
            raise NodeBridgeError(error.get('message') or 'JavaScript validation could not be completed.')

        engine_version = result.get('engineVersion') or ''

        issues = []
        for raw in result.get('issues', []):
            rule_id = raw.get('ruleId') or 'javascript:unknown'
            source_engine = rule_id.split(':', 1)[0] if ':' in rule_id else 'eslint'
            severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
            issues.append(ValidationIssueData(
                language='javascript',
                source_context='standalone-javascript',
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
                related_attribute='',
                risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
            ))
        return issues

"""LESS compilation + generated-CSS validation adapter (Sprint CSS-D).
Used for the standalone CSS-tab source when css_source_type is 'less'.

Security: see validators_node/compile_less.mjs's module docstring for the
compiler-side controls. This adapter's only responsibility on the Python
side is building the `partials` map from already-ownership-scoped,
already-trusted storage reads (never from the request body, never from an
arbitrary filesystem path) and normalizing the Node script's response
into the unified issue schema. No caller currently supplies `partials` —
there is no LESS-partial storage feature yet — so it is always `{}` in
practice; the parameter and its security properties are exercised
directly by tests (see tests/test_less_compilation.py), the same pattern
used for ScssSassAdapter in Sprint CSS-C.
"""

from .base import ValidatorAdapter
from ..node_bridge import NodeBridgeError, run_less_compilation
from ..schema import ValidationIssueData

_ENGINE_NAME = 'less-compiler'
_UNMAPPED_NOTE = 'Detected in generated CSS; exact original LESS location could not be mapped.'


class LessAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'css'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str, *, partials: dict[str, str] | None = None) -> list[ValidationIssueData]:
        # Sprint CSS-E — read by engine.py after this call to populate
        # ValidationRunResult.generated_css*. Reset on every call, same
        # reasoning as ScssSassAdapter.
        self.compiled = False
        self.compiled_css = None
        self.compiled_engine_version = ''

        if not source or not source.strip():
            return []

        # NodeBridgeError propagates to the orchestrator as an adapter failure
        result = run_less_compilation(source, profile, partials=partials)

        if not result.get('success'):
            error = result.get('error') or {}
            raise NodeBridgeError(error.get('message') or 'LESS compilation could not be completed.')

        engine_version = result.get('engineVersion') or ''
        self.compiled_engine_version = engine_version
        self.compiled = bool(result.get('compiled'))
        if self.compiled:
            self.compiled_css = result.get('css')
        return [self._build_issue(raw, engine_version) for raw in result.get('issues', [])]

    def _build_issue(self, raw: dict, engine_version: str) -> ValidationIssueData:
        rule_id = raw.get('ruleId') or 'css:unknown'
        severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
        unmapped = bool(raw.get('unmapped'))
        suggestion = raw.get('suggestion') or ''
        if unmapped:
            suggestion = f'{_UNMAPPED_NOTE} {suggestion}'.strip()

        return ValidationIssueData(
            language='css',
            source_context='standalone-less',
            source_engine=rule_id.split(':', 1)[0] if ':' in rule_id else _ENGINE_NAME,
            engine_version=engine_version,
            rule_id=rule_id,
            category=raw.get('category') or 'syntax',
            severity=severity,
            message=raw.get('message') or '',
            start_line=raw.get('line') or 1,
            start_column=raw.get('column'),
            generated_start_line=raw.get('generatedLine'),
            generated_start_column=raw.get('generatedColumn'),
            confidence=raw.get('confidence') or 'definite',
            suggestion=suggestion,
            code_excerpt=raw.get('codeExcerpt') or '',
            fixable=False,
            requires_manual_review=True,
            risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
        )

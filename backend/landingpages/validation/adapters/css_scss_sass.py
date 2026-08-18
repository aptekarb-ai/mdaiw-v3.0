"""SCSS / indented-Sass compilation + generated-CSS validation adapter
(Sprint CSS-C). Used for the standalone CSS-tab source when
css_source_type is 'scss' or 'sass' — plain 'css' keeps using
CssConformanceAdapter unchanged (see engine.py's dispatch).

Security: see validators_node/compile_scss.mjs's module docstring for the
compiler-side controls. This adapter's only responsibility on the Python
side is building the `partials` map from already-ownership-scoped,
already-trusted storage reads (never from the request body, never from an
arbitrary filesystem path) and normalizing the Node script's response
into the unified issue schema. No caller currently supplies `partials` —
there is no SCSS-partial storage feature yet — so it is always `{}` in
practice; the parameter and its security properties are exercised
directly by tests (see tests/test_scss_sass_compilation.py).
"""

from .base import ValidatorAdapter
from ..node_bridge import NodeBridgeError, run_scss_compilation
from ..schema import ValidationIssueData

_ENGINE_NAME_BY_SYNTAX = {'scss': 'scss-compiler', 'sass': 'sass-compiler'}
_LABEL_BY_SYNTAX = {'scss': 'SCSS', 'sass': 'Sass'}
_UNMAPPED_NOTE = 'Detected in generated CSS; exact original source location could not be mapped.'


class ScssSassAdapter(ValidatorAdapter):
    engine_version = ''
    language = 'css'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def __init__(self, source_type: str):
        # source_type: 'scss' or 'sass' (indented) — validated by the
        # caller (engine.py) before construction.
        self.source_type = source_type
        self.engine_name = _ENGINE_NAME_BY_SYNTAX[source_type]

    def validate(self, source: str, profile: str, *, partials: dict[str, str] | None = None) -> list[ValidationIssueData]:
        # Sprint CSS-E — read by engine.py after this call to populate
        # ValidationRunResult.generated_css*. Reset on every call so a
        # second validate() on the same instance (not done today, but not
        # relied upon not to happen) never carries a stale compile forward.
        self.compiled = False
        self.compiled_css = None
        self.compiled_engine_version = ''

        if not source or not source.strip():
            return []

        syntax = 'indented' if self.source_type == 'sass' else 'scss'
        # NodeBridgeError propagates to the orchestrator as an adapter failure
        result = run_scss_compilation(source, syntax, profile, partials=partials)

        if not result.get('success'):
            error = result.get('error') or {}
            raise NodeBridgeError(
                error.get('message') or f'{_LABEL_BY_SYNTAX[self.source_type]} compilation could not be completed.',
            )

        engine_version = result.get('engineVersion') or ''
        self.compiled_engine_version = engine_version
        self.compiled = bool(result.get('compiled'))
        if self.compiled:
            self.compiled_css = result.get('css')
        source_context = f'standalone-{self.source_type}'
        return [
            self._build_issue(raw, source_context, engine_version)
            for raw in result.get('issues', [])
        ]

    def _build_issue(self, raw: dict, source_context: str, engine_version: str) -> ValidationIssueData:
        rule_id = raw.get('ruleId') or 'css:unknown'
        severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
        unmapped = bool(raw.get('unmapped'))
        suggestion = raw.get('suggestion') or ''
        if unmapped:
            suggestion = f'{_UNMAPPED_NOTE} {suggestion}'.strip()

        return ValidationIssueData(
            language='css',
            source_context=source_context,
            source_engine=rule_id.split(':', 1)[0] if ':' in rule_id else self.engine_name,
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

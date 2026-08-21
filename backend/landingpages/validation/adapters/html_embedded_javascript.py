"""Extracts every real, browser-runnable `<script>...</script>` block from
an HTML document and validates its content with the same JavaScript engine
used for the standalone JS tab (see js_conformance.py /
validators_node/js_engine.mjs). Findings are mapped back to their real
position inside the HTML source — that is where the developer can fix
them — so `editor_target` stays 'html' even though `language='javascript'`
(see schema.py::ValidationIssueData.file).

A `<script>` block is skipped (not validated, not reported as an error)
when it: has a `src` attribute (external — see html_external_script.py),
or declares a non-JavaScript `type` (`application/ld+json`,
`application/json`, `importmap`, a template-data type, ...) — none of
those are ever parsed as a program by the browser. `type="module"` is
validated with `sourceType='module'`; absent/`text/javascript`/
`application/javascript` are validated as a classic script.

Each block is validated with its own subprocess call rather than batched
(unlike inline-style/style-block CSS batching) — a landing page typically
has only a handful of `<script>` blocks, and batching would risk silently
mixing `module`- and `script`-sourceType content into one join, which is
not always syntactically composable (`import`/`export` are only legal in
module code). A failure isolated to one block never removes another
block's findings — same conservative behavior as html_style_block.py.
"""

from .base import ValidatorAdapter
from .embedded_css import line_col_to_offset, line_starts, offset_to_line_col
from .html_js_context import MODULE_JS_TYPE, PLAIN_JS_TYPES, extract_script_blocks
from ..node_bridge import run_js_validation
from ..schema import ValidationIssueData

_ENGINE_NAME = 'html-embedded-javascript'
_SOURCE_CONTEXT = 'html-script-block'


class HtmlEmbeddedJavascriptAdapter(ValidatorAdapter):
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

        blocks = extract_script_blocks(source)
        if not blocks:
            return []

        starts = line_starts(source)
        issues: list[ValidationIssueData] = []

        for index, block in enumerate(blocks):
            if block['has_src']:
                continue  # external — see html_external_script.py
            script_type = block['type']
            if script_type not in PLAIN_JS_TYPES and script_type != MODULE_JS_TYPE:
                continue  # not JavaScript (application/ld+json, importmap, a template-data type, ...)
            content = block['content']
            if not content.strip():
                continue

            source_type = 'module' if script_type == MODULE_JS_TYPE else 'script'
            result = run_js_validation(
                content, profile, source_type=source_type,
                known_element_ids=self.known_element_ids, duplicate_ids=self.duplicate_ids,
            )
            if not result.get('success'):
                continue  # a failure isolated to one block must not remove findings from another

            content_starts = line_starts(content)
            for raw in result.get('issues', []):
                rel_line = raw.get('line') or 1
                rel_col = raw.get('column') or 1
                offset_within_content = line_col_to_offset(rel_line, rel_col, content_starts)
                absolute_offset = block['content_offset'] + offset_within_content
                mapped_line, mapped_col = offset_to_line_col(absolute_offset, starts)

                rule_id = raw.get('ruleId') or 'javascript:unknown'
                source_engine = rule_id.split(':', 1)[0] if ':' in rule_id else 'eslint'
                severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
                issues.append(ValidationIssueData(
                    language='javascript',
                    editor_target='html',
                    source_context=_SOURCE_CONTEXT,
                    source_block_index=index,
                    source_engine=source_engine,
                    engine_version=result.get('engineVersion') or '',
                    rule_id=rule_id,
                    category=raw.get('category') or 'syntax',
                    severity=severity,
                    message=raw.get('message') or '',
                    start_line=mapped_line,
                    start_column=mapped_col,
                    confidence=raw.get('confidence') or 'definite',
                    suggestion=raw.get('suggestion') or '',
                    code_excerpt=raw.get('codeExcerpt') or '',
                    fixable=False,
                    requires_manual_review=True,
                    related_element='script',
                    related_attribute='',
                    risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
                ))
        return issues

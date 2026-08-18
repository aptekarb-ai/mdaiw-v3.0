"""Extracts every recognized inline event-handler attribute
(`onclick`, `onchange`, `onsubmit`, `onload`, `oninput`, `onfocus`,
`onblur`, `onkeydown`, `onkeyup`) from an HTML document and validates its
body with the same JavaScript engine used for the standalone JS tab (see
js_conformance.py / validators_node/js_engine.mjs). A handler's content is
not a complete program on its own — the browser runs it as a function
body — so each extracted value is wrapped in a synthetic function before
validation, and every reported position is mapped back to the attribute's
real location in the original HTML — that is where the developer can
actually fix it, so `editor_target='html'` even though
`language='javascript'` (see schema.py::ValidationIssueData.file).

Also performs a best-effort "missing referenced function" check: when a
handler's entire body is exactly one simple call expression
(`doThing()`), and `doThing` is neither a common bare browser global
(`alert`, `confirm`, ...) nor found among `declared_function_names`
(collected across the standalone JS tab and every `<script>` block by
adapters/html_js_context.py::extract_top_level_function_names), it is
reported at 'possible' confidence — a name lookup, not a claim of
certainty, since a function could legally be declared dynamically or
assigned in a way the regex-based scan does not recognize.
"""

import re
from html.parser import HTMLParser

from .base import ValidatorAdapter
from .embedded_css import line_col_to_offset, line_starts, offset_to_line_col
from ..node_bridge import run_js_validation
from ..schema import ValidationIssueData

_ENGINE_NAME = 'html-inline-event-handler'
_SOURCE_CONTEXT = 'html-inline-event-handler'

_RECOGNIZED_ATTRIBUTES = (
    'onclick', 'onchange', 'onsubmit', 'onload', 'oninput', 'onfocus', 'onblur', 'onkeydown', 'onkeyup',
)
_ATTRIBUTE_PATTERN = '|'.join(_RECOGNIZED_ATTRIBUTES)
_HANDLER_ATTR_RE = re.compile(rf'\b(?:{_ATTRIBUTE_PATTERN})\s*=\s*(?P<quote>["\'])', re.IGNORECASE)

_WRAPPER_PREFIX = 'function __mdaiwHandler__(event){\n'
_WRAPPER_SUFFIX = '\n}'

_SIMPLE_CALL_RE = re.compile(r'^\s*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*;?\s*$')
_KNOWN_BARE_GLOBALS = frozenset({'alert', 'confirm', 'prompt', 'print', 'open', 'close', 'focus', 'blur'})


# Reuses html.parser.HTMLParser exactly like html_inline_style.py's
# _InlineStyleExtractor, re-scanning each tag's own raw text (rather than
# trusting HTMLParser's decoded attrs dict) so entity decoding never
# shifts the reported offset.
class _InlineHandlerExtractor(HTMLParser):
    def __init__(self, source: str, starts: list[int]):
        super().__init__(convert_charrefs=False)
        self._source = source
        self._starts = starts
        self.found: list[dict] = []  # {tag, attribute, value, value_offset}

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        tag_line, tag_col0 = self.getpos()
        tag_offset = line_col_to_offset(tag_line, tag_col0 + 1, self._starts)
        raw_tag_text = self.get_starttag_text() or ''
        for match in _HANDLER_ATTR_RE.finditer(raw_tag_text):
            attribute = match.group(0).split('=', 1)[0].strip().lower()
            if attr_dict.get(attribute) is None:
                continue
            quote = match.group('quote')
            value_start = tag_offset + match.end()
            value_end = self._source.find(quote, value_start)
            if value_end == -1:
                continue
            value = self._source[value_start:value_end]
            if not value.strip():
                continue
            self.found.append({'tag': tag, 'attribute': attribute, 'value': value, 'value_offset': value_start})


class HtmlInlineEventHandlerAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'javascript'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def __init__(
        self, known_element_ids: set[str] | None = None, duplicate_ids: set[str] | None = None,
        declared_function_names: set[str] | None = None,
    ):
        self.known_element_ids = sorted(known_element_ids) if known_element_ids is not None else None
        self.duplicate_ids = sorted(duplicate_ids) if duplicate_ids else []
        self.declared_function_names = declared_function_names or set()

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        starts = line_starts(source)
        extractor = _InlineHandlerExtractor(source, starts)
        try:
            extractor.feed(source)
            extractor.close()
        except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
            return []
        if not extractor.found:
            return []

        issues: list[ValidationIssueData] = []
        for index, handler in enumerate(extractor.found):
            issues.extend(self._validate_handler(index, handler, profile, starts))
        return issues

    def _validate_handler(self, index: int, handler: dict, profile: str, starts: list[int]) -> list[ValidationIssueData]:
        content = handler['value']
        wrapped = f'{_WRAPPER_PREFIX}{content}{_WRAPPER_SUFFIX}'
        result = run_js_validation(
            wrapped, profile, source_type='script',
            known_element_ids=self.known_element_ids, duplicate_ids=self.duplicate_ids,
        )
        issues: list[ValidationIssueData] = []
        if result.get('success'):
            content_starts = line_starts(content)
            content_line_count = content.count('\n') + 1
            for raw in result.get('issues', []):
                wrapped_line = raw.get('line') or 1
                wrapped_col = raw.get('column') or 1
                content_line = max(1, min(wrapped_line - 1, content_line_count))
                content_col = wrapped_col if wrapped_line > 1 else 1
                offset_within_value = line_col_to_offset(content_line, content_col, content_starts)
                absolute_offset = handler['value_offset'] + offset_within_value
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
                    code_excerpt=raw.get('codeExcerpt') or content[:200],
                    fixable=False,
                    requires_manual_review=True,
                    related_element=handler['tag'],
                    related_attribute=handler['attribute'],
                    risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
                ))

        issues.extend(self._check_missing_function(index, handler, starts))
        return issues

    def _check_missing_function(self, index: int, handler: dict, starts: list[int]) -> list[ValidationIssueData]:
        match = _SIMPLE_CALL_RE.match(handler['value'])
        if not match:
            return []
        function_name = match.group(1)
        if function_name in _KNOWN_BARE_GLOBALS or function_name in self.declared_function_names:
            return []
        mapped_line, mapped_col = offset_to_line_col(handler['value_offset'], starts)
        return [ValidationIssueData(
            language='javascript',
            editor_target='html',
            source_context=_SOURCE_CONTEXT,
            source_block_index=index,
            source_engine=_ENGINE_NAME,
            engine_version='',
            rule_id='html-inline-event-handler:missing-function-reference',
            category='value',
            severity='warning',
            message=f'"{handler["attribute"]}" calls "{function_name}()", but no function named "{function_name}" was found in this page\'s JavaScript.',
            start_line=mapped_line,
            start_column=mapped_col,
            confidence='possible',
            suggestion=f'Define a "{function_name}" function, or correct the handler.',
            code_excerpt=handler['value'][:200],
            requires_manual_review=True,
            related_element=handler['tag'],
            related_attribute=handler['attribute'],
            risk='medium',
        )]

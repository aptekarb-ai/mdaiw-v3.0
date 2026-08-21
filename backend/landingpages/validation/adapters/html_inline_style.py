"""Extracts every `style="..."` attribute from an HTML document and
validates its declaration list with the same CSS engine used for the
standalone CSS tab (see embedded_css.py / validators_node/validate_css.mjs).
A bare declaration list is not a complete stylesheet, so each extracted
value is wrapped in a synthetic selector before validation, and every
reported position is mapped back to the attribute's real location in the
original HTML — that is where the developer can actually fix it, so
`editor_target='html'` even though `language='css'` (see
schema.py::ValidationIssueData.file).
"""

import re
from html.parser import HTMLParser

from .base import ValidatorAdapter
from .embedded_css import line_col_to_offset, line_starts, offset_to_line_col, validate_css_units
from ..schema import ValidationIssueData

_ENGINE_NAME = 'html-inline-style'
_SOURCE_CONTEXT = 'html-inline-style'

# A bare declaration list ("color: red; width: 10px") is not valid CSS on
# its own — PostCSS/Stylelint need a rule. This synthetic selector is a
# single line with no leading whitespace, so the column arithmetic below
# (`len(_WRAPPER_PREFIX)`) stays exact.
_WRAPPER_PREFIX = '[data-mdaiw-inline-style]{'
_WRAPPER_SUFFIX = '}'

_STYLE_ATTR_RE = re.compile(r'style\s*=\s*(?P<quote>["\'])', re.IGNORECASE)


class _InlineStyleExtractor(HTMLParser):
    """Finds every `style` attribute's exact value and its absolute
    character offset in `source`. Re-scans the tag's own raw text (via
    get_starttag_text()) rather than trusting HTMLParser's decoded attrs
    dict for position purposes — attrs values may have entities decoded,
    which would silently shift offsets."""

    def __init__(self, source: str, starts: list[int]):
        super().__init__(convert_charrefs=False)
        self._source = source
        self._starts = starts
        self.found: list[dict] = []  # {tag, value, value_offset}

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        if attr_dict.get('style') is None:
            return
        tag_line, tag_col0 = self.getpos()
        tag_offset = line_col_to_offset(tag_line, tag_col0 + 1, self._starts)
        raw_tag_text = self.get_starttag_text() or ''
        match = _STYLE_ATTR_RE.search(raw_tag_text)
        if not match:
            return
        quote = match.group('quote')
        value_start = tag_offset + match.end()
        value_end = self._source.find(quote, value_start)
        if value_end == -1:
            return
        value = self._source[value_start:value_end]
        if not value.strip():
            return
        self.found.append({'tag': tag, 'value': value, 'value_offset': value_start})


def _value_offset_for_unit_position(rel_line: int, rel_col: int, prefix_len: int, value_starts: list[int]) -> int:
    """`rel_line`/`rel_col` are 1-based positions inside the wrapped unit
    (`_WRAPPER_PREFIX` + value + `_WRAPPER_SUFFIX`). Returns the 0-based
    character offset of that position within `value` alone."""
    if rel_line <= 1:
        value_line_index = 0
        col_in_value = max(1, rel_col - prefix_len)
    else:
        value_line_index = min(rel_line - 2, len(value_starts) - 1)
        col_in_value = rel_col
    value_line_index = max(0, value_line_index)
    return value_starts[value_line_index] + max(0, col_in_value - 1)


class HtmlInlineStyleAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'css'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        starts = line_starts(source)
        extractor = _InlineStyleExtractor(source, starts)
        try:
            extractor.feed(source)
            extractor.close()
        except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
            return []
        if not extractor.found:
            return []

        units = [f"{_WRAPPER_PREFIX}{style['value']}{_WRAPPER_SUFFIX}" for style in extractor.found]
        results = validate_css_units(units, profile, context='declaration-list')

        issues: list[ValidationIssueData] = []
        for index, (style, result) in enumerate(zip(extractor.found, results)):
            if not result.get('success'):
                continue  # a wrapper-level failure isn't a real defect in this particular value
            value_starts = line_starts(style['value'])
            for raw in result.get('issues', []):
                rel_line = raw.get('line') or 1
                rel_col = raw.get('column') or 1
                offset_within_value = _value_offset_for_unit_position(
                    rel_line, rel_col, len(_WRAPPER_PREFIX), value_starts,
                )
                absolute_offset = style['value_offset'] + offset_within_value
                mapped_line, mapped_col = offset_to_line_col(absolute_offset, starts)

                rule_id = raw.get('ruleId') or 'css:unknown'
                severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
                issues.append(ValidationIssueData(
                    language='css',
                    editor_target='html',
                    source_context=_SOURCE_CONTEXT,
                    source_block_index=index,
                    source_engine=rule_id.split(':', 1)[0] if ':' in rule_id else 'css',
                    engine_version=result.get('engineVersion') or '',
                    rule_id=rule_id,
                    category=raw.get('category') or 'syntax',
                    severity=severity,
                    message=raw.get('message') or '',
                    start_line=mapped_line,
                    start_column=mapped_col,
                    confidence=raw.get('confidence') or 'definite',
                    suggestion=raw.get('suggestion') or '',
                    code_excerpt=raw.get('codeExcerpt') or style['value'][:200],
                    fixable=False,
                    requires_manual_review=True,
                    related_element=style['tag'],
                    related_attribute='style',
                    risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
                ))
        return issues

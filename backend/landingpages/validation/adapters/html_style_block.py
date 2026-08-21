"""Extracts every `<style>...</style>` block from an HTML document and
validates its content with the same CSS engine used for the standalone
CSS tab. Findings are mapped back to their real position inside the HTML
source — that is where the developer can fix them — so `editor_target`
stays 'html' even though `language='css'` (see
schema.py::ValidationIssueData.file). Multiple blocks are validated
independently in one batched subprocess call and every block's findings
are merged; a parse failure in one block never hides findings from
another (see embedded_css.validate_css_units).
"""

from html.parser import HTMLParser

from .base import ValidatorAdapter
from .embedded_css import line_col_to_offset, line_starts, offset_to_line_col, validate_css_units
from ..schema import ValidationIssueData

_ENGINE_NAME = 'html-style-block'
_SOURCE_CONTEXT = 'html-style-block'

# Standard <style> content defaults to CSS. A project may explicitly opt
# a block into preprocessor syntax (type="text/scss" / "text/less") —
# compiling and validating that content is out of scope for this sprint
# (see Sprint CSS-C/D); validating it as plain CSS would just produce
# noise, so those blocks are reported as a single "not browser-runnable"
# notice instead of being fed through the CSS engine.
_PLAIN_CSS_TYPES = frozenset({'', 'text/css'})


class _StyleBlockExtractor(HTMLParser):
    def __init__(self, source: str, starts: list[int]):
        super().__init__(convert_charrefs=False)
        self._source = source
        self._starts = starts
        self._pending: dict | None = None
        self.found: list[dict] = []  # {content, content_offset, media, type}

    def handle_starttag(self, tag, attrs):
        if tag != 'style':
            return
        attr_dict = dict(attrs)
        tag_line, tag_col0 = self.getpos()
        tag_offset = line_col_to_offset(tag_line, tag_col0 + 1, self._starts)
        raw_tag_text = self.get_starttag_text() or ''
        self._pending = {
            'content_offset': tag_offset + len(raw_tag_text),
            'media': attr_dict.get('media') or '',
            'type': (attr_dict.get('type') or '').strip().lower(),
        }

    def handle_endtag(self, tag):
        if tag != 'style' or self._pending is None:
            return
        end_line, end_col0 = self.getpos()
        end_offset = line_col_to_offset(end_line, end_col0 + 1, self._starts)
        content = self._source[self._pending['content_offset']:end_offset]
        self.found.append({**self._pending, 'content': content})
        self._pending = None


class HtmlStyleBlockAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'css'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        starts = line_starts(source)
        extractor = _StyleBlockExtractor(source, starts)
        try:
            extractor.feed(source)
            extractor.close()
        except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
            return []
        if not extractor.found:
            return []

        issues: list[ValidationIssueData] = []

        for index, block in enumerate(extractor.found):
            if block['type'] in _PLAIN_CSS_TYPES or not block['content'].strip():
                continue
            block_line, block_col = offset_to_line_col(block['content_offset'], starts)
            issues.append(ValidationIssueData(
                language='css',
                editor_target='html',
                source_context=_SOURCE_CONTEXT,
                source_block_index=index,
                source_engine=_ENGINE_NAME,
                engine_version='',
                rule_id='html-style-block:preprocessor-not-compiled-in-browser',
                category='syntax',
                severity='warning',
                message=(
                    f'"<style type=\"{block["type"]}\">" contains preprocessor syntax that browsers '
                    'cannot run directly.'
                ),
                start_line=block_line,
                start_column=block_col,
                confidence='definite',
                suggestion='Compile this block to CSS before shipping, or reference a compiled stylesheet instead.',
                requires_manual_review=True,
                related_element='style',
                related_attribute='type',
                risk='medium',
            ))

        plain_blocks = [
            (index, block) for index, block in enumerate(extractor.found)
            if block['type'] in _PLAIN_CSS_TYPES and block['content'].strip()
        ]
        if not plain_blocks:
            return issues

        units = [block['content'] for _index, block in plain_blocks]
        results = validate_css_units(units, profile)

        for (index, block), result in zip(plain_blocks, results):
            if not result.get('success'):
                continue  # a parse failure in one block must not remove findings from another
            content_starts = line_starts(block['content'])
            for raw in result.get('issues', []):
                rel_line = raw.get('line') or 1
                rel_col = raw.get('column') or 1
                offset_within_content = line_col_to_offset(rel_line, rel_col, content_starts)
                absolute_offset = block['content_offset'] + offset_within_content
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
                    code_excerpt=raw.get('codeExcerpt') or '',
                    fixable=False,
                    requires_manual_review=True,
                    related_element='style',
                    related_attribute='',
                    risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
                ))
        return issues

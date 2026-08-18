"""SEO and document-metadata checks. Deliberately limited to objectively
detectable presence/absence/shape rules (missing tag, empty value,
duplicate tag, invalid format, broken reference) — subjective advice
("write a more compelling title") is out of scope and must never be
reported at error/warning severity as if it were a syntax defect.
"""

import re
from html.parser import HTMLParser

from ..schema import (
    CONFIDENCE_DEFINITE,
    SEVERITY_WARNING,
    ValidationIssueData,
)
from .base import ValidatorAdapter

_ENGINE_NAME = 'html-seo'
_LANG_PATTERN = re.compile(r'^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$')
_HEADING_TAGS = {f'h{level}': level for level in range(1, 7)}


def _issue(**kwargs) -> ValidationIssueData:
    kwargs.setdefault('language', 'html')
    kwargs.setdefault('source_engine', _ENGINE_NAME)
    kwargs.setdefault('engine_version', '')
    kwargs.setdefault('category', 'seo')
    kwargs.setdefault('severity', SEVERITY_WARNING)
    kwargs.setdefault('confidence', CONFIDENCE_DEFINITE)
    kwargs.setdefault('risk', 'low')
    return ValidationIssueData(**kwargs)


class _SeoChecker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.issues: list[ValidationIssueData] = []
        self._all_ids: set[str] = set()
        self._fragment_refs: list[tuple[str, int, int]] = []
        self._has_lang = False
        self._html_position: tuple[int, int] | None = None
        self._has_charset = False
        self._charset_head_child_index: int | None = None
        self._charset_position: tuple[int, int] | None = None
        self._head_child_count = 0
        self._in_head = False
        self._description_positions: list[tuple[int, int]] = []
        self._description_empty_positions: list[tuple[int, int]] = []
        self._viewport_positions: list[tuple[int, int]] = []
        self._max_heading_seen = 0
        self._h1_count = 0
        self._skipped_heading_positions: list[tuple[int, int, int, int]] = []

    def handle_starttag(self, tag, attrs):
        self._handle_tag(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._handle_tag(tag, attrs)

    def _handle_tag(self, tag, attrs):
        line, column = self.getpos()
        attr_dict = dict(attrs)

        if attr_dict.get('id'):
            self._all_ids.add(attr_dict['id'])

        if tag == 'a' and (attr_dict.get('href') or '').startswith('#') and len(attr_dict['href']) > 1:
            self._fragment_refs.append((attr_dict['href'][1:], line, column + 1))

        if tag == 'html':
            if self._html_position is None:
                self._html_position = (line, column + 1)
            lang = attr_dict.get('lang')
            if lang:
                self._has_lang = True
                if not _LANG_PATTERN.match(lang):
                    self.issues.append(_issue(
                        rule_id='invalid-lang-format',
                        message=f'"lang={lang!r}" is not a valid BCP 47 language tag format.',
                        start_line=line,
                        start_column=column + 1,
                        suggestion='Use a format like "en" or "en-US".',
                        related_element='html',
                        related_attribute='lang',
                    ))

        if tag == 'head':
            self._in_head = True
        if self._in_head:
            self._head_child_count += 1

        if tag == 'meta':
            if attr_dict.get('charset') is not None or (
                attr_dict.get('http-equiv', '').lower() == 'content-type'
            ):
                self._has_charset = True
                if self._charset_head_child_index is None:
                    self._charset_head_child_index = self._head_child_count
                    self._charset_position = (line, column + 1)
            name = attr_dict.get('name', '').lower()
            if name == 'viewport':
                self._viewport_positions.append((line, column + 1))
            if name == 'description':
                content = attr_dict.get('content', '')
                self._description_positions.append((line, column + 1))
                if not content.strip():
                    self._description_empty_positions.append((line, column + 1))

        if tag in _HEADING_TAGS:
            level = _HEADING_TAGS[tag]
            if level == 1:
                self._h1_count += 1
            if self._max_heading_seen and level > self._max_heading_seen + 1:
                self._skipped_heading_positions.append((self._max_heading_seen, level, line, column + 1))
            self._max_heading_seen = max(self._max_heading_seen, level)

    def handle_endtag(self, tag):
        if tag == 'head':
            self._in_head = False

    def finish(self):
        if not self._has_lang:
            html_line, html_column = self._html_position or (1, 1)
            self.issues.append(_issue(
                rule_id='missing-lang',
                message='"<html>" is missing a lang attribute.',
                start_line=html_line,
                start_column=html_column,
                suggestion='Add lang="en" (or the document\'s actual language) to <html>.',
                related_element='html',
                related_attribute='lang',
            ))

        if not self._has_charset:
            self.issues.append(_issue(
                rule_id='missing-charset',
                message='Document is missing a character-encoding declaration.',
                start_line=1,
                start_column=1,
                suggestion='Add <meta charset="utf-8"> as early as possible inside <head>.',
                related_element='meta',
                related_attribute='charset',
            ))
        elif self._charset_head_child_index and self._charset_head_child_index > 2:
            charset_line, charset_column = self._charset_position or (1, 1)
            self.issues.append(_issue(
                rule_id='charset-declared-late',
                message='The character-encoding declaration is not among the first elements in <head>.',
                start_line=charset_line,
                start_column=charset_column,
                suggestion='Move <meta charset="..."> to be the first child of <head>.',
                confidence='likely',
                related_element='meta',
                related_attribute='charset',
            ))

        if not self._viewport_positions:
            self.issues.append(_issue(
                rule_id='missing-viewport',
                message='Document is missing a viewport meta tag.',
                start_line=1,
                start_column=1,
                suggestion='Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
                category='responsive',
                related_element='meta',
                related_attribute='viewport',
            ))
        elif len(self._viewport_positions) > 1:
            for line, column in self._viewport_positions[1:]:
                self.issues.append(_issue(
                    rule_id='multiple-viewport',
                    message='Document has more than one viewport meta tag.',
                    start_line=line,
                    start_column=column,
                    category='responsive',
                    related_element='meta',
                ))

        if not self._description_positions:
            self.issues.append(_issue(
                rule_id='missing-meta-description',
                message='Document is missing a meta description.',
                start_line=1,
                start_column=1,
                suggestion='Add <meta name="description" content="...">.',
                related_element='meta',
                related_attribute='description',
            ))
        else:
            for line, column in self._description_empty_positions:
                self.issues.append(_issue(
                    rule_id='empty-meta-description',
                    message='Meta description content is empty.',
                    start_line=line,
                    start_column=column,
                    related_element='meta',
                    related_attribute='description',
                ))
            if len(self._description_positions) > 1:
                for line, column in self._description_positions[1:]:
                    self.issues.append(_issue(
                        rule_id='multiple-meta-description',
                        message='Document has more than one meta description.',
                        start_line=line,
                        start_column=column,
                        related_element='meta',
                    ))

        if self._h1_count == 0:
            self.issues.append(_issue(
                rule_id='missing-h1',
                message='Document has no top-level "<h1>" heading.',
                start_line=1,
                start_column=1,
                suggestion='Add a single <h1> describing the page\'s main topic.',
                related_element='h1',
            ))

        for previous_level, level, line, column in self._skipped_heading_positions:
            self.issues.append(_issue(
                rule_id='skipped-heading-level',
                message=f'Heading level jumps from h{previous_level} to h{level} — h{previous_level + 1} is skipped.',
                start_line=line,
                start_column=column,
                suggestion='Do not skip heading levels; use them in order.',
                related_element=f'h{level}',
            ))

        for target_id, line, column in self._fragment_refs:
            if target_id not in self._all_ids:
                self.issues.append(_issue(
                    rule_id='broken-fragment-link',
                    message=f'Link references "#{target_id}", which does not match any element id.',
                    start_line=line,
                    start_column=column,
                    suggestion=f'Add id="{target_id}" to the intended target, or correct the link.',
                    related_element='a',
                    related_attribute='href',
                ))


class HtmlSeoAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        checker = _SeoChecker()
        try:
            checker.feed(source)
            checker.close()
        except Exception as exc:  # noqa: BLE001 - malformed input is expected, not a bug
            return [_issue(
                rule_id='parser-error',
                message=f'Could not parse HTML: {exc}',
                start_line=1,
                start_column=None,
                requires_manual_review=True,
            )]
        checker.finish()
        return checker.issues

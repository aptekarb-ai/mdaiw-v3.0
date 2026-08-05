"""Supplemental structural adapter — Sprint 1A's original custom scanner,
kept only as a secondary check (per this sprint's explicit instruction),
not the primary conformance authority (that's HtmlConformanceAdapter,
html5lib-backed). Its value over html5lib: it tracks each element's own
*opening* source position, so it can attribute an unclosed-element error
to the line where the element was opened — html5lib instead reports at
the point of detection (typically the mismatched closing tag), which is
correct but different information.

Fixed defect from Sprint 1A/1B: the previous recovery logic silently
popped every intervening open element when a later, non-adjacent closing
tag matched further down the stack (e.g. `<h1>` never explicitly closed,
followed by `</section>`) — discarding real authoring errors. It now
reports every orphaned element individually, referencing its own opening
position, before recovering the stack so the scan can continue.
"""

from html.parser import HTMLParser

from ..schema import (
    CONFIDENCE_DEFINITE,
    FIX_TYPE_INSERT_CLOSING_TAG,
    FIX_TYPE_NONE,
    SEVERITY_ERROR,
    SEVERITY_WARNING,
    ValidationIssueData,
)
from .base import ValidatorAdapter

_VOID_ELEMENTS = frozenset({
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
})

_ENGINE_NAME = 'html-structure'
_STANDARDS_REFERENCE = 'https://html.spec.whatwg.org/multipage/syntax.html#syntax-tag-omission'


def _issue(**kwargs) -> ValidationIssueData:
    kwargs.setdefault('language', 'html')
    kwargs.setdefault('source_engine', _ENGINE_NAME)
    kwargs.setdefault('engine_version', '')
    kwargs.setdefault('category', 'syntax')
    kwargs.setdefault('confidence', CONFIDENCE_DEFINITE)
    kwargs.setdefault('standards_reference', _STANDARDS_REFERENCE)
    kwargs.setdefault('risk', 'high' if kwargs.get('severity') == SEVERITY_ERROR else 'medium')
    return ValidationIssueData(**kwargs)


class _StructureChecker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.issues: list[ValidationIssueData] = []
        self._open_stack: list[tuple[str, int, int]] = []
        self._seen_ids: dict[str, tuple[int, int]] = {}
        self._has_doctype = False
        self._seen_elements: set[str] = set()
        self._title_positions: list[tuple[int, int]] = []

    def handle_decl(self, decl):
        if decl.strip().lower().startswith('doctype'):
            self._has_doctype = True

    def handle_starttag(self, tag, attrs):
        line, column = self.getpos()
        attr_dict = dict(attrs)
        self._seen_elements.add(tag)

        if tag == 'title':
            self._title_positions.append((line, column + 1))

        element_id = attr_dict.get('id')
        if element_id:
            if element_id in self._seen_ids:
                first_line, first_column = self._seen_ids[element_id]
                self.issues.append(_issue(
                    rule_id='duplicate-id',
                    severity=SEVERITY_ERROR,
                    message=f'Duplicate id "{element_id}" (first used at line {first_line}).',
                    start_line=line,
                    start_column=column + 1,
                    suggestion='Each id attribute must be unique within the page.',
                    related_element=tag,
                    related_attribute='id',
                ))
            else:
                self._seen_ids[element_id] = (line, column + 1)

        if tag not in _VOID_ELEMENTS:
            self._open_stack.append((tag, line, column + 1))

    def handle_startendtag(self, tag, attrs):
        # Self-closed in the markup (e.g. <br />) — never pushed onto the
        # open stack, regardless of whether it's a void element.
        self.handle_starttag(tag, attrs)
        if self._open_stack and self._open_stack[-1][0] == tag:
            self._open_stack.pop()

    def handle_endtag(self, tag):
        for index in range(len(self._open_stack) - 1, -1, -1):
            if self._open_stack[index][0] == tag:
                orphans = self._open_stack[index + 1:]
                close_line, _close_column = self.getpos()
                unambiguous = len(orphans) == 1
                for orphan_tag, orphan_line, orphan_column in orphans:
                    deterministic_fix = None
                    fix_type = FIX_TYPE_NONE
                    if unambiguous:
                        fix_type = FIX_TYPE_INSERT_CLOSING_TAG
                        deterministic_fix = {
                            'action': 'insert_closing_tag',
                            'tag': f'</{orphan_tag}>',
                            'before_line': close_line,
                            'before_column': 1,
                        }
                    self.issues.append(_issue(
                        rule_id='unclosed-tag',
                        severity=SEVERITY_ERROR,
                        message=(
                            f'"<{orphan_tag}>" is never closed — end tag "</{tag}>" '
                            f'encountered while "<{orphan_tag}>" was still open.'
                        ),
                        start_line=orphan_line,
                        start_column=orphan_column,
                        suggestion=f'Add a matching </{orphan_tag}> before </{tag}>.',
                        fixable=unambiguous,
                        fix_type=fix_type,
                        deterministic_fix=deterministic_fix,
                        requires_manual_review=not unambiguous,
                        related_element=orphan_tag,
                    ))
                del self._open_stack[index:]
                return
        # No matching opener anywhere on the stack — a stray closing tag.
        line, column = self.getpos()
        self.issues.append(_issue(
            rule_id='unexpected-closing-tag',
            severity=SEVERITY_ERROR,
            message=f'Unexpected closing tag "</{tag}>" has no matching opening tag.',
            start_line=line,
            start_column=column + 1,
            requires_manual_review=True,
            related_element=tag,
        ))

    def finish(self):
        for tag, line, column in self._open_stack:
            self.issues.append(_issue(
                rule_id='unclosed-tag',
                severity=SEVERITY_ERROR,
                message=f'"<{tag}>" is never closed.',
                start_line=line,
                start_column=column,
                suggestion=f'Add a matching </{tag}>.',
                requires_manual_review=True,
                related_element=tag,
            ))

        if not self._has_doctype:
            self.issues.append(_issue(
                rule_id='missing-doctype',
                severity=SEVERITY_ERROR,
                message='Document is missing "<!DOCTYPE html>".',
                start_line=1,
                start_column=1,
                suggestion='Add <!DOCTYPE html> as the first line of the document.',
                fixable=True,
                fix_type=FIX_TYPE_NONE,
                requires_manual_review=False,
            ))

        for required in ('html', 'head', 'body', 'title'):
            if required not in self._seen_elements:
                self.issues.append(_issue(
                    rule_id=f'missing-{required}',
                    severity=SEVERITY_ERROR,
                    message=f'Document is missing a required "<{required}>" element.',
                    start_line=1,
                    start_column=1,
                    requires_manual_review=True,
                    related_element=required,
                ))

        if len(self._title_positions) > 1:
            for line, column in self._title_positions[1:]:
                self.issues.append(_issue(
                    rule_id='duplicate-title',
                    severity=SEVERITY_WARNING,
                    message='Document has more than one "<title>" element.',
                    start_line=line,
                    start_column=column,
                    requires_manual_review=True,
                    related_element='title',
                    risk='medium',
                ))


class HtmlStructureAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        checker = _StructureChecker()
        try:
            checker.feed(source)
            checker.close()
        except Exception as exc:  # noqa: BLE001 - malformed input is expected, not a bug
            return [_issue(
                rule_id='parser-error',
                severity=SEVERITY_ERROR,
                message=f'Could not parse HTML: {exc}',
                start_line=1,
                start_column=None,
                requires_manual_review=True,
            )]
        checker.finish()
        return checker.issues

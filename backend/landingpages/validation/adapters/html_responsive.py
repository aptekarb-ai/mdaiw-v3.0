"""Responsive-design checks reachable from HTML source alone. Deliberately
thin for Sprint 1C — most genuinely useful responsive checks (fixed-width
layout overflow, non-responsive font sizing, media-query coverage) need a
real CSS parser and arrive with the CSS adapter in a later sprint. This
adapter only validates what the viewport meta tag itself declares, so it
does not duplicate HtmlSeoAdapter's presence check (missing-viewport) —
this one only fires when a viewport tag exists but its content is
inadequate.
"""

from html.parser import HTMLParser

from ..schema import CONFIDENCE_DEFINITE, SEVERITY_WARNING, ValidationIssueData
from .base import ValidatorAdapter

_ENGINE_NAME = 'html-responsive'


def _issue(**kwargs) -> ValidationIssueData:
    kwargs.setdefault('language', 'html')
    kwargs.setdefault('source_engine', _ENGINE_NAME)
    kwargs.setdefault('engine_version', '')
    kwargs.setdefault('category', 'responsive')
    kwargs.setdefault('severity', SEVERITY_WARNING)
    kwargs.setdefault('confidence', CONFIDENCE_DEFINITE)
    kwargs.setdefault('risk', 'low')
    return ValidationIssueData(**kwargs)


class _ResponsiveChecker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.issues: list[ValidationIssueData] = []

    def handle_starttag(self, tag, attrs):
        self._check(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._check(tag, attrs)

    def _check(self, tag, attrs):
        if tag != 'meta':
            return
        attr_dict = dict(attrs)
        if attr_dict.get('name', '').lower() != 'viewport':
            return

        line, column = self.getpos()
        content = attr_dict.get('content', '')
        if 'width=device-width' not in content.replace(' ', '').lower():
            self.issues.append(_issue(
                rule_id='viewport-missing-width-device-width',
                message='Viewport meta tag is missing "width=device-width".',
                start_line=line,
                start_column=column + 1,
                suggestion='Set content="width=device-width, initial-scale=1".',
                related_element='meta',
                related_attribute='content',
            ))


class HtmlResponsiveAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        checker = _ResponsiveChecker()
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
        return checker.issues

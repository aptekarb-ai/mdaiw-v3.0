"""Standards-aware HTML conformance adapter, backed by html5lib's real
WHATWG HTML5 tree-construction algorithm — not a hand-rolled tokenizer.

html5lib parses in non-strict mode (`strict=False`) so a single defect
does not abort parsing; every recorded parser error is still collected via
`parser.errors` and normalized here, regardless of whether the tree
construction algorithm went on to "recover". A recovered tree is not
evidence the source was valid — every entry in `parser.errors` is reported
as an issue independent of what the final DOM looks like.

This adapter does not claim to be a complete HTML conformance checker
(html5lib is a parser, not a full linter — it does not flag obsolete
elements, missing lang/charset/viewport, or accessibility/SEO concerns;
those are covered by the other HTML adapters). A stricter secondary
engine (e.g. a locally bundled Nu Html Checker) can be added later as an
additional adapter without changing this class's public shape — it
already only exposes `validate() -> list[ValidationIssueData]` like every
other adapter.
"""

import html5lib
from html5lib.constants import E as HTML5LIB_ERROR_MESSAGES

from ..schema import (
    CONFIDENCE_DEFINITE,
    SEVERITY_ERROR,
    ValidationIssueData,
)
from .base import ValidatorAdapter

_MAX_MESSAGE_FORMAT_FAILURE = 'HTML parse error ({code}).'


def _format_message(code: str, data: dict | None) -> str:
    template = HTML5LIB_ERROR_MESSAGES.get(code)
    if template is None:
        return _MAX_MESSAGE_FORMAT_FAILURE.format(code=code)
    try:
        return template % (data or {})
    except Exception:  # noqa: BLE001 - a template/data mismatch must never crash validation
        return _MAX_MESSAGE_FORMAT_FAILURE.format(code=code)


class HtmlConformanceAdapter(ValidatorAdapter):
    engine_name = 'html5lib'
    engine_version = html5lib.__version__
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        parser = html5lib.HTMLParser(strict=False)
        # parser.parse() never raises in non-strict mode — errors accumulate
        # in parser.errors instead. Genuine engine crashes (e.g. a Python
        # exception in html5lib itself) still propagate, which is correct:
        # the orchestrator treats that as an adapter failure, not a
        # validation result.
        parser.parse(source)

        issues: list[ValidationIssueData] = []
        for position, code, data in parser.errors:
            line, column = position if position else (1, None)
            issues.append(ValidationIssueData(
                language='html',
                source_engine=self.engine_name,
                engine_version=self.engine_version,
                rule_id=f'html5lib:{code}',
                category='syntax',
                severity=SEVERITY_ERROR,
                message=_format_message(code, data),
                start_line=line,
                start_column=column,
                standards_reference='https://html.spec.whatwg.org/multipage/parsing.html#parse-errors',
                confidence=CONFIDENCE_DEFINITE,
                suggestion='',
                fixable=False,
                requires_manual_review=True,
                risk='high',
            ))
        return issues

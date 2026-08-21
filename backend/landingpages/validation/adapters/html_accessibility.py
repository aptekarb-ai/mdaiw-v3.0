"""Static (source-only) accessibility checks. Explicitly the "layer 1"
half of WCAG automated checking described for this product — rendered
DOM/axe-core checks (layer 2) are out of scope for Sprint 1C (require a
sandboxed rendering environment, tracked for a later sprint).

Scope is deliberately bounded to what is reliably detectable from source
alone: explicit label association (for/id, aria-label, aria-labelledby)
is checked; a <label> implicitly wrapping a control without a `for`
attribute is NOT detected here (would require full DOM containment
tracking) — such controls are conservatively reported at 'likely' rather
than 'definite' confidence for that reason.
"""

from html.parser import HTMLParser

from ..schema import (
    CONFIDENCE_DEFINITE,
    CONFIDENCE_LIKELY,
    FIX_TYPE_ADD_ATTRIBUTE,
    FIX_TYPE_NONE,
    SEVERITY_WARNING,
    ValidationIssueData,
)
from .base import ValidatorAdapter

_ENGINE_NAME = 'html-accessibility'
_NON_LABELED_INPUT_TYPES = frozenset({'hidden', 'submit', 'button', 'image', 'reset'})


def _issue(**kwargs) -> ValidationIssueData:
    kwargs.setdefault('language', 'html')
    kwargs.setdefault('source_engine', _ENGINE_NAME)
    kwargs.setdefault('engine_version', '')
    kwargs.setdefault('category', 'accessibility')
    kwargs.setdefault('severity', SEVERITY_WARNING)
    kwargs.setdefault('risk', 'medium')
    return ValidationIssueData(**kwargs)


class _AccessibilityChecker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.issues: list[ValidationIssueData] = []
        self._all_ids: set[str] = set()
        self._label_for_targets: set[str] = set()
        self._pending_control_checks: list[tuple[str, str, int, int]] = []
        self._aria_refs: list[tuple[str, str, int, int]] = []
        self._capture_stack: list[dict] = []

    def handle_starttag(self, tag, attrs):
        self._handle_tag(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._handle_tag(tag, attrs)

    def _handle_tag(self, tag, attrs):
        line, column = self.getpos()
        attr_dict = dict(attrs)

        if attr_dict.get('id'):
            self._all_ids.add(attr_dict['id'])

        if tag == 'img' and attr_dict.get('alt') is None:
            self.issues.append(_issue(
                rule_id='missing-alt',
                message='Image is missing an alt attribute.',
                start_line=line,
                start_column=column + 1,
                suggestion='Add a descriptive alt attribute (or alt="" only for purely decorative images).',
                fixable=True,
                fix_type=FIX_TYPE_ADD_ATTRIBUTE,
                requires_manual_review=True,
                confidence=CONFIDENCE_DEFINITE,
                related_element='img',
                related_attribute='alt',
            ))

        if tag == 'label' and attr_dict.get('for'):
            self._label_for_targets.add(attr_dict['for'])

        if tag in ('input', 'textarea', 'select'):
            input_type = attr_dict.get('type', 'text').lower()
            has_explicit_name = bool(attr_dict.get('aria-label') or attr_dict.get('aria-labelledby'))
            if not has_explicit_name and input_type not in _NON_LABELED_INPUT_TYPES:
                control_id = attr_dict.get('id')
                if control_id:
                    self._pending_control_checks.append((tag, control_id, line, column + 1))
                else:
                    self.issues.append(_issue(
                        rule_id='missing-form-label',
                        message=f'"<{tag}>" has no accessible label (no id, aria-label, or aria-labelledby).',
                        start_line=line,
                        start_column=column + 1,
                        suggestion='Associate a <label for="..."> or add aria-label.',
                        requires_manual_review=True,
                        confidence=CONFIDENCE_LIKELY,
                        related_element=tag,
                    ))

        for attr_name in ('aria-labelledby', 'aria-describedby'):
            value = attr_dict.get(attr_name)
            if value:
                for ref_id in value.split():
                    self._aria_refs.append((attr_name, ref_id, line, column + 1))

        if tag in ('button', 'a'):
            self._capture_stack.append({
                'tag': tag,
                'line': line,
                'column': column + 1,
                'text': '',
                'has_named_child': bool(attr_dict.get('aria-label')),
            })

    def handle_data(self, data):
        if self._capture_stack:
            self._capture_stack[-1]['text'] += data

    def handle_endtag(self, tag):
        if tag in ('button', 'a') and self._capture_stack and self._capture_stack[-1]['tag'] == tag:
            frame = self._capture_stack.pop()
            if not frame['text'].strip() and not frame['has_named_child']:
                rule_id = 'empty-button' if tag == 'button' else 'empty-link'
                self.issues.append(_issue(
                    rule_id=rule_id,
                    message=f'"<{tag}>" has no accessible text content, aria-label, or accessible name.',
                    start_line=frame['line'],
                    start_column=frame['column'],
                    suggestion='Add visible text or an aria-label.',
                    requires_manual_review=True,
                    confidence=CONFIDENCE_LIKELY,
                    related_element=tag,
                ))

    def finish(self):
        for tag, control_id, line, column in self._pending_control_checks:
            if control_id not in self._label_for_targets:
                self.issues.append(_issue(
                    rule_id='missing-form-label',
                    message=f'"<{tag} id="{control_id}">" is not referenced by any <label for="{control_id}">.',
                    start_line=line,
                    start_column=column,
                    suggestion=f'Add <label for="{control_id}"> or aria-label.',
                    requires_manual_review=True,
                    confidence=CONFIDENCE_LIKELY,
                    related_element=tag,
                ))

        for attr_name, ref_id, line, column in self._aria_refs:
            if ref_id not in self._all_ids:
                self.issues.append(_issue(
                    rule_id='invalid-aria-reference',
                    message=f'{attr_name}="{ref_id}" does not match any element id in the document.',
                    start_line=line,
                    start_column=column,
                    suggestion=f'Add id="{ref_id}" to the referenced element, or correct {attr_name}.',
                    requires_manual_review=True,
                    confidence=CONFIDENCE_DEFINITE,
                    related_attribute=attr_name,
                ))


class HtmlAccessibilityStaticAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        checker = _AccessibilityChecker()
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

"""Nu Html Checker adapter — Hybrid Validator + AI Engineer architecture
sprint, spec section 2/28. Wraps the W3C/WHATWG reference HTML conformance
checker («vnu.jar», via java_bridge.py) as an ADDITIONAL authoritative
cross-check alongside the existing lexical/tag-stack/html5lib passes —
never a replacement for them. Its distinguishing value: it is a real,
standards-grounded parser (not `html.parser`'s browser-style forgiving
recovery), so it reliably names the actual malformed construct — e.g.
"Saw '<' when expecting an attribute name. Probable cause: Missing '>'
immediately before." for a malformed `<html` tag — rather than surfacing a
downstream symptom like a phantom "missing <head>" once recovery has
already swallowed it (see engine.py's
`_suppress_false_missing_element_claims`, which uses the project's own
lexical scanner for that specific cross-check; this adapter adds Nu's
independent, broader conformance coverage on top).

Nu findings carry no structured rule id of their own — `rule_id` is a
fixed `nu:<type>` bucket; the free-text `message` (always Nu's own
literal wording) is what actually differentiates one finding from
another for fingerprinting/deduplication purposes."""

from ..java_bridge import JavaBridgeError, run_nu_html_check
from ..schema import ValidationIssueData
from .base import ValidatorAdapter

_ENGINE_NAME = 'nu-html-checker'
_STANDARDS_REFERENCE = 'https://validator.github.io/validator/'


def _severity_for(message: dict) -> str:
    message_type = message.get('type')
    if message_type == 'info':
        return 'warning' if message.get('subType') == 'warning' else 'info'
    # 'error' and 'non-document-error' (a checker-internal failure, e.g.
    # an encoding problem) both represent something genuinely wrong with
    # the submitted document from the user's point of view.
    return 'error'


class HtmlNuAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        try:
            messages = run_nu_html_check(source)
        except JavaBridgeError:
            raise  # propagates to the orchestrator as an isolated adapter failure

        issues = []
        for message in messages:
            severity = _severity_for(message)
            line = message.get('firstLine') or message.get('lastLine') or 1
            column = message.get('firstColumn')
            issues.append(ValidationIssueData(
                language='html',
                source_context='',
                source_engine=_ENGINE_NAME,
                engine_version='',
                rule_id=f'nu:{message.get("type") or "conformance"}',
                category='syntax',
                severity=severity,
                message=message.get('message') or '',
                start_line=line,
                start_column=column,
                end_line=message.get('lastLine'),
                end_column=message.get('lastColumn'),
                standards_reference=_STANDARDS_REFERENCE,
                confidence='definite',
                suggestion='',
                code_excerpt=message.get('extract') or '',
                fixable=False,
                fix_type='',
                deterministic_fix=None,
                requires_manual_review=True,
                related_element='',
                related_attribute='',
                risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
            ))
        return issues

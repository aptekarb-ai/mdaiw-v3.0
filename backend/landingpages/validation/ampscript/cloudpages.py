"""Static, best-effort CloudPages/security checks. These are warnings about
patterns that are usually risky, not proof of a runtime vulnerability or of
safety — static analysis cannot see what a Data Extension actually contains
or how a value will really be used at send/render time.
"""

from dataclasses import dataclass

from .functions import Call
from .tokens import Token, TokenType
from .variables import VariableScope

_TAINT_SOURCES = frozenset({'REQUESTPARAMETER', 'QUERYPARAMETER'})
_WRITE_FUNCTIONS = frozenset({'INSERTDATA', 'UPDATEDATA', 'UPSERTDATA'})


@dataclass
class SecurityIssue:
    rule_id: str
    severity: str
    message: str
    line: int
    column: int


def _mark_taint_sources(tokens: list[Token], scope: VariableScope) -> None:
    n = len(tokens)
    for i in range(n - 3):
        if not (
            tokens[i].type == TokenType.KEYWORD and tokens[i].value == 'SET'
            and tokens[i + 1].type == TokenType.VARIABLE
            and tokens[i + 2].type == TokenType.EQUALS
            and tokens[i + 3].type == TokenType.IDENT
        ):
            continue
        func_name = tokens[i + 3].value.upper()
        if func_name in _TAINT_SOURCES:
            scope.tainted[tokens[i + 1].value] = func_name


def _arg_variable_names(arg: list[Token]) -> list[Token]:
    return [t for t in arg if t.type == TokenType.VARIABLE]


def analyze_cloudpages(
    tokens: list[Token], calls: list[Call], scope: VariableScope, *, region_kind: str,
) -> list[SecurityIssue]:
    issues: list[SecurityIssue] = []

    _mark_taint_sources(tokens, scope)

    # Direct reflection of a tainted variable into inline output —
    # `%%=v(@x)=%%` or the bare `%%=@x=%%` shorthand — with no sanitization
    # step in between. This is what fires acceptance case B.
    if region_kind == 'inline':
        for token in tokens:
            if token.type == TokenType.VARIABLE and token.value in scope.tainted:
                source = scope.tainted[token.value]
                issues.append(SecurityIssue(
                    'ampscript:unsanitized-request-parameter', 'warning',
                    f'"{token.value}" comes from {source}() and is output directly without any '
                    'validation or encoding. Confirm this value is safe to render.',
                    token.line, token.column,
                ))

    for call in calls:
        name = call.name.upper()

        if name == 'TREATASCONTENT' and call.args:
            var_tokens = _arg_variable_names(call.args[0])
            if var_tokens:
                issues.append(SecurityIssue(
                    'ampscript:unsafe-treat-as-content', 'warning',
                    'TreatAsContent() renders its argument as raw markup/AMPscript. '
                    'Ensure this value is trusted, not derived from unvalidated input.',
                    call.name_token.line, call.name_token.column,
                ))

        if name == 'REDIRECTTO' and call.args:
            var_tokens = _arg_variable_names(call.args[0])
            if var_tokens:
                issues.append(SecurityIssue(
                    'ampscript:unsafe-redirect', 'warning',
                    'RedirectTo() target comes from a variable rather than a fixed literal. '
                    'Validate it against an allowlist to avoid an open redirect.',
                    call.name_token.line, call.name_token.column,
                ))

        if name in _WRITE_FUNCTIONS or name == 'DELETEDATA':
            if call.args:
                de_name_blank = (
                    len(call.args[0]) == 0
                    or (len(call.args[0]) == 1 and call.args[0][0].type == TokenType.STRING and not call.args[0][0].value.strip())
                )
                if de_name_blank:
                    issues.append(SecurityIssue(
                        'ampscript:empty-data-extension-name', 'error',
                        f'"{call.name}" was called with an empty Data Extension name.',
                        call.name_token.line, call.name_token.column,
                    ))
            if name == 'DELETEDATA':
                issues.append(SecurityIssue(
                    'ampscript:destructive-data-operation', 'warning',
                    'DeleteData() permanently removes Data Extension rows. '
                    'Verify the filter conditions before this runs.',
                    call.name_token.line, call.name_token.column,
                ))

    return issues

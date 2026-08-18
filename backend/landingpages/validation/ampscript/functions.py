"""Extracts function calls from a region's token stream and validates them
against the server-owned registry.py. Purely structural (token counting and
paren-depth matching) — never evaluates or executes anything from the call.
"""

from dataclasses import dataclass, field

from .registry import get_function
from .tokens import Token, TokenType

_VALUE_TYPES = (TokenType.STRING, TokenType.NUMBER, TokenType.VARIABLE)


@dataclass
class Call:
    name: str
    name_token: Token
    args: list[list[Token]] = field(default_factory=list)
    well_formed: bool = True


@dataclass
class FunctionIssue:
    rule_id: str
    severity: str
    message: str
    line: int
    column: int


def _split_args(inner: list[Token]) -> list[list[Token]]:
    if not inner:
        return []
    args: list[list[Token]] = []
    current: list[Token] = []
    depth = 0
    for token in inner:
        if token.type == TokenType.LPAREN:
            depth += 1
            current.append(token)
        elif token.type == TokenType.RPAREN:
            depth -= 1
            current.append(token)
        elif token.type == TokenType.COMMA and depth == 0:
            args.append(current)
            current = []
        else:
            current.append(token)
    args.append(current)
    return args


def extract_calls(tokens: list[Token]) -> tuple[list[Call], list[FunctionIssue]]:
    calls: list[Call] = []
    issues: list[FunctionIssue] = []
    i = 0
    n = len(tokens)

    while i < n:
        token = tokens[i]
        if token.type == TokenType.IDENT and i + 1 < n and tokens[i + 1].type == TokenType.LPAREN:
            depth = 1
            j = i + 2
            while j < n and depth > 0:
                if tokens[j].type == TokenType.LPAREN:
                    depth += 1
                elif tokens[j].type == TokenType.RPAREN:
                    depth -= 1
                j += 1

            if depth > 0:
                issues.append(FunctionIssue(
                    'ampscript:missing-parenthesis', 'error',
                    f'Call to "{token.value}(" is missing its closing ")".',
                    token.line, token.column,
                ))
                calls.append(Call(token.value, token, [], well_formed=False))
                i = n
                continue

            inner = tokens[i + 2:j - 1]
            args = _split_args(inner)
            calls.append(Call(token.value, token, args))
            i = j
            continue
        i += 1

    for call in calls:
        _validate_call(call, issues)

    return calls, issues


def _validate_call(call: Call, issues: list[FunctionIssue]) -> None:
    spec = get_function(call.name)
    if spec is None:
        issues.append(FunctionIssue(
            'ampscript:unknown-function', 'warning',
            f'"{call.name}" is not in the known AMPscript function registry. '
            'It may still be valid — the registry does not list every AMPscript function.',
            call.name_token.line, call.name_token.column,
        ))
        return

    arg_count = 0 if (len(call.args) == 1 and not call.args[0]) else len(call.args)
    if arg_count < spec.min_params or (spec.max_params is not None and arg_count > spec.max_params):
        expected = (
            f'exactly {spec.min_params}' if spec.min_params == spec.max_params
            else f'at least {spec.min_params}' if spec.max_params is None
            else f'between {spec.min_params} and {spec.max_params}'
        )
        issues.append(FunctionIssue(
            'ampscript:function-parameter-count', 'error',
            f'"{call.name}" expects {expected} parameter(s), but {arg_count} were given.',
            call.name_token.line, call.name_token.column,
        ))

    for arg in call.args:
        values = [t for t in arg if t.type in _VALUE_TYPES]
        if len(values) >= 2:
            operators = [t for t in arg if t.type == TokenType.OPERATOR]
            if not operators:
                issues.append(FunctionIssue(
                    'ampscript:missing-comma', 'warning',
                    f'A parameter to "{call.name}(" may be missing a comma between values.',
                    arg[0].line, arg[0].column,
                ))

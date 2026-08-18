"""Variable-declaration and reference tracking. Declarations persist across
regions via the caller-owned `VariableScope` instance (real AMPscript blocks
share page-level variable scope — see parser.py, which creates one
VariableScope per document and threads it through every region in order).
"""

from dataclasses import dataclass, field

from .tokens import Token, TokenType

# Server-owned allowlist of context values a page may reference without an
# explicit VAR/SET in view (e.g. injected by a future CloudPages-context
# integration). Empty by default — the mechanism exists so a later sprint
# can populate it per-project without changing this module's shape; the API
# request itself can never add to this set.
KNOWN_CONTEXT_VARIABLES: frozenset[str] = frozenset()


@dataclass
class VariableIssue:
    rule_id: str
    severity: str
    message: str
    line: int
    column: int


@dataclass
class VariableScope:
    declared: set[str] = field(default_factory=set)
    tainted: dict[str, str] = field(default_factory=dict)  # name -> source function that tainted it


def analyze_variables(tokens: list[Token], scope: VariableScope) -> list[VariableIssue]:
    issues: list[VariableIssue] = []
    n = len(tokens)
    i = 0

    while i < n:
        token = tokens[i]

        if token.type == TokenType.KEYWORD and token.value == 'VAR':
            i += 1
            if i < n and tokens[i].type == TokenType.VARIABLE:
                _declare(tokens[i].value, scope, issues, tokens[i])
                i += 1
            elif i < n and tokens[i].type == TokenType.IDENT:
                issues.append(VariableIssue(
                    'ampscript:variable-missing-at-prefix', 'error',
                    f'AMPscript variables must begin with "@" (found "{tokens[i].value}").',
                    tokens[i].line, tokens[i].column,
                ))
                i += 1
            continue

        if token.type == TokenType.KEYWORD and token.value == 'SET':
            i += 1
            if i < n and tokens[i].type == TokenType.VARIABLE:
                name = tokens[i].value
                if name not in scope.declared:
                    scope.declared.add(name)
                # Skip past "=" — the right-hand side is analyzed normally
                # below via the general reference-checking pass so a
                # variable used on the right of its own SET is still
                # checked in document order.
                i += 1
            elif i < n and tokens[i].type == TokenType.IDENT:
                issues.append(VariableIssue(
                    'ampscript:variable-missing-at-prefix', 'error',
                    f'AMPscript variables must begin with "@" (found "{tokens[i].value}").',
                    tokens[i].line, tokens[i].column,
                ))
                i += 1
            continue

        if token.type == TokenType.VARIABLE:
            if token.value not in scope.declared and token.value not in KNOWN_CONTEXT_VARIABLES:
                issues.append(VariableIssue(
                    'ampscript:variable-undeclared', 'warning',
                    f'Variable "{token.value}" is used before it is declared with VAR or SET.',
                    token.line, token.column,
                ))
                # Report once per name per region to avoid flooding the
                # issue list with the same undeclared variable repeated
                # throughout a long block.
                scope.declared.add(token.value)
            i += 1
            continue

        i += 1

    return issues


def _declare(name: str, scope: VariableScope, issues: list[VariableIssue], token: Token) -> None:
    if name in scope.declared:
        issues.append(VariableIssue(
            'ampscript:variable-duplicate-declaration', 'warning',
            f'Variable "{name}" is already declared.',
            token.line, token.column,
        ))
        return
    scope.declared.add(name)

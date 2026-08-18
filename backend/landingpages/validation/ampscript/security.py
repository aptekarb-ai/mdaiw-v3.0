"""Hard-coded-secret heuristic — flags a literal string assigned to a
variable whose name suggests it holds a credential. Purely a naming
heuristic (no entropy analysis, no real secret-scanning) — always a
warning, never a claim of certainty.
"""

from dataclasses import dataclass

from .tokens import Token, TokenType

_SECRET_HINTS = ('PASSWORD', 'SECRET', 'APIKEY', 'API_KEY', 'ACCESSTOKEN', 'ACCESS_TOKEN', 'AUTHTOKEN', 'PRIVATEKEY')


@dataclass
class SecretIssue:
    rule_id: str
    severity: str
    message: str
    line: int
    column: int


def find_hardcoded_secrets(tokens: list[Token]) -> list[SecretIssue]:
    issues: list[SecretIssue] = []
    n = len(tokens)
    for i in range(n - 3):
        if not (
            tokens[i].type == TokenType.KEYWORD and tokens[i].value == 'SET'
            and tokens[i + 1].type == TokenType.VARIABLE
            and tokens[i + 2].type == TokenType.EQUALS
            and tokens[i + 3].type == TokenType.STRING
        ):
            continue
        name_upper = tokens[i + 1].value.upper()
        literal = tokens[i + 3].value
        if literal and any(hint in name_upper for hint in _SECRET_HINTS):
            issues.append(SecretIssue(
                'ampscript:hardcoded-secret', 'warning',
                f'"{tokens[i + 1].value}" is assigned a literal string and its name suggests it holds '
                'a credential. Avoid hard-coding secrets in AMPscript source.',
                tokens[i + 1].line, tokens[i + 1].column,
            ))
    return issues

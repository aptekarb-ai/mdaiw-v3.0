"""Per-region analysis: control-flow (IF/ENDIF, FOR/NEXT, WHILE/ENDWHILE)
matching, plus wiring together variables.py / functions.py / cloudpages.py /
security.py into one issue list with positions relative to the region's own
inner text (the caller maps these onto the real document — see __init__.py).
"""

from dataclasses import dataclass

from .cloudpages import analyze_cloudpages
from .functions import extract_calls
from .security import find_hardcoded_secrets
from .tokenizer import tokenize
from .tokens import Token, TokenType
from .variables import VariableScope, analyze_variables

_CONTROL_KEYWORDS = frozenset({'IF', 'ELSEIF', 'ELSE', 'ENDIF', 'FOR', 'NEXT', 'WHILE', 'ENDWHILE'})


@dataclass(frozen=True)
class AmpscriptIssue:
    rule_id: str
    severity: str
    category: str
    message: str
    line: int
    column: int


def _requires_then(tokens: list[Token], start_index: int) -> bool:
    """True if no THEN appears before the next control keyword/EOF."""
    for token in tokens[start_index + 1:]:
        if token.type == TokenType.KEYWORD:
            if token.value == 'THEN':
                return False
            if token.value in _CONTROL_KEYWORDS:
                return True
        if token.type == TokenType.EOF:
            return True
    return True


def _requires_do(tokens: list[Token], start_index: int) -> bool:
    for token in tokens[start_index + 1:]:
        if token.type == TokenType.KEYWORD:
            if token.value == 'DO':
                return False
            if token.value in _CONTROL_KEYWORDS:
                return True
        if token.type == TokenType.EOF:
            return True
    return True


def _analyze_control_flow(tokens: list[Token]) -> list[AmpscriptIssue]:
    issues: list[AmpscriptIssue] = []
    stack: list[dict] = []

    for index, token in enumerate(tokens):
        if token.type != TokenType.KEYWORD:
            continue
        kw = token.value

        if kw == 'IF':
            if _requires_then(tokens, index):
                issues.append(AmpscriptIssue(
                    'ampscript:if-missing-then', 'error', 'syntax',
                    'IF is missing THEN.', token.line, token.column,
                ))
            stack.append({'type': 'IF', 'else_seen': False, 'token': token})

        elif kw == 'ELSEIF':
            if not stack or stack[-1]['type'] != 'IF':
                issues.append(AmpscriptIssue(
                    'ampscript:elseif-without-if', 'error', 'syntax',
                    'ELSEIF was found without a matching IF.', token.line, token.column,
                ))
            elif stack[-1]['else_seen']:
                issues.append(AmpscriptIssue(
                    'ampscript:elseif-after-else', 'error', 'syntax',
                    'ELSEIF cannot appear after ELSE.', token.line, token.column,
                ))
            elif _requires_then(tokens, index):
                issues.append(AmpscriptIssue(
                    'ampscript:if-missing-then', 'error', 'syntax',
                    'ELSEIF is missing THEN.', token.line, token.column,
                ))

        elif kw == 'ELSE':
            if not stack or stack[-1]['type'] != 'IF':
                issues.append(AmpscriptIssue(
                    'ampscript:else-without-if', 'error', 'syntax',
                    'ELSE was found without a matching IF.', token.line, token.column,
                ))
            elif stack[-1]['else_seen']:
                issues.append(AmpscriptIssue(
                    'ampscript:duplicate-else', 'error', 'syntax',
                    'This IF already has an ELSE.', token.line, token.column,
                ))
            else:
                stack[-1]['else_seen'] = True

        elif kw == 'ENDIF':
            if not stack or stack[-1]['type'] != 'IF':
                issues.append(AmpscriptIssue(
                    'ampscript:endif-without-if', 'error', 'syntax',
                    'ENDIF was found without a matching IF.', token.line, token.column,
                ))
            else:
                stack.pop()

        elif kw == 'FOR':
            next_token = tokens[index + 1] if index + 1 < len(tokens) else None
            if next_token is None or next_token.type != TokenType.VARIABLE:
                issues.append(AmpscriptIssue(
                    'ampscript:for-invalid-loop-variable', 'error', 'syntax',
                    'FOR must be followed by a "@" loop variable.', token.line, token.column,
                ))
            if _requires_do(tokens, index):
                issues.append(AmpscriptIssue(
                    'ampscript:for-missing-do', 'error', 'syntax',
                    'FOR is missing DO.', token.line, token.column,
                ))
            stack.append({'type': 'FOR', 'token': token})

        elif kw == 'NEXT':
            if not stack or stack[-1]['type'] != 'FOR':
                issues.append(AmpscriptIssue(
                    'ampscript:next-without-for', 'error', 'syntax',
                    'NEXT was found without a matching FOR.', token.line, token.column,
                ))
            else:
                stack.pop()

        elif kw == 'WHILE':
            if _requires_do(tokens, index):
                issues.append(AmpscriptIssue(
                    'ampscript:while-missing-do', 'error', 'syntax',
                    'WHILE is missing DO.', token.line, token.column,
                ))
            stack.append({'type': 'WHILE', 'token': token})

        elif kw == 'ENDWHILE':
            if not stack or stack[-1]['type'] != 'WHILE':
                issues.append(AmpscriptIssue(
                    'ampscript:endwhile-without-while', 'error', 'syntax',
                    'ENDWHILE was found without a matching WHILE.', token.line, token.column,
                ))
            else:
                stack.pop()

    for frame in stack:
        frame_type = frame['type']
        token = frame['token']
        if frame_type == 'IF':
            issues.append(AmpscriptIssue(
                'ampscript:if-without-endif', 'error', 'syntax',
                'This IF has no matching ENDIF.', token.line, token.column,
            ))
        elif frame_type == 'FOR':
            issues.append(AmpscriptIssue(
                'ampscript:for-without-next', 'error', 'syntax',
                'This FOR has no matching NEXT.', token.line, token.column,
            ))
        elif frame_type == 'WHILE':
            issues.append(AmpscriptIssue(
                'ampscript:while-without-endwhile', 'error', 'syntax',
                'This WHILE has no matching ENDWHILE.', token.line, token.column,
            ))

    return issues


def analyze_region_text(text: str, region_kind: str, scope: VariableScope) -> list[AmpscriptIssue]:
    tokens = tokenize(text)

    issues: list[AmpscriptIssue] = []

    for token in tokens:
        if token.unterminated and token.type == TokenType.STRING:
            issues.append(AmpscriptIssue(
                'ampscript:unterminated-string', 'error', 'syntax',
                'This string is missing its closing quote.', token.line, token.column,
            ))
        elif token.unterminated:
            issues.append(AmpscriptIssue(
                'ampscript:unterminated-comment', 'error', 'syntax',
                'This comment is missing its closing "*/".', token.line, token.column,
            ))

    if region_kind == 'block':
        issues.extend(_analyze_control_flow(tokens))

    for issue in analyze_variables(tokens, scope):
        issues.append(AmpscriptIssue(issue.rule_id, issue.severity, 'syntax', issue.message, issue.line, issue.column))

    calls, function_issues = extract_calls(tokens)
    for issue in function_issues:
        issues.append(AmpscriptIssue(issue.rule_id, issue.severity, 'syntax', issue.message, issue.line, issue.column))

    for issue in analyze_cloudpages(tokens, calls, scope, region_kind=region_kind):
        issues.append(AmpscriptIssue(issue.rule_id, issue.severity, 'security', issue.message, issue.line, issue.column))

    for issue in find_hardcoded_secrets(tokens):
        issues.append(AmpscriptIssue(issue.rule_id, issue.severity, 'security', issue.message, issue.line, issue.column))

    return issues

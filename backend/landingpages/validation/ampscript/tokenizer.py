"""Hand-written linear-scan tokenizer for AMPscript block/inline content.
Deliberately not regex-driven beyond single fixed-width character classes —
one pass, O(n), no backtracking of any kind, so it cannot be a source of
catastrophic-regex risk on attacker-controlled input.
"""

from .tokens import KEYWORDS, Token, TokenType

_MAX_TOKENS = 20_000  # resource bound — mirrors engine.py's MAX_ISSUES style cap


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    line = 1
    col = 1
    i = 0
    n = len(text)

    def advance(count: int = 1):
        nonlocal i, line, col
        for _ in range(count):
            if i >= n:
                return
            if text[i] == '\n':
                line += 1
                col = 1
            else:
                col += 1
            i += 1

    while i < n and len(tokens) < _MAX_TOKENS:
        ch = text[i]

        if ch in ' \t\r\n':
            advance()
            continue

        # Block comment /* ... */ — consumed and discarded, never tokenized.
        if ch == '/' and i + 1 < n and text[i + 1] == '*':
            start_line, start_col = line, col
            advance(2)
            while i < n and not (text[i] == '*' and i + 1 < n and text[i + 1] == '/'):
                advance()
            if i < n:
                advance(2)
            else:
                tokens.append(Token(TokenType.OPERATOR, '/*', start_line, start_col, unterminated=True))
            continue

        if ch == '@':
            start_line, start_col = line, col
            start = i
            advance()
            while i < n and (text[i].isalnum() or text[i] == '_'):
                advance()
            tokens.append(Token(TokenType.VARIABLE, text[start:i], start_line, start_col))
            continue

        if ch == '"':
            start_line, start_col = line, col
            advance()
            start = i
            closed = False
            while i < n:
                if text[i] == '\\' and i + 1 < n:
                    advance(2)
                    continue
                if text[i] == '"':
                    closed = True
                    break
                advance()
            value = text[start:i]
            if closed:
                advance()
                tokens.append(Token(TokenType.STRING, value, start_line, start_col))
            else:
                tokens.append(Token(TokenType.STRING, value, start_line, start_col, unterminated=True))
            continue

        if ch.isdigit():
            start_line, start_col = line, col
            start = i
            advance()
            while i < n and (text[i].isdigit() or text[i] == '.'):
                advance()
            tokens.append(Token(TokenType.NUMBER, text[start:i], start_line, start_col))
            continue

        if ch.isalpha() or ch == '_':
            start_line, start_col = line, col
            start = i
            advance()
            while i < n and (text[i].isalnum() or text[i] == '_'):
                advance()
            word = text[start:i]
            upper = word.upper()
            if upper in KEYWORDS:
                tokens.append(Token(TokenType.KEYWORD, upper, start_line, start_col))
            else:
                tokens.append(Token(TokenType.IDENT, word, start_line, start_col))
            continue

        if ch == '(':
            tokens.append(Token(TokenType.LPAREN, ch, line, col))
            advance()
            continue
        if ch == ')':
            tokens.append(Token(TokenType.RPAREN, ch, line, col))
            advance()
            continue
        if ch == ',':
            tokens.append(Token(TokenType.COMMA, ch, line, col))
            advance()
            continue
        if ch == '=':
            tokens.append(Token(TokenType.EQUALS, ch, line, col))
            advance()
            continue
        if ch in '+-*/<>!':
            tokens.append(Token(TokenType.OPERATOR, ch, line, col))
            advance()
            continue

        # Any other character (stray punctuation) — skip silently rather
        # than raising; malformed input is what this module exists to
        # report as issues elsewhere, not to crash on.
        advance()

    tokens.append(Token(TokenType.EOF, '', line, col))
    return tokens

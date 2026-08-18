"""Token model shared by tokenizer.py and parser.py. Positions are 1-based
(line, column) relative to whatever text was tokenized — callers own
converting that into an absolute document position (see blocks.py /
adapters/ampscript_conformance.py / adapters/html_embedded_ampscript.py)."""

from dataclasses import dataclass


class TokenType:
    KEYWORD = 'keyword'
    VARIABLE = 'variable'
    IDENT = 'ident'
    STRING = 'string'
    NUMBER = 'number'
    LPAREN = 'lparen'
    RPAREN = 'rparen'
    COMMA = 'comma'
    EQUALS = 'equals'
    OPERATOR = 'operator'
    EOF = 'eof'


# Real AMPscript keywords this validator understands. WHILE/ENDWHILE are
# included per the spec's "approved AMPscript functionality profile" note —
# SFMC AMPscript itself does not define WHILE/ENDWHILE, but a few CloudPages
# implementations use a documented custom-tag convention for it; kept here
# as a recognized-but-rare keyword pair so it participates in block matching
# rather than being silently misread as an undeclared identifier.
KEYWORDS = frozenset({
    'VAR', 'SET', 'IF', 'THEN', 'ELSEIF', 'ELSE', 'ENDIF',
    'FOR', 'TO', 'DO', 'NEXT', 'WHILE', 'ENDWHILE',
})


@dataclass(frozen=True)
class Token:
    type: str
    value: str
    line: int
    column: int
    unterminated: bool = False

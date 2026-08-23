"""Email Document Standards Sub-phase 2 — Custom CSS security boundary.

This is the FINAL persistence gate (the frontend also validates before
Save/before an AI proposal can even be shown, but this backend validator
is authoritative — the API can never be used to bypass it).

Deliberately narrow: this module owns ONLY the security allow/deny
decision. It never renders CSS into HTML (nothing server-side renders
email documents — Preview/Code/Export all run entirely client-side, see
frontend/src/emailbuilder/emailCss.ts, which is where the actual Reset
CSS text and the non-blocking structural-selector warning detector
live) and it never silently strips or rewrites a violating value — every
rejection is a specific, human-readable reason returned to the caller,
who always rejects with it rather than saving a modified value.

NORMALIZATION STRATEGY (closure item 3) -- every pattern below is
matched against `_normalize_for_security_scan(css)`, never the raw
string. The normalization undoes ONLY the specific encodings a real
browser's CSS engine would ALSO undo before interpreting a value --
never more than that, so a rule can never be "tricked" into flagging
something a browser wouldn't actually execute, and can never be
bypassed by an encoding a browser WOULD execute:

  1. CSS numeric escapes (`\\XX..X` -- 1 to 6 hex digits, optional one
     trailing whitespace character) decoded to the literal character
     they represent, e.g. `\\6a` -> "j". This is the standard CSS
     escape mechanism every engine honors, so `j\\61vascript:` is
     exactly as dangerous as `javascript:` to a real browser -- and is
     now caught identically here.
  2. Any other backslash-escaped character decoded to that literal
     character (`\\<` -> `<`, `\\:` -> `:`, ...) -- CSS's generic
     escape-the-next-character rule.
  3. CSS comments (`/* ... */`) removed. Historically exploitable to
     split a dangerous token (`java/**/script:`, `expre/**/ssion(`) in
     older engines (legacy IE); stripped so the split token
     reassembles before matching.
  4. C0/DEL control characters removed (the historical
     `java\\0script:` NUL-byte trick and relatives).
  5. Case-folded to lowercase.

Deliberately NOT done: collapsing/stripping ordinary whitespace between
otherwise-intact words. A literal space inserted mid-keyword (`java
script:`) is not something any real CSS engine reinterprets back into a
working scheme -- normalizing that away would just invite false
positives on legitimate content without closing any genuine bypass.
`</style`/`<script`/`<!--`/`-->`/the generic embedded-tag pattern are
HTML-parser-level breakout vectors, not CSS-engine ones -- the HTML
tokenizer does not honor CSS backslash escapes or CSS comments at all,
so those patterns gain no coverage from this normalization (harmless
either way, since none of steps 1-5 touches their literal spelling) and
are unaffected by it.
"""

import re

MAX_CUSTOM_CSS_LENGTH = 20000

_HEX_ESCAPE_RE = re.compile(r'\\([0-9a-fA-F]{1,6})\s?')
_CHAR_ESCAPE_RE = re.compile(r'\\(.)')
_COMMENT_RE = re.compile(r'/\*.*?\*/', re.DOTALL)
_CONTROL_CHAR_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def _decode_hex_escape(match):
    try:
        return chr(int(match.group(1), 16))
    except (ValueError, OverflowError):
        return ''


def _normalize_for_security_scan(css):
    """See module docstring's "NORMALIZATION STRATEGY" for exactly what
    this does and why each step is there. Used ONLY for the security
    scan below -- never returned, never persisted; the caller always
    stores/rejects the ORIGINAL value, unmodified."""
    normalized = _HEX_ESCAPE_RE.sub(_decode_hex_escape, css)
    normalized = _CHAR_ESCAPE_RE.sub(r'\1', normalized)
    normalized = _COMMENT_RE.sub('', normalized)
    normalized = _CONTROL_CHAR_RE.sub('', normalized)
    return normalized.lower()


# Every message is written for a NORMALIZED (already-lowercased) match,
# so patterns no longer need re.IGNORECASE -- mixed/upper case is already
# folded away by _normalize_for_security_scan before these ever run.
_BREAKOUT_PATTERNS = [
    (re.compile(r'</\s*style'), 'a "</style" tag (style-element breakout)'),
    (re.compile(r'<\s*script'), 'a "<script" tag'),
    (re.compile(r'<!--'), 'an HTML comment open ("<!--")'),
    (re.compile(r'-->'), 'an HTML comment close ("-->")'),
    (re.compile(r'javascript\s*:'), 'a "javascript:" URL scheme'),
    (re.compile(r'vbscript\s*:'), 'a "vbscript:" URL scheme'),
    (re.compile(r'expression\s*\('), 'a legacy IE CSS expression() call'),
    (re.compile(r'behavior\s*:'), 'a legacy IE "behavior:" binding'),
    (re.compile(r'-moz-binding\s*:'), 'a "-moz-binding:" XBL binding'),
    (re.compile(r'@import\b'), 'an "@import" rule (external stylesheets cannot be vetted)'),
    # Item 2 -- data: URLs are disallowed entirely (no data:image/
    # exception). The Asset Manager / owned HTTP(S) assets are the
    # supported path for images; a data: URL can encode arbitrary
    # content (including non-image payloads) and cannot be vetted the
    # way an uploaded/owned asset can.
    (re.compile(r'data\s*:'), 'a "data:" URL scheme (use the Asset Manager or an https:// URL instead)'),
    # Catches any embedded HTML tag (<script>/<iframe>/<img onerror=...>/
    # etc.) generically. Safe against normal CSS: legitimate CSS syntax
    # never contains a literal `<` character (attribute selectors use
    # `[...]`, the descendant/child combinators are ` ` and `>`, not `<`).
    (re.compile(r'<\s*[a-zA-Z][a-zA-Z0-9]*[\s/>]'), 'an embedded HTML tag'),
]


def validate_custom_css_security(css):
    """Returns a list of human-readable violation messages — empty means
    safe. Never modifies `css` (the returned messages describe the
    NORMALIZED match, but the caller always keeps/rejects the ORIGINAL
    string, verbatim). Does NOT evaluate compatibility/structural
    concerns (bare `body`/`table`/`td` overrides etc.) — those are
    non-blocking warnings, a separate, frontend-only concern (see
    emailCss.ts's detectCustomCssWarnings); this function is the
    security gate only."""
    if not isinstance(css, str):
        return ['Custom CSS must be text.']
    if len(css) > MAX_CUSTOM_CSS_LENGTH:
        return [f'Custom CSS is too long (maximum {MAX_CUSTOM_CSS_LENGTH} characters).']

    normalized = _normalize_for_security_scan(css)
    violations = []
    for pattern, description in _BREAKOUT_PATTERNS:
        if pattern.search(normalized):
            violations.append(f'Custom CSS must not contain {description}.')
    return violations

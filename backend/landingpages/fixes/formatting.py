"""AI Engineer Formatting + Documentation sprint — deterministic,
behavior-preserving formatting for every Module-3 language, plus a small
pure-Python AMPscript formatter (no comparable deterministic AMPscript
formatter exists off the shelf, and AMPscript is not JavaScript — spec
section 9).

Formatting is intentionally NOT an LLM call (spec section 20 — "do not
send the entire source to OpenAI merely to adjust whitespace"). It runs
AFTER structural/syntax/security repair has already converged (spec
section 4 — format after repair, never before, or a formatter can hide or
distort a real structural problem), and its output is never trusted on
its own claim: the caller re-validates the formatted candidate through
the same authoritative pipeline as any other repair candidate and
discards it (reverting to the pre-format source for that file) if the
candidate is not at least as good as what it replaced (spec section 18).
"""

from __future__ import annotations

import logging
import re

from .. validation.node_bridge import NodeBridgeError, run_css_autofix, run_format

logger = logging.getLogger('landingpages.fixes.formatting')

# Spec section 5A — HTML formatting must never corrupt embedded AMPscript
# delimiters (`%%[ ... ]%%` blocks, `%%=...=%%` output expressions), which
# js-beautify's html-beautify has no awareness of. A count-based balance
# check is a deliberately simple, deterministic safety net: if formatting
# changed how many of each delimiter substring appear, something about
# the AMPscript boundaries moved and the candidate is rejected outright
# rather than risk silently corrupting SFMC template syntax.
_AMPSCRIPT_DELIMITER_TOKENS = ('%%[', ']%%', '%%=', '=%%')


def _delimiter_signature(text: str) -> tuple[int, ...]:
    return tuple(text.count(token) for token in _AMPSCRIPT_DELIMITER_TOKENS)


def format_html(html: str) -> str | None:
    """Returns the reformatted HTML, or None if formatting was skipped
    (empty input, engine unavailable, or the AMPscript-delimiter safety
    net tripped) — callers must treat None as "leave the source
    unchanged", never as an error to surface to the user."""
    if not html or not html.strip():
        return None
    try:
        result = run_format('html', html)
    except NodeBridgeError:
        logger.warning('landingpages.fixes.formatting.html_engine_unavailable', exc_info=True)
        return None
    if not result.get('success') or not isinstance(result.get('formatted'), str):
        return None
    formatted = result['formatted']
    if _delimiter_signature(formatted) != _delimiter_signature(html):
        logger.warning('landingpages.fixes.formatting.html_ampscript_delimiter_mismatch_rejected')
        return None
    return formatted


# Spec section 7 — LESS/SCSS use the same brace-delimited beautifier as
# plain CSS (js-beautify's css-beautify is a token-based reindenter, not a
# strict-CSS parser, so it tolerates `$variable`/`@variable`,
# `&`-nesting, and `//` comments without misinterpreting them). Indented
# Sass has no braces at all — a brace-based beautifier would corrupt its
# whitespace-significant syntax, so it is deliberately left unformatted
# (a documented, honest limitation, not a silent no-op bug).
_CSS_FAMILY_LANGUAGES = {'css', 'scss', 'less'}

# Closure spec section 1/7 — js-beautify's css-beautify unconditionally
# pushes EVERY comment onto its own line (verified directly: it does
# this even to a comment that was already trailing on a declaration),
# which would silently re-create the exact "standalone comment line"
# problem this policy exists to fix, and would re-trigger Stylelint's
# `comment-empty-line-before` warning the AI-added comment was never
# supposed to cause in the first place. Every trailing-comment-bearing
# line is protected behind a comment-free placeholder before beautifying
# (the same "protect an opaque region" technique format_html already
# uses for AMPscript delimiters) and restored verbatim afterward, at
# whatever indentation depth the beautifier decided for that line.
_CSS_TRAILING_COMMENT_LINE_RE = re.compile(r'^([ \t]*)(\S.*?)[ \t]+(/\*(?:(?!\*/).)*\*/)[ \t]*$')
_CSS_PLACEHOLDER_TEMPLATE = '__MDAIW_TRAILING_COMMENT_{index}__'

# Closure spec section 1 — a comment already sitting on its OWN line
# directly after exactly one declaration (its own line, optionally with
# one blank line before it) is repositioned onto the end of that
# declaration, matching the preferred `code; /* comment */` shape. This
# is a pure repositioning of EXISTING content — no text added or
# removed, no new comment authored — so it is safe to do unconditionally
# as a deterministic step, never an LLM call. A comment is left alone
# (never moved) when it precedes a selector/rule opening (`{`) — that
# shape plausibly describes the whole following block, not one
# declaration, matching the spec's own carve-out.
_CSS_SINGLE_DECLARATION_LINE_RE = re.compile(r'^([ \t]*)([^{}\n]+;)[ \t]*$')
_CSS_STANDALONE_COMMENT_LINE_RE = re.compile(r'^[ \t]*(/\*(?:(?!\*/).)*\*/)[ \t]*$')


def _reposition_standalone_css_comments_to_trailing(css: str) -> str | None:
    lines = css.split('\n')
    result = []
    changed = False
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        decl_match = _CSS_SINGLE_DECLARATION_LINE_RE.match(line)
        if decl_match and '/*' not in line:
            j = i + 1
            if j < n and lines[j].strip() == '':
                j += 1
            if j < n:
                comment_match = _CSS_STANDALONE_COMMENT_LINE_RE.match(lines[j])
                if comment_match:
                    result.append(f'{line.rstrip()} {comment_match.group(1)}')
                    i = j + 1
                    changed = True
                    continue
        result.append(line)
        i += 1
    return '\n'.join(result) if changed else None


def _protect_trailing_css_comment_lines(css: str) -> tuple[str, dict]:
    lines = css.split('\n')
    placeholders = {}
    protected_lines = []
    for index, line in enumerate(lines):
        match = _CSS_TRAILING_COMMENT_LINE_RE.match(line)
        if match is None:
            protected_lines.append(line)
            continue
        indent = match.group(1)
        token = _CSS_PLACEHOLDER_TEMPLATE.format(index=index)
        placeholders[token] = line.strip()
        protected_lines.append(f'{indent}{token};')
    return '\n'.join(protected_lines), placeholders


def _restore_trailing_css_comment_lines(formatted: str, placeholders: dict) -> str:
    if not placeholders:
        return formatted
    lines = formatted.split('\n')
    for i, line in enumerate(lines):
        for token, original_stripped in placeholders.items():
            if token in line:
                indent = line[:len(line) - len(line.lstrip())]
                lines[i] = f'{indent}{original_stripped}'
                break
    return '\n'.join(lines)


def format_css(css: str, css_source_type: str) -> str | None:
    if not css or not css.strip():
        return None
    if css_source_type not in _CSS_FAMILY_LANGUAGES:
        return None

    current = css
    changed = False

    # Repositioning runs FIRST — turns a standalone comment sitting right
    # after one declaration into a trailing comment before anything else
    # runs, so stylelint's own `comment-empty-line-before` check never
    # even has anything to flag for it.
    repositioned = _reposition_standalone_css_comments_to_trailing(current)
    if repositioned is not None:
        current = repositioned
        changed = True

    # Closure spec section 6 — rule-aware stylelint autofix runs FIRST,
    # only for plain CSS (the only source type stylelint here validates
    # directly, rather than validating a compiled-from-scss/less
    # intermediate — see css_scss_sass.py/css_less.py). Fixes formatting
    # findings (e.g. `comment-empty-line-before`) exactly the way the
    # SAME stylelint config that flagged them expects, rather than a
    # generic beautifier's guess.
    if css_source_type == 'css':
        try:
            autofix_result = run_css_autofix(current)
        except NodeBridgeError:
            logger.warning('landingpages.fixes.formatting.css_autofix_engine_unavailable', exc_info=True)
            autofix_result = None
        if autofix_result and autofix_result.get('success') and isinstance(autofix_result.get('fixed'), str):
            current = autofix_result['fixed']
            changed = True

    protected_source, placeholders = _protect_trailing_css_comment_lines(current)
    try:
        result = run_format(css_source_type, protected_source)
    except NodeBridgeError:
        logger.warning('landingpages.fixes.formatting.css_engine_unavailable', exc_info=True)
        result = None
    if result and result.get('success') and isinstance(result.get('formatted'), str):
        restored = _restore_trailing_css_comment_lines(result['formatted'], placeholders)
        if restored != current:
            current = restored
            changed = True

    return current if changed else None


def format_javascript(js: str) -> str | None:
    if not js or not js.strip():
        return None
    try:
        result = run_format('javascript', js)
    except NodeBridgeError:
        logger.warning('landingpages.fixes.formatting.js_engine_unavailable', exc_info=True)
        return None
    if not result.get('success') or not isinstance(result.get('formatted'), str):
        return None
    return result['formatted']


# --- AMPscript formatter -----------------------------------------------
#
# Spec section 9 — AMPscript is not JavaScript and must not be run
# through a JS/generic formatter. AMPscript has no publicly-standard
# deterministic formatter this project can depend on, so this is a small,
# conservative, purpose-built one: it only ever changes leading
# indentation (never reorders, never rewrites statement content, never
# touches anything inside a %%=...=%% output expression or outside a
# %%[ ... ]%% block), keyed on well-known block keywords matched only at
# the start of an already-trimmed line (never a substring match, which
# would misfire on a keyword appearing inside a string literal).

_BLOCK_OPEN_RE = re.compile(r'^(IF)\b.*\bTHEN\s*$', re.IGNORECASE)
_BLOCK_ELSE_RE = re.compile(r'^(ELSEIF)\b.*\bTHEN\s*$|^(ELSE)\s*$', re.IGNORECASE)
_BLOCK_CLOSE_RE = re.compile(r'^ENDIF\s*$', re.IGNORECASE)
_FOR_OPEN_RE = re.compile(r'^FOR\b.*\bDO\s*$', re.IGNORECASE)
_FOR_CLOSE_RE = re.compile(r'^NEXT\b', re.IGNORECASE)
_AMPSCRIPT_BLOCK_START_RE = re.compile(r'%%\[')
_AMPSCRIPT_BLOCK_END_RE = re.compile(r'\]%%')

_INDENT_UNIT = '  '


def _format_ampscript_block_lines(lines: list[str]) -> list[str]:
    """`lines` are the lines STRICTLY between one `%%[` and its matching
    `]%%` (exclusive of the delimiter lines themselves)."""
    formatted = []
    depth = 0
    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped:
            formatted.append('')
            continue
        is_close = bool(_BLOCK_CLOSE_RE.match(stripped) or _FOR_CLOSE_RE.match(stripped))
        is_else = bool(_BLOCK_ELSE_RE.match(stripped))
        line_depth = depth - 1 if (is_close or is_else) else depth
        line_depth = max(0, line_depth)
        formatted.append(f'{_INDENT_UNIT * line_depth}{stripped}')
        if is_close:
            depth = max(0, depth - 1)
        elif _BLOCK_OPEN_RE.match(stripped) or _FOR_OPEN_RE.match(stripped):
            depth += 1
        # ELSEIF/ELSE do not change depth relative to the IF they belong
        # to — the block body under them is still one level deeper.
    return formatted


def format_ampscript(ampscript: str) -> str | None:
    """Formats every `%%[ ... ]%%` block found in `ampscript` (there may
    be several, or the whole string may be exactly one). Text outside any
    block — including inline `%%=...=%%` output expressions and plain
    literal text — is passed through completely untouched. Returns None
    if the input has no recognizable block to format, or if the delimiter
    count doesn't balance (malformed input — never guess a repair here,
    only format what is already well-formed)."""
    if not ampscript or not ampscript.strip():
        return None
    opens = list(_AMPSCRIPT_BLOCK_START_RE.finditer(ampscript))
    closes = list(_AMPSCRIPT_BLOCK_END_RE.finditer(ampscript))
    if not opens or len(opens) != len(closes):
        return None

    pieces = []
    cursor = 0
    changed = False
    for open_match, close_match in zip(opens, closes):
        if close_match.start() < open_match.end():
            # Overlapping/out-of-order delimiters — malformed; do not guess.
            return None
        pieces.append(ampscript[cursor:open_match.end()])
        block_body = ampscript[open_match.end():close_match.start()]
        # Preserve whether the original opened/closed with its own
        # newline immediately inside the delimiters.
        leading_newline = block_body.startswith('\n')
        trailing_newline = block_body.endswith('\n')
        body_lines = block_body.strip('\n').split('\n') if block_body.strip('\n') else []
        formatted_lines = _format_ampscript_block_lines(body_lines)
        new_body = '\n'.join(formatted_lines)
        rebuilt = ('\n' if leading_newline else '') + new_body + ('\n' if trailing_newline else '')
        if rebuilt != block_body:
            changed = True
        pieces.append(rebuilt)
        cursor = close_match.start()
    pieces.append(ampscript[cursor:])
    result = ''.join(pieces)
    if _delimiter_signature(result) != _delimiter_signature(ampscript):
        # Safety net — never publish a candidate that altered delimiter
        # balance, even though this formatter does not intentionally
        # touch delimiters.
        return None
    return result if changed else None


# --- Orchestrator --------------------------------------------------------

_LANGUAGE_FOR_SOURCE_KEY = {'html': 'html', 'js': 'javascript', 'ampscript': 'ampscript'}


def format_all_sources(sources: dict, css_source_type: str) -> tuple[dict, set]:
    """Returns (new_sources, changed_file_keys). `new_sources` always has
    every key `sources` had; a file that could not be safely formatted
    (or was already correctly formatted) is copied through unchanged.
    Never raises — every formatter above already fails closed."""
    new_sources = dict(sources)
    changed: set[str] = set()

    html_formatted = format_html(sources.get('html', ''))
    if html_formatted is not None and html_formatted != sources.get('html', ''):
        new_sources['html'] = html_formatted
        changed.add('html')

    css_formatted = format_css(sources.get('css', ''), css_source_type)
    if css_formatted is not None and css_formatted != sources.get('css', ''):
        new_sources['css'] = css_formatted
        changed.add('css')

    js_formatted = format_javascript(sources.get('js', ''))
    if js_formatted is not None and js_formatted != sources.get('js', ''):
        new_sources['js'] = js_formatted
        changed.add('js')

    ampscript_formatted = format_ampscript(sources.get('ampscript', ''))
    if ampscript_formatted is not None and ampscript_formatted != sources.get('ampscript', ''):
        new_sources['ampscript'] = ampscript_formatted
        changed.add('ampscript')

    return new_sources, changed

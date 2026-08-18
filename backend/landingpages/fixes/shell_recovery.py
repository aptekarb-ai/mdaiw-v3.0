"""HTML Whole-Document Structural Recovery sprint — a document-shell
corruption (duplicate/misplaced/premature `<html>`/`<head>`/`<body>`)
produces a CASCADE of secondary parser findings from third-party engines
(html5lib, Nu Html Checker) that treat every symptom as an independent
issue. Treating each of those as "one finding = one patch" produces
exactly the reported failure mode: many regional-repair rounds that each
nibble at a symptom while the root defect never gets addressed, until
the iteration budget runs out with double-digit errors still remaining.

This module never re-serializes a browser/parser's own error-recovery
DOM (spec section 10 — html5lib/Nu perform silent recovery that may
move, drop, or imply tags, which must never be trusted as the repaired
source). Everything here operates on RAW TEXT RANGES of the original
source: `attempt_premature_html_close_recovery` only ever deletes one
proven-premature `</html>` span and re-appends it, moving zero other
bytes. Every embedded-language region (`<style>`, `<script>`, AMPscript)
is protected as an opaque placeholder before the whole-source AI
fallback ever sees the document, and a candidate that returns without
every placeholder intact — or that drops a content fact the original
had — is rejected outright, never published.
"""

from __future__ import annotations

import re

# --- Shell-tag scanning -----------------------------------------------

_HTML_OPEN_RE = re.compile(r'<html\b[^>]*>', re.IGNORECASE)
_HTML_CLOSE_RE = re.compile(r'</html\s*>', re.IGNORECASE)
_HEAD_OPEN_RE = re.compile(r'<head\b[^>]*>', re.IGNORECASE)
_HEAD_CLOSE_RE = re.compile(r'</head\s*>', re.IGNORECASE)
_BODY_OPEN_RE = re.compile(r'<body\b[^>]*>', re.IGNORECASE)
_BODY_CLOSE_RE = re.compile(r'</body\s*>', re.IGNORECASE)

CORRUPTION_DUPLICATE_HTML = 'duplicate-html'
CORRUPTION_DUPLICATE_CLOSE_HTML = 'duplicate-close-html'
CORRUPTION_DUPLICATE_HEAD = 'duplicate-head'
CORRUPTION_DUPLICATE_BODY = 'duplicate-body'
CORRUPTION_PREMATURE_HTML_CLOSE = 'premature-html-close'
CORRUPTION_HEAD_AFTER_BODY = 'head-after-body'
CORRUPTION_CONTENT_BEFORE_HTML = 'content-before-html'

# Correctness regression sprint, spec section A — a real tag (e.g. a
# stray <meta> before the explicit <html>) sitting between an optional
# leading DOCTYPE and the literal <html> tag. The raw source has only
# ONE literal <html> and ONE literal <head> — classify_shell_corruption's
# other checks (which only count literal tag occurrences) see nothing
# wrong — but the HTML5 parsing algorithm's "before html"/"before head"
# insertion modes silently synthesize an IMPLICIT <html>/<head> pair to
# hold that stray tag, so the document's own LATER, explicit <html>/
# <head> tags land inside an already-open implicit shell and get
# reported as "unexpected"/merged rather than duplicated. Never matches
# a bare DOCTYPE, whitespace, or a comment preceding <html> — all
# expected and harmless.
_DOCTYPE_RE = re.compile(r'<!DOCTYPE\b[^>]*>', re.IGNORECASE)
_COMMENT_RE = re.compile(r'<!--.*?-->', re.DOTALL)
_REAL_TAG_START_RE = re.compile(r'<[a-zA-Z]')


def _strip_comments(text: str) -> str:
    return _COMMENT_RE.sub('', text)


def classify_shell_corruption(html: str) -> frozenset:
    """Deterministic, regex-based scan of the RAW top-level shell tags
    (spec section 1/14) — independent of what any downstream validator
    engine's rule_id says, so it catches the corruption class even when
    OUR OWN structural checkers (which only track generic tag-nesting,
    not shell-uniqueness semantics) see nothing wrong. Returns an empty
    frozenset for a structurally sound shell."""
    html_opens = list(_HTML_OPEN_RE.finditer(html))
    html_closes = list(_HTML_CLOSE_RE.finditer(html))
    head_opens = list(_HEAD_OPEN_RE.finditer(html))
    head_closes = list(_HEAD_CLOSE_RE.finditer(html))
    body_opens = list(_BODY_OPEN_RE.finditer(html))
    body_closes = list(_BODY_CLOSE_RE.finditer(html))

    corruption = set()
    if len(html_opens) > 1:
        corruption.add(CORRUPTION_DUPLICATE_HTML)
    if len(html_closes) > 1:
        corruption.add(CORRUPTION_DUPLICATE_CLOSE_HTML)
    if len(head_opens) > 1:
        corruption.add(CORRUPTION_DUPLICATE_HEAD)
    if len(body_opens) > 1:
        corruption.add(CORRUPTION_DUPLICATE_BODY)

    if len(html_closes) == 1:
        close_offset = html_closes[0].start()
        later_shell_tags = [
            m for m in (*head_opens, *head_closes, *body_opens, *body_closes)
            if m.start() > close_offset
        ]
        if later_shell_tags:
            corruption.add(CORRUPTION_PREMATURE_HTML_CLOSE)

    if head_opens and body_opens and min(m.start() for m in head_opens) > min(m.start() for m in body_opens):
        corruption.add(CORRUPTION_HEAD_AFTER_BODY)

    if html_opens:
        before_html = html[:html_opens[0].start()]
        doctype_match = _DOCTYPE_RE.search(before_html)
        after_doctype = before_html[doctype_match.end():] if doctype_match else before_html
        if _REAL_TAG_START_RE.search(_strip_comments(after_doctype)):
            corruption.add(CORRUPTION_CONTENT_BEFORE_HTML)

    return frozenset(corruption)


def attempt_premature_html_close_recovery(html: str) -> str | None:
    """Handles EXACTLY the unambiguous case: one `<html>` open tag, one
    `</html>` close tag, and that close tag appears before real
    head/body markup that follows it in the document — spec section 4's
    own example, and section 21's `premature-html-close` strategy.
    Deletes the premature `</html>` text span (nothing else) and
    reappends `</html>` at the true end of the document. Returns None
    for anything more ambiguous than this (duplicate shell tags,
    multiple closes, etc.) — those fall through to the whole-source AI
    fallback rather than being guessed here."""
    html_opens = list(_HTML_OPEN_RE.finditer(html))
    html_closes = list(_HTML_CLOSE_RE.finditer(html))
    if len(html_opens) != 1 or len(html_closes) != 1:
        return None
    if len(_HEAD_OPEN_RE.findall(html)) > 1 or len(_BODY_OPEN_RE.findall(html)) > 1:
        return None

    close_match = html_closes[0]
    if classify_shell_corruption(html) != frozenset({CORRUPTION_PREMATURE_HTML_CLOSE}):
        # Only ever act when premature-close is the SOLE detected defect
        # — any other simultaneous shell corruption means this simple
        # text-level fix is not confidently sufficient on its own.
        return None

    without_premature_close = html[:close_match.start()] + html[close_match.end():]
    return without_premature_close.rstrip('\n \t') + '\n</html>\n'


def attempt_content_before_html_recovery(html: str) -> str | None:
    """Handles EXACTLY the unambiguous case: one real tag (or more) sits
    between an optional leading DOCTYPE and the single literal <html>
    tag, AND a real <head> tag already exists explicitly later in the
    document. Moves that orphaned content to immediately after the
    existing <head> tag — never fabricates a <head> that doesn't already
    exist explicitly, never deletes the orphaned content (business copy
    like a meta description must survive, moved not dropped). Returns
    None for anything more ambiguous than this (no explicit <head> to
    receive the content, multiple <html> tags, or any OTHER simultaneous
    shell corruption) — those fall through to the whole-source AI
    fallback, exactly like attempt_premature_html_close_recovery's own
    threshold for what counts as "confidently unambiguous.\""""
    html_opens = list(_HTML_OPEN_RE.finditer(html))
    if len(html_opens) != 1:
        return None
    if classify_shell_corruption(html) != frozenset({CORRUPTION_CONTENT_BEFORE_HTML}):
        # Only ever act when this is the SOLE detected defect — the same
        # discipline attempt_premature_html_close_recovery uses.
        return None

    html_open_match = html_opens[0]
    before_html = html[:html_open_match.start()]
    doctype_match = _DOCTYPE_RE.search(before_html)
    if doctype_match:
        doctype_prefix = html[:doctype_match.end()]
        orphaned = html[doctype_match.end():html_open_match.start()].strip('\n \t')
    else:
        doctype_prefix = ''
        orphaned = before_html.strip('\n \t')
    if not orphaned:
        return None

    remainder = html[html_open_match.start():]
    head_open_match = _HEAD_OPEN_RE.search(remainder)
    if head_open_match is None:
        # No explicit <head> to receive the orphaned content — fabricating
        # one would be guessing at document structure this function has
        # no basis for; the whole-source AI fallback handles this case.
        return None

    insert_at = head_open_match.end()
    rebuilt_remainder = remainder[:insert_at] + '\n' + orphaned + remainder[insert_at:]
    if doctype_prefix:
        return doctype_prefix + '\n' + rebuilt_remainder
    return rebuilt_remainder


# --- Embedded-region protection for the whole-source AI fallback ------

_STYLE_BLOCK_RE = re.compile(r'(<style\b[^>]*>)(.*?)(</style\s*>)', re.IGNORECASE | re.DOTALL)
_SCRIPT_BLOCK_RE = re.compile(r'(<script\b[^>]*>)(.*?)(</script\s*>)', re.IGNORECASE | re.DOTALL)
_AMPSCRIPT_BLOCK_RE = re.compile(r'%%\[.*?\]%%', re.DOTALL)
_AMPSCRIPT_OUTPUT_RE = re.compile(r'%%=.*?=%%', re.DOTALL)

_PLACEHOLDER_TEMPLATE = '__MDAIW_PROTECTED_REGION_{index}__'


def protect_embedded_regions(html: str) -> tuple[str, dict]:
    """Replaces every `<style>`/`<script>` block's INNER content and
    every AMPscript block/output expression with an opaque placeholder
    token before the whole-source AI fallback ever sees the document
    (spec section 7/8/9) — the model is never given an opportunity to
    reinterpret CSS/JS tokens or AMPscript delimiters as HTML while
    reasoning about shell placement. Returns (protected_html,
    placeholders); `restore_embedded_regions` reverses this and proves
    every placeholder survived intact."""
    placeholders: dict[str, str] = {}
    counter = [0]

    def _protect_block(match):
        index = counter[0]
        counter[0] += 1
        token = _PLACEHOLDER_TEMPLATE.format(index=index)
        placeholders[token] = match.group(2)
        return f'{match.group(1)}{token}{match.group(3)}'

    def _protect_bare(match):
        index = counter[0]
        counter[0] += 1
        token = _PLACEHOLDER_TEMPLATE.format(index=index)
        placeholders[token] = match.group(0)
        return token

    protected = _STYLE_BLOCK_RE.sub(_protect_block, html)
    protected = _SCRIPT_BLOCK_RE.sub(_protect_block, protected)
    protected = _AMPSCRIPT_BLOCK_RE.sub(_protect_bare, protected)
    protected = _AMPSCRIPT_OUTPUT_RE.sub(_protect_bare, protected)
    return protected, placeholders


def restore_embedded_regions(candidate_html: str, placeholders: dict) -> str | None:
    """Returns the fully-restored candidate, or None if even ONE
    placeholder token did not survive intact in the model's output —
    proof the candidate dropped, duplicated, or corrupted an embedded
    region (spec section 12 — reject outright, never guess a repair)."""
    restored = candidate_html
    for token, original in placeholders.items():
        count = restored.count(token)
        if count != 1:
            return None
        restored = restored.replace(token, original, 1)
    return restored


# --- Content-preservation fingerprint ----------------------------------

_HREF_SRC_RE = re.compile(r'\b(?:href|src)\s*=\s*"([^"]*)"|\b(?:href|src)\s*=\s*\'([^\']*)\'', re.IGNORECASE)
_ID_RE = re.compile(r'\bid\s*=\s*"([^"]*)"|\bid\s*=\s*\'([^\']*)\'', re.IGNORECASE)
_TEXT_RUN_RE = re.compile(r'>([^<>]{3,})<')


def capture_content_fingerprint(html: str) -> frozenset:
    """Stable facts (spec section 13/24): every href/src/id attribute
    value, and every non-trivial visible-text run between tags. Used
    ONLY to prove the whole-source AI fallback candidate didn't silently
    drop business content — never applied to deterministic recipes,
    which only ever move tag markup and provably never touch content."""
    hrefs_srcs = {(g1 or g2) for g1, g2 in _HREF_SRC_RE.findall(html)}
    ids = {(g1 or g2) for g1, g2 in _ID_RE.findall(html)}
    text_runs = {text.strip() for text in _TEXT_RUN_RE.findall(html) if text.strip()}
    return frozenset(hrefs_srcs | ids | text_runs)


def content_preserved(original_html: str, candidate_html: str) -> bool:
    """True if every stable content fact in `original_html` still
    appears in `candidate_html` — the candidate may add more (new
    content is fine), it may never lose what was already there."""
    return capture_content_fingerprint(original_html) <= capture_content_fingerprint(candidate_html)


# --- Generalized Full-Source Repair sprint, spec section 22/33 ---------
#
# The HTML-specific facts above (href/src/id/text-run) don't generalize —
# CSS/JS/AMPscript have no href/id concept. Every language DOES share two
# universal carriers of business meaning a whole-source AI candidate
# could silently drop: quoted string literals (URLs, marketing copy,
# personalization values, class-name arguments) and comment text.
# AMPscript additionally uses `@name` variables, which often carry the
# customer's own field/business naming. Never applied to a deterministic
# recipe, which by construction only ever moves markup/syntax and
# provably can't touch content in the first place.

_STRING_LITERAL_RE = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|`(?:[^`\\]|\\.)*`')
_BLOCK_COMMENT_RE = re.compile(r'/\*.*?\*/', re.DOTALL)
_AMPSCRIPT_VARIABLE_RE = re.compile(r'@[A-Za-z_][A-Za-z0-9_]*')


def capture_content_fingerprint_for_language(language: str, source: str) -> frozenset:
    """Language-appropriate stable content facts for a whole-source AI
    repair candidate."""
    if language == 'html':
        return capture_content_fingerprint(source)

    facts = {literal.strip('"\'`') for literal in _STRING_LITERAL_RE.findall(source) if len(literal) > 2}
    if language in ('css', 'scss', 'less', 'sass'):
        facts |= {c.strip() for c in _BLOCK_COMMENT_RE.findall(source)}
    elif language == 'javascript':
        # JavaScript Source-Recovery Architecture sprint, spec section 16
        # — a comment describing a defect the candidate just FIXED (e.g.
        # "// syntax error") is meta-commentary about the broken fixture,
        # never business content, and the whole point of a repair is
        # sometimes to remove or correct exactly that comment. Treating
        # every comment as an inviolable fact directly contradicted that
        # requirement — a candidate that correctly cleaned up a stale
        # comment was rejected as "dropped content" (the initial cause of
        # the reported "Resolved 0, Remaining 1" regression once the
        # error-count exemption below was added but comments still
        # blocked acceptance). String literals remain hard-required —
        # unlike comments, they are real runtime/business data a repair
        # must never silently drop.
        pass
    elif language == 'ampscript':
        facts |= {c.strip() for c in _BLOCK_COMMENT_RE.findall(source)}
        facts |= set(_AMPSCRIPT_VARIABLE_RE.findall(source))
    return frozenset(fact for fact in facts if fact)


def content_preserved_for_language(language: str, original: str, candidate: str) -> bool:
    """True if every stable content fact in `original` still appears in
    `candidate` — the candidate may add more, it may never lose what was
    already there."""
    return (
        capture_content_fingerprint_for_language(language, original)
        <= capture_content_fingerprint_for_language(language, candidate)
    )

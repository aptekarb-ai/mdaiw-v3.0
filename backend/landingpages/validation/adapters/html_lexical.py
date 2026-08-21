"""Parser-independent HTML checks — Pass A (lexical opening-tag scan) and
Pass C (raw tag-stack structure) of the HTML validation pipeline. Both
operate purely on the raw source text, independent of any parser's
tokenizer or recovered DOM.

This is deliberate: both html5lib (HtmlConformanceAdapter) and Python's
stdlib html.parser (HtmlStructureAdapter) perform their own internal
error recovery once they hit a malformed tag, and that recovery can
silently swallow LATER, unrelated tags into the malformed one's
attribute soup. Observed live: `<html` missing its `>` swallows the
literal text `<head>` as bogus attribute content, so html.parser never
even calls handle_starttag('head', ...) for it; a later `<img ...`
missing its own `>` likewise swallows the `<a href="contact.html">`
that immediately follows it, so html.parser never sees `<a>` as a start
tag either — it simply cannot report an element as unclosed when it
never knew the element existed. Once an element like `<title>` is
genuinely left unclosed, html5lib's spec-correct RCDATA handling
compounds this by treating every subsequent tag-like sequence as plain
text, so it cannot see any of them.

Pass A (HtmlLexicalAdapter) finds a tag missing its own terminating `>`
directly: for every `<name` sequence that looks like the start of an
element's opening tag, it scans forward — honoring quoted attribute
values, where a stray `<`/`>` is ordinary text — for that same tag's
own terminating `>`. If another tag-opening `<` or end-of-source is
reached first, the original tag never got its `>`, reported at the
tag's own opening position.

Pass C (HtmlTagStackAdapter) re-derives the open/close tag stack from
its own lexical token stream (see `_tokenize` below) rather than from
either parser's callbacks, so a malformed tag earlier in the document
can never suppress recognition of a perfectly well-formed tag that
follows it. It deliberately does NOT apply strict RCDATA semantics to
`<title>` (unlike html5lib) — content following an unclosed `<title>`
is still tokenized as tags, trading one point of spec purity for not
losing every subsequent defect to a single earlier mistake. `<script>`
and `<style>` bodies ARE skipped as raw text (up to their literal
closing tag): those routinely contain `<`/`>` as code/CSS operators,
and tokenizing them as markup would flood the report with noise.

Both passes are intentionally conservative about what they fix
automatically (`fixable=False` throughout) — they exist to make sure a
real defect is never silently dropped, not to guess at insertion
points a stricter, already-tested primary adapter would get exactly
right when it can see the tag at all.
"""

from ..schema import (
    CONFIDENCE_DEFINITE,
    FIX_TYPE_NONE,
    FIX_TYPE_REMOVE_CLOSING_TAG,
    SEVERITY_ERROR,
    ValidationIssueData,
)
from .base import ValidatorAdapter
from .embedded_css import line_starts, offset_to_line_col

_ENGINE_NAME = 'html-lexical'
_TAG_STACK_ENGINE_NAME = 'html-tag-stack'
_STANDARDS_REFERENCE = 'https://html.spec.whatwg.org/multipage/syntax.html#start-tags'
_TAG_STACK_STANDARDS_REFERENCE = 'https://html.spec.whatwg.org/multipage/syntax.html#syntax-tag-omission'

_VOID_ELEMENTS = frozenset({
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
})
_RAWTEXT_ELEMENTS = frozenset({'script', 'style'})


def _issue(**kwargs) -> ValidationIssueData:
    kwargs.setdefault('language', 'html')
    kwargs.setdefault('source_engine', _ENGINE_NAME)
    kwargs.setdefault('engine_version', '')
    kwargs.setdefault('category', 'syntax')
    kwargs.setdefault('confidence', CONFIDENCE_DEFINITE)
    kwargs.setdefault('standards_reference', _STANDARDS_REFERENCE)
    kwargs.setdefault('risk', 'high')
    return ValidationIssueData(**kwargs)


def _is_tag_name_start(ch: str) -> bool:
    return ch.isalpha()


def _is_tag_name_char(ch: str) -> bool:
    return ch.isalnum() or ch in '-_:'


def _tokenize(source: str):
    """Yields ('start', tag, line, col, self_closing) and
    ('end', tag, line, col) tuples via pure raw-text scanning. A
    malformed start tag (missing its own '>') is still yielded — using
    the tag name it clearly intended — because scanning resumes right
    after the tag NAME rather than after a found '>', so it can never
    swallow a later, unrelated tag as bogus attribute content of this
    one (the exact failure mode this pass exists to avoid)."""
    starts = line_starts(source)
    length = len(source)
    i = 0
    while i < length:
        if source[i] != '<':
            i += 1
            continue

        nxt = source[i + 1] if i + 1 < length else ''

        if nxt == '/':
            j = i + 2
            name_start = j
            while j < length and _is_tag_name_char(source[j]):
                j += 1
            tag_name = source[name_start:j].lower()
            k = j
            while k < length and source[k] != '>':
                k += 1
            end_pos = k + 1 if k < length else k
            if tag_name:
                line, col = offset_to_line_col(i, starts)
                yield ('end', tag_name, line, col)
            i = end_pos if end_pos > i else i + 1
            continue

        if nxt in ('!', '?') or not _is_tag_name_start(nxt):
            i += 1
            continue

        tag_start = i
        j = i + 1
        name_start = j
        while j < length and _is_tag_name_char(source[j]):
            j += 1
        tag_name = source[name_start:j].lower()
        if not tag_name:
            i += 1
            continue

        k = j
        quote = None
        terminated = False
        self_closing = False
        while k < length:
            c = source[k]
            if quote:
                if c == quote:
                    quote = None
                k += 1
                continue
            if c in ('"', "'"):
                quote = c
                k += 1
                continue
            if c == '>':
                terminated = True
                self_closing = k > 0 and source[k - 1] == '/'
                break
            if c == '<':
                break
            k += 1

        line, col = offset_to_line_col(tag_start, starts)
        yield ('start', tag_name, line, col, self_closing)

        if tag_name in _RAWTEXT_ELEMENTS and terminated and not self_closing:
            # Skip the raw-text BODY only — resume right at its closing
            # tag (rather than past it) so the normal end-tag branch above
            # still sees and yields it, keeping the stack balanced.
            close_needle = f'</{tag_name}'
            idx = source.lower().find(close_needle, k + 1)
            i = idx if idx != -1 else length
            continue

        i = k + 1 if terminated else j


class HtmlLexicalAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        issues: list[ValidationIssueData] = []
        starts = line_starts(source)
        length = len(source)
        i = 0

        while i < length:
            if source[i] != '<':
                i += 1
                continue

            nxt = source[i + 1] if i + 1 < length else ''
            if nxt in ('/', '!', '?') or not _is_tag_name_start(nxt):
                # Closing tag, comment/doctype, or processing-instruction-
                # like sequence — not in scope for this check.
                i += 1
                continue

            tag_start = i
            j = i + 1
            name_start = j
            while j < length and _is_tag_name_char(source[j]):
                j += 1
            tag_name = source[name_start:j]

            k = j
            quote = None
            terminated = False
            while k < length:
                c = source[k]
                if quote:
                    if c == quote:
                        quote = None
                    k += 1
                    continue
                if c in ('"', "'"):
                    quote = c
                    k += 1
                    continue
                if c == '>':
                    terminated = True
                    break
                if c == '<':
                    break
                k += 1

            if not terminated:
                line, column = offset_to_line_col(tag_start, starts)
                issues.append(_issue(
                    rule_id='malformed-start-tag',
                    severity=SEVERITY_ERROR,
                    message=f'"<{tag_name}" is missing its closing ">".',
                    start_line=line,
                    start_column=column,
                    suggestion=f'Add ">" to close the "<{tag_name}" start tag.',
                    fixable=False,
                    fix_type=FIX_TYPE_NONE,
                    requires_manual_review=True,
                    related_element=tag_name,
                ))
                i = j
                continue

            i = k + 1

        return issues


def _tag_stack_issue(**kwargs) -> ValidationIssueData:
    kwargs.setdefault('language', 'html')
    kwargs.setdefault('source_engine', _TAG_STACK_ENGINE_NAME)
    kwargs.setdefault('engine_version', '')
    kwargs.setdefault('category', 'syntax')
    kwargs.setdefault('confidence', CONFIDENCE_DEFINITE)
    kwargs.setdefault('standards_reference', _TAG_STACK_STANDARDS_REFERENCE)
    kwargs.setdefault('risk', 'high')
    kwargs.setdefault('fixable', False)
    kwargs.setdefault('fix_type', FIX_TYPE_NONE)
    kwargs.setdefault('requires_manual_review', True)
    return ValidationIssueData(**kwargs)


class HtmlTagStackAdapter(ValidatorAdapter):
    """Pass C — independent tag-stack structure check. A conservative
    backstop for HtmlStructureAdapter: reports the SAME class of defect
    (an element left unclosed, or a stray closing tag with no opener),
    but only when its own, independently-tokenized stack disagrees with
    what html.parser was able to see. Where both agree, the engine's
    cross-engine merge (engine.py::_dedupe) keeps HtmlStructureAdapter's
    original, more detailed finding — this adapter exists purely so an
    element is never silently invisible just because an unrelated,
    earlier tag confused a real parser's recovery."""

    engine_name = _TAG_STACK_ENGINE_NAME
    engine_version = ''
    language = 'html'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        issues: list[ValidationIssueData] = []
        open_stack: list[tuple[str, int, int]] = []

        for event in _tokenize(source):
            if event[0] == 'start':
                _, tag, line, col, self_closing = event
                if tag in _VOID_ELEMENTS or self_closing:
                    continue
                open_stack.append((tag, line, col))
                continue

            _, tag, line, col = event
            matched_index = None
            for index in range(len(open_stack) - 1, -1, -1):
                if open_stack[index][0] == tag:
                    matched_index = index
                    break

            if matched_index is None:
                # Repair-architecture closure sprint, spec section 4 —
                # unambiguous by construction, exactly like the primary
                # HtmlStructureAdapter's sibling case (html_structure.py).
                issues.append(_tag_stack_issue(
                    rule_id='unexpected-closing-tag-independent',
                    severity=SEVERITY_ERROR,
                    message=f'Unexpected closing tag "</{tag}>" has no matching opening tag.',
                    start_line=line,
                    start_column=col,
                    fixable=True,
                    fix_type=FIX_TYPE_REMOVE_CLOSING_TAG,
                    deterministic_fix={'action': 'remove_closing_tag', 'tag': tag, 'start_line': line, 'start_column': col},
                    requires_manual_review=False,
                    related_element=tag,
                ))
                continue

            orphans = open_stack[matched_index + 1:]
            for orphan_tag, orphan_line, orphan_col in orphans:
                issues.append(_tag_stack_issue(
                    rule_id='unclosed-tag-independent',
                    severity=SEVERITY_ERROR,
                    message=(
                        f'"<{orphan_tag}>" is never closed — end tag "</{tag}>" '
                        f'encountered while "<{orphan_tag}>" was still open.'
                    ),
                    start_line=orphan_line,
                    start_column=orphan_col,
                    suggestion=f'Add a matching </{orphan_tag}> before </{tag}>.',
                    related_element=orphan_tag,
                ))
            del open_stack[matched_index:]

        for tag, line, col in open_stack:
            issues.append(_tag_stack_issue(
                rule_id='unclosed-tag-independent',
                severity=SEVERITY_ERROR,
                message=f'"<{tag}>" is never closed.',
                start_line=line,
                start_column=col,
                suggestion=f'Add a matching </{tag}>.',
                related_element=tag,
            ))

        return issues

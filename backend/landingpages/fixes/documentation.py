"""AI Engineer Formatting + Documentation sprint (closure spec: "Adjust
the AI Engineer FORMAT + COMMENT policy") — the documentation pass. Runs
as part of "AI Fix Issues", BEFORE the formatting pass (spec section 7:
repair -> comments -> formatter -> validators), and ONLY as part of that
operation; "AI Validate Code" never calls this module (read-only).

This pass is deliberately scoped to ADDING comments only — it never
removes or rewrites an existing comment (stale-comment cleanup is a
*permitted*, not mandatory, behavior the project has not built yet; this
MVP pass takes the strictly safer of the two options). A comment may be
attached in one of two ways, matching the closure spec's per-language
policy:

1. A whole new standalone comment LINE (unchanged from the original
   behavior) — the default for HTML, and for JS/CSS/AMPscript comments
   that genuinely explain more than one following line.
2. A TRAILING comment appended to the end of an EXISTING line, for
   CSS/SCSS/LESS/JavaScript/AMPscript — the code portion of that line
   must stay byte-for-byte identical; only whitespace + a well-formed
   trailing comment may be appended. Never for HTML (spec section 4 —
   HTML comments are never forced onto the same physical line as
   markup, since that risks altering significant whitespace).

Idempotency (spec section 6): a line that ALREADY carries a trailing
comment can never receive a second one — verified structurally here,
not merely hoped for from the model's own restraint.

`_verify_add_only_comments` uses a line-level diff; any hunk that doesn't
match one of the two shapes above is rejected outright and the original
source is kept untouched. Fails closed, matching "never let a
formatting/documentation candidate corrupt behavior" (spec section 16).
"""

from __future__ import annotations

import difflib
import logging
import re

from ..ai_review.provider import DocumentationRequest
from ..ai_review.provider import AIReviewUnavailable

logger = logging.getLogger('landingpages.fixes.documentation')

_LANGUAGE_FOR_FILE_KEY = {'html': 'html', 'css': 'css', 'js': 'javascript', 'ampscript': 'ampscript'}

_FULL_LINE_COMMENT_RE = {
    'html': re.compile(r'^\s*<!--.*-->\s*$'),
    'css': re.compile(r'^\s*(/\*.*\*/|//.*)\s*$'),
    'javascript': re.compile(r'^\s*(//.*|/\*.*\*/)\s*$'),
    'ampscript': re.compile(r'^\s*/\*.*\*/\s*$'),
}

# Closure spec section 1/2/3 — HTML deliberately excluded (section 4:
# never force a trailing same-line comment onto markup). CSS/SCSS/LESS
# use block comments; JavaScript uses line comments; AMPscript's own
# conformance checker was verified directly (see
# test_documentation.py) to accept a trailing `/* ... */` after a
# statement without raising any new finding, matching the spec's
# "confirm the parser accepts it" requirement.
_TRAILING_COMMENT_SUFFIX_RE = {
    'css': re.compile(r'^(?P<code>.*\S)[ \t]+(?P<comment>/\*(?:(?!\*/).)*\*/)[ \t]*$'),
    'javascript': re.compile(r'^(?P<code>.*\S)[ \t]+(?P<comment>//[^\r\n]*)$'),
    'ampscript': re.compile(r'^(?P<code>.*\S)[ \t]+(?P<comment>/\*(?:(?!\*/).)*\*/)[ \t]*$'),
}


def _is_trailing_comment_attachment(language: str, old_line: str, new_line: str) -> bool:
    """True if `new_line` is exactly `old_line` (byte-identical, modulo
    trailing whitespace) plus one well-formed trailing comment appended
    — and `old_line` does NOT already carry one (idempotency: a second
    AI Fix Issues run must never double up)."""
    suffix_re = _TRAILING_COMMENT_SUFFIX_RE.get(language)
    if suffix_re is None:
        return False
    match = suffix_re.match(new_line)
    if match is None:
        return False
    if match.group('code') != old_line.rstrip():
        return False
    # The comment itself must not be embedded inside the "code" portion
    # too — i.e. old_line must not ALREADY end in a trailing comment of
    # its own (idempotency guard).
    if suffix_re.match(old_line.rstrip()):
        return False
    return True


def _verify_add_only_comments(language: str, original: str, candidate: str) -> bool:
    """True only if `candidate` differs from `original` by pure comment
    additions — either a whole new standalone comment line, or a
    trailing comment appended to an existing (unmodified, not-already-
    commented) line. Never a genuine content replace/delete."""
    if candidate == original:
        return False  # nothing to adopt — not a failure, just a no-op the caller should skip
    comment_re = _FULL_LINE_COMMENT_RE.get(language)
    if comment_re is None:
        return False
    original_lines = original.split('\n')
    candidate_lines = candidate.split('\n')
    matcher = difflib.SequenceMatcher(None, original_lines, candidate_lines, autojunk=False)
    saw_change = False
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            continue
        if tag == 'insert':
            inserted = candidate_lines[j1:j2]
            for line in inserted:
                if line.strip() == '':
                    continue
                if not comment_re.match(line):
                    return False
            saw_change = True
            continue
        if tag == 'replace' and (i2 - i1) == (j2 - j1):
            # Equal-count line-for-line replace — each pair must be a
            # trailing-comment attachment onto an otherwise-untouched
            # line. Any pair that isn't rejects the WHOLE candidate.
            for old_line, new_line in zip(original_lines[i1:i2], candidate_lines[j1:j2]):
                if old_line == new_line:
                    continue
                if not _is_trailing_comment_attachment(language, old_line, new_line):
                    return False
            saw_change = True
            continue
        # 'delete', or a 'replace' that changes the line count — a real
        # structural change. Never permitted in this pass.
        return False
    return saw_change


def apply_documentation_pass(
    sources: dict, css_source_type: str, target_platform: str | None, rate_limit_identifier: str,
    provider=None,
) -> tuple[dict, set]:
    """Returns (new_sources, documented_file_keys). Never raises: AI
    unavailability, a malformed response, or a candidate that fails the
    add-only-comments check all simply mean that file is left unchanged
    (spec section 28 — "no additional comments required" is a valid,
    unremarkable outcome, not an error)."""
    if provider is None:
        from ..ai_review.provider import get_default_ai_review_provider

        provider = get_default_ai_review_provider()
    if provider is None:
        return dict(sources), set()

    new_sources = dict(sources)
    documented: set[str] = set()

    for file_key, language in _LANGUAGE_FOR_FILE_KEY.items():
        source = sources.get(file_key, '')
        if not source or not source.strip():
            continue
        try:
            result = provider.suggest_documentation(DocumentationRequest(
                file_key=file_key, language=language, source=source,
                css_source_type=css_source_type, target_platform=target_platform,
                rate_limit_identifier=rate_limit_identifier,
            ))
        except AIReviewUnavailable:
            continue
        if result.documented_source is None:
            continue
        if not _verify_add_only_comments(language, source, result.documented_source):
            logger.warning(
                'landingpages.fixes.documentation.candidate_rejected file_key=%s', file_key,
            )
            continue
        new_sources[file_key] = result.documented_source
        documented.add(file_key)

    return new_sources, documented

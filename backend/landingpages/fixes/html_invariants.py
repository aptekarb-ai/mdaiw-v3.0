"""HTML document-shell structural invariants — Source-Repair Integrity
sprint, spec section 10/11/12. A repair candidate must never be committed
to the editor if it violates basic document-shell shape, REGARDLESS of
which upstream mechanism produced the bad candidate (a mis-scoped AI
proposal, a same-anchor merge that absorbed disqualified content, a stale
offset, a double-applied patch, ...). This is the last line of defense,
not the only one — see fixes/regions.py's `_is_disqualified_extra` for the
targeted root-cause fix to the specific case that motivated this module.

Deliberately simple counting/ordering checks, not a full parser: this only
needs to catch OBVIOUS, catastrophic duplication (two `<head>` elements,
`<head>` appearing after `</body>`, ...) cheaply on every candidate, not
re-implement conformance checking that the real HTML engines already do
far more thoroughly.
"""

import re

_TAG_PATTERNS = {
    'doctype': re.compile(r'<!doctype\s+html', re.IGNORECASE),
    'html': re.compile(r'<html[\s>]', re.IGNORECASE),
    'head': re.compile(r'<head[\s>]', re.IGNORECASE),
    'body': re.compile(r'<body[\s>]', re.IGNORECASE),
}
_BODY_CLOSE_PATTERN = re.compile(r'</body\s*>', re.IGNORECASE)

# A live-verification session found a SECOND class of repair-generated
# duplication, milder than a doubled document-shell element but still a
# real defect: an insertion proposal for one of these singleton elements
# landed even though the element already existed elsewhere in the
# document (the proposal was for a DIFFERENT issue than "this element is
# missing" — e.g. an AI Engineer contextual suggestion about the title —
# but its patch still added a brand new one). None of these singleton
# elements are legitimately duplicated by an autonomous repair: if the
# count goes up for one that was ALREADY present before this round, the
# round is rejected exactly like a structural-invariant violation.
_SINGLETON_PATTERNS = {
    'title': re.compile(r'<title[\s>]', re.IGNORECASE),
    'meta charset': re.compile(r'<meta\s[^>]*charset', re.IGNORECASE),
    'meta viewport': re.compile(r'<meta\s[^>]*name=["\']viewport["\']', re.IGNORECASE),
    'meta description': re.compile(r'<meta\s[^>]*name=["\']description["\']', re.IGNORECASE),
}


def check_no_new_duplicate_singletons(before_html: str, after_html: str) -> list[str]:
    """Returns violation descriptions when a round's candidate ADDS a new
    occurrence of a singleton element (title, charset, viewport, meta
    description) that was already present at least once before this round
    — never fires for an element going from 0 -> 1 (a genuine "missing X"
    fix), only for 1+ -> more (a duplicate)."""
    if not after_html or not after_html.strip():
        return []
    violations = []
    for name, pattern in _SINGLETON_PATTERNS.items():
        before_count = len(pattern.findall(before_html or ''))
        after_count = len(pattern.findall(after_html))
        if before_count >= 1 and after_count > before_count:
            violations.append(
                f'Repair added a new "{name}" occurrence when one already existed '
                f'({before_count} -> {after_count}).',
            )
    return violations


def check_html_structural_invariants(html: str) -> list[str]:
    """Returns a list of human-readable violation descriptions — empty
    means the candidate is structurally sane. Only meaningful for a
    FULL-DOCUMENT HTML source (the html scope's own editor content, or
    Complete LP's html tab) — never called against a fragment, embedded
    snippet, or non-HTML source."""
    if not html or not html.strip():
        return []

    violations = []
    counts = {name: len(pattern.findall(html)) for name, pattern in _TAG_PATTERNS.items()}

    for name, count in counts.items():
        if count > 1:
            violations.append(f'Document has {count} "<{name}>" elements — expected at most one.')

    body_close_match = _BODY_CLOSE_PATTERN.search(html)
    if body_close_match and counts['head'] >= 1:
        head_match = _TAG_PATTERNS['head'].search(html)
        if head_match and head_match.start() > body_close_match.start():
            violations.append('A "<head>" element appears after "</body>".')

    if counts['head'] == 1 and counts['body'] == 1:
        head_start = _TAG_PATTERNS['head'].search(html).start()
        body_start = _TAG_PATTERNS['body'].search(html).start()
        if body_start < head_start:
            violations.append('"<body>" appears before "<head>".')

    return violations


__all__ = ['check_html_structural_invariants', 'check_no_new_duplicate_singletons']

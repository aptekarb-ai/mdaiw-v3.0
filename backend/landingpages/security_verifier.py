"""Deterministic Secure-DOM verifier — Verified Repair Memory + Secure
JavaScript closure spec, sections 5/6.

AI Engineer (or a verified recipe) may PROPOSE a repair for a dangerous-
DOM-sink finding; this module is the deterministic gate that decides
whether the resulting candidate source is actually acceptable. It never
generates a repair itself — it only counts dangerous-sink occurrences
before/after and refuses any candidate that introduces a NEW one (by
count, per category) that was not already present, which blocks the
specific failure mode this spec calls out: swapping one unsafe sink for
another (innerHTML -> insertAdjacentHTML, innerHTML -> outerHTML,
innerHTML -> document.write, or anything routed through eval/Function).

Deliberately text-pattern-based, not a full AST analysis — consistent
with every other lightweight static check in this project
(html_js_context.py's own docstring makes the same tradeoff explicitly).
A pattern-based counter cannot be fooled by trivial reformatting in a way
that matters here: an attacker isn't submitting adversarial input through
an internal repair pipeline, the goal is catching a well-intentioned but
wrong AI/recipe candidate, not defeating deliberate evasion.
"""

import re

# Every category name here doubles as the "what happened" label surfaced
# in verification-rejection messages — keep them short and human-readable.
_DANGEROUS_SINK_PATTERNS: dict[str, re.Pattern] = {
    'innerHTML-assignment': re.compile(r'\.innerHTML\s*='),
    'outerHTML-assignment': re.compile(r'\.outerHTML\s*='),
    'insertAdjacentHTML-call': re.compile(r'\.insertAdjacentHTML\s*\('),
    'document-write-call': re.compile(r'\bdocument\s*\.\s*write(?:ln)?\s*\('),
    'eval-call': re.compile(r'(?<![.\w$])eval\s*\('),
    'function-constructor': re.compile(r'\bnew\s+Function\s*\(|(?<![.\w$])Function\s*\('),
    'javascript-url-scheme': re.compile(r'''['"]\s*javascript\s*:'''),
}


def count_dangerous_sinks(js_source: str) -> dict[str, int]:
    """Occurrence count per dangerous-sink category in `js_source`."""
    return {name: len(pattern.findall(js_source)) for name, pattern in _DANGEROUS_SINK_PATTERNS.items()}


def introduces_new_dangerous_sink(before_source: str, after_source: str) -> list[str]:
    """Category names whose count went UP from `before_source` to
    `after_source` — a hard reject signal for any security-classified
    repair candidate, regardless of whether the candidate came from AI
    Engineer or a verified recipe. An unchanged or DECREASED count for
    every category means this check passes (a candidate that legitimately
    removes a dangerous sink, or touches unrelated code, is never
    penalized for sinks that were already there and untouched)."""
    before_counts = count_dangerous_sinks(before_source)
    after_counts = count_dangerous_sinks(after_source)
    return [
        name for name in _DANGEROUS_SINK_PATTERNS
        if after_counts[name] > before_counts.get(name, 0)
    ]


# --- Trust-boundary classification (spec section 6) -------------------------
#
# TRUST_UNKNOWN and every "external" category are treated conservatively
# by callers (i.e. as untrusted) — only TRUST_STATIC_LITERAL is ever
# treated as safe-by-construction. This classifier is advisory: it feeds
# AI prompt context and lets tests/reporting reason about WHY a value was
# treated as untrusted, but the actual accept/reject decision for a
# candidate is always made by `introduces_new_dangerous_sink` above plus
# real validator revalidation — never by this classification alone.
TRUST_STATIC_LITERAL = 'STATIC_LITERAL'
TRUST_DOM_INPUT = 'DOM_INPUT'
TRUST_URL_PARAMETER = 'URL_PARAMETER'
TRUST_QUERY_PARAMETER = 'QUERY_PARAMETER'
TRUST_FORM_VALUE = 'FORM_VALUE'
TRUST_NETWORK_RESPONSE = 'NETWORK_RESPONSE'
TRUST_LOCAL_STORAGE = 'LOCAL_STORAGE'
TRUST_SESSION_STORAGE = 'SESSION_STORAGE'
TRUST_AMPSCRIPT_OUTPUT = 'AMPSCRIPT_OUTPUT'
TRUST_UNKNOWN = 'UNKNOWN'

# Untrusted-by-default — every category except STATIC_LITERAL. Exposed so
# callers don't need to enumerate the "not static" set themselves.
UNTRUSTED_CATEGORIES = frozenset({
    TRUST_DOM_INPUT, TRUST_URL_PARAMETER, TRUST_QUERY_PARAMETER, TRUST_FORM_VALUE,
    TRUST_NETWORK_RESPONSE, TRUST_LOCAL_STORAGE, TRUST_SESSION_STORAGE,
    TRUST_AMPSCRIPT_OUTPUT, TRUST_UNKNOWN,
})

_TRUST_SIGNATURES: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(r'\blocation\s*\.\s*search\b|\bURLSearchParams\s*\('), TRUST_QUERY_PARAMETER),
    (re.compile(r'\blocation\s*\.\s*(?:hash|pathname|href)\b'), TRUST_URL_PARAMETER),
    (re.compile(r'\bFormData\s*\(|\.elements\s*\['), TRUST_FORM_VALUE),
    (re.compile(r'\bfetch\s*\(|\.json\s*\(\s*\)|XMLHttpRequest|\bresponse\b'), TRUST_NETWORK_RESPONSE),
    (re.compile(r'\blocalStorage\s*\.\s*getItem\s*\('), TRUST_LOCAL_STORAGE),
    (re.compile(r'\bsessionStorage\s*\.\s*getItem\s*\('), TRUST_SESSION_STORAGE),
    # A DOM read — `.value`/`.textContent`/`.innerText` off any element
    # reference — is user-controlled input, not a static value, even
    # though it is read from "our own" page.
    (re.compile(r'\.\s*(?:value|textContent|innerText)\b'), TRUST_DOM_INPUT),
)

_STATIC_STRING_LITERAL_RE = re.compile(r'^\s*([\'"]).*\1\s*$')
_BARE_IDENTIFIER_RE = re.compile(r'^\s*[A-Za-z_$][\w$]*\s*$')


def classify_value_source(expression: str) -> str:
    """Heuristic trust-boundary classification of a JS expression's
    likely data source. Deliberately conservative: an expression this
    function cannot confidently place is TRUST_UNKNOWN, never guessed
    into TRUST_STATIC_LITERAL — "treat user-controlled/unknown values
    conservatively" (spec section 6). AMPscript-originated values are
    only ever classified TRUST_AMPSCRIPT_OUTPUT by the caller (cross-
    language callers pass that in directly — a plain JS-text heuristic
    cannot see AMPscript source), never inferred here from JS text alone.
    """
    text = expression.strip()
    if not text:
        return TRUST_UNKNOWN
    if _STATIC_STRING_LITERAL_RE.match(text) and '${' not in text:
        return TRUST_STATIC_LITERAL
    for pattern, category in _TRUST_SIGNATURES:
        if pattern.search(text):
            return category
    # A bare identifier/property path with no recognizable signature and
    # no string literal shape — genuinely unknown provenance from static
    # text alone (could be a safely-derived local constant, could be
    # user input threaded through a variable) — never assumed safe.
    return TRUST_UNKNOWN


__all__ = [
    'count_dangerous_sinks', 'introduces_new_dangerous_sink', 'classify_value_source',
    'TRUST_STATIC_LITERAL', 'TRUST_DOM_INPUT', 'TRUST_URL_PARAMETER', 'TRUST_QUERY_PARAMETER',
    'TRUST_FORM_VALUE', 'TRUST_NETWORK_RESPONSE', 'TRUST_LOCAL_STORAGE', 'TRUST_SESSION_STORAGE',
    'TRUST_AMPSCRIPT_OUTPUT', 'TRUST_UNKNOWN', 'UNTRUSTED_CATEGORIES',
]

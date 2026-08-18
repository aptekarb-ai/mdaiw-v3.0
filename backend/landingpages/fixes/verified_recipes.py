"""Verified Repair Knowledge sprint — structural repair recipes for a
small, deliberately narrow set of well-understood patterns. These sit
between the mechanical catalogue.py fixers and full AI Engineer reasoning
in the repair priority chain (deterministic -> verified recipe -> AI):
each function here re-runs the REAL validator adapter that raised the
issue against the CURRENT source and only proceeds when a freshly-
computed issue has the exact same fingerprint as the persisted one — the
identical trust boundary catalogue.py uses, for the identical reason.

Every recipe here is intentionally conservative: if the structural
preconditions it checks for are not unambiguously met, it returns None
and the issue falls through to AI Engineer (or Requires Input) rather
than guess. Outcomes are recorded into fixes/repair_memory.py by the
caller (fixes/iterative.py) so success/failure stats, negative memory,
and "skip a fresh reasoning pass" fast-pathing accumulate over time —
this module only ever builds candidates; it never trusts its own output
without the caller's live authoritative revalidation.
"""

import re
import uuid
from dataclasses import dataclass, field

from ..validation.adapters.css_conformance import CssConformanceAdapter
from ..validation.adapters.css_less import LessAdapter
from ..validation.adapters.css_scss_sass import ScssSassAdapter
from ..validation.adapters.html_embedded_javascript import HtmlEmbeddedJavascriptAdapter
from ..validation.adapters.html_inline_style import HtmlInlineStyleAdapter
from ..validation.adapters.html_js_context import extract_element_ids, extract_script_blocks
from ..validation.adapters.html_seo import HtmlSeoAdapter
from ..validation.adapters.html_style_block import HtmlStyleBlockAdapter
from ..validation.adapters.js_conformance import JsConformanceAdapter
from ..validation.node_bridge import NodeBridgeError
from ..security_verifier import introduces_new_dangerous_sink
from .catalogue import Patch, _find_by_fingerprint, _make_patch
from .offsets import line_col_to_offset, line_starts, offset_to_line_col

# A recipe result also carries the small facts needed to record it into
# Verified Repair Memory — a `strategy_key` (the CODE identity of the
# transform used, not a stored diff) and `context_facts` (booleans/counts
# only, never source text; see repair_memory.compute_context_signature).


@dataclass(frozen=True)
class RecipeResult:
    # Almost always one patch; a "move" (charset) needs two DISJOINT,
    # narrow patches (insert at the new spot, remove from the old spot)
    # rather than one wide patch spanning everything in between — a wide
    # patch would spuriously range-conflict with any unrelated issue's
    # patch elsewhere in the same region. The caller treats every patch
    # in one RecipeResult as ATOMIC: if conflict detection would drop any
    # one of them, all of them are dropped (see
    # fixes/iterative.py::_attempt_verified_recipes).
    patches: list[Patch]
    strategy_key: str
    strategy_description: str
    context_facts: dict
    # Optional extra environment facts recorded into Verified Repair
    # Memory's `last_verified_environment` on success (merged with the
    # caller's own {'profile': ...}) — e.g. the font-classification table
    # version a font-fallback recipe was proven under (spec section 11).
    # Empty for every recipe that has no versioned data source of its own.
    environment_extra: dict = field(default_factory=dict)


# --- HTML: charset-declared-late --------------------------------------------

_HEAD_TAG_RE = re.compile(r'<head\b[^>]*>', re.IGNORECASE)
_HEAD_CLOSE_TAG_RE = re.compile(r'</head\s*>', re.IGNORECASE)
_CHARSET_META_RE = re.compile(r'<meta\b[^>]*\bcharset\s*=\s*["\'][^"\']*["\'][^>]*/?>', re.IGNORECASE)

_MOVE_EXISTING_CHARSET_STRATEGY = 'move-existing-charset-to-head-start'


def recipe_charset_declared_late(issue, sources, css_source_type, profile) -> RecipeResult | None:
    """Spec section 7 — MOVE the existing <meta charset> element to the
    first appropriate position in <head>. Never creates a second charset,
    never duplicates <head>, never touches anything else in the document.
    Only fires when the document has exactly one <head> and exactly one
    charset meta tag — anything more structurally unusual is left to AI
    Engineer/manual review rather than guessed at."""
    html = sources.get('html', '')
    fresh = HtmlSeoAdapter().validate(html, profile)
    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None:
        return None

    head_open_matches = list(_HEAD_TAG_RE.finditer(html))
    head_close_matches = list(_HEAD_CLOSE_TAG_RE.finditer(html))
    context_facts = {'head_count': len(head_open_matches), 'head_close_count': len(head_close_matches)}
    if len(head_open_matches) != 1 or len(head_close_matches) != 1:
        return None
    open_end = head_open_matches[0].end()
    close_start = head_close_matches[0].start()
    if close_start <= open_end:
        return None

    charset_matches = list(_CHARSET_META_RE.finditer(html, open_end, close_start))
    context_facts['charset_count'] = len(charset_matches)
    if len(charset_matches) != 1:
        # Zero found here means the http-equiv=content-type variant (this
        # recipe only recognizes the charset="..." attribute form) or a
        # different structural shape — never guess between several.
        return None
    charset_match = charset_matches[0]
    charset_start, charset_end = charset_match.start(), charset_match.end()
    charset_text = charset_match.group(0)
    context_facts['charset_already_first'] = html[open_end:charset_start].strip() == ''
    if context_facts['charset_already_first']:
        return None

    starts = line_starts(html)
    # Two narrow, DISJOINT patches instead of one wide "replace the whole
    # head" patch — a wide patch spanning open_end..close_start would
    # overlap (and spuriously range-conflict with) any OTHER issue's
    # patch elsewhere in the same <head> (e.g. a duplicate <title> or
    # duplicate viewport removal), silently blocking both for no real
    # reason. Insert the charset element right after <head>, then remove
    # it from its old position — the caller treats both patches as one
    # atomic unit (fixes/iterative.py::_attempt_verified_recipes).
    insert_patch = _make_patch(
        issue, match, file='html', start_offset=open_end, end_offset=open_end,
        original_text='', replacement_text=charset_text + '\n',
        description='Insert the existing <meta charset> as the first child of <head>.', starts=starts,
    )
    remove_end = charset_end + 1 if html[charset_end:charset_end + 1] == '\n' else charset_end
    remove_patch = _make_patch(
        issue, match, file='html', start_offset=charset_start, end_offset=remove_end,
        original_text=html[charset_start:remove_end], replacement_text='',
        description='Remove the <meta charset> from its old position.', starts=starts,
    )
    return RecipeResult(
        patches=[insert_patch, remove_patch], strategy_key=_MOVE_EXISTING_CHARSET_STRATEGY, context_facts=context_facts,
        strategy_description=(
            'Move the EXISTING <meta charset> element to be the first child of <head> via two narrow '
            'insert/remove patches. Never create a second charset meta or a second <head>.'
        ),
    )


# --- CSS/SCSS/Sass/LESS: font-family-no-missing-generic-family-keyword -----

_FONT_FAMILY_DECL_RE = re.compile(r'font-family\s*:\s*([^;{}\n]+);?', re.IGNORECASE)
_GENERIC_FAMILIES = frozenset({
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
})
# A small, conservative, well-known font -> generic-family classification
# — MAINTAINED and VERSIONED (closure spec section 11), not asked of the
# AI on every operation. Deliberately not exhaustive: an unrecognized
# font name means "don't guess" (this recipe returns None and the issue
# falls through to AI Engineer, which may still propose a fix — just not
# via this fast, no-LLM-call path), never "default to sans-serif". To
# extend: add the font's lowercase name to the appropriate set below and
# bump _FONT_CLASSIFICATION_VERSION — the version is recorded into
# Verified Repair Memory's `last_verified_environment` on every success,
# so a future table change is visible in the ledger rather than silently
# invalidating (or silently over-trusting) prior confidence.
_FONT_CLASSIFICATION_VERSION = 1
_KNOWN_SANS_SERIF_FONTS = frozenset({
    'arial', 'helvetica', 'helvetica neue', 'verdana', 'tahoma', 'segoe ui', 'roboto', 'calibri',
    'trebuchet ms', 'century gothic', 'lucida sans', 'lucida sans unicode', 'geneva', 'candara',
    'optima', 'futura', 'gill sans', 'noto sans', 'open sans', 'lato', 'montserrat', 'inter',
    'source sans pro', 'work sans', 'poppins', 'nunito', 'raleway',
})
_KNOWN_SERIF_FONTS = frozenset({
    'georgia', 'times new roman', 'times', 'garamond', 'palatino', 'palatino linotype',
    'book antiqua', 'cambria', 'didot', 'perpetua', 'rockwell', 'baskerville', 'noto serif',
    'playfair display', 'merriweather', 'pt serif', 'lora',
})
_KNOWN_MONOSPACE_FONTS = frozenset({
    'courier new', 'courier', 'consolas', 'monaco', 'lucida console', 'menlo', 'source code pro',
    'fira code', 'roboto mono', 'ibm plex mono', 'jetbrains mono', 'andale mono',
})
_KNOWN_CURSIVE_FONTS = frozenset({'comic sans ms', 'brush script mt', 'lucida handwriting'})

_APPEND_GENERIC_FAMILY_STRATEGY = 'append-known-generic-family'


def _classify_generic_family(font_names: list[str]) -> str | None:
    for raw in font_names:
        name = raw.strip().strip('\'"').lower()
        if name in _KNOWN_SANS_SERIF_FONTS:
            return 'sans-serif'
        if name in _KNOWN_SERIF_FONTS:
            return 'serif'
        if name in _KNOWN_MONOSPACE_FONTS:
            return 'monospace'
        if name in _KNOWN_CURSIVE_FONTS:
            return 'cursive'
    return None


def _locate_font_family_fix(target_source: str, line: int):
    lines = target_source.split('\n')
    if not line or line < 1 or line > len(lines):
        return None
    line_text = lines[line - 1]
    match = _FONT_FAMILY_DECL_RE.search(line_text)
    if match is None:
        return None
    value_text = match.group(1)
    tokens = [t.strip() for t in value_text.split(',') if t.strip()]
    if not tokens:
        return None
    lowered_tokens = {t.strip().strip('\'"').lower() for t in tokens}
    if lowered_tokens & _GENERIC_FAMILIES:
        return None  # already has a generic fallback — nothing for THIS recipe to do
    generic = _classify_generic_family(tokens)
    if generic is None:
        return None
    starts = line_starts(target_source)
    line_start = starts[line - 1]
    value_start = line_start + match.start(1)
    value_end = line_start + match.end(1)
    original = target_source[value_start:value_end]
    replacement = original.rstrip() + f', {generic}'
    return value_start, value_end, original, replacement, starts, generic


def recipe_missing_generic_font_family(issue, sources, css_source_type, profile) -> RecipeResult | None:
    """Spec section 8 — preserve the existing concrete font(s), append the
    correct generic family inferred from a known font-classification
    table. Never guesses between serif/sans-serif for an unrecognized
    font name; that case falls through to AI Engineer/manual review."""
    context = issue.source_context
    html = sources.get('html', '')
    css = sources.get('css', '')

    if context in ('html-inline-style', 'html-style-block'):
        adapter = HtmlInlineStyleAdapter() if context == 'html-inline-style' else HtmlStyleBlockAdapter()
        fresh = adapter.validate(html, profile)
        target, file_key = html, 'html'
    elif context == 'standalone-css':
        fresh = CssConformanceAdapter().validate(css, profile)
        target, file_key = css, 'css'
    elif context in ('standalone-scss', 'standalone-sass'):
        source_type = 'sass' if context == 'standalone-sass' else 'scss'
        try:
            fresh = ScssSassAdapter(source_type).validate(css, profile)
        except NodeBridgeError:
            return None
        target, file_key = css, 'css'
    elif context == 'standalone-less':
        try:
            fresh = LessAdapter().validate(css, profile)
        except NodeBridgeError:
            return None
        target, file_key = css, 'css'
    else:
        return None

    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None:
        return None
    located = _locate_font_family_fix(target, match.start_line)
    if located is None:
        return None
    start_offset, end_offset, original, replacement, starts, generic = located
    patch = _make_patch(
        issue, match, file=file_key, start_offset=start_offset, end_offset=end_offset,
        original_text=original, replacement_text=replacement,
        description=f'Append generic font family: "{generic}".', starts=starts,
    )
    return RecipeResult(
        patches=[patch], strategy_key=_APPEND_GENERIC_FAMILY_STRATEGY,
        context_facts={'generic_family': generic},
        strategy_description=(
            'Preserve the existing concrete font(s); append the known generic-family '
            'fallback inferred from a verified font classification table. Never guess '
            'between serif/sans-serif for an unrecognized font.'
        ),
        environment_extra={'font_classification_version': _FONT_CLASSIFICATION_VERSION},
    )


# --- JavaScript/HTML cross-language: mdaiw-lp/missing-selector-target ------

_MISSING_SELECTOR_MESSAGE_RE = re.compile(r'No element with id "([^"]+)" exists in the HTML document\.')
_RENAME_TO_EQUIVALENT_ID_STRATEGY = 'rename-selector-to-existing-equivalent-id'


def _normalize_id(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', value.lower())


def _find_normalized_equivalent_id(html_ids: set, missing_id: str) -> str | None:
    """Case A only (spec section 9) — an element that is CLEARLY the same
    field under a different id/casing/separator (e.g. "userName",
    "user_name" for a JS selector of "username"). Never a semantic
    guess: a different id that merely LOOKS related (e.g. "user-email")
    does not match. Exactly one candidate required — ambiguity falls
    through to AI Engineer/Requires Input rather than picking one."""
    target_norm = _normalize_id(missing_id)
    if not target_norm:
        return None
    candidates = [hid for hid in html_ids if hid != missing_id and _normalize_id(hid) == target_norm]
    if len(candidates) == 1:
        return candidates[0]
    return None


def _locate_selector_literal(js_source: str, line: int, missing_id: str):
    lines = js_source.split('\n')
    if not line or line < 1 or line > len(lines):
        return None
    line_text = lines[line - 1]
    escaped = re.escape(missing_id)
    patterns = [
        re.compile(r'getElementById\(\s*[\'"](?P<id>' + escaped + r')[\'"]\s*\)'),
        re.compile(r'querySelector\(\s*[\'"]#(?P<id>' + escaped + r')[\'"]\s*\)'),
    ]
    for pattern in patterns:
        found = pattern.search(line_text)
        if found:
            starts = line_starts(js_source)
            line_start = starts[line - 1]
            value_start = line_start + found.start('id')
            value_end = line_start + found.end('id')
            return value_start, value_end, js_source[value_start:value_end], starts
    return None


# --- Shared standalone-JS/embedded-<script> targeting -----------------------
#
# The SAME secure-DOM-repair recipes work for both the standalone
# JavaScript tab and an HTML-embedded <script> block (closure spec
# section 2 — "do not maintain two separate behavioral implementations";
# section 3 — map the repair back to exact HTML offsets before
# publishing). Every existing `_locate_*` helper above/below was already
# written against a plain (text, line_number) pair — `_resolve_js_target`
# supplies that pair from whichever source the issue actually lives in,
# and `_finalize_js_patch` maps the LOCAL offsets those helpers return
# back to real, absolute offsets in the actual editor source ('js' or
# 'html') before a Patch is ever built.


@dataclass(frozen=True)
class _JsTarget:
    local_source: str  # text to run a `_locate_*` helper against
    local_line: int  # issue's line NUMBER WITHIN local_source
    file: str  # 'js' | 'html' — which sources[] key patches ultimately target
    block_content_offset: int  # 0 for standalone; a <script> block's HTML offset otherwise


def _resolve_js_target(issue, sources, match) -> '_JsTarget | None':
    if issue.source_context == 'standalone-javascript':
        js = sources.get('js', '')
        if not js:
            return None
        return _JsTarget(local_source=js, local_line=match.start_line, file='js', block_content_offset=0)

    if issue.source_context == 'html-script-block':
        html = sources.get('html', '')
        if not html or issue.source_block_index is None:
            return None
        blocks = extract_script_blocks(html)
        if issue.source_block_index >= len(blocks):
            return None
        block = blocks[issue.source_block_index]
        # match.start_line/start_column are ABSOLUTE HTML positions —
        # HtmlEmbeddedJavascriptAdapter maps every finding back to real
        # HTML coordinates by construction (see its own module docstring)
        # — convert to a line number LOCAL to the block's own content so
        # every existing `_locate_*` helper (written for plain JS text)
        # works completely unmodified against embedded script content.
        html_starts = line_starts(html)
        absolute_offset = line_col_to_offset(match.start_line, match.start_column, html_starts)
        local_offset = absolute_offset - block['content_offset']
        if local_offset < 0:
            return None
        content_starts = line_starts(block['content'])
        local_line, _local_col = offset_to_line_col(local_offset, content_starts)
        return _JsTarget(
            local_source=block['content'], local_line=local_line, file='html',
            block_content_offset=block['content_offset'],
        )

    return None


def _finalize_js_patch(target: _JsTarget, sources: dict, local_start: int, local_end: int):
    """Shifts a (local_start, local_end) offset pair — computed against
    `target.local_source` by a `_locate_*` helper — into absolute offsets
    in the REAL editor source (`sources[target.file]`), and re-slices
    `original_text` from that real source rather than trusting the local
    copy, so a candidate can never be built against stale/mismatched
    text. A no-op shift for standalone JS (block_content_offset=0)."""
    absolute_start = target.block_content_offset + local_start
    absolute_end = target.block_content_offset + local_end
    real_source = sources[target.file]
    return absolute_start, absolute_end, real_source[absolute_start:absolute_end]


def recipe_missing_selector_target(issue, sources, css_source_type, profile) -> RecipeResult | None:
    """Spec section 9, case A only — the JS selector is rewritten ONLY
    when exactly one existing HTML id is a pure formatting variant of the
    missing one (never a semantic/business guess). Case B (add the
    missing element) and case C (Requires Input) are left to AI Engineer
    reasoning / the existing blocked/requires_configuration path — this
    recipe never fabricates HTML elements.

    Works for both the standalone JavaScript tab and an HTML-embedded
    <script> block — see _resolve_js_target/_finalize_js_patch above."""
    if issue.source_context not in ('standalone-javascript', 'html-script-block'):
        return None
    html = sources.get('html', '')
    if not html:
        return None
    known_ids, duplicate_ids = extract_element_ids(html)

    if issue.source_context == 'standalone-javascript':
        js = sources.get('js', '')
        if not js:
            return None
        fresh = JsConformanceAdapter(known_element_ids=known_ids, duplicate_ids=duplicate_ids).validate(js, profile)
    else:
        fresh = HtmlEmbeddedJavascriptAdapter(known_element_ids=known_ids, duplicate_ids=duplicate_ids).validate(html, profile)

    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None:
        return None

    message_match = _MISSING_SELECTOR_MESSAGE_RE.search(match.message)
    if message_match is None:
        return None
    missing_id = message_match.group(1)

    equivalent_id = _find_normalized_equivalent_id(known_ids, missing_id)
    # STRUCTURAL facts only — the actual missing id (even normalized) is
    # still the customer's own field/variable name and must never be
    # stored (closure spec section 10). A length bucket is enough
    # structure to distinguish "short id" vs "long id" contexts without
    # ever coming close to reconstructing the real identifier, and
    # keeps the memory entry reusable across DIFFERENT customers' pages
    # that hit the identical structural pattern — a raw identifier in
    # the signature would make every customer's occurrence unique and
    # defeat the whole point of a shared, reusable ledger.
    if equivalent_id is None:
        return None
    context_facts = {
        'equivalent_found': True,
        'id_length_bucket': 'short' if len(missing_id) <= 12 else 'long',
    }

    target = _resolve_js_target(issue, sources, match)
    if target is None:
        return None
    located = _locate_selector_literal(target.local_source, target.local_line, missing_id)
    if located is None:
        return None
    local_start, local_end, _local_original, _local_starts = located
    start_offset, end_offset, original = _finalize_js_patch(target, sources, local_start, local_end)
    patch = _make_patch(
        issue, match, file=target.file, start_offset=start_offset, end_offset=end_offset,
        original_text=original, replacement_text=equivalent_id,
        description=f'Update selector to the existing element id "{equivalent_id}".', starts=line_starts(sources[target.file]),
    )
    return RecipeResult(
        patches=[patch], strategy_key=_RENAME_TO_EQUIVALENT_ID_STRATEGY, context_facts=context_facts,
        strategy_description=(
            'The referenced id does not exist, but exactly one HTML element carries a pure '
            'formatting variant of it (case/separator only) — safely repoint the JS selector '
            'to that existing element rather than fabricating a new one.'
        ),
    )


# --- JavaScript: mdaiw-security/innerhtml-assignment (secure DOM repair) ---
#
# Only the two SAFE-BY-CONSTRUCTION mechanical transforms explicitly
# named in the secure-DOM-repair policy (see openai_provider.py's
# _SYSTEM_INSTRUCTIONS for the fuller policy AI Engineer follows for
# everything else): clearing content, and assigning innerHTML from a
# value that provably contains no HTML markup. Anything markup-bearing
# (a template literal/concatenation containing "<", or an RHS this regex
# can't confidently parse) is left to AI Engineer reasoning — this
# recipe never reconstructs DOM structure, only rewrites the sink itself.

_INNERHTML_ASSIGNMENT_RE = re.compile(
    r'(?P<lhs>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.innerHTML\s*=\s*(?P<rhs>[^;\n]*);?'
)
_CLEAR_INNERHTML_STRATEGY = 'innerhtml-clear-to-replacechildren'
_DYNAMIC_TEXT_INNERHTML_STRATEGY = 'innerhtml-dynamic-text-to-textcontent'
_SIMPLE_MARKUP_STRATEGY = 'innerhtml-simple-markup-to-dom-construction'

# Section 4 (closure spec) — a small, deliberately narrow set of "simple
# known markup" tags where ONE element wraps ONE interpolated expression
# and NOTHING else (no attributes, no nested tags, no sibling text) can
# be safely reconstructed with real DOM APIs instead of an HTML string.
# Variable names loosely mirror the spec's own example ("paragraph" for
# <p>) — a real naming COLLISION with an existing local variable of the
# same name would make the replacement fail to PARSE, which the
# authoritative revalidation that always follows would catch and reject
# (candidate-first architecture, unconditional) — this recipe never
# trusts its own generated name to be unique, the same as it never
# trusts anything else about its own output.
_SIMPLE_MARKUP_TAG_VAR_NAMES = {
    'p': 'paragraph', 'span': 'span', 'div': 'div', 'strong': 'strong', 'em': 'em',
    'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
    'li': 'listItem', 'a': 'link', 'button': 'button',
}
_SIMPLE_MARKUP_TEMPLATE_RE = re.compile(
    r'^`<(?P<tag>' + '|'.join(re.escape(tag) for tag in _SIMPLE_MARKUP_TAG_VAR_NAMES) + r')>'
    r'\$\{(?P<expr>[^{}`]+)\}</(?P=tag)>`$'
)


def _locate_innerhtml_fix(js_source: str, line: int):
    lines = js_source.split('\n')
    if not line or line < 1 or line > len(lines):
        return None
    line_text = lines[line - 1]
    match = _INNERHTML_ASSIGNMENT_RE.search(line_text)
    if match is None:
        return None
    starts = line_starts(js_source)
    line_start = starts[line - 1]
    rhs = match.group('rhs').strip()

    if rhs in ('""', "''"):
        # Clear pattern (spec: `el.innerHTML = ""` -> `el.replaceChildren()`)
        # — the whole assignment (including any trailing ";") is replaced.
        whole_start = line_start + match.start()
        whole_end = line_start + match.end()
        original = js_source[whole_start:whole_end]
        has_semicolon = original.rstrip().endswith(';')
        replacement = f"{match.group('lhs')}.replaceChildren()" + (';' if has_semicolon else '')
        return whole_start, whole_end, original, replacement, _CLEAR_INNERHTML_STRATEGY, 'empty_string'

    markup_match = _SIMPLE_MARKUP_TEMPLATE_RE.match(rhs)
    if markup_match:
        # A SINGLE known-safe tag wrapping a SINGLE interpolated
        # expression, nothing else — reconstruct with real DOM APIs
        # instead of ever building an HTML string. Anything even
        # slightly more complex (attributes, nested tags, sibling text,
        # multiple interpolations) does NOT match this pattern and falls
        # through to AI Engineer reasoning below — never guessed at.
        tag = markup_match.group('tag')
        expr = markup_match.group('expr').strip()
        var_name = _SIMPLE_MARKUP_TAG_VAR_NAMES[tag]
        whole_start = line_start + match.start()
        whole_end = line_start + match.end()
        original = js_source[whole_start:whole_end]
        has_semicolon = original.rstrip().endswith(';')
        lhs = match.group('lhs')
        replacement = (
            f'const {var_name} = document.createElement("{tag}");\n'
            f'{var_name}.textContent = {expr};\n'
            f'{lhs}.replaceChildren({var_name})' + (';' if has_semicolon else '')
        )
        return whole_start, whole_end, original, replacement, _SIMPLE_MARKUP_STRATEGY, f'simple_markup_tag_{tag}'

    if '<' in rhs:
        # Markup-bearing or ambiguous — never guess at DOM reconstruction
        # here; AI Engineer reasoning handles this (or marks it for review).
        return None

    # PLAIN_DYNAMIC_TEXT — rewrite ONLY the property name itself, RHS
    # untouched (minimal diff, no risk of mis-copying the expression).
    dot_offset = match.end('lhs')
    property_start = line_start + dot_offset + 1
    property_end = property_start + len('innerHTML')
    original = js_source[property_start:property_end]
    if original != 'innerHTML':
        return None
    return property_start, property_end, original, 'textContent', _DYNAMIC_TEXT_INNERHTML_STRATEGY, 'plain_dynamic_text'


def recipe_unsafe_innerhtml_assignment(issue, sources, css_source_type, profile) -> RecipeResult | None:
    """Secure JavaScript DOM Repair policy — three mechanical, always-
    behavior-preserving transforms: clearing content
    (`innerHTML = ""` -> `replaceChildren()`), assigning plain non-markup
    dynamic text (`innerHTML = value` -> `textContent = value` when
    `value` provably contains no "<"), and reconstructing a SINGLE known-
    safe tag wrapping a SINGLE interpolated expression with real DOM
    APIs (`` innerHTML = `<p>${x}</p>` `` -> `createElement`/`textContent`/
    `replaceChildren`). Anything with attributes, nesting, multiple
    interpolations, or an unlisted tag does not match and falls through
    to AI Engineer reasoning. `outerHTML` is never handled here —
    `textContent`/`replaceChildren()` are not behavior-equivalent
    replacements for it.

    Works for both the standalone JavaScript tab and an HTML-embedded
    <script> block — see _resolve_js_target/_finalize_js_patch above. The
    resulting candidate is ALSO run through the deterministic secure-DOM
    verifier (security_verifier.introduces_new_dangerous_sink) as
    defense-in-depth, even though this recipe is safe by construction and
    the check can never actually trigger for its own output."""
    if issue.source_context not in ('standalone-javascript', 'html-script-block'):
        return None
    if issue.source_context == 'standalone-javascript':
        js = sources.get('js', '')
        if not js:
            return None
        fresh = JsConformanceAdapter().validate(js, profile)
    else:
        html = sources.get('html', '')
        if not html:
            return None
        fresh = HtmlEmbeddedJavascriptAdapter().validate(html, profile)

    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None:
        return None

    target = _resolve_js_target(issue, sources, match)
    if target is None:
        return None
    located = _locate_innerhtml_fix(target.local_source, target.local_line)
    if located is None:
        return None
    local_start, local_end, _local_original, replacement, strategy_key, rhs_shape = located
    start_offset, end_offset, original = _finalize_js_patch(target, sources, local_start, local_end)

    candidate = sources[target.file][:start_offset] + replacement + sources[target.file][end_offset:]
    if introduces_new_dangerous_sink(sources[target.file], candidate):
        return None

    patch = _make_patch(
        issue, match, file=target.file, start_offset=start_offset, end_offset=end_offset,
        original_text=original, replacement_text=replacement,
        description='Replace the unsafe innerHTML sink with a behavior-preserving DOM-safe equivalent.',
        starts=line_starts(sources[target.file]),
    )
    return RecipeResult(
        patches=[patch], strategy_key=strategy_key, context_facts={'rhs_shape': rhs_shape},
        strategy_description=(
            'A mechanical, behavior-preserving secure-DOM rewrite of an unsafe innerHTML sink '
            '(clear-to-replaceChildren, or plain-non-markup-text-to-textContent). Never used for '
            'markup-bearing content, and never swaps one unsafe sink for another.'
        ),
    )


# --- JavaScript: parse-blocking extra closing brace ------------------------
#
# Repair-architecture closure sprint, spec section 2/3 — parser/syntax
# blockers must be repaired BEFORE any downstream semantic/security
# finding can even be reasoned about (ESLint/Espree cannot produce
# further findings past a fatal parse error at all). This handles the
# single, unambiguous case Espree's own tokenizer already proves: a `}`
# character at the EXACT reported line/column that the real parser
# itself calls out as the unexpected token. Espree's tokenizer already
# correctly ignores string/template/regex/comment content when producing
# this diagnosis — this recipe trusts that diagnosis for WHERE the extra
# brace is, then lets the same candidate-first revalidation every other
# repair in this codebase goes through prove whether removing it actually
# fixes the parse error (never assumed correct from a local heuristic
# alone). A "missing" closing brace (reported as unexpected end-of-input,
# not a `}` token) is a materially different, less unambiguous case and
# is deliberately left to AI Engineer reasoning.

_JS_UNEXPECTED_CLOSING_BRACE_RE = re.compile(r'Unexpected token\s*\}')
_JS_EXTRA_CLOSING_BRACE_STRATEGY = 'js-extra-closing-brace-remove'


def recipe_javascript_extra_closing_brace(issue, sources, css_source_type, profile) -> RecipeResult | None:
    if issue.source_context not in ('standalone-javascript', 'html-script-block'):
        return None
    if issue.source_context == 'standalone-javascript':
        js = sources.get('js', '')
        if not js:
            return None
        fresh = JsConformanceAdapter().validate(js, profile)
    else:
        html = sources.get('html', '')
        if not html:
            return None
        fresh = HtmlEmbeddedJavascriptAdapter().validate(html, profile)

    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None:
        return None
    if not _JS_UNEXPECTED_CLOSING_BRACE_RE.search(match.message):
        return None

    target = _resolve_js_target(issue, sources, match)
    if target is None:
        return None

    local_starts = line_starts(target.local_source)
    local_offset = line_col_to_offset(target.local_line, match.start_column, local_starts)
    if local_offset >= len(target.local_source) or target.local_source[local_offset] != '}':
        # The reported coordinate no longer points at a genuine `}` in
        # the current source — never guess a different location.
        return None

    start_offset, end_offset, original = _finalize_js_patch(target, sources, local_offset, local_offset + 1)
    if original != '}':
        return None

    patch = _make_patch(
        issue, match, file=target.file, start_offset=start_offset, end_offset=end_offset,
        original_text=original, replacement_text='',
        description='Remove the extra closing brace the parser identified as unexpected.',
        starts=line_starts(sources[target.file]),
    )
    return RecipeResult(
        patches=[patch], strategy_key=_JS_EXTRA_CLOSING_BRACE_STRATEGY,
        context_facts={'defect': 'extra_closing_brace'},
        strategy_description=(
            "The parser's own tokenizer identified an unexpected `}` at an exact position — "
            'removing exactly that character is attempted, then re-validated like any other candidate.'
        ),
    )


# rule_id -> recipe function. Each function ALSO records its own
# strategy_key/context_facts (used by the caller for Verified Repair
# Memory bookkeeping) rather than just returning a bare Patch.
_RECIPES = {
    'charset-declared-late': recipe_charset_declared_late,
    'stylelint:font-family-no-missing-generic-family-keyword': recipe_missing_generic_font_family,
    'mdaiw-lp/missing-selector-target': recipe_missing_selector_target,
    'mdaiw-security/innerhtml-assignment': recipe_unsafe_innerhtml_assignment,
    'javascript:parse-error': recipe_javascript_extra_closing_brace,
}


def generate_recipe_result(issue, sources, css_source_type, profile) -> RecipeResult | None:
    recipe = _RECIPES.get(issue.rule_id)
    if recipe is None:
        return None
    try:
        return recipe(issue, sources, css_source_type, profile)
    except NodeBridgeError:
        return None


def known_rule_ids() -> frozenset:
    return frozenset(_RECIPES.keys())


__all__ = ['RecipeResult', 'generate_recipe_result', 'known_rule_ids']

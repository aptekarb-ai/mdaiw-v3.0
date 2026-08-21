"""Shared HTML-side context extraction for JavaScript / landing-page
cross-language checks (see validators_node/js_engine.mjs's
`mdaiw-lp/missing-selector-target` rule and html_inline_event_handler.py's
missing-function-reference check). Both extractors here are purely static
(HTMLParser / regex) — never executed, never AST-based on the HTML side.
"""

import re
from html.parser import HTMLParser

from .embedded_css import line_col_to_offset, line_starts

# <script> types that are real, browser-runnable JavaScript. Empty/absent
# type defaults to JavaScript per the HTML spec. 'module' is JavaScript
# too, just with a different sourceType. Anything else (application/json,
# application/ld+json, importmap, text/template, ...) is real markup the
# page depends on but is never parsed as a program by the browser — see
# PLAIN_JS_TYPES' callers for how those are skipped rather than validated.
PLAIN_JS_TYPES = frozenset({'', 'text/javascript', 'application/javascript'})
MODULE_JS_TYPE = 'module'


class _ElementIdExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        element_id = attr_dict.get('id')
        if element_id and element_id.strip():
            self.ids.append(element_id.strip())


class _ElementClassExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.classes: set[str] = set()

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        class_attr = attr_dict.get('class')
        if class_attr:
            self.classes.update(token for token in class_attr.split() if token)


def extract_element_classes(html: str) -> set[str]:
    """Tool-Grounded AI Engineer sprint, spec section 14 — the HTML-side
    half of the CSS-selector-to-HTML-target cross-language check (see
    validation/engine.py::_check_css_selectors_reference_html). Same
    HTMLParser-based, best-effort, never-raises posture as
    extract_element_ids above."""
    if not html or not html.strip():
        return set()
    extractor = _ElementClassExtractor()
    try:
        extractor.feed(html)
        extractor.close()
    except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
        pass
    return extractor.classes


def extract_element_ids(html: str) -> tuple[set[str], set[str]]:
    """Returns (all_ids, duplicate_ids) found in `html`. Malformed HTML
    yields whatever HTMLParser could recover before failing — never
    raises (HTML syntax errors are reported by the HTML adapters, not
    here)."""
    if not html or not html.strip():
        return set(), set()
    extractor = _ElementIdExtractor()
    try:
        extractor.feed(html)
        extractor.close()
    except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
        pass
    seen: set[str] = set()
    duplicates: set[str] = set()
    for element_id in extractor.ids:
        if element_id in seen:
            duplicates.add(element_id)
        seen.add(element_id)
    return seen, duplicates


# Deliberately regex-based, not AST-based — a cheap, best-effort, over-
# inclusive textual signal only (a false negative here just means a real
# function isn't recognized as declared; it is never used to assert that
# anything IS invalid on its own, only to decide whether NOT to flag an
# inline handler's call as unresolved — see html_inline_event_handler.py).
_FUNCTION_DECL_RE = re.compile(r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\(')
_FUNCTION_EXPR_ASSIGN_RE = re.compile(
    r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)',
)
_WINDOW_ASSIGN_RE = re.compile(r'\bwindow\.([A-Za-z_$][\w$]*)\s*=\s*function\b')


def extract_top_level_function_names(js_sources: list[str]) -> set[str]:
    """Scans every JavaScript unit already part of this request (standalone
    JS tab + every embedded <script> block) for names that would plausibly
    satisfy an inline event-handler's call."""
    names: set[str] = set()
    for source in js_sources:
        if not source:
            continue
        names.update(_FUNCTION_DECL_RE.findall(source))
        names.update(_FUNCTION_EXPR_ASSIGN_RE.findall(source))
        names.update(_WINDOW_ASSIGN_RE.findall(source))
    return names


class _ScriptBlockExtractor(HTMLParser):
    def __init__(self, source: str, starts: list[int]):
        super().__init__(convert_charrefs=False)
        self._source = source
        self._starts = starts
        self._pending: dict | None = None
        self.found: list[dict] = []  # {content, content_offset, line, column, type, has_src}

    def handle_starttag(self, tag, attrs):
        if tag != 'script':
            return
        attr_dict = dict(attrs)
        tag_line, tag_col0 = self.getpos()
        tag_offset = line_col_to_offset(tag_line, tag_col0 + 1, self._starts)
        raw_tag_text = self.get_starttag_text() or ''
        self._pending = {
            'content_offset': tag_offset + len(raw_tag_text),
            'line': tag_line,
            'column': tag_col0 + 1,
            'type': (attr_dict.get('type') or '').strip().lower(),
            'has_src': attr_dict.get('src') is not None,
        }

    def handle_startendtag(self, tag, attrs):
        # A self-closed <script ... /> (always true for a script with a
        # `src` attribute and no inline body) never reaches handle_endtag.
        if tag != 'script':
            return
        self.handle_starttag(tag, attrs)
        if self._pending is not None:
            self.found.append({**self._pending, 'content': ''})
            self._pending = None

    def handle_endtag(self, tag):
        if tag != 'script' or self._pending is None:
            return
        end_line, end_col0 = self.getpos()
        end_offset = line_col_to_offset(end_line, end_col0 + 1, self._starts)
        content = self._source[self._pending['content_offset']:end_offset]
        self.found.append({**self._pending, 'content': content})
        self._pending = None


def extract_script_blocks(html: str) -> list[dict]:
    """Every `<script>...</script>` block in `html`, in document order, as
    `{content, content_offset, line, column, type, has_src}`. `content` is
    the raw text between the tags (empty for a self-closing or external
    `<script src="...">` with no inline body). Never raises — malformed
    HTML yields whatever HTMLParser recovered before failing; HTML syntax
    errors are reported by the HTML adapters, not here."""
    if not html or not html.strip():
        return []
    starts = line_starts(html)
    extractor = _ScriptBlockExtractor(html, starts)
    try:
        extractor.feed(html)
        extractor.close()
    except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
        pass
    return extractor.found

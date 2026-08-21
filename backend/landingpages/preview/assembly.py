"""Deterministic, parser-aware LP document assembly for Preview.

Builds ONE standalone HTML document from the current editor state. Never
string-concatenates HTML — always parses with html5lib (already a project
dependency, used by validation/adapters/html_conformance.py) so an existing
`<html>`/`<head>`/`<body>` is reused rather than duplicated, and a bare
fragment is safely normalized into one by html5lib's own HTML5 tree
construction algorithm.

The returned string is embedded by views.py into the outer shell's
`srcdoc="..."` attribute — this module has no opinion about that boundary,
it only guarantees the returned string is a single, well-formed, self-
contained HTML document.
"""

import re
from dataclasses import dataclass

import html5lib

from .ampscript_preview import extract_variables, substitute
from .cdn_policy import classify_url

_RAW_TEXT_CLOSERS = {'script': '</script', 'style': '</style'}
_AMPSCRIPT_NOTICE = (
    'AMPscript preview is simulated. Salesforce Marketing Cloud is not being executed.'
)


@dataclass(frozen=True)
class AssemblyResult:
    html: str
    ampscript_simulated: bool


class AssemblyError(Exception):
    """Raised only for a genuinely unassemblable input (the HTML itself
    could not be parsed at all) — never for a merely imperfect document,
    which html5lib normalizes rather than rejects."""


def _escape_raw_text_closer(tag: str, text: str) -> str:
    if not text:
        return text
    closer = _RAW_TEXT_CLOSERS[tag]
    pattern = re.compile(re.escape(closer), re.IGNORECASE)
    # Breaks up a literal "</script"/"</style" inside embedded text so the
    # browser's HTML tokenizer can never read it as closing the element
    # early. For <script>, "<\/script" is valid JS and parses to the exact
    # same string at runtime. This is an HTML-correctness fix, not a
    # sandboxing boundary — containment comes from the iframe sandbox
    # (see preview/__init__.py), not from this escaping.
    return pattern.sub(lambda m: m.group(0)[:1] + '\\' + m.group(0)[1:], text)


def _strip_dangerous_references(tree) -> None:
    for element in tree.iter():
        tag = element.tag
        for attr in ('src', 'href'):
            value = element.get(attr)
            if value is None:
                continue
            allow_data = tag == 'img' and attr == 'src'
            if classify_url(value, allow_data=allow_data) == 'blocked':
                del element.attrib[attr]


def assemble_document(
    *,
    html_source: str,
    css_source: str,
    js_source: str,
    ampscript_source: str,
    ampscript_mock_values: dict[str, str] | None,
    inner_csp: str,
) -> AssemblyResult:
    html_source = html_source or ''
    css_source = css_source or ''
    js_source = js_source or ''
    ampscript_source = ampscript_source or ''

    # AMPscript simulation runs on the raw text BEFORE HTML parsing — the
    # `%%[ ]%%`/`%%=...=%%` delimiters are not HTML and html5lib treats
    # them as inert text, so simulating first is both correct and simpler
    # than trying to locate them inside a parsed tree.
    variables = extract_variables(ampscript_source, ampscript_mock_values)
    variables = extract_variables(html_source, variables)
    html_simulated, _used_from_html = substitute(html_source, variables)
    ampscript_active = html_simulated != html_source or bool(ampscript_source.strip())

    try:
        tree = html5lib.parse(html_simulated, treebuilder='etree', namespaceHTMLElements=False)
    except Exception as exc:  # noqa: BLE001 - html5lib is non-strict; a raise here is a genuine parser failure
        raise AssemblyError('The HTML could not be parsed for preview.') from exc

    head = tree.find('head')
    body = tree.find('body')
    if head is None or body is None:
        raise AssemblyError('The assembled document is missing <head> or <body>.')

    _strip_dangerous_references(tree)

    meta_csp = tree.makeelement('meta', {'http-equiv': 'Content-Security-Policy', 'content': inner_csp})
    head.insert(0, meta_csp)

    if css_source.strip():
        style_el = tree.makeelement('style', {})
        style_el.text = _escape_raw_text_closer('style', css_source)
        head.append(style_el)

    if ampscript_active:
        notice = tree.makeelement('div', {
            'style': (
                'position:fixed;top:0;left:0;right:0;z-index:2147483647;'
                'background:#FFFAEB;color:#B54708;border-bottom:1px solid #B54708;'
                'font:12px/1.4 -apple-system,Segoe UI,Arial,sans-serif;'
                'padding:6px 12px;text-align:center;'
            ),
        })
        notice.text = _AMPSCRIPT_NOTICE
        body.insert(0, notice)

    if js_source.strip():
        script_el = tree.makeelement('script', {})
        script_el.text = _escape_raw_text_closer('script', js_source)
        body.append(script_el)

    serialized = html5lib.serialize(
        tree, tree='etree', omit_optional_tags=False, quote_attr_values='always',
    )
    return AssemblyResult(html='<!DOCTYPE html>\n' + serialized, ampscript_simulated=ampscript_active)


__all__ = ['assemble_document', 'AssemblyResult', 'AssemblyError']

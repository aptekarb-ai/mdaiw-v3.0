"""Per-rule safe-fix patch generators. Every function here re-runs the
REAL validator adapter that originally produced the issue, against the
CURRENT submitted source, and only proceeds when a freshly-computed issue
has the exact same fingerprint as the persisted one — see this package's
__init__.py docstring for why that is the sole trust boundary.

Adding a rule to `_HANDLERS` is the only thing that makes it eligible for
Apply Safe Fixes; nothing here reads `ValidationIssue.auto_fixable`.
"""

import re
import uuid
from dataclasses import dataclass

from ..validation.adapters.css_conformance import CssConformanceAdapter
from ..validation.adapters.css_less import LessAdapter
from ..validation.adapters.css_scss_sass import ScssSassAdapter
from ..validation.adapters.html_embedded_ampscript import HtmlEmbeddedAmpscriptAdapter
from ..validation.adapters.html_inline_style import HtmlInlineStyleAdapter
from ..validation.adapters.html_seo import HtmlSeoAdapter
from ..validation.adapters.html_lexical import HtmlTagStackAdapter
from ..validation.adapters.html_structure import HtmlStructureAdapter
from ..validation.adapters.html_style_block import HtmlStyleBlockAdapter
from ..validation.adapters.ampscript_conformance import AmpscriptConformanceAdapter
from ..validation.ampscript import analyze
from ..validation.ampscript.blocks import find_regions
from ..validation.node_bridge import NodeBridgeError
from .offsets import line_col_to_offset, line_starts, offset_to_line_col


@dataclass(frozen=True)
class Patch:
    fix_id: str
    issue_id: int
    fingerprint: str
    language: str
    source_context: str
    file: str  # which sources[] key this patch targets: 'html' | 'css' | 'ampscript'
    start_offset: int
    end_offset: int
    start_line: int
    start_column: int
    end_line: int
    end_column: int
    original_text: str
    replacement_text: str
    description: str
    risk: str
    confidence: str


def _find_by_fingerprint(fresh_issues, fingerprint):
    for candidate in fresh_issues:
        if candidate.fingerprint == fingerprint:
            return candidate
    return None


def _make_patch(issue, match, *, file, start_offset, end_offset, original_text, replacement_text, description, starts):
    start_line, start_column = offset_to_line_col(start_offset, starts)
    end_line, end_column = offset_to_line_col(end_offset, starts)
    return Patch(
        fix_id=str(uuid.uuid4()),
        issue_id=issue.id,
        fingerprint=issue.fingerprint,
        language=match.language,
        source_context=match.source_context,
        file=file,
        start_offset=start_offset,
        end_offset=end_offset,
        start_line=start_line,
        start_column=start_column,
        end_line=end_line,
        end_column=end_column,
        original_text=original_text,
        replacement_text=replacement_text,
        description=description,
        risk=match.risk,
        confidence=match.confidence,
    )


# --- HTML -------------------------------------------------------------------

def _fix_missing_doctype(issue, sources, css_source_type, profile):
    html = sources.get('html', '')
    fresh = HtmlStructureAdapter().validate(html, profile)
    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None:
        return None
    starts = line_starts(html)
    return _make_patch(
        issue, match, file='html', start_offset=0, end_offset=0,
        original_text='', replacement_text='<!DOCTYPE html>\n',
        description='Insert missing <!DOCTYPE html>.', starts=starts,
    )


def _fix_unclosed_tag(issue, sources, css_source_type, profile):
    html = sources.get('html', '')
    fresh = HtmlStructureAdapter().validate(html, profile)
    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None or match.requires_manual_review or not match.deterministic_fix:
        return None
    fix = match.deterministic_fix
    if fix.get('action') != 'insert_closing_tag' or not fix.get('tag'):
        return None
    starts = line_starts(html)
    offset = line_col_to_offset(fix['before_line'], fix['before_column'], starts)
    return _make_patch(
        issue, match, file='html', start_offset=offset, end_offset=offset,
        original_text='', replacement_text=fix['tag'],
        description=f"Insert missing closing tag: {fix['tag']}.", starts=starts,
    )


def _make_remove_orphan_closing_tag_fixer(adapter_cls):
    """Repair-architecture closure sprint, spec section 4 — a closing tag
    the tag-stack has already PROVEN has no matching opener anywhere is
    unambiguous by construction: there is no orphan to choose between,
    unlike `_fix_unclosed_tag`'s case. Safe to remove outright."""
    def handler(issue, sources, css_source_type, profile):
        html = sources.get('html', '')
        fresh = adapter_cls().validate(html, profile)
        match = _find_by_fingerprint(fresh, issue.fingerprint)
        if match is None or match.requires_manual_review or not match.deterministic_fix:
            return None
        fix = match.deterministic_fix
        if fix.get('action') != 'remove_closing_tag' or not fix.get('tag'):
            return None
        starts = line_starts(html)
        start_offset = line_col_to_offset(fix['start_line'], fix['start_column'], starts)
        closing_tag_match = _CLOSING_TAG_AT_RE.match(html, start_offset)
        if closing_tag_match is None or closing_tag_match.group(1).lower() != fix['tag'].lower():
            # The live source no longer matches what the adapter proved a
            # moment ago (e.g. concurrent edit) — never guess a span.
            return None
        return _make_patch(
            issue, match, file='html', start_offset=closing_tag_match.start(), end_offset=closing_tag_match.end(),
            original_text=closing_tag_match.group(0), replacement_text='',
            description=f"Remove the orphan closing tag </{fix['tag']}> (proven to have no matching opening tag).",
            starts=starts,
        )
    return handler


_CLOSING_TAG_AT_RE = re.compile(r'</\s*([A-Za-z][A-Za-z0-9-]*)\s*>')
_fix_unexpected_closing_tag = _make_remove_orphan_closing_tag_fixer(HtmlStructureAdapter)
_fix_unexpected_closing_tag_independent = _make_remove_orphan_closing_tag_fixer(HtmlTagStackAdapter)


_HEAD_TAG_RE = re.compile(r'<head\b[^>]*>', re.IGNORECASE)


def _make_missing_meta_fixer(meta_html, description):
    def handler(issue, sources, css_source_type, profile):
        html = sources.get('html', '')
        fresh = HtmlSeoAdapter().validate(html, profile)
        match = _find_by_fingerprint(fresh, issue.fingerprint)
        if match is None:
            return None
        head_match = _HEAD_TAG_RE.search(html)
        if head_match is None:
            return None
        offset = head_match.end()
        starts = line_starts(html)
        return _make_patch(
            issue, match, file='html', start_offset=offset, end_offset=offset,
            original_text='', replacement_text='\n' + meta_html,
            description=description, starts=starts,
        )
    return handler


_fix_missing_charset = _make_missing_meta_fixer(
    '<meta charset="utf-8">', 'Insert missing <meta charset="utf-8">.',
)
_fix_missing_viewport = _make_missing_meta_fixer(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    'Insert missing viewport meta tag.',
)


# --- CSS / SCSS / Sass / LESS zero-unit -------------------------------------

_ZERO_UNIT_RE = re.compile(r'\b0(?:px|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|q)\b', re.IGNORECASE)


def _locate_zero_unit(target_source, line, column):
    lines = target_source.split('\n')
    if not line or line < 1 or line > len(lines):
        return None
    line_text = lines[line - 1]
    matches = list(_ZERO_UNIT_RE.finditer(line_text))
    if not matches:
        return None
    chosen = None
    if column:
        for candidate in matches:
            if candidate.start() + 1 == column:
                chosen = candidate
                break
    if chosen is None:
        # Ambiguous — only fall back to "the only candidate on the line"
        # when there is exactly one; never guess between several.
        if len(matches) == 1:
            chosen = matches[0]
        else:
            return None
    starts = line_starts(target_source)
    line_start = starts[line - 1]
    return line_start + chosen.start(), line_start + chosen.end(), chosen.group(0), starts


def _fix_zero_unit(issue, sources, css_source_type, profile):
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
    located = _locate_zero_unit(target, match.start_line, match.start_column)
    if located is None:
        return None
    start_offset, end_offset, original, starts = located
    return _make_patch(
        issue, match, file=file_key, start_offset=start_offset, end_offset=end_offset,
        original_text=original, replacement_text='0',
        description=f'Change "{original}" to "0" — a zero length does not need a unit.', starts=starts,
    )


# --- AMPscript ---------------------------------------------------------------

_UNRESOLVED_CONTROL_RULES = frozenset({
    'ampscript:if-without-endif', 'ampscript:for-without-next', 'ampscript:while-without-endwhile',
})


def _fix_ampscript_endif(issue, sources, css_source_type, profile):
    is_embedded = issue.source_context == 'html-embedded-ampscript'
    target = sources.get('html', '') if is_embedded else sources.get('ampscript', '')
    fresh = (HtmlEmbeddedAmpscriptAdapter() if is_embedded else AmpscriptConformanceAdapter()).validate(target, profile)
    match = _find_by_fingerprint(fresh, issue.fingerprint)
    if match is None or match.source_block_index is None:
        return None

    regions, _delimiter_issues = find_regions(target)
    region = next((r for r in regions if r.index == match.source_block_index), None)
    if region is None:
        return None

    # Only safe when this region has EXACTLY one unresolved control
    # structure, and it is this IF — a nested unclosed FOR/WHILE inside
    # the same region means the exact insertion point can't be proven.
    analysis = analyze(target)
    region_control_issues = [
        candidate for candidate in analysis.issues
        if candidate.region_index == region.index and candidate.rule_id in _UNRESOLVED_CONTROL_RULES
    ]
    if len(region_control_issues) != 1 or region_control_issues[0].rule_id != 'ampscript:if-without-endif':
        return None

    starts = line_starts(target)
    offset = region.inner_end
    file_key = 'html' if is_embedded else 'ampscript'
    return _make_patch(
        issue, match, file=file_key, start_offset=offset, end_offset=offset,
        original_text='', replacement_text='ENDIF\n',
        description='Insert missing ENDIF.', starts=starts,
    )


_HANDLERS = {
    'missing-doctype': _fix_missing_doctype,
    'unclosed-tag': _fix_unclosed_tag,
    'unexpected-closing-tag': _fix_unexpected_closing_tag,
    'unexpected-closing-tag-independent': _fix_unexpected_closing_tag_independent,
    'missing-charset': _fix_missing_charset,
    'missing-viewport': _fix_missing_viewport,
    'stylelint:length-zero-no-unit': _fix_zero_unit,
    'ampscript:if-without-endif': _fix_ampscript_endif,
}


def generate_patch(issue, sources, css_source_type, profile) -> Patch | None:
    handler = _HANDLERS.get(issue.rule_id)
    if handler is None:
        return None
    try:
        return handler(issue, sources, css_source_type, profile)
    except NodeBridgeError:
        return None

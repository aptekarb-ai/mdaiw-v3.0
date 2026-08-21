"""Validation orchestrator — Sprint 1C (HTML) / Sprint 1D (CSS) / JS engine
sprint (JavaScript).

Runs every enabled adapter for each submitted language, merges their
output into the unified issue schema, and returns a ValidationRunResult
(issues + per-engine status). A single adapter crashing never discards
results from the others — each adapter call is individually timed and
exception-guarded, and this applies identically across languages: a CSS
engine failure cannot delete HTML findings, and vice versa.

`ts` is permanently deprecated (TypeScript was replaced by AMPscript) and
is accepted-but-ignored, never mapped onto `ampscript`.
"""

import dataclasses
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor

from .adapters.ampscript_conformance import AmpscriptConformanceAdapter
from .adapters.css_conformance import CssConformanceAdapter
from .adapters.css_less import LessAdapter
from .adapters.css_scss_sass import ScssSassAdapter
from .adapters.html_accessibility import HtmlAccessibilityStaticAdapter
from .adapters.html_conformance import HtmlConformanceAdapter
from .adapters.html_embedded_ampscript import HtmlEmbeddedAmpscriptAdapter
from .adapters.html_embedded_javascript import HtmlEmbeddedJavascriptAdapter
from .adapters.html_external_script import HtmlExternalScriptAdapter
from .adapters.html_external_stylesheet import HtmlExternalStylesheetAdapter
from .adapters.html_inline_event_handler import HtmlInlineEventHandlerAdapter
from .adapters.html_inline_style import HtmlInlineStyleAdapter
from .adapters.html_js_context import (
    MODULE_JS_TYPE,
    PLAIN_JS_TYPES,
    extract_element_classes,
    extract_element_ids,
    extract_script_blocks,
    extract_top_level_function_names,
)
from .adapters.html_lexical import HtmlLexicalAdapter, HtmlTagStackAdapter
from .adapters.html_responsive import HtmlResponsiveAdapter
from .adapters.html_seo import HtmlSeoAdapter
from .adapters.html_structure import HtmlStructureAdapter
from .adapters.html_style_block import HtmlStyleBlockAdapter
from .adapters.html_nu import HtmlNuAdapter
from .adapters.js_conformance import JsConformanceAdapter
from .java_bridge import JavaBridgeError
from .node_bridge import NodeBridgeError
from ..fixes.shell_recovery import classify_shell_corruption
from .profiles import (
    DEFAULT_CSS_SOURCE_TYPE,
    DEFAULT_PROFILE,
    DEFAULT_SCOPE,
    CssSourceType,
    ValidationScope,
    apply_severity_override,
    is_known_css_source_type,
    is_known_profile,
    is_known_scope,
)
from .schema import (
    CONFIDENCE_DEFINITE,
    CONFIDENCE_LIKELY,
    EngineStatus,
    SEVERITY_ERROR,
    SEVERITY_WARNING,
    ValidationIssueData,
    ValidationRunResult,
    severity_rank,
)

logger = logging.getLogger(__name__)

# Resource limits. Input character-length is enforced earlier, at the
# request-serializer layer (a clean 400 rather than partial processing) —
# these bound what happens once a request has already passed that check.
MAX_LINE_COUNT = 20_000
MAX_ISSUES = 300
GLOBAL_TIME_BUDGET_SECONDS = 8.0
_MAX_EXCERPT_LENGTH = 200

_CONFIDENCE_RANK = {'definite': 0, 'likely': 1, 'possible': 2}

_HTML_ADAPTERS = (
    # PASS A — raw-text lexical scan for malformed opening tags. Runs
    # first and independent of every other adapter's parser/DOM, so a
    # tag missing its own ">" is still reported even when that same
    # defect makes html5lib/html.parser silently swallow LATER tags into
    # bogus attribute soup (or, via RCDATA on an unclosed <title>, makes
    # them invisible to a spec-correct tokenizer entirely).
    HtmlLexicalAdapter(),
    # PASS B — the W3C/WHATWG reference conformance checker (Nu Html
    # Checker), an authoritative, standards-grounded parser independent of
    # html.parser's own browser-style recovery — isolated exactly like
    # every other subprocess-backed engine (an unavailable/timed-out Java
    # runtime never removes any other engine's findings, see
    # java_bridge.py).
    HtmlNuAdapter(),
    HtmlConformanceAdapter(),
    HtmlStructureAdapter(),
    # PASS C — independent tag-stack backstop for HtmlStructureAdapter,
    # registered right after it so the cross-engine merge (_dedupe below)
    # keeps HtmlStructureAdapter's original finding whenever both agree,
    # and falls back to this one only where html.parser's own recovery
    # made it blind to an element entirely (see html_lexical.py).
    HtmlTagStackAdapter(),
    HtmlAccessibilityStaticAdapter(),
    HtmlSeoAdapter(),
    HtmlResponsiveAdapter(),
    # CSS embedded directly in the HTML source (Sprint CSS-A) — these run
    # whenever HTML itself runs (html scope and complete scope alike),
    # never as part of the separate standalone CSS-tab adapters below,
    # per "HTML-only CSS validation applies only to CSS embedded in the
    # HTML source."
    HtmlInlineStyleAdapter(),
    HtmlStyleBlockAdapter(),
    # AMPscript embedded directly in the HTML source (%%[ ]%% / %%= =%%) —
    # same reasoning as the two CSS adapters above: runs whenever HTML
    # runs, entirely separate from the dedicated AMPscript-tab adapter
    # below, so the same source is never validated twice.
    HtmlEmbeddedAmpscriptAdapter(),
)
_CSS_ADAPTERS = (
    CssConformanceAdapter(),
)
_AMPSCRIPT_ADAPTERS = (
    AmpscriptConformanceAdapter(),
)
# Runs only under Complete LP scope (Sprint CSS-B / JS engine sprint) —
# both need `project` context the generic _run_adapters loop doesn't
# provide, so engine.run() calls them directly rather than listing them in
# _HTML_ADAPTERS.
_EXTERNAL_STYLESHEET_ADAPTER = HtmlExternalStylesheetAdapter()
_EXTERNAL_SCRIPT_ADAPTER = HtmlExternalScriptAdapter()
# TypeScript is deprecated (replaced by AMPscript, see profiles.py) and
# never gets a real engine again — kept as an empty tuple, not removed
# entirely, so the scope-dispatch table below has one stable shape
# regardless of which engines exist.
_TYPESCRIPT_ADAPTERS: tuple = ()


def _truncate_lines(source: str) -> tuple[str, bool]:
    lines = source.split('\n')
    if len(lines) <= MAX_LINE_COUNT:
        return source, False
    return '\n'.join(lines[:MAX_LINE_COUNT]), True


def _excerpt_for(source_lines: list[str], line: int) -> str:
    if line and 1 <= line <= len(source_lines):
        return source_lines[line - 1].strip()[:_MAX_EXCERPT_LENGTH]
    return ''


def _run_adapters(
    adapters: tuple, source: str, profile: str, deadline: float,
) -> tuple[list[ValidationIssueData], list[EngineStatus]]:
    issues: list[ValidationIssueData] = []
    statuses: list[EngineStatus] = []
    source_lines = source.split('\n')

    for adapter in adapters:
        if time.perf_counter() > deadline:
            statuses.append(EngineStatus(
                engine_name=adapter.engine_name,
                success=False,
                duration_ms=0,
                issue_count=0,
                message='Skipped — validation time budget exceeded.',
            ))
            continue

        started_at = time.perf_counter()
        try:
            raw_issues = adapter.validate(source, profile)
        except (NodeBridgeError, JavaBridgeError) as exc:
            # NodeBridgeError/JavaBridgeError messages are explicitly
            # guaranteed safe to surface (never a stack trace, path, or
            # stderr content — see node_bridge.py/java_bridge.py's module
            # docstrings) and are specific per failure mode (timeout /
            # engine unavailable / output-limit / unexpected exit /
            # malformed output) — preserving it here is what lets the
            # frontend distinguish "Compilation blocked by source errors"
            # from "Compiler unavailable" from "Compilation timed out" etc.,
            # instead of every failure collapsing into one generic status.
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            logger.exception('landingpages.validate.adapter_failed engine=%s', adapter.engine_name)
            statuses.append(EngineStatus(
                engine_name=adapter.engine_name,
                success=False,
                duration_ms=duration_ms,
                issue_count=0,
                message=str(exc),
            ))
            continue
        except Exception:  # noqa: BLE001 - never let one adapter's crash take down the others; message safety is NOT guaranteed for a non-NodeBridgeError exception, so it is never surfaced
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            logger.exception('landingpages.validate.adapter_failed engine=%s', adapter.engine_name)
            statuses.append(EngineStatus(
                engine_name=adapter.engine_name,
                success=False,
                duration_ms=duration_ms,
                issue_count=0,
                message='This check could not complete.',
            ))
            continue

        duration_ms = int((time.perf_counter() - started_at) * 1000)
        enriched = [
            dataclasses.replace(
                issue,
                code_excerpt=issue.code_excerpt or _excerpt_for(source_lines, issue.start_line),
                severity=apply_severity_override(issue.rule_id, issue.severity, profile),
            )
            for issue in raw_issues
        ]
        issues.extend(enriched)
        statuses.append(EngineStatus(
            engine_name=adapter.engine_name,
            success=True,
            duration_ms=duration_ms,
            issue_count=len(enriched),
        ))

    return issues, statuses


def _tag_html_shell_corruption_root_cause(issues: list[ValidationIssueData], html: str) -> list[ValidationIssueData]:
    """Tool-Grounded AI Engineer sprint, spec section 4/5 — structured
    diagnostics contract's `root_cause_id` field. A corrupted document
    shell (duplicate/misplaced/premature `<html>`/`<head>`/`<body>`, or
    real content before the opening `<html>` tag) is not a set of
    independent HTML findings — it is ONE structural root cause that
    produces a whole cascade of secondary parser complaints (see
    fixes/shell_recovery.py's own module docstring, which this reuses
    directly rather than re-deriving). Every 'html'-language issue in
    this report is tagged with the SAME deterministic root_cause_id when
    a shell corruption is classified, so a consumer (AI Engineer's own
    context, or the frontend) can group them instead of treating each as
    an unrelated finding — exactly the grouping fixes/iterative.py's
    repair loop already acts on internally (PASS 1), now also exposed on
    the diagnostics themselves. Never applied to css/javascript/ampscript
    issues — a shell corruption's cascade is HTML-parser-specific."""
    corruption = classify_shell_corruption(html or '')
    if not corruption:
        return issues
    root_cause_id = 'html-shell-corruption:' + ','.join(sorted(corruption))
    return [
        dataclasses.replace(issue, root_cause_id=root_cause_id) if issue.language == 'html' else issue
        for issue in issues
    ]


# Tool-Grounded AI Engineer sprint, spec section 14 — Complete LP cross-
# language checks. Deliberately regex-based, not CSS-AST-based: only the
# text immediately before an unescaped `{` is ever scanned (a rule's
# SELECTOR, never a declaration VALUE), so a hex color (`color: #fff`)
# or a `url(#fragment)` inside a declaration block is structurally
# excluded rather than pattern-matched around. An at-rule prelude
# (`@media ...`, `@keyframes name`) is skipped entirely rather than
# guessed at — false negatives here are acceptable (a selector this
# misses just isn't cross-checked); a false POSITIVE would incorrectly
# flag valid CSS as "missing target," which this project treats as the
# worse failure mode for an advisory-only check.
_SELECTOR_PRELUDE_RE = re.compile(r'([^{}]+)\{')
_ATTRIBUTE_SELECTOR_RE = re.compile(r'\[[^\]]*\]')
_ID_SELECTOR_TOKEN_RE = re.compile(r'#([A-Za-z_][\w-]*)')
_CLASS_SELECTOR_TOKEN_RE = re.compile(r'\.([A-Za-z_][\w-]*)')


def _extract_css_selector_targets(css: str) -> list[tuple[str, str, int]]:
    targets = []
    for match in _SELECTOR_PRELUDE_RE.finditer(css):
        prelude = match.group(1)
        if not prelude.strip() or prelude.strip().startswith('@'):
            continue
        line = css.count('\n', 0, match.start(1)) + 1
        # Attribute selectors (`[data-foo=".bar"]`) can contain arbitrary
        # quoted text, including characters that look exactly like an id/
        # class token — strip the bracketed content entirely before
        # scanning, rather than risk treating a VALUE as a SELECTOR.
        scannable = _ATTRIBUTE_SELECTOR_RE.sub(' ', prelude)
        for id_match in _ID_SELECTOR_TOKEN_RE.finditer(scannable):
            targets.append(('id', id_match.group(1), line))
        for class_match in _CLASS_SELECTOR_TOKEN_RE.finditer(scannable):
            targets.append(('class', class_match.group(1), line))
    return targets


def _check_css_selectors_reference_html(
    issues: list[ValidationIssueData], html: str, css: str, validation_scope: str, css_source_type: str,
) -> list[ValidationIssueData]:
    """A CSS selector referencing an id/class absent from the whole HTML
    document almost always signals a typo or a stale rule left behind
    after markup changed. Advisory-only (never blocks a build; never
    marked fixable — safely inferring WHICH side is wrong, the selector
    or the markup, is not something this project guesses at). Scoped to
    Complete LP with plain CSS only: LESS/SCSS/Sass selectors can be
    built from nesting (`&`) or interpolation (`#{$x}`) a regex scan
    cannot safely resolve, and every other scope has no HTML (or no CSS)
    to cross-check against at all."""
    if validation_scope != ValidationScope.COMPLETE or css_source_type != CssSourceType.CSS:
        return issues
    if not html.strip() or not css.strip():
        return issues
    known_ids, _duplicate_ids = extract_element_ids(html)
    known_classes = extract_element_classes(html)
    seen: set[tuple[str, str]] = set()
    new_issues = list(issues)
    for kind, name, line in _extract_css_selector_targets(css):
        known = known_ids if kind == 'id' else known_classes
        if name in known or (kind, name) in seen:
            continue
        seen.add((kind, name))
        symbol = '#' if kind == 'id' else '.'
        new_issues.append(ValidationIssueData(
            language='css', source_engine='cross-language-html-css', engine_version='1.0',
            rule_id='cross-language:css-selector-missing-target',
            category='value', severity=SEVERITY_WARNING, confidence=CONFIDENCE_LIKELY,
            message=f'CSS selector "{symbol}{name}" has no matching element anywhere in the HTML.',
            start_line=line,
            suggestion='Correct the selector, or add the matching id/class to the HTML.',
            fixable=False, requires_manual_review=True,
        ))
    return new_issues


def _dedupe(issues: list[ValidationIssueData]) -> list[ValidationIssueData]:
    # Stage 1: exact-duplicate removal via fingerprint (same engine, rule,
    # location, and message — never by line number alone).
    seen: set[str] = set()
    unique: list[ValidationIssueData] = []
    for issue in issues:
        fingerprint = issue.fingerprint
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        unique.append(issue)

    # Stage 2: conservative cross-engine merge. Only collapses two issues
    # from DIFFERENT engines that land at the exact same language, line,
    # column, and category — anything less precise stays separate, so two
    # genuinely different defects (even on the same line) are never
    # accidentally combined. Keeps the higher-confidence / better-detailed
    # of the two.
    merged: dict[tuple, ValidationIssueData] = {}
    order: list[tuple] = []
    for issue in unique:
        # `issue.file` (editor_target-or-language) is included so an
        # inline-style/style-block finding — mapped onto HTML line/column
        # ranges — can never merge with an unrelated standalone-CSS-tab
        # finding just because both happen to land on the same line/column
        # of their own, entirely different, documents (see Sprint CSS-A).
        # For every pre-existing adapter `file == language` always, so this
        # is a no-op change to their merge behaviour.
        key = (issue.language, issue.file, issue.start_line, issue.start_column, issue.category)
        existing = merged.get(key)
        if existing is None:
            merged[key] = issue
            order.append(key)
            continue
        if existing.source_engine == issue.source_engine:
            # Same engine at the same exact spot with a different
            # fingerprint means a genuinely different finding — keep both
            # by not merging (fall through to appending under a
            # disambiguated key).
            order.append(key + (issue.fingerprint,))
            merged[key + (issue.fingerprint,)] = issue
            continue
        existing_rank = _CONFIDENCE_RANK.get(existing.confidence, 9)
        new_rank = _CONFIDENCE_RANK.get(issue.confidence, 9)
        existing_score = (existing_rank, -len(existing.suggestion), -len(existing.standards_reference))
        new_score = (new_rank, -len(issue.suggestion), -len(issue.standards_reference))
        merged[key] = issue if new_score < existing_score else existing

    return [merged[key] for key in order]


_MISSING_ELEMENT_RULES = ('missing-html', 'missing-head', 'missing-body', 'missing-title')


def _suppress_false_missing_element_claims(issues: list[ValidationIssueData]) -> list[ValidationIssueData]:
    """Hybrid Validator + AI Engineer architecture sprint, spec section 4.

    `html.parser`-based adapters (html_structure.py) recover from a
    malformed start tag by silently discarding it — `<html` with no closing
    `>` never reaches `handle_starttag`, so `html not in self._seen_elements`
    looks IDENTICAL to a genuinely absent `<html>` element. That produced a
    real, misleading finding: "Document is missing a required <head>
    element" on source where `<head>` is visibly present, just preceded by
    a malformed `<html` tag that ate it during recovery.

    The real root cause is always independently visible to
    HtmlLexicalAdapter's raw-text scan (PASS A — runs before any parser,
    never subject to its recovery): a `malformed-start-tag` finding. Once
    one exists ANYWHERE in the document, `html.parser`'s own recovery
    behavior for everything downstream of it is unreliable — which
    specific later element(s) get swallowed by the recovery depends on
    exactly how the malformed tag's soup of following text gets consumed,
    not just the malformed tag's own name (a malformed `<html` was
    observed live to make `<head>` disappear from `_seen_elements`, not
    `<html>` itself). Rather than try to model that recovery precisely, ANY
    missing-{html,head,body,title} claim in a document that also has a
    malformed-start-tag finding is treated as untrustworthy and dropped —
    the concrete, independently-detected malformed-tag finding is the
    honest root cause to report instead."""
    has_malformed_tag = any(
        issue.language == 'html' and issue.rule_id == 'malformed-start-tag' for issue in issues
    )
    if not has_malformed_tag:
        return issues
    return [
        issue for issue in issues
        if not (issue.language == 'html' and issue.rule_id in _MISSING_ELEMENT_RULES)
    ]


def _required_html_issue() -> ValidationIssueData:
    # Complete-LP mode treats a blank HTML source as one landing-page-level
    # defect, not an invitation to run all 5 HTML adapters against an empty
    # string (which would otherwise report ~6 separate document-structure
    # errors for a document that was never meant to exist yet).
    return ValidationIssueData(
        language='html',
        source_engine='orchestrator',
        engine_version='',
        rule_id='html-required-for-complete-validation',
        category='syntax',
        severity=SEVERITY_ERROR,
        message='Complete landing-page validation requires HTML source.',
        start_line=1,
        start_column=1,
        confidence=CONFIDENCE_DEFINITE,
        suggestion='Add HTML source, or switch to a single-language validation scope.',
        requires_manual_review=False,
    )


def _sort_key(issue: ValidationIssueData):
    return (
        issue.language,
        issue.start_line,
        issue.start_column or 0,
        severity_rank(issue.severity),
        issue.rule_id,
    )


def run(
    html: str,
    css: str = '',
    js: str = '',
    ts: str = '',
    ampscript: str = '',
    profile: str = DEFAULT_PROFILE,
    validation_scope: str = DEFAULT_SCOPE,
    project=None,
    css_source_type: str = DEFAULT_CSS_SOURCE_TYPE,
    on_progress=None,
) -> ValidationRunResult:
    """`on_progress`, when given, is called as `on_progress(stage=...)` at
    each real checkpoint (AI Validate Code Live Progress sprint) — never
    required for correctness, and only ever called for a stage whose work
    is actually about to run for this request's scope (never a fake
    stage for a language that isn't in scope). Any exception it raises is
    caught and logged rather than allowed to abort validation itself."""
    def _emit(stage):
        if on_progress is None:
            return
        try:
            on_progress(stage=stage)
        except Exception:  # noqa: BLE001 - a progress-reporting failure must never abort validation
            logger.warning('landingpages.validation.engine.on_progress_failed', exc_info=True)

    if not is_known_profile(profile):
        profile = DEFAULT_PROFILE
    if not is_known_scope(validation_scope):
        validation_scope = DEFAULT_SCOPE
    if not is_known_css_source_type(css_source_type):
        css_source_type = DEFAULT_CSS_SOURCE_TYPE

    _emit('preparing')

    deadline = time.perf_counter() + GLOBAL_TIME_BUDGET_SECONDS
    html = html or ''
    css = css or ''
    js = js or ''
    ampscript = ampscript or ''
    truncated_html, html_was_truncated = _truncate_lines(html)
    truncated_css, css_was_truncated = _truncate_lines(css)
    truncated_js, js_was_truncated = _truncate_lines(js)
    truncated_ampscript, ampscript_was_truncated = _truncate_lines(ampscript)
    input_was_truncated = html_was_truncated or css_was_truncated or js_was_truncated or ampscript_was_truncated

    issues: list[ValidationIssueData] = []
    statuses: list[EngineStatus] = []
    generated_css: str | None = None
    generated_css_compiled = False
    generated_css_engine = ''
    generated_css_engine_version = ''

    run_html = validation_scope in (ValidationScope.COMPLETE, ValidationScope.HTML)
    run_css = validation_scope in (ValidationScope.COMPLETE, ValidationScope.CSS)
    run_js = validation_scope in (ValidationScope.COMPLETE, ValidationScope.JAVASCRIPT)
    run_ampscript = validation_scope in (ValidationScope.COMPLETE, ValidationScope.AMPSCRIPT)

    # Cross-language JS/HTML context (Phase 7/9) — element ids for the
    # "missing selector target" / "duplicate id" checks, and function names
    # declared anywhere in this request's JavaScript for the inline-handler
    # "missing referenced function" check. Derived only from the HTML that
    # is actually part of THIS request's scope; a pure 'javascript'-scope
    # request (no HTML field in play) gets an empty context, never a guess.
    if run_html and truncated_html.strip():
        known_element_ids, duplicate_element_ids = extract_element_ids(truncated_html)
        html_script_blocks = extract_script_blocks(truncated_html)
        html_js_block_texts = [
            block['content'] for block in html_script_blocks
            if not block['has_src'] and (block['type'] in PLAIN_JS_TYPES or block['type'] == MODULE_JS_TYPE)
        ]
    else:
        known_element_ids, duplicate_element_ids = set(), set()
        html_js_block_texts = []

    function_lookup_sources = list(html_js_block_texts)
    if run_js and validation_scope == ValidationScope.COMPLETE:
        function_lookup_sources.append(truncated_js)
    declared_function_names = extract_top_level_function_names(function_lookup_sources)

    # Low-Latency AI Engineer Performance Optimization sprint, spec
    # section 3 — HTML/CSS/JavaScript/AMPscript (plus the Complete-LP-
    # only external-stylesheet/external-script checks) are mutually
    # INDEPENDENT once the cross-language context facts above are
    # computed: none of them reads another's issues/statuses/generated_css
    # while running, only the ALREADY-COMPUTED known_element_ids/
    # duplicate_element_ids/declared_function_names, truncated_html, and
    # profile/deadline/project. They ran strictly sequentially before —
    # measured baseline showed a warm Complete LP request costs
    # approximately the SUM of its languages' individual durations, not
    # the max, confirming real serialized-for-no-reason latency (a
    # request dominated by the slowest single language, typically
    # JavaScript, was paying for every other language's subprocess
    # start-up on top). Running them concurrently via a thread pool is
    # safe here specifically because the actual work is subprocess-I/O-
    # bound (each Node/Java call blocks on `subprocess.run`, which
    # releases the GIL) — nothing below performs meaningful CPU-bound
    # work in the Python interpreter itself, so real Python threads (not
    # multiprocessing) give real concurrency without a process-per-
    # request cost. Results are merged back in the SAME FIXED order
    # (html, css, external-stylesheet, external-script, js, ampscript)
    # every constituent ran in before this change — required for
    # `_dedupe`'s cross-engine tie-breaking (equal-score ties keep
    # whichever issue was encountered first) to remain byte-for-byte
    # identical to the pre-parallel behavior regardless of which
    # language's subprocess happens to finish first.
    def _do_html():
        local_issues: list[ValidationIssueData] = []
        local_statuses: list[EngineStatus] = []
        if validation_scope == ValidationScope.COMPLETE and not truncated_html.strip():
            # One clear landing-page-level defect, not ~6 document-structure
            # errors generated by running every HTML adapter against ''.
            local_issues.append(_required_html_issue())
            local_statuses.append(EngineStatus(
                engine_name='html-required', success=True, duration_ms=0, issue_count=1,
            ))
        else:
            html_adapters = _HTML_ADAPTERS + (
                HtmlEmbeddedJavascriptAdapter(
                    known_element_ids=known_element_ids, duplicate_ids=duplicate_element_ids,
                ),
                HtmlInlineEventHandlerAdapter(
                    known_element_ids=known_element_ids, duplicate_ids=duplicate_element_ids,
                    declared_function_names=declared_function_names,
                ),
            )
            html_issues, html_statuses = _run_adapters(html_adapters, truncated_html, profile, deadline)
            local_issues.extend(html_issues)
            local_statuses.extend(html_statuses)
        return local_issues, local_statuses, None

    def _do_css():
        if css_source_type in (CssSourceType.SCSS, CssSourceType.SASS):
            # Compiles first, then runs the exact same CSS pipeline
            # against the generated output — see
            # adapters/css_scss_sass.py / validators_node/compile_scss.mjs.
            css_adapters = (ScssSassAdapter(css_source_type),)
        elif css_source_type == CssSourceType.LESS:
            # Compiles first, then runs the exact same CSS pipeline
            # against the generated output — see
            # adapters/css_less.py / validators_node/compile_less.mjs.
            css_adapters = (LessAdapter(),)
        else:
            css_adapters = _CSS_ADAPTERS

        css_issues, css_statuses = _run_adapters(css_adapters, truncated_css, profile, deadline)
        extra = None
        if css_source_type in (CssSourceType.SCSS, CssSourceType.SASS, CssSourceType.LESS):
            # The compiler adapter (the only element of css_adapters in this
            # branch) stashes its own compile result as instance attributes
            # during validate() — read here rather than widening the generic
            # _run_adapters/ValidatorAdapter contract for every other
            # adapter's sake. getattr(..., default) covers the case where
            # the adapter raised before setting them (e.g. a NodeBridgeError
            # from a missing compiler), which _run_adapters already turned
            # into a failed EngineStatus above.
            compiler_adapter = css_adapters[0]
            extra = {
                'generated_css': getattr(compiler_adapter, 'compiled_css', None),
                'generated_css_compiled': bool(getattr(compiler_adapter, 'compiled', False)),
                'generated_css_engine': getattr(compiler_adapter, 'engine_name', ''),
                'generated_css_engine_version': getattr(compiler_adapter, 'compiled_engine_version', ''),
            }
        return css_issues, css_statuses, extra

    def _do_external():
        local_issues: list[ValidationIssueData] = []
        local_statuses: list[EngineStatus] = []
        # External <link rel="stylesheet"> classification/validation is a
        # Complete-LP-only concern (see Sprint CSS-B) — isolated in its
        # own try/except exactly like every adapter in _run_adapters, so
        # a failure here can never remove HTML/CSS findings, and vice
        # versa.
        if time.perf_counter() > deadline:
            local_statuses.append(EngineStatus(
                engine_name=_EXTERNAL_STYLESHEET_ADAPTER.engine_name, success=False,
                duration_ms=0, issue_count=0, message='Skipped — validation time budget exceeded.',
            ))
        else:
            started_at = time.perf_counter()
            try:
                external_issues = _EXTERNAL_STYLESHEET_ADAPTER.validate(truncated_html, profile, project=project)
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                local_issues.extend(external_issues)
                local_statuses.append(EngineStatus(
                    engine_name=_EXTERNAL_STYLESHEET_ADAPTER.engine_name, success=True,
                    duration_ms=duration_ms, issue_count=len(external_issues),
                ))
            except Exception:  # noqa: BLE001 - never let this adapter's crash take down the rest
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                logger.exception(
                    'landingpages.validate.adapter_failed engine=%s', _EXTERNAL_STYLESHEET_ADAPTER.engine_name,
                )
                local_statuses.append(EngineStatus(
                    engine_name=_EXTERNAL_STYLESHEET_ADAPTER.engine_name, success=False,
                    duration_ms=duration_ms, issue_count=0, message='This check could not complete.',
                ))

        # External <script src="..."> classification/validation — same
        # Complete-LP-only concern and isolation as the stylesheet block
        # immediately above.
        if time.perf_counter() > deadline:
            local_statuses.append(EngineStatus(
                engine_name=_EXTERNAL_SCRIPT_ADAPTER.engine_name, success=False,
                duration_ms=0, issue_count=0, message='Skipped — validation time budget exceeded.',
            ))
        else:
            started_at = time.perf_counter()
            try:
                external_js_issues = _EXTERNAL_SCRIPT_ADAPTER.validate(truncated_html, profile, project=project)
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                local_issues.extend(external_js_issues)
                local_statuses.append(EngineStatus(
                    engine_name=_EXTERNAL_SCRIPT_ADAPTER.engine_name, success=True,
                    duration_ms=duration_ms, issue_count=len(external_js_issues),
                ))
            except Exception:  # noqa: BLE001 - never let this adapter's crash take down the rest
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                logger.exception(
                    'landingpages.validate.adapter_failed engine=%s', _EXTERNAL_SCRIPT_ADAPTER.engine_name,
                )
                local_statuses.append(EngineStatus(
                    engine_name=_EXTERNAL_SCRIPT_ADAPTER.engine_name, success=False,
                    duration_ms=duration_ms, issue_count=0, message='This check could not complete.',
                ))
        return local_issues, local_statuses, None

    def _do_js():
        # Cross-language LP rules (missing selector target / duplicate id)
        # only activate when HTML is genuinely part of THIS request's scope
        # (Complete LP) — a standalone 'javascript'-scope request has no
        # HTML context to check against, so `known_element_ids` stays None
        # there (see js_conformance.py — None means "off", not "empty").
        if validation_scope == ValidationScope.COMPLETE:
            js_adapters = (JsConformanceAdapter(
                known_element_ids=known_element_ids, duplicate_ids=duplicate_element_ids,
            ),)
        else:
            js_adapters = (JsConformanceAdapter(),)

        js_issues, js_statuses = _run_adapters(js_adapters, truncated_js, profile, deadline)
        return js_issues, js_statuses, None

    def _do_ampscript():
        ampscript_issues, ampscript_statuses = _run_adapters(
            _AMPSCRIPT_ADAPTERS, truncated_ampscript, profile, deadline,
        )
        return ampscript_issues, ampscript_statuses, None

    # Progress stages are emitted up front, in the same fixed order they
    # always were, right before the concurrent batch starts — with the
    # underlying work now genuinely parallel, there is no single instant
    # that is honestly "validating HTML but not yet CSS," so this is a
    # deliberate, disclosed coarsening (spec section 24 already calls for
    # coarse stages) rather than an attempt to fake a sequential-looking
    # timeline for work that no longer runs sequentially.
    # `_do_external` is deliberately EXCLUDED from the thread pool below —
    # it is the only job that touches the Django ORM (via `project`-scoped
    # storage reads for external <link>/<script> assets). A worker thread
    # gets its own DB connection, which under Django's test-transaction
    # wrapping (TestCase wraps each test in an atomic transaction on the
    # MAIN thread's connection) cannot see that transaction's data at all
    # — a real correctness bug caught by the external-stylesheet/script
    # test suites during this sprint's own verification, not a
    # hypothetical. Running it directly on the main thread sidesteps that
    # entirely (same connection the request/test already uses) while
    # STILL overlapping with the other jobs' wall-clock time: it is
    # kicked off here, synchronously, in between submitting the other
    # jobs to the executor and collecting their results below — the OS
    # already has those subprocess calls running in the background by
    # the time this line executes.
    threaded_jobs = []
    if run_html:
        _emit('validating_html')
        threaded_jobs.append(('html', _do_html))
    if run_css:
        _emit('validating_css')
        threaded_jobs.append(('css', _do_css))
    if run_js:
        _emit('validating_js')
        threaded_jobs.append(('js', _do_js))
    if run_ampscript:
        _emit('validating_ampscript')
        threaded_jobs.append(('ampscript', _do_ampscript))
    run_external = run_html and validation_scope == ValidationScope.COMPLETE
    # The fixed merge order every constituent ran in before this change —
    # required for `_dedupe`'s cross-engine tie-breaking determinism (see
    # the comment above `_do_html`). `run_external` only ever coincides
    # with `run_css` also being true (COMPLETE scope implies both), so
    # 'external' always has a real 'css' entry to follow here.
    merge_order = ['html', 'css'] + (['external'] if run_external else []) + ['js', 'ampscript']
    merge_order = [name for name in merge_order if name == 'external' or any(name == job_name for job_name, _fn in threaded_jobs)]

    results = {}
    if len(threaded_jobs) > 1:
        with ThreadPoolExecutor(max_workers=len(threaded_jobs)) as executor:
            futures = {name: executor.submit(fn) for name, fn in threaded_jobs}
            if run_external:
                results['external'] = _do_external()
            results.update({name: future.result() for name, future in futures.items()})
    else:
        if threaded_jobs:
            name, fn = threaded_jobs[0]
            results[name] = fn()
        if run_external:
            results['external'] = _do_external()

    for name in merge_order:
        job_issues, job_statuses, extra = results[name]
        issues.extend(job_issues)
        statuses.extend(job_statuses)
        if name == 'css' and extra:
            generated_css = extra['generated_css']
            generated_css_compiled = extra['generated_css_compiled']
            generated_css_engine = extra['generated_css_engine']
            generated_css_engine_version = extra['generated_css_engine_version']

    if validation_scope == ValidationScope.TYPESCRIPT:
        # TypeScript is deprecated and never gets a real engine again (see
        # profiles.py) — a direct API caller still gets a safe, honest
        # status rather than silently running nothing with no explanation,
        # or running HTML/JavaScript by mistake.
        statuses.append(EngineStatus(
            engine_name='typescript-conformance', success=False, duration_ms=0, issue_count=0,
            message='This validation engine is not available yet.',
        ))
    # `ts` is otherwise unused — permanently deprecated, replaced by
    # ampscript. Accepted for API-contract stability, never validated here.
    _ = ts

    _emit('normalizing')
    issues = _dedupe(issues)
    issues = _suppress_false_missing_element_claims(issues)
    issues = _tag_html_shell_corruption_root_cause(issues, html)
    issues = _check_css_selectors_reference_html(issues, html, css, validation_scope, css_source_type)
    issues.sort(key=_sort_key)

    truncated_issue_count = 0
    if len(issues) > MAX_ISSUES:
        truncated_issue_count = len(issues) - MAX_ISSUES
        issues = issues[:MAX_ISSUES]

    if input_was_truncated:
        statuses.append(EngineStatus(
            engine_name='input-limits', success=True, duration_ms=0, issue_count=0,
            message=f'Input truncated to the first {MAX_LINE_COUNT} lines before validation.',
        ))
    if truncated_issue_count:
        statuses.append(EngineStatus(
            engine_name='input-limits', success=True, duration_ms=0, issue_count=0,
            message=f'{truncated_issue_count} additional issue(s) were truncated (limit {MAX_ISSUES}).',
        ))

    return ValidationRunResult(
        issues=issues,
        engine_status=statuses,
        truncated=input_was_truncated or truncated_issue_count > 0,
        truncated_issue_count=truncated_issue_count,
        validation_scope=validation_scope,
        css_source_type=css_source_type,
        generated_css=generated_css,
        generated_css_compiled=generated_css_compiled,
        generated_css_engine=generated_css_engine,
        generated_css_engine_version=generated_css_engine_version,
    )

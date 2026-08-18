"""Unified normalized validation-issue schema shared by every adapter.

Every adapter (html5lib-backed conformance checker, the supplemental
structural scanner, accessibility/SEO/responsive checks, and future
CSS/JS/TS adapters) must produce `ValidationIssueData` instances — never a
library-specific shape. This is the one contract the orchestrator
(`validation/engine.py`) and the API layer (`views.py`/`serializers.py`)
depend on.
"""

import hashlib
import re
from dataclasses import dataclass, field

SEVERITY_ERROR = 'error'
SEVERITY_WARNING = 'warning'
SEVERITY_INFO = 'info'
_SEVERITY_RANK = {SEVERITY_ERROR: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}

CONFIDENCE_DEFINITE = 'definite'
CONFIDENCE_LIKELY = 'likely'
CONFIDENCE_POSSIBLE = 'possible'

FIX_TYPE_NONE = ''
FIX_TYPE_INSERT_CLOSING_TAG = 'insert-closing-tag'
FIX_TYPE_ADD_ATTRIBUTE = 'add-attribute'
FIX_TYPE_REMOVE_DUPLICATE = 'remove-duplicate'
# AI Fix Issues repair-architecture closure sprint, spec section 4 — a
# closing tag proven (by the tag-stack) to have NO matching opener
# anywhere is unambiguous by construction (there is no "which orphan"
# choice to make, unlike FIX_TYPE_INSERT_CLOSING_TAG's unclosed-tag
# case) — always safely auto-fixable.
FIX_TYPE_REMOVE_CLOSING_TAG = 'remove-closing-tag'


def severity_rank(severity: str) -> int:
    return _SEVERITY_RANK.get(severity, 99)


def _normalize_message(message: str) -> str:
    return re.sub(r'\s+', ' ', message.strip().lower())


def compute_fingerprint(
    *,
    language: str,
    source_engine: str,
    rule_id: str,
    start_line: int,
    start_column: int | None,
    end_line: int | None,
    end_column: int | None,
    message: str,
    source_context: str = '',
) -> str:
    """Stable identity for an issue — deliberately NOT based on line number
    alone (two different defects on the same line must never collapse into
    one). Includes source_engine so two engines independently reporting
    something near the same spot are never accidentally treated as
    identical by fingerprint equality; that kind of cross-engine merge is
    a separate, more conservative decision made by the orchestrator.
    Includes source_context so an inline-style or internal-style-block
    finding (both mapped onto HTML line/column ranges) can never collapse
    with an unrelated standalone-CSS-tab finding that happens to land on
    the same line/column of its own, much smaller document."""
    raw = '|'.join([
        language,
        source_engine,
        rule_id,
        f'{start_line}:{start_column}-{end_line}:{end_column}',
        _normalize_message(message),
        source_context,
    ])
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]


@dataclass(frozen=True)
class ValidationIssueData:
    language: str  # 'html' | 'css' | 'javascript' | 'ampscript' | 'typescript' (deprecated) | 'cdn'
    source_engine: str  # e.g. 'html5lib', 'html-structure', 'html-accessibility'
    engine_version: str
    rule_id: str
    category: str  # 'syntax' | 'accessibility' | 'seo' | 'security' | 'performance' | 'responsive'
    severity: str  # SEVERITY_*
    message: str
    start_line: int
    start_column: int | None = None
    end_line: int | None = None
    end_column: int | None = None
    standards_reference: str = ''
    confidence: str = CONFIDENCE_DEFINITE
    suggestion: str = ''
    code_excerpt: str = ''
    fixable: bool = False
    fix_type: str = FIX_TYPE_NONE
    deterministic_fix: dict | None = None
    requires_manual_review: bool = True
    related_element: str = ''
    related_attribute: str = ''
    risk: str = 'low'  # kept for Sprint 1A/1B API compatibility — see serializers.py

    # Tool-Grounded AI Engineer sprint, spec section 4/5 — structured
    # diagnostics contract. Empty string means "no known root-cause
    # grouping" (never null-vs-empty ambiguity downstream). Populated by
    # validation/engine.py's _tag_html_shell_corruption_root_cause();
    # issues sharing the same non-empty value are part of one cascade
    # from a single underlying defect, not independent findings.
    root_cause_id: str = ''

    # Sprint CSS-A additions. `editor_target` overrides which editor tab a
    # finding belongs to (via the `file` property below) when it differs
    # from `language` — an inline `style="..."` attribute or an internal
    # `<style>` block is CSS (`language='css'`) but the developer can only
    # fix it in the HTML editor (`editor_target='html'`). Left blank,
    # `file` falls back to `language` exactly as before, so every
    # pre-existing adapter is unaffected. `source_context` identifies
    # *where* the CSS came from (e.g. 'standalone-css', 'html-inline-style',
    # 'html-style-block') and `source_block_index` disambiguates multiple
    # occurrences of the same context within one document (the Nth style
    # attribute / Nth <style> block).
    editor_target: str = ''
    source_context: str = ''
    source_block_index: int | None = None
    # Sprint CSS-B addition — the storage-relative path of the local
    # project asset a finding came from, when one was actually resolved
    # and read (see adapters/html_external_stylesheet.py). Blank for
    # every issue that isn't about a resolved local stylesheet asset.
    source_asset_id: str = ''
    # Sprint CSS-C additions — for a finding produced against SCSS/Sass's
    # *generated* CSS, the position in that generated CSS before it was
    # mapped back to the original source (start_line/start_column above
    # are always the original-source position, or the generated position
    # itself when no mapping was available — see
    # adapters/css_scss_sass.py). None for every non-preprocessor issue.
    generated_start_line: int | None = None
    generated_start_column: int | None = None

    # AI Engineer full-source-analysis sprint. None for every deterministic
    # adapter's own issue. Set by ai_engineer/__init__.py either on a new
    # AI-only issue (source_engine='ai-engineer' or
    # 'ai-engineer-cross-language') or merged onto an EXISTING deterministic
    # issue (via dataclasses.replace, source_engine becomes
    # '<engine>+ai-engineer') when the AI Engineer independently corroborates
    # it. Shape: {'reasoning': str, 'evidence': str, 'cross_language': bool,
    # 'verifiable': bool, 'chunk_index': int, 'total_chunks': int}. Never
    # trusted as authoritative location data — only explanatory context; see
    # ai_engineer/location.py for how the real start_line/start_column above
    # are server-verified before this issue is ever constructed.
    ai_metadata: dict | None = None

    @property
    def fingerprint(self) -> str:
        return compute_fingerprint(
            language=self.language,
            source_engine=self.source_engine,
            rule_id=self.rule_id,
            start_line=self.start_line,
            start_column=self.start_column,
            end_line=self.end_line,
            end_column=self.end_column,
            message=self.message,
            source_context=self.source_context,
        )

    # --- Sprint 1A/1B compatibility aliases --------------------------------
    # The frontend and the existing ValidationIssue model/serializer still
    # use these shorter names. Keeping them as read-only properties means
    # no caller written against the old ValidationIssueData shape needs to
    # change for this sprint.
    @property
    def line(self) -> int:
        return self.start_line

    @property
    def column(self) -> int | None:
        return self.start_column

    @property
    def file(self) -> str:
        return self.editor_target or self.language

    @property
    def auto_fixable(self) -> bool:
        return self.fixable


@dataclass
class EngineStatus:
    engine_name: str
    success: bool
    duration_ms: int
    issue_count: int
    message: str = ''


@dataclass
class ValidationRunResult:
    issues: list[ValidationIssueData] = field(default_factory=list)
    engine_status: list[EngineStatus] = field(default_factory=list)
    truncated: bool = False
    truncated_issue_count: int = 0
    validation_scope: str = 'complete'
    css_source_type: str = 'css'
    # Sprint CSS-E — the compiled CSS output for a scss/sass/less source,
    # when compilation actually succeeded (compile_scss.mjs/compile_less.mjs
    # already produce this; only the Python layer previously discarded it —
    # see adapters/css_scss_sass.py, adapters/css_less.py). None for plain
    # 'css' and for any failed compilation. Never persisted — returned only
    # on the validate response, exactly like every other transient field.
    generated_css: str | None = None
    generated_css_compiled: bool = False
    generated_css_engine: str = ''
    generated_css_engine_version: str = ''

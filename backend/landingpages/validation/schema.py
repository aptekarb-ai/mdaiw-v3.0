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
    language: str  # 'html' | 'css' | 'javascript' | 'typescript' | 'cdn'
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

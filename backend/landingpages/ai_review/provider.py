"""AI Review provider interface — same shape as yukti/providers.py's
`IntentProvider`: a single `review(request)` contract the view depends on,
so the view/frontend contract never has to know which concrete provider
(or none) actually answered. `get_default_ai_review_provider()` is the only
place that decides whether a real provider is even instantiated, based on
configuration.
"""

from dataclasses import dataclass, field


class AIReviewUnavailable(Exception):
    """Raised for any condition that means AI review cannot run right now —
    not configured, rate-limited, timed out, or the provider call itself
    failed. Never carries the underlying provider exception's raw text
    outward (see openai_provider.py, which logs the exception type only)."""


@dataclass(frozen=True)
class ReviewIssueContext:
    """One issue's bounded, whitelisted context — everything the model is
    given about a single finding. Built exclusively from ValidationIssue
    fields and a short, redacted source excerpt; never the full document."""

    issue_id: int
    rule_id: str
    message: str
    severity: str
    confidence: str
    suggestion: str
    language: str
    source_context: str
    file: str
    start_line: int
    start_column: int | None
    code_excerpt: str
    # Absolute character offset where `code_excerpt` begins within the
    # real source — needed to translate the excerpt-relative offsets the
    # AI is asked to return (see openai_provider.py's system prompt) back
    # into real source offsets (see validation.py). See excerpt.py's
    # docstring for why this exists at all.
    excerpt_start_offset: int
    # Deep Validation spec section 2/29 — this project's own, server-owned
    # repair guidance for `rule_id` (see validation/rules/), when the Rule
    # Knowledge Registry has an entry for it. The model supplements this
    # with its own reasoning; it is never asked to invent the standard.
    # Blank when the registry has no entry (e.g. rule not yet catalogued,
    # or a language the registry doesn't cover yet).
    repair_hint: str = ''


@dataclass(frozen=True)
class AIReviewRequest:
    """The complete, bounded input to a provider call. `target_platform` is
    set only when AMPscript issues are in scope (see provider prompt)."""

    issues: list[ReviewIssueContext]
    css_source_type: str
    validation_scope: str
    target_platform: str | None
    rate_limit_identifier: str


@dataclass(frozen=True)
class ProposalDraft:
    """Raw, not-yet-verified shape of one provider-returned proposal —
    exactly what came back from the structured-output schema, before any
    of it is trusted. See ai_review/validation.py for what happens next:
    every field here is re-checked against the CURRENT source before a
    draft is allowed to become an applicable patch."""

    issue_ids: list[int]
    language: str
    source_context: str
    explanation: str
    risk: str
    confidence: str
    start_offset: int
    end_offset: int
    expected_text: str
    replacement_text: str
    requires_configuration: bool
    assumptions: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AIReviewResult:
    summary: str
    proposals: list[ProposalDraft]


@dataclass(frozen=True)
class WholeSourceIssueSummary:
    """One current issue's bare identity for whole-source repair context —
    deliberately NOT a full ReviewIssueContext (no per-issue excerpt; the
    model already has the entire file). rule_id/message/line only, plus
    the registry's repair_hint when catalogued."""

    issue_id: int
    rule_id: str
    message: str
    severity: str
    line: int
    repair_hint: str = ''


@dataclass(frozen=True)
class WholeSourceRepairRequest:
    """Deep Validation spec section 2/4/10/11 — 'Whole-Source AI Repair
    mode'. Distinct from AIReviewRequest: the model receives the ENTIRE
    current source for ONE file, not a bounded per-issue excerpt, and may
    return a single coherent REPLACE_ENTIRE_SOURCE candidate instead of a
    list of regional patches. Reserved for `run_autonomous_repair` (spec
    section 12 — 'AI Fix This Issue' must never use this mode) and only
    ever attempted when regional patching has already failed to make
    progress on a structurally malformed document (see
    fixes/iterative.py::_attempt_whole_source_repair)."""

    file_key: str  # 'html' | 'css' | 'js' | 'ampscript' — the sources[] dict key
    language: str
    source: str
    issues: list[WholeSourceIssueSummary]
    css_source_type: str
    target_platform: str | None
    rate_limit_identifier: str


@dataclass(frozen=True)
class WholeSourceRepairResult:
    """`corrected_source` is None when the model declines to propose a
    whole-source rewrite (e.g. it judges regional patching sufficient, or
    the fix genuinely requires external input) — never a signal to
    fabricate content. `preserved_content_note` is the model's own brief
    statement of what it kept unchanged, surfaced for audit, never trusted
    as proof on its own (the real proof is the candidate re-validating
    clean and the before/after comparison in fixes/iterative.py)."""

    corrected_source: str | None
    explanation: str
    preserved_content_note: str = ''


@dataclass(frozen=True)
class DocumentationRequest:
    """AI Engineer Formatting + Documentation sprint (spec section 3/10;
    reordered by the FORMAT + COMMENT policy closure spec section 7) —
    same 'whole file in' shape as WholeSourceRepairRequest, but this is
    NOT a repair request: `source` is already structurally/security-clean
    by the time this runs, but NOT yet formatted — comments are added
    BEFORE formatting, so the formatter is what's responsible for
    preserving whatever placement is chosen here. The model is asked
    only to identify genuinely valuable comment opportunities, and
    explicitly allowed to find none."""

    file_key: str  # 'html' | 'css' | 'js' | 'ampscript'
    language: str
    source: str
    css_source_type: str
    target_platform: str | None
    rate_limit_identifier: str


@dataclass(frozen=True)
class DocumentationResult:
    """`documented_source` is None when the model found no comment worth
    adding — a valid, expected outcome (spec section 28), never treated as
    a failure. When present it must be the ENTIRE file with ONLY comments
    added; the caller independently verifies this via a comment-stripped
    equivalence check before ever adopting it (spec section 16) — the
    model's own claim is never sufficient on its own."""

    documented_source: str | None
    comments_added: int = 0
    explanation: str = ''


class AIReviewProvider:
    def review(self, request: AIReviewRequest) -> AIReviewResult:
        raise NotImplementedError

    def repair_whole_source(self, request: WholeSourceRepairRequest) -> WholeSourceRepairResult:
        raise NotImplementedError

    def suggest_documentation(self, request: DocumentationRequest) -> DocumentationResult:
        raise NotImplementedError


def get_default_ai_review_provider():
    """AI review is unavailable unless both a provider is selected
    (`LP_AI_REVIEW_PROVIDER`) and actually configured (its API key
    present) — otherwise `None`, and the view returns AI_REVIEW_UNAVAILABLE
    exactly as if this function didn't exist. No fallback: unlike Yukti
    (which always has the deterministic router to fall back to), there is
    no non-AI way to produce an AI review — the caller must handle `None`."""
    from django.conf import settings

    if settings.LP_AI_REVIEW_PROVIDER == 'openai' and settings.OPENAI_API_KEY:
        from .openai_provider import OpenAIAIReviewProvider

        return OpenAIAIReviewProvider()
    return None

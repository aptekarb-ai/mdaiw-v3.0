"""AI Engineer provider interface — same shape as
ai_review/provider.py::AIReviewProvider and yukti_explain/provider.py::
ExplainProvider: a single `analyze(request)` contract the orchestrator
(__init__.py) depends on, so it never has to know which concrete provider
(or none) actually answered. `get_default_ai_engineer_provider()` is the
only place that decides whether a real provider is even instantiated.

This is a DISTINCT capability from AI Review & Fix (proposes patches for
already-detected issues) and Yukti explain (explains already-detected
issues in natural language): AI Engineer independently reads complete
source looking for issues no deterministic engine reported at all. It
never proposes a source patch directly — a resulting ValidationIssue
participates in AI Fix Issues/AI Fix This Issue exactly like any other
issue, via the EXISTING ai_review pipeline (see views.py::ValidateView's
docstring update and ai_engineer/__init__.py).
"""

from dataclasses import dataclass, field


class AIEngineerUnavailable(Exception):
    """Raised for any condition that means AI Engineer analysis cannot run
    right now — not configured, rate-limited, timed out, or the provider
    call itself failed. Never carries the underlying provider exception's
    raw text outward. The caller (ai_engineer/__init__.py) always has a
    perfectly good fallback: deterministic validation never depends on
    this succeeding — see spec section 16."""


@dataclass(frozen=True)
class DeterministicFindingRef:
    """One deterministic finding's bounded context, given to the model
    purely so it can explain/correlate/avoid restating it — never so it
    can be asked to re-verify or override it."""

    rule_id: str
    message: str
    severity: str
    line: int


@dataclass(frozen=True)
class AIEngineerChunk:
    """One structurally-bounded slice of one language's complete source —
    see chunking.py. `text` is already redacted before being placed here."""

    language: str
    text: str
    start_line: int  # 1-indexed, inclusive — first line of `text` within the full source
    end_line: int  # 1-indexed, inclusive
    chunk_index: int  # 0-indexed
    total_chunks: int
    source_context: str = ''  # css_source_type when language == 'css'; '' otherwise
    findings_in_range: list[DeterministicFindingRef] = field(default_factory=list)
    # True when NO deterministic engine reported a category='syntax' error
    # anywhere in this language's source — told to the model so it doesn't
    # need to guess; the server ALSO independently enforces this (see
    # ai_engineer/__init__.py's contradiction guard) — this is defense in
    # depth at the source, not the actual safety boundary.
    deterministic_syntax_confirmed_valid: bool = False


@dataclass(frozen=True)
class AIEngineerChunkRequest:
    chunk: AIEngineerChunk
    validation_scope: str
    target_platform: str | None
    rate_limit_identifier: str


@dataclass(frozen=True)
class CrossLanguageRequest:
    """A single bounded, cross-language pass — see spec section 13. Each
    entry in `sources` is (language, redacted bounded excerpt)."""

    sources: list[tuple[str, str]]
    validation_scope: str
    target_platform: str | None
    rate_limit_identifier: str


@dataclass(frozen=True)
class AIFindingDraft:
    """Raw, not-yet-verified shape of one provider-returned finding —
    exactly what came back from the structured-output schema, before any
    of it is trusted. See ai_engineer/location.py for what happens next:
    `evidence` is re-located in the CURRENT source before this draft is
    allowed to become a ValidationIssueData."""

    category: str
    severity: str
    message: str
    evidence: str
    reasoning: str
    suggested_fix: str
    confidence: str
    risk: str
    verifiable: bool
    cross_language: bool = False
    # Only ever set (to one of 'html'/'css'/'javascript'/'ampscript') by
    # analyze_cross_language's response parsing — a single-chunk
    # analyze_chunk() call already knows its own language from the request,
    # so this stays '' there.
    language: str = ''


@dataclass(frozen=True)
class AIEngineerFindingsResult:
    findings: list[AIFindingDraft]


class AIEngineerProvider:
    def analyze_chunk(self, request: AIEngineerChunkRequest) -> AIEngineerFindingsResult:
        raise NotImplementedError

    def analyze_cross_language(self, request: CrossLanguageRequest) -> AIEngineerFindingsResult:
        raise NotImplementedError


def get_default_ai_engineer_provider():
    """AI Engineer analysis is unavailable unless both a provider is
    selected (`LP_AI_ENGINEER_PROVIDER` — its OWN toggle, deliberately NOT
    shared with AI Review & Fix/Yukti explain's `LP_AI_REVIEW_PROVIDER";
    see settings.py's comment on why) and actually configured (its API key
    present) — otherwise `None`, and the caller treats it exactly as if
    this function didn't exist. Deterministic validation is always
    available regardless."""
    from django.conf import settings

    if settings.LP_AI_ENGINEER_PROVIDER == 'openai' and settings.OPENAI_API_KEY:
        from .openai_provider import OpenAIAIEngineerProvider

        return OpenAIAIEngineerProvider()
    return None

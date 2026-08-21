"""Yukti explanation provider interface — same shape as
ai_review/provider.py::AIReviewProvider and yukti/providers.py::IntentProvider:
a single `explain(request)` contract the view depends on, so the view/
frontend contract never has to know which concrete provider (or none)
answered. `get_default_explain_provider()` is the only place that decides
whether a real provider is even instantiated, based on configuration.

This is a DISTINCT capability from both AI Review & Fix (ai_review/) and
Yukti chat (yukti/): it never proposes a source patch and never routes a
navigation/fill action — it only produces natural-language explanation
text, grounded in real ValidationIssue rows the view already fetched.
`fix_method`/`requires_decision` per issue are computed by the view from
the real deterministic-fix engine (fixes/), never guessed by this
provider — see views.py::YuktiExplainView.
"""

from dataclasses import dataclass, field


class ExplainUnavailable(Exception):
    """Raised for any condition that means an AI-generated explanation
    cannot be produced right now — not configured, rate-limited, timed
    out, or the provider call itself failed. Never carries the underlying
    provider exception's raw text outward (see openai_provider.py, which
    logs the exception type only). The caller (views.py) always has a
    perfectly good fallback: the real, computed counts/language breakdown/
    fix-method facts are never dependent on this provider succeeding."""


@dataclass(frozen=True)
class ExplainIssueContext:
    """One issue's bounded, whitelisted context — built exclusively from
    ValidationIssue fields and a short, redacted source excerpt; never the
    full document. Same shape as ai_review.provider.ReviewIssueContext by
    design (see yukti_explain/__init__.py, which reuses
    ai_review.build_issue_context directly rather than duplicating it)."""

    issue_id: int
    rule_id: str
    message: str
    severity: str
    category: str
    language: str
    file: str
    start_line: int
    code_excerpt: str
    fix_method: str  # 'deterministic' | 'ai-assisted' — computed by the view, not this provider
    # AI Engineer full-source-analysis sprint — e.g. 'html-structure',
    # 'ai-engineer', 'html-structure+ai-engineer'. Lets the provider phrase
    # attribution correctly (spec section 23: "must say where the finding
    # came from... do not describe AI-only observations as compiler
    # errors") without Yukti needing any other knowledge of the pipeline.
    source_engine: str = ''


@dataclass(frozen=True)
class ExplainRequest:
    """The complete, bounded input to a provider call."""

    issues: list[ExplainIssueContext]
    error_count: int
    warning_count: int
    info_count: int
    language_breakdown: list[dict]  # [{'language': 'html', 'errors': N, 'warnings': N, 'info': N}, ...]
    validation_scope: str
    rate_limit_identifier: str


@dataclass(frozen=True)
class ExplainMostImportant:
    issue_id: int
    reason: str


@dataclass(frozen=True)
class ExplainPerIssue:
    issue_id: int
    what: str
    why: str
    impact: str
    recommended_correction: str


@dataclass(frozen=True)
class ExplainResult:
    summary: str
    most_important: list[ExplainMostImportant] = field(default_factory=list)
    why_it_matters: str = ''
    how_to_fix: str = ''
    recommended_order: str = ''
    per_issue: list[ExplainPerIssue] = field(default_factory=list)


class ExplainProvider:
    def explain(self, request: ExplainRequest) -> ExplainResult:
        raise NotImplementedError


def get_default_explain_provider():
    """Explanation is unavailable unless both a provider is selected
    (reuses `LP_AI_REVIEW_PROVIDER` — one AI-availability switch for the
    whole LP Validator, same as AI Review & Fix) and actually configured
    (its API key present) — otherwise `None`, and the view returns
    EXPLAIN_UNAVAILABLE exactly as if this function didn't exist. Text
    explanation is the only feature that ever calls this; the computed
    counts/language-breakdown/fix-method facts the view builds are always
    available regardless, so a missing provider degrades the feature
    rather than breaking it."""
    from django.conf import settings

    if settings.LP_AI_REVIEW_PROVIDER == 'openai' and settings.OPENAI_API_KEY:
        from .openai_provider import OpenAIExplainProvider

        return OpenAIExplainProvider()
    return None

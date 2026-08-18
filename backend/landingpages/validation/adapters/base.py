"""Common adapter interface every validator (HTML today; CSS/JS/TS in later
sprints) must implement, so the orchestrator never needs to know which
concrete engine produced a result."""

from abc import ABC, abstractmethod

from ..schema import ValidationIssueData


class ValidatorAdapter(ABC):
    #: short, stable identifier used as ValidationIssueData.source_engine
    engine_name: str = ''
    #: version string of the underlying engine/library, or '' if not applicable
    engine_version: str = ''
    #: language this adapter validates — 'html' | 'css' | 'javascript' | 'ampscript'
    language: str = ''
    #: profile keys (see validation/profiles.py) this adapter runs under
    supported_profiles: tuple[str, ...] = ()

    @abstractmethod
    def validate(self, source: str, profile: str) -> list[ValidationIssueData]:
        """Validate `source` under `profile`. Must never raise for merely
        malformed input — malformed input is exactly what this exists to
        report as issues. May raise for a genuine engine failure (crash,
        resource exhaustion); the orchestrator catches that and records a
        safe EngineStatus rather than failing the whole request."""

    def normalize_issue(self, raw_issue) -> ValidationIssueData:
        """Optional hook for adapters that want to centralize raw-issue ->
        ValidationIssueData conversion outside validate(). Not required —
        adapters may construct ValidationIssueData directly instead."""
        raise NotImplementedError

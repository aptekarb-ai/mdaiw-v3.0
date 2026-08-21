"""Validation profiles. Sprint 1C: every profile runs the same HTML
adapters (there is only one HTML engine tier so far) — profiles only tune
a small set of rule severities. Later sprints widen this (e.g. 'legacy'
enabling obsolete-element leniency, 'experimental' enabling proposal-stage
CSS/JS syntax) without changing this module's public shape.
"""

from django.db import models

from .schema import SEVERITY_ERROR, SEVERITY_WARNING


class ValidationProfile(models.TextChoices):
    STANDARD = 'standard', 'Standard'
    STRICT = 'strict', 'Strict'
    LEGACY = 'legacy', 'Legacy Compatibility'
    EXPERIMENTAL = 'experimental', 'Experimental'


DEFAULT_PROFILE = ValidationProfile.STANDARD


class ValidationScope(models.TextChoices):
    """Which language(s) a single validate request actually runs — separate
    from `profile` (how strictly) and separate from the frontend's *active
    editor tab* (a pure UI concern, never sent to the backend). 'complete'
    is the only scope where HTML is required and cross-language rules are
    eligible to run; the single-language scopes are strictly narrower, not
    just "complete with the others hidden"."""

    COMPLETE = 'complete', 'Complete LP'
    HTML = 'html', 'HTML Only'
    CSS = 'css', 'CSS Only'
    JAVASCRIPT = 'javascript', 'JavaScript Only'
    # Deprecated — replaced by AMPSCRIPT below. Kept only so existing rows/
    # migration history stay valid and legacy API callers get a stable
    # (if unavailable) response rather than a 400. New frontend code never
    # sends this scope; see AmpscriptConformanceAdapter for the real engine.
    TYPESCRIPT = 'typescript', 'TypeScript Only'
    AMPSCRIPT = 'ampscript', 'AMPscript Only'


DEFAULT_SCOPE = ValidationScope.COMPLETE


def is_known_scope(scope: str) -> bool:
    return scope in ValidationScope.values


class CssSourceType(models.TextChoices):
    """Which syntax the standalone CSS-tab source is written in (Sprint
    CSS-C). 'css' needs no compilation. 'scss'/'sass' compile via Dart
    Sass (see adapters/css_scss_sass.py). 'less' is accepted by the API
    contract now for forward stability but has no engine yet (Sprint
    CSS-D) — engine.py reports it honestly unavailable rather than
    silently validating it as plain CSS."""

    CSS = 'css', 'CSS'
    SCSS = 'scss', 'SCSS'
    SASS = 'sass', 'Sass'
    LESS = 'less', 'LESS'


DEFAULT_CSS_SOURCE_TYPE = CssSourceType.CSS


def is_known_css_source_type(value: str) -> bool:
    return value in CssSourceType.values

# rule_id -> severity override, applied after every adapter has produced its
# issues (see engine.py::_apply_profile_overrides). A rule not listed here
# keeps whatever severity its adapter assigned.
_SEVERITY_OVERRIDES: dict[str, dict[str, str]] = {
    ValidationProfile.STRICT: {
        'missing-h1': SEVERITY_ERROR,
        'missing-meta-description': SEVERITY_ERROR,
        'missing-viewport': SEVERITY_ERROR,
        'stylelint:declaration-no-important': SEVERITY_ERROR,
        'stylelint:no-duplicate-selectors': SEVERITY_ERROR,
        'stylelint:declaration-block-no-duplicate-properties': SEVERITY_ERROR,
        'stylelint:selector-max-specificity': SEVERITY_ERROR,
        'stylelint:block-no-empty': SEVERITY_ERROR,
        'css-custom:insecure-external-url': SEVERITY_ERROR,
        'css-custom:responsive-fixed-width-risk': SEVERITY_ERROR,
        'css-custom:focus-outline-removed': SEVERITY_ERROR,
    },
    ValidationProfile.LEGACY: {
        # Legacy compatibility scope is int deliberately thin for Sprint 1C
        # — obsolete-element detection lands with the full HTML rule set in
        # a later sprint. No overrides yet; the key exists so the profile
        # is selectable and stored now, per the "prepare for future
        # expansion" requirement.
    },
    ValidationProfile.EXPERIMENTAL: {},
}


def apply_severity_override(rule_id: str, severity: str, profile: str) -> str:
    return _SEVERITY_OVERRIDES.get(profile, {}).get(rule_id, severity)


def is_known_profile(profile: str) -> bool:
    return profile in ValidationProfile.values

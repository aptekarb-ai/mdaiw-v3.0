"""Lookup helpers over the per-language rule tables. HTML and the CSS
family (css/scss/sass/less) are populated (Deep Validation sprint,
Checkpoints 1-2) — JavaScript/AMPscript/cross-language are intentionally
empty until their own checkpoint, so `get_rule` simply returns None for
them rather than guessing.

IMPORTANT: every CSS-family ValidationIssueData/ValidationIssue is stamped
`language='css'` regardless of whether the actual source was CSS, SCSS,
Sass, or LESS (see adapters/css_scss_sass.py, adapters/css_less.py) — the
preprocessor distinction lives in rule_id prefix (scss:/sass:/less:) and
source_context, never in the `language` field itself. So the 'css' table
below is the UNION of css.py + scss.py + sass.py + less.py — a lookup by
the real, always-'css' language value finds a scss:/sass:/less: rule just
as well as a css-custom:/stylelint: one. The per-language tables are also
kept independently addressable (get_rules_for_language('scss'), etc.) for
callers that already know which preprocessor they mean.
"""

from .ampscript import AMPSCRIPT_RULES
from .base import Rule
from .css import CSS_RULES
from .html import HTML_RULES
from .javascript import JAVASCRIPT_RULES
from .less import LESS_RULES
from .sass import SASS_RULES
from .scss import SCSS_RULES

_CSS_FAMILY_UNION: dict[str, Rule] = {**CSS_RULES, **SCSS_RULES, **SASS_RULES, **LESS_RULES}

_TABLES: dict[str, dict[str, Rule]] = {
    'html': HTML_RULES,
    'css': _CSS_FAMILY_UNION,
    'scss': SCSS_RULES,
    'sass': SASS_RULES,
    'less': LESS_RULES,
    'javascript': JAVASCRIPT_RULES,
    'ampscript': AMPSCRIPT_RULES,
}


def get_rule(rule_id: str, language: str) -> Rule | None:
    """Exact match first; falls back to a PARAMETRIC family entry (e.g.
    'html5lib:parse-error-foo' -> the 'html5lib:*' family, or
    'stylelint:some-unlisted-rule' -> 'stylelint:*') when the checker that
    raised it mints many distinct codes this project does not enumerate
    individually. Returns None when nothing is catalogued for this
    rule/language yet — callers must treat that as "no guidance
    available", never as an error."""
    table = _TABLES.get(language)
    if table is None:
        return None
    rule = table.get(rule_id)
    if rule is not None:
        return rule
    if ':' in rule_id:
        family_id = rule_id.split(':', 1)[0] + ':*'
        rule = table.get(family_id)
        if rule is not None:
            return rule
    return None


def get_rules_for_language(language: str) -> dict[str, Rule]:
    return dict(_TABLES.get(language, {}))

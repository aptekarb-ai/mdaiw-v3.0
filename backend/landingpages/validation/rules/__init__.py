"""Rule Knowledge Registry — server-owned, versioned project knowledge
about every validation rule the deterministic engines can raise. This is
authoritative: the AI Engineer/AI Review providers are handed the
relevant entry as CONTEXT for a rule they are working on, they do not
invent or "remember" standards themselves (spec: AI Engineer Deep
Validation + Autonomous Repair, section 2/29).

HTML (Checkpoint 1), CSS/SCSS/Sass/LESS (Checkpoint 2), JavaScript
(Checkpoint 3), and AMPscript (Checkpoint 4) are populated so far —
cross-language rules are intentionally empty until their own checkpoint,
see get_rule's docstring.
"""

from .ampscript import AMPSCRIPT_RULES
from .base import Rule
from .css import CSS_RULES
from .html import HTML_RULES
from .javascript import JAVASCRIPT_RULES
from .less import LESS_RULES
from .sass import SASS_RULES
from .scss import SCSS_RULES
from .registry import get_rule, get_rules_for_language

__all__ = [
    'Rule', 'HTML_RULES', 'CSS_RULES', 'SCSS_RULES', 'SASS_RULES', 'LESS_RULES', 'JAVASCRIPT_RULES', 'AMPSCRIPT_RULES',
    'get_rule', 'get_rules_for_language',
]

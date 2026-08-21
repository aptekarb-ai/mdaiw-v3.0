"""Sass (indented syntax) rule table — Deep Validation spec section 20,
Checkpoint 2. Same compiler/pipeline as SCSS (validators_node/compile_scss.mjs
with syntax='indented'), just under the sass: namespace — see rules/scss.py
for the fuller explanation shared by both.
"""

from .base import Rule

_RULES: list[Rule] = [
    Rule(
        rule_id='sass:compile-error', language='sass', category='structure', severity='error',
        description='The Dart Sass compiler could not compile this Sass (indented syntax) source.',
        detection_source='sass-compiler',
        repair_strategy='Correct the construct the compiler identified; the message names the specific defect and includes a targeted suggestion.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='sass:unclosed-comment', language='sass', category='structure', severity='error',
        description='A /* comment is never closed with */.',
        detection_source='sass-compiler', repair_strategy='Add the missing closing */ at the correct point.',
    ),
    Rule(
        rule_id='sass:unclosed-string', language='sass', category='structure', severity='error',
        description='A quoted string is never closed with a matching quote.',
        detection_source='sass-compiler', repair_strategy='Add the missing closing quote.',
    ),
    Rule(
        rule_id='sass:unmatched-closing-brace', language='sass', category='structure', severity='error',
        description='A "}" appears with no matching "{".',
        detection_source='sass-compiler',
        repair_strategy='Remove the stray "}", or add the "{" it was meant to close — requires understanding the intended block structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='sass:unclosed-block', language='sass', category='structure', severity='error',
        description='A "{" is never closed with a matching "}".',
        detection_source='sass-compiler', repair_strategy='Add the missing closing "}" at the correct point.',
    ),
    Rule(
        rule_id='sass:recovery-limited', language='sass', category='structure', severity='info',
        description='Compilation stopped at the first blocking syntax error — later compiler errors in this file have not been discovered yet.',
        detection_source='sass-compiler',
        repair_strategy='Informational only — fix the reported error first, then revalidate to reveal any remaining ones.',
        auto_repair_allowed=False,
    ),
]

SASS_RULES: dict[str, Rule] = {rule.rule_id: rule for rule in _RULES}

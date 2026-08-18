"""SCSS rule table — Deep Validation spec section 20, Checkpoint 2.

Covers SCSS-specific compiler/lint checks (validators_node/compile_scss.mjs,
Dart Sass, run against the ORIGINAL preprocessor source, never generated
CSS). `scss:unclosed-*` come from the same lexical structural-balance
scanner LESS uses, renamed under the scss: namespace as a best-effort
supplemental pass once the primary compile error is found. Once SCSS
compiles, the resulting CSS is validated through the same pipeline CSS
uses — see rules/registry.py's fallback to the 'css' table for that
shared rule_id space (css-custom:*, css-structure:*, stylelint:*, etc.).
"""

from .base import Rule

_RULES: list[Rule] = [
    Rule(
        rule_id='scss:compile-error', language='scss', category='structure', severity='error',
        description='The Dart Sass compiler could not compile this SCSS source.',
        detection_source='scss-compiler',
        repair_strategy='Correct the construct the compiler identified; the message names the specific defect and includes a targeted suggestion.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='scss:unclosed-comment', language='scss', category='structure', severity='error',
        description='A /* comment is never closed with */.',
        detection_source='scss-compiler', repair_strategy='Add the missing closing */ at the correct point.',
    ),
    Rule(
        rule_id='scss:unclosed-string', language='scss', category='structure', severity='error',
        description='A quoted string is never closed with a matching quote.',
        detection_source='scss-compiler', repair_strategy='Add the missing closing quote.',
    ),
    Rule(
        rule_id='scss:unmatched-closing-brace', language='scss', category='structure', severity='error',
        description='A "}" appears with no matching "{".',
        detection_source='scss-compiler',
        repair_strategy='Remove the stray "}", or add the "{" it was meant to close — requires understanding the intended block structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='scss:unclosed-block', language='scss', category='structure', severity='error',
        description='A "{" is never closed with a matching "}".',
        detection_source='scss-compiler', repair_strategy='Add the missing closing "}" at the correct point.',
    ),
    Rule(
        rule_id='scss:recovery-limited', language='scss', category='structure', severity='info',
        description='Compilation stopped at the first blocking syntax error — later compiler errors in this file have not been discovered yet.',
        detection_source='scss-compiler',
        repair_strategy='Informational only — fix the reported error first, then revalidate to reveal any remaining ones.',
        auto_repair_allowed=False,
    ),
]

SCSS_RULES: dict[str, Rule] = {rule.rule_id: rule for rule in _RULES}

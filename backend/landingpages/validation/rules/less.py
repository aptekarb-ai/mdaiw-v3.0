"""LESS rule table — Deep Validation spec section 20, Checkpoint 2.

Covers LESS-specific compiler/lint checks (validators_node/compile_less.mjs,
run against the ORIGINAL preprocessor source, never generated CSS). Once
LESS compiles, the resulting CSS is validated through the same pipeline
CSS uses — see validation/rules/registry.py's fallback to the 'css' table
for that shared rule_id space (css-custom:*, css-structure:*, stylelint:*,
etc.), so those are not duplicated here.
"""

from .base import Rule

_RULES: list[Rule] = [
    Rule(
        rule_id='less:compile-error', language='less', category='structure', severity='error',
        description='The LESS compiler (the real one, less.js) could not compile this source.',
        detection_source='less-compiler',
        repair_strategy='Correct the construct the compiler identified; the message names the specific defect.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='less:incomplete-variable-declaration', language='less', category='structure', severity='error',
        description='A LESS variable (@name: ...;) has no value before its terminator.',
        detection_source='less-compiler',
        repair_strategy='Provide the intended value, or remove the declaration if it is dead.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='less:possibly-undefined-variable', language='less', category='value', severity='warning',
        description='A LESS variable (@name) is used but no matching @name: ... declaration was found in this source (it may come from an unshown imported file).',
        detection_source='less-compiler',
        repair_strategy='Declare the variable before use, or fix a typo — never invent a plausible value for an undeclared variable.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='less:invalid-mixin-call-punctuation', language='less', category='structure', severity='error',
        description='A mixin call is missing its closing ")".',
        detection_source='less-compiler',
        repair_strategy='Add the missing ")" before the ";" that closes the mixin call.',
    ),
    Rule(
        rule_id='less:trailing-comma-in-mixin-call', language='less', category='structure', severity='warning',
        description='A mixin call has a trailing comma before its closing ")".',
        detection_source='less-compiler',
        repair_strategy='Remove the trailing comma from the mixin call\'s argument list.',
    ),
    Rule(
        rule_id='less:stray-trailing-token', language='less', category='structure', severity='error',
        description='An unexpected token (~, ^, $, or `) appears at the end of a line, right after ";" or "}".',
        detection_source='less-compiler',
        repair_strategy='Remove the unexpected token; verify nested rules and the parent block have matching closing braces.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='less:missing-semicolon', language='less', category='structure', severity='error',
        description='A "property: value" declaration is missing its closing ";" before the next declaration/block-close.',
        detection_source='less-compiler',
        repair_strategy='Add the missing ";" at the end of the declaration.',
    ),
    Rule(
        rule_id='less:recovery-limited', language='less', category='structure', severity='info',
        description='The compiler\'s error-recovery pass stopped early — later findings in this file may not have been discovered.',
        detection_source='less-compiler',
        repair_strategy='Informational only — fix the earlier reported errors first, then revalidate to see what remains.',
        auto_repair_allowed=False,
    ),
]

LESS_RULES: dict[str, Rule] = {rule.rule_id: rule for rule in _RULES}

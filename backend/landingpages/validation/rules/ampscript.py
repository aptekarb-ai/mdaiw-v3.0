"""AMPscript rule table — Deep Validation spec section 20, Checkpoint 4.

Every entry documents a rule this project's own AMPscript analyzer
(validation/ampscript/*.py — a hand-written tokenizer/parser, not a
third-party linter) actually raises. No parametric families here: this
analyzer mints a fixed, fully enumerable set of rule_ids (unlike
html5lib/Nu/Stylelint/ESLint's large third-party rule catalogs), so every
rule is catalogued individually.
"""

from .base import Rule

_RULES: list[Rule] = [
    # --- Delimiter/region structure (blocks.py) -----------------------------
    Rule(
        rule_id='ampscript:too-many-regions', language='ampscript', category='syntax', severity='info',
        description='More than 500 %%[ ]%% / %%= =%% regions were found; remaining content was not analyzed (resource bound).',
        detection_source='ampscript-blocks', repair_strategy='Informational only.', auto_repair_allowed=False,
    ),
    Rule(
        rule_id='ampscript:unexpected-closing-delimiter', language='ampscript', category='syntax', severity='error',
        description='"]%%" or "=%%" was found without a matching opening delimiter.',
        detection_source='ampscript-blocks',
        repair_strategy='Remove the stray closing delimiter, or add the matching opener it was meant to close — requires understanding the intended block boundaries.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:empty-block', language='ampscript', category='syntax', severity='warning',
        description='"%%[ ]%%" block has no AMPscript content.',
        detection_source='ampscript-blocks',
        repair_strategy='Remove the empty block, or add its intended content — requires knowing what it was meant to do.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:overlapping-block', language='ampscript', category='syntax', severity='error',
        description='"%%[" was found before the previous block was closed with "]%%".',
        detection_source='ampscript-blocks',
        repair_strategy='Close the previous block before opening a new one — requires understanding the intended block structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:invalid-nested-delimiter', language='ampscript', category='syntax', severity='error',
        description='A block/inline-expression delimiter appears nested inside the wrong kind of region (e.g. "%%=" inside a "%%[ ]%%" block).',
        detection_source='ampscript-blocks',
        repair_strategy='Remove or relocate the misplaced delimiter — requires understanding the intended structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:empty-inline-expression', language='ampscript', category='syntax', severity='error',
        description='"%%= =%%" has no expression.',
        detection_source='ampscript-blocks',
        repair_strategy='Remove the empty inline expression, or add its intended expression — requires knowing what it was meant to output.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:unterminated-block', language='ampscript', category='syntax', severity='error',
        description='A "%%[" block is missing its closing "]%%".',
        detection_source='ampscript-blocks', repair_strategy='Add the missing "]%%" at the correct point.',
    ),
    Rule(
        rule_id='ampscript:unterminated-inline-expression', language='ampscript', category='syntax', severity='error',
        description='A "%%=" expression is missing its closing "=%%".',
        detection_source='ampscript-blocks', repair_strategy='Add the missing "=%%" at the correct point.',
    ),

    # --- Control flow (parser.py) -------------------------------------------
    Rule(
        rule_id='ampscript:if-missing-then', language='ampscript', category='syntax', severity='error',
        description='IF or ELSEIF is missing its required THEN keyword.',
        detection_source='ampscript-parser', repair_strategy='Add THEN after the IF/ELSEIF condition.',
    ),
    Rule(
        rule_id='ampscript:elseif-without-if', language='ampscript', category='syntax', severity='error',
        description='ELSEIF was found without a matching IF.',
        detection_source='ampscript-parser',
        repair_strategy='Remove the stray ELSEIF, or add the missing IF it belongs to — requires understanding the intended branch structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:elseif-after-else', language='ampscript', category='syntax', severity='error',
        description='ELSEIF cannot appear after ELSE in the same IF block.',
        detection_source='ampscript-parser',
        repair_strategy='Reorder so ELSEIF branches all come before ELSE, or remove the misplaced ELSEIF — requires understanding the intended branch order.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:else-without-if', language='ampscript', category='syntax', severity='error',
        description='ELSE was found without a matching IF.',
        detection_source='ampscript-parser',
        repair_strategy='Remove the stray ELSE, or add the missing IF it belongs to — requires understanding the intended branch structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:duplicate-else', language='ampscript', category='syntax', severity='error',
        description='This IF already has an ELSE — a second ELSE for the same IF is invalid.',
        detection_source='ampscript-parser',
        repair_strategy='Remove the duplicate ELSE, or merge its intended logic into the existing one — requires understanding the intended branch logic.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:endif-without-if', language='ampscript', category='syntax', severity='error',
        description='ENDIF was found without a matching IF.',
        detection_source='ampscript-parser',
        repair_strategy='Remove the stray ENDIF, or add the missing IF it belongs to — requires understanding the intended block structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:if-without-endif', language='ampscript', category='syntax', severity='error',
        description='This IF has no matching ENDIF.',
        detection_source='ampscript-parser', repair_strategy='Add the missing ENDIF at the correct point (end of the intended conditional block).',
    ),
    Rule(
        rule_id='ampscript:for-invalid-loop-variable', language='ampscript', category='syntax', severity='error',
        description='FOR must be followed by a "@" loop variable.',
        detection_source='ampscript-parser',
        repair_strategy='Add the intended loop variable name after FOR — requires knowing the intended variable name.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:for-missing-do', language='ampscript', category='syntax', severity='error',
        description='FOR is missing its required DO keyword.',
        detection_source='ampscript-parser', repair_strategy='Add DO after the FOR loop\'s range expression.',
    ),
    Rule(
        rule_id='ampscript:next-without-for', language='ampscript', category='syntax', severity='error',
        description='NEXT was found without a matching FOR.',
        detection_source='ampscript-parser',
        repair_strategy='Remove the stray NEXT, or add the missing FOR it belongs to — requires understanding the intended loop structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:for-without-next', language='ampscript', category='syntax', severity='error',
        description='This FOR has no matching NEXT.',
        detection_source='ampscript-parser', repair_strategy='Add the missing NEXT at the correct point (end of the intended loop body).',
    ),
    Rule(
        rule_id='ampscript:while-missing-do', language='ampscript', category='syntax', severity='error',
        description='WHILE is missing its required DO keyword.',
        detection_source='ampscript-parser', repair_strategy='Add DO after the WHILE condition.',
    ),
    Rule(
        rule_id='ampscript:endwhile-without-while', language='ampscript', category='syntax', severity='error',
        description='ENDWHILE was found without a matching WHILE.',
        detection_source='ampscript-parser',
        repair_strategy='Remove the stray ENDWHILE, or add the missing WHILE it belongs to — requires understanding the intended loop structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:while-without-endwhile', language='ampscript', category='syntax', severity='error',
        description='This WHILE has no matching ENDWHILE.',
        detection_source='ampscript-parser', repair_strategy='Add the missing ENDWHILE at the correct point (end of the intended loop body).',
    ),
    Rule(
        rule_id='ampscript:unterminated-string', language='ampscript', category='syntax', severity='error',
        description='A string literal is missing its closing quote.',
        detection_source='ampscript-parser', repair_strategy='Add the missing closing quote.',
    ),
    Rule(
        rule_id='ampscript:unterminated-comment', language='ampscript', category='syntax', severity='error',
        description='A /* comment is missing its closing */.',
        detection_source='ampscript-parser', repair_strategy='Add the missing closing */.',
    ),

    # --- Variables (variables.py) -------------------------------------------
    Rule(
        rule_id='ampscript:variable-missing-at-prefix', language='ampscript', category='syntax', severity='error',
        description='An AMPscript variable name after VAR/SET does not begin with "@".',
        detection_source='ampscript-variables', repair_strategy='Add the missing "@" prefix to the variable name.',
    ),
    Rule(
        rule_id='ampscript:variable-undeclared', language='ampscript', category='syntax', severity='warning',
        description='A variable is used before it is declared with VAR or SET.',
        detection_source='ampscript-variables',
        repair_strategy='Add a VAR or SET declaration before first use — requires knowing the intended initial value/type.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:variable-duplicate-declaration', language='ampscript', category='syntax', severity='warning',
        description='A variable is declared with VAR more than once.',
        detection_source='ampscript-variables', repair_strategy='Remove the duplicate VAR declaration.',
    ),

    # --- Functions (functions.py) -------------------------------------------
    Rule(
        rule_id='ampscript:missing-parenthesis', language='ampscript', category='syntax', severity='error',
        description='A function call is missing its closing ")".',
        detection_source='ampscript-functions', repair_strategy='Add the missing closing ")".',
    ),
    Rule(
        rule_id='ampscript:unknown-function', language='ampscript', category='syntax', severity='warning',
        description='The called function is not in the project\'s known AMPscript function registry (may still be a valid function the registry does not list).',
        detection_source='ampscript-functions',
        repair_strategy='Verify the function name against real AMPscript/SFMC documentation — never invent or assume a signature that is not already known.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='ampscript:function-parameter-count', language='ampscript', category='syntax', severity='error',
        description='A known function is called with the wrong number of arguments for its registered signature.',
        detection_source='ampscript-functions',
        repair_strategy='Add/remove arguments to match the expected count — requires knowing the intended real argument values, never fabricated ones.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='ampscript:missing-comma', language='ampscript', category='syntax', severity='warning',
        description='A function-call argument appears to contain two values with no operator between them, suggesting a missing comma.',
        detection_source='ampscript-functions',
        repair_strategy='Add the missing comma between the two argument values.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Security / CloudPages (security.py, cloudpages.py) ------------------
    Rule(
        rule_id='ampscript:hardcoded-secret', language='ampscript', category='security', severity='warning',
        description='A variable whose name suggests it holds a credential (password/secret/api key/token) is assigned a literal string.',
        detection_source='ampscript-security',
        repair_strategy='Move the secret to secure SFMC Business Unit configuration; never hard-code it in AMPscript — requires knowing the real secure-storage setup.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='ampscript:unsanitized-request-parameter', language='ampscript', category='security', severity='warning',
        description='A value from RequestParameter()/QueryParameter() is output directly (%%=@x=%%) with no validation/encoding step.',
        detection_source='ampscript-cloudpages',
        repair_strategy='Validate/encode the value before output — the correct validation depends on the real expected input shape and cannot be invented.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='ampscript:unsafe-treat-as-content', language='ampscript', category='security', severity='warning',
        description='TreatAsContent() renders its argument as raw markup/AMPscript — a risk if the value is not trusted.',
        detection_source='ampscript-cloudpages',
        repair_strategy='Confirm the value is trusted (not derived from unvalidated input) — requires knowing the real data flow.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='ampscript:unsafe-redirect', language='ampscript', category='security', severity='warning',
        description='RedirectTo() target comes from a variable rather than a fixed literal — an open-redirect risk.',
        detection_source='ampscript-cloudpages',
        repair_strategy='Validate the destination against an allowlist — requires knowing the real allowed destinations.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='ampscript:empty-data-extension-name', language='ampscript', category='security', severity='error',
        description='InsertData()/UpdateData()/UpsertData()/DeleteData() was called with an empty Data Extension name.',
        detection_source='ampscript-cloudpages',
        repair_strategy='Supply the real, intended Data Extension name — must never be invented.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='ampscript:destructive-data-operation', language='ampscript', category='security', severity='warning',
        description='DeleteData() permanently removes Data Extension rows.',
        detection_source='ampscript-cloudpages',
        repair_strategy='Informational/confirmatory only — verify the filter conditions are correct before this runs; never auto-modify a destructive data operation.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
]

AMPSCRIPT_RULES: dict[str, Rule] = {rule.rule_id: rule for rule in _RULES}

"""CSS rule table — Deep Validation spec section 20, Checkpoint 2.

Every entry documents a rule this project's own Node bridge pipeline
(validators_node/css_engine.mjs, run via node_bridge.py) actually raises.
`css-custom:*`, `css-structure:*`, `css-semantic:*`, `css-compatibility:*`
are this project's OWN AST-based checks (not Stylelint's) — each gets its
own concrete entry. `stylelint:*` covers stylelint-config-standard, which
this project extends wholesale (dozens of built-in rules) plus ten rules
this project explicitly configures on top of it — those ten get their own
concrete entries (deliberate, project-owned choices); everything else
stylelint-config-standard covers is documented as the `stylelint:*`
family rather than enumerated one by one.
"""

from .base import Rule

_RULES: list[Rule] = [
    # --- This project's own AST-based checks (css-custom:*) ----------------
    Rule(
        rule_id='css-custom:unsafe-javascript-url', language='css', category='security', severity='error',
        description='A declaration or @import uses a javascript: URL — a script-injection vector.',
        detection_source='css-conformance',
        repair_strategy='Remove the javascript: URL; CSS must never reference executable script.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:large-data-url', language='css', category='performance', severity='warning',
        description='A url() embeds a very large data: URL (over 5000 characters).',
        detection_source='css-conformance',
        repair_strategy='Reference an external asset instead of a large inline data URL — requires knowing the real asset.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='css-custom:insecure-external-url', language='css', category='security', severity='warning',
        description='A declaration or @import references a non-HTTPS (http://) external URL.',
        detection_source='css-conformance',
        repair_strategy='Change the URL scheme to https:// when the resource is available over HTTPS.',
        requires_context=True,
    ),
    Rule(
        rule_id='css-custom:responsive-fixed-width-risk', language='css', category='responsive', severity='warning',
        description='A width/min-width/max-width declaration uses a large fixed px value with no surrounding @media/@container.',
        detection_source='css-conformance',
        repair_strategy='Use a relative unit, a smaller max-width, or add a responsive @media override — requires knowing the intended breakpoints.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:focus-outline-removed', language='css', category='accessibility', severity='warning',
        description='"outline: none/0" removes the default focus indicator with no visible replacement (e.g. box-shadow).',
        detection_source='css-conformance',
        repair_strategy='Add a visible focus replacement (e.g. box-shadow) alongside the outline removal.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:small-font-size', language='css', category='accessibility', severity='warning',
        description='font-size is smaller than ~12px, which may be hard to read.',
        detection_source='css-conformance',
        repair_strategy='Increase to at least 12px (or the relative-unit equivalent) — the exact right size is a design decision.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:extreme-line-height', language='css', category='accessibility', severity='warning',
        description='A unitless line-height is outside the typical readable range (1.0-3.0).',
        detection_source='css-conformance',
        repair_strategy='Set line-height to a value between about 1.2 and 2 for readable body text.',
    ),
    Rule(
        rule_id='css-custom:text-clipping-risk', language='css', category='accessibility', severity='warning',
        description='"overflow: hidden" combined with a small fixed height risks clipping text content.',
        detection_source='css-conformance',
        repair_strategy='Use a larger/content-based height, or allow overflow — the right choice depends on intended layout.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:motion-without-reduced-motion', language='css', category='accessibility', severity='warning',
        description='animation/transition is used with no accompanying @media (prefers-reduced-motion: reduce) override.',
        detection_source='css-conformance',
        repair_strategy='Add a @media (prefers-reduced-motion: reduce) block that disables or reduces the motion.',
    ),
    Rule(
        rule_id='css-custom:suspicious-z-index', language='css', category='syntax', severity='warning',
        description='z-index uses an unusually extreme value (magnitude over 9999).',
        detection_source='css-conformance',
        repair_strategy='Use a smaller, deliberately managed z-index scale — the right value depends on the stacking context.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:empty-at-rule-condition', language='css', category='syntax', severity='error',
        description='@media/@supports/@container is missing its required condition.',
        detection_source='css-conformance',
        repair_strategy='Add the missing condition (e.g. "(min-width: 40rem)") — the intended breakpoint/feature query must be inferred or supplied.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:keyframes-missing-name', language='css', category='syntax', severity='error',
        description='@keyframes is missing its required animation name.',
        detection_source='css-conformance',
        repair_strategy='Add a name for the keyframes block, then update any animation-name declarations that reference it.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:negative-invalid-dimension', language='css', category='syntax', severity='error',
        description='A dimension property (width/height/padding/font-size/...) has a negative value, which is invalid for that property.',
        detection_source='css-conformance',
        repair_strategy='Replace with a non-negative value — the intended value must be inferred from context.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-custom:modern-feature-compatibility-notice', language='css', category='syntax', severity='info',
        description='(legacy profile only) Uses a modern CSS feature that may not be supported by older targeted browsers.',
        detection_source='css-conformance',
        repair_strategy='Informational only — provide a fallback if older-browser support is required.',
        auto_repair_allowed=False,
    ),
    # Tool-Grounded AI Engineer sprint, spec section 14 — Complete LP
    # cross-language check (validation/engine.py::
    # _check_css_selectors_reference_html). repair_strategy is EXACTLY
    # 'Informational only.' (not a longer sentence like the notice above)
    # so fixes/iterative.py::_is_advisory_only's exact-match check
    # classifies it correctly — this finding can never be safely auto-
    # resolved (which side is wrong, the selector or the markup, is a
    # human call), so it belongs in issues_advisory_total, not
    # issues_requires_input_total (which is reserved for findings an AI
    # proposal actively declined with requires_configuration=True).
    Rule(
        rule_id='cross-language:css-selector-missing-target', language='css', category='value', severity='warning',
        description='A CSS selector references an id/class that does not exist anywhere in the HTML.',
        detection_source='cross-language-html-css',
        repair_strategy='Informational only.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Structural scan (css-structure:*) ----------------------------------
    Rule(
        rule_id='css-structure:unclosed-comment', language='css', category='structure', severity='error',
        description='A /* comment is never closed with */.',
        detection_source='css-conformance',
        repair_strategy='Add the missing closing */ at the correct point.',
    ),
    Rule(
        rule_id='css-structure:unclosed-string', language='css', category='structure', severity='error',
        description='A quoted string is never closed with a matching quote.',
        detection_source='css-conformance',
        repair_strategy='Add the missing closing quote.',
    ),
    Rule(
        rule_id='css-structure:unmatched-closing-brace', language='css', category='structure', severity='error',
        description='A "}" appears with no matching "{".',
        detection_source='css-conformance',
        repair_strategy='Remove the stray "}", or add the "{" it was meant to close — requires understanding the intended block structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='css-structure:unclosed-block', language='css', category='structure', severity='error',
        description='A "{" is never closed with a matching "}".',
        detection_source='css-conformance',
        repair_strategy='Add the missing closing "}" at the correct point (end of the intended rule/at-rule body).',
    ),
    Rule(
        rule_id='css-structure:parse-error', language='css', category='structure', severity='error',
        description='The css-tree structural/semantic parser could not parse the document at this point.',
        detection_source='css-conformance',
        repair_strategy='Correct the malformed construct the parser identified; the message names the specific defect.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Semantic / compatibility (css-semantic:*, css-compatibility:*) ----
    Rule(
        rule_id='css-semantic:unknown-property', language='css', category='property', severity='error',
        description='A declaration uses a property name not recognized by the standards-derived grammar database.',
        detection_source='css-conformance',
        repair_strategy='Correct the property name (usually a typo).',
    ),
    Rule(
        rule_id='css-semantic:invalid-value', language='css', category='value', severity='error',
        description='A declaration\'s value does not match the expected grammar for its property.',
        detection_source='css-conformance',
        repair_strategy='Replace the value with one matching the property\'s expected syntax (given in the finding\'s suggestion).',
    ),
    Rule(
        rule_id='css-compatibility:unrecognized-vendor-property', language='css', category='compatibility', severity='info',
        description='A vendor-prefixed property (-webkit-/-moz-/-ms-/-o-) is not recognized by the validator\'s data set.',
        detection_source='css-conformance',
        repair_strategy='Informational only — verify real browser support for this vendor-prefixed property.',
        auto_repair_allowed=False,
    ),

    # --- Explicitly project-configured Stylelint rules ----------------------
    # This project's own additions on top of stylelint-config-standard (see
    # css_engine.mjs::buildStylelintConfig) — deliberate, not inherited
    # defaults, so each gets its own entry.
    Rule(
        rule_id='stylelint:block-no-empty', language='css', category='syntax', severity='warning',
        description='A rule/at-rule block has no declarations.',
        detection_source='stylelint', repair_strategy='Remove the empty block, or add its intended declarations.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='stylelint:declaration-block-no-duplicate-properties', language='css', category='syntax', severity='warning',
        description='The same property is declared more than once in one rule block.',
        detection_source='stylelint', repair_strategy='Remove the earlier, overridden duplicate (keep the one that reflects intent).',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='stylelint:declaration-no-important', language='css', category='maintainability', severity='warning',
        description='A declaration uses !important.',
        detection_source='stylelint',
        repair_strategy='Remove !important and resolve the specificity conflict directly — requires understanding the surrounding cascade.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='stylelint:no-duplicate-selectors', language='css', category='syntax', severity='warning',
        description='The same selector is used in more than one rule in the stylesheet.',
        detection_source='stylelint',
        repair_strategy='Merge the duplicate rules into one, or differentiate the selectors — requires understanding intended scope.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='stylelint:no-unknown-animations', language='css', category='syntax', severity='warning',
        description='animation-name references a @keyframes name that is not defined anywhere in the stylesheet.',
        detection_source='stylelint',
        repair_strategy='Add the missing @keyframes block, or fix the referenced name — requires knowing the intended animation.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='stylelint:property-no-unknown', language='css', category='property', severity='warning',
        description='A declaration uses a property name Stylelint does not recognize.',
        detection_source='stylelint', repair_strategy='Correct the property name (usually a typo).',
    ),
    Rule(
        rule_id='stylelint:at-rule-no-unknown', language='css', category='syntax', severity='warning',
        description='An @-rule name is not recognized (modern at-rules like @container/@layer/@property/@scope/@starting-style are explicitly allowed).',
        detection_source='stylelint', repair_strategy='Correct the at-rule name (usually a typo).',
    ),
    Rule(
        rule_id='stylelint:function-no-unknown', language='css', category='value', severity='warning',
        description='A value uses a CSS function name Stylelint does not recognize.',
        detection_source='stylelint', repair_strategy='Correct the function name (usually a typo).',
    ),
    Rule(
        rule_id='stylelint:unit-no-unknown', language='css', category='value', severity='warning',
        description='A value uses a unit Stylelint does not recognize.',
        detection_source='stylelint', repair_strategy='Correct the unit (usually a typo, e.g. "pxx" for "px").',
    ),
    Rule(
        rule_id='stylelint:function-url-quotes', language='css', category='syntax', severity='warning',
        description='A url() function argument is not quoted (stylelint-config-standard requires quotes around url() arguments).',
        detection_source='stylelint', repair_strategy='Wrap the url() argument in quotes, e.g. url("path/to/asset").',
    ),
    Rule(
        rule_id='stylelint:selector-max-specificity', language='css', category='maintainability', severity='warning',
        description='A selector exceeds the project\'s configured maximum specificity (0,3,0).',
        detection_source='stylelint',
        repair_strategy='Simplify the selector (fewer combined classes/attributes) — requires understanding what the selector needs to match.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Parametric family ----------------------------------------------------
    Rule(
        rule_id='stylelint:*', language='css', category='syntax', severity='warning',
        description='A rule from stylelint-config-standard (this project extends it wholesale) — one of many possible built-in rule ids not individually catalogued here.',
        detection_source='stylelint',
        repair_strategy='Correct the construct the rule identified; the message and rule id name the specific defect.',
        auto_repair_allowed=False, requires_context=True, is_family=True,
    ),
]

CSS_RULES: dict[str, Rule] = {rule.rule_id: rule for rule in _RULES}

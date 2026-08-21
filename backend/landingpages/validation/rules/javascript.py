"""JavaScript rule table — Deep Validation spec section 20, Checkpoint 3.

Every entry documents a rule this project's own Node bridge pipeline
(validators_node/js_engine.mjs, ESLint's Linter class, run via
node_bridge.py) actually raises. `mdaiw-security/*` and `mdaiw-lp/*` are
this project's OWN custom ESLint rules (security + landing-page-specific
checks no core ESLint rule covers) — each gets its own concrete entry.
Six core ESLint rules are explicitly, deliberately enabled on top of
`@eslint/js`'s recommended config (see buildConfig) and get their own
entries too. The REST of the recommended set (no-undef, no-unreachable,
no-const-assign, ...) is NOT catalogued, even as a family: unlike the
html5lib:/nu:/stylelint: rule ids elsewhere in this registry, core ESLint
rule ids carry no colon-prefixed namespace to pattern-match on (they're
bare names like "no-undef"), so there is no reliable way to distinguish
"an uncatalogued core ESLint rule" from any other bare identifier.
get_rule() correctly returns None for these — "no guidance available" is
the honest answer, not a fabricated family match. Submitted JavaScript is
only ever parsed and walked as an AST — never executed."""

from .base import Rule

_RULES: list[Rule] = [
    # --- Custom security rules (mdaiw-security/*) ---------------------------
    Rule(
        rule_id='mdaiw-security/document-write', language='javascript', category='security', severity='warning',
        description='document.write()/document.writeln() can inject unsanitized markup into the page and blocks streaming parsing.',
        detection_source='eslint',
        repair_strategy='Update the DOM via safe APIs (textContent, createElement, or a sanitized template) instead.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='mdaiw-security/innerhtml-assignment', language='javascript', category='security', severity='error',
        description='Assigning innerHTML/outerHTML with unsanitized content is a cross-site-scripting risk.',
        detection_source='eslint',
        repair_strategy='Sanitize the content first, or use textContent when only plain text is intended.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='mdaiw-security/insert-adjacent-html', language='javascript', category='security', severity='error',
        description='insertAdjacentHTML() with unsanitized content is a cross-site-scripting risk.',
        detection_source='eslint',
        repair_strategy='Sanitize the content first, or build DOM nodes with createElement instead.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='mdaiw-security/dynamic-script-src', language='javascript', category='security', severity='warning',
        description='Assigning a dynamic (non-literal) value to a created <script> element\'s src can load untrusted code.',
        detection_source='eslint',
        repair_strategy='Load scripts only from a fixed, trusted, literal URL.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='mdaiw-security/wildcard-postmessage', language='javascript', category='security', severity='error',
        description='postMessage() with a wildcard ("*") target origin can leak data to any page.',
        detection_source='eslint',
        repair_strategy='Specify the exact expected origin instead of "*" — requires knowing the real target origin.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='mdaiw-security/unsafe-redirect', language='javascript', category='security', severity='warning',
        description='Redirecting (location assignment/location.assign/location.replace) to a non-literal, unvalidated destination is an open-redirect risk.',
        detection_source='eslint',
        repair_strategy='Validate the destination against an allowlist before redirecting — requires knowing the allowed destinations.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='mdaiw-security/hardcoded-secret', language='javascript', category='security', severity='warning',
        description='A variable/property/assignment whose name looks like a credential (api_key/secret/token/password/auth) is assigned a string literal 8+ characters long.',
        detection_source='eslint',
        repair_strategy='Move the secret to server-side configuration; never ship it in client-side JavaScript — requires knowing the real secret-management setup.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='mdaiw-security/prototype-pollution', language='javascript', category='security', severity='error',
        description='Assigning to a dynamic "__proto__"/"constructor"/"prototype" computed key can pollute the object prototype.',
        detection_source='eslint',
        repair_strategy='Use a Map, or validate the key against an allowlist before assignment.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='mdaiw-security/untrusted-dynamic-import', language='javascript', category='security', severity='warning',
        description='Dynamic import() with a non-literal specifier can load an untrusted module path.',
        detection_source='eslint',
        repair_strategy='Import from a fixed, literal module specifier — requires knowing the real intended module.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='mdaiw-security/mixed-content-url', language='javascript', category='security', severity='warning',
        description='A string literal references a resource over an insecure http:// connection.',
        detection_source='eslint', repair_strategy='Use an https:// URL for this resource.',
    ),
    Rule(
        rule_id='mdaiw-security/sensitive-storage', language='javascript', category='security', severity='warning',
        description='localStorage/sessionStorage.setItem() is called with a key that looks sensitive (password/secret/token/ssn/credit card/cvv/pin).',
        detection_source='eslint',
        repair_strategy='Avoid storing sensitive values in client-side storage; use a secure, server-managed session instead — requires redesigning the storage approach.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),

    # --- Custom landing-page rules (mdaiw-lp/*) -----------------------------
    Rule(
        rule_id='mdaiw-lp/missing-selector-target', language='javascript', category='value', severity='warning',
        description='getElementById()/querySelector("#id") references an id that does not exist anywhere in the HTML document (only checked when HTML context is available, i.e. Complete LP scope).',
        detection_source='eslint',
        repair_strategy='Correct the selector to a real id, or add the missing element to the HTML — requires cross-language context (spec section 9).',
        auto_repair_allowed=False, requires_context=True,
    ),
    # Correctness-pass sprint — the advisory counterpart to
    # missing-selector-target above. repair_strategy is EXACTLY
    # 'Informational only.' so fixes/iterative.py::_is_advisory_only's
    # exact-match check classifies it correctly: this finding means the
    # code ALREADY handles the absent element safely (every use is
    # null-checked), so it is never offered to AI Fix Issues, never
    # counted in issues_requires_input_total, and never blocks the
    # "all repairable issues fixed" success banner.
    Rule(
        rule_id='mdaiw-lp/optional-selector-target', language='javascript', category='value', severity='info',
        description='getElementById()/querySelector("#id") references an id absent from the HTML, but every use of the result is already null-checked (optional chaining, if/ternary, &&/||) — an intentionally optional DOM target.',
        detection_source='eslint',
        repair_strategy='Informational only.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='mdaiw-lp/unchecked-selector-access', language='javascript', category='value', severity='warning',
        description='A variable assigned from getElementById()/querySelector() is used (member/call access) without a null-check, and the selector match is not guaranteed.',
        detection_source='eslint',
        repair_strategy='Guard the access with an if-check or optional chaining (?.) before using the result.',
    ),

    # --- Explicitly project-configured core ESLint rules ---------------------
    Rule(
        rule_id='no-eval', language='javascript', category='security', severity='error',
        description='Use of eval() — arbitrary code execution risk.',
        detection_source='eslint', repair_strategy='Replace eval() with a safe, specific alternative (e.g. JSON.parse for data, direct property access for lookups) — requires understanding what the eval() call was meant to do.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='no-new-func', language='javascript', category='security', severity='error',
        description='Use of the Function constructor — arbitrary code execution risk, equivalent to eval().',
        detection_source='eslint', repair_strategy='Replace with a normal function declaration/expression — requires understanding the intended behavior.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='no-implied-eval', language='javascript', category='security', severity='error',
        description='A string is passed to setTimeout/setInterval (or similar), which implicitly evaluates it like eval().',
        detection_source='eslint', repair_strategy='Pass a function reference instead of a string.',
    ),
    Rule(
        rule_id='no-script-url', language='javascript', category='security', severity='error',
        description='A javascript: URL is used (e.g. as an href) — a script-injection-adjacent anti-pattern.',
        detection_source='eslint', repair_strategy='Replace with a real event handler / real URL; remove the javascript: URL.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='no-unused-expressions', language='javascript', category='syntax', severity='warning',
        description='An expression statement\'s result is unused (likely a typo, e.g. a missing assignment or call).',
        detection_source='eslint', repair_strategy='Requires understanding intent — likely a missing "=" or forgotten side effect.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='no-shadow', language='javascript', category='syntax', severity='warning',
        description='A variable declaration shadows a variable of the same name from an outer scope.',
        detection_source='eslint', repair_strategy='Rename the inner variable to something distinct.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='complexity', language='javascript', category='maintainability', severity='warning',
        description='(strict profile only) A function\'s cyclomatic complexity exceeds the configured threshold (15).',
        detection_source='eslint', repair_strategy='Split the function into smaller, single-purpose functions — requires understanding its logic.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Structural / compatibility ------------------------------------------
    Rule(
        rule_id='javascript:parse-error', language='javascript', category='syntax', severity='error',
        description='ESLint\'s bundled Espree parser could not parse the source at all (a fatal syntax error).',
        detection_source='eslint',
        repair_strategy='Fix the syntax error the parser identified FIRST — every other finding in this file is hidden until the source parses (spec section 7).',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='mdaiw-compat:modern-feature-notice', language='javascript', category='compatibility', severity='info',
        description='(legacy profile only) Uses a modern JavaScript feature (optional chaining, nullish coalescing, private fields, top-level await) that may not be supported by older targeted browsers/engines.',
        detection_source='eslint', repair_strategy='Informational only — provide a fallback/transpilation step if older-target support is required.',
        auto_repair_allowed=False,
    ),
]

JAVASCRIPT_RULES: dict[str, Rule] = {rule.rule_id: rule for rule in _RULES}

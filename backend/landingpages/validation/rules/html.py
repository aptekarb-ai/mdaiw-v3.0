"""HTML rule table — Deep Validation spec section 2/3, Checkpoint 1.

Every entry below documents a rule this project's OWN deterministic
adapters (backend/landingpages/validation/adapters/html_*.py) already
raise — nothing here is invented; `detection_source`/`standards_reference`
values are copied from the adapter that actually produces the rule.
Parametric families (html5lib:*, nu:*) are documented as families
(`is_family=True`) rather than one entry per possible underlying message
code, since those checkers mint many distinct codes this project does not
enumerate individually.
"""

from .base import Rule

_WHATWG_SYNTAX = 'https://html.spec.whatwg.org/multipage/syntax.html#syntax-tag-omission'
_WHATWG_START_TAGS = 'https://html.spec.whatwg.org/multipage/syntax.html#start-tags'
_WHATWG_PARSE_ERRORS = 'https://html.spec.whatwg.org/multipage/parsing.html#parse-errors'
_NU_CHECKER = 'https://validator.github.io/validator/'

_RULES: list[Rule] = [
    # --- Document shell (html_structure.py) --------------------------------
    Rule(
        rule_id='missing-doctype', language='html', category='syntax', severity='error',
        description='Document is missing "<!DOCTYPE html>".',
        detection_source='html-structure', standards_reference=_WHATWG_SYNTAX,
        repair_strategy='Insert "<!DOCTYPE html>" as the first line of the document.',
        related_rules=('missing-html', 'missing-head', 'missing-body'),
    ),
    Rule(
        rule_id='missing-html', language='html', category='syntax', severity='error',
        description='Document is missing a required "<html>" element.',
        detection_source='html-structure', standards_reference=_WHATWG_SYNTAX,
        repair_strategy='Wrap the document in a single <html>...</html> element containing <head> and <body>.',
        auto_repair_allowed=False, requires_context=True,
        related_rules=('missing-doctype', 'missing-head', 'missing-body'),
    ),
    Rule(
        rule_id='missing-head', language='html', category='syntax', severity='error',
        description='Document is missing a required "<head>" element.',
        detection_source='html-structure', standards_reference=_WHATWG_SYNTAX,
        repair_strategy='Add a <head> element as the first child of <html>, before <body>.',
        auto_repair_allowed=False, requires_context=True,
        related_rules=('missing-html', 'missing-charset', 'missing-viewport'),
    ),
    Rule(
        rule_id='missing-body', language='html', category='syntax', severity='error',
        description='Document is missing a required "<body>" element.',
        detection_source='html-structure', standards_reference=_WHATWG_SYNTAX,
        repair_strategy='Add a <body> element as the second child of <html>, after <head>.',
        auto_repair_allowed=False, requires_context=True,
        related_rules=('missing-html', 'missing-head'),
    ),
    Rule(
        rule_id='unclosed-tag', language='html', category='syntax', severity='error',
        description='An element was opened but never explicitly closed before an ancestor or the document ended.',
        detection_source='html-structure', standards_reference=_WHATWG_SYNTAX,
        repair_strategy=(
            'Insert the matching closing tag at the point the element actually ends. Only safe to auto-apply '
            'when exactly one orphaned element is involved (unambiguous nesting); otherwise requires manual review.'
        ),
        related_rules=('unexpected-closing-tag',),
    ),
    Rule(
        rule_id='unclosed-tag-independent', language='html', category='syntax', severity='error',
        description=(
            'Lexical scanner cross-check variant of unclosed-tag — an independent tag-stack scan reports the '
            'same class of defect using its own opening-position tracking.'
        ),
        detection_source='html-lexical', standards_reference=_WHATWG_SYNTAX,
        repair_strategy='Same as unclosed-tag: insert the matching closing tag at the correct point.',
        related_rules=('unclosed-tag',),
    ),
    Rule(
        rule_id='unexpected-closing-tag', language='html', category='syntax', severity='error',
        description='A closing tag was found with no matching open element anywhere on the stack.',
        detection_source='html-structure', standards_reference=_WHATWG_SYNTAX,
        repair_strategy='Requires manual review — could mean a stray tag, or a missing opening tag earlier in the document.',
        auto_repair_allowed=False,
    ),
    Rule(
        rule_id='unexpected-closing-tag-independent', language='html', category='syntax', severity='error',
        description='Lexical scanner cross-check variant of unexpected-closing-tag.',
        detection_source='html-lexical', standards_reference=_WHATWG_SYNTAX,
        repair_strategy='Same as unexpected-closing-tag — requires manual review.',
        auto_repair_allowed=False, related_rules=('unexpected-closing-tag',),
    ),
    Rule(
        rule_id='malformed-start-tag', language='html', category='syntax', severity='error',
        description='A start tag could not be parsed as written (invalid character in a tag/attribute name, etc).',
        detection_source='html-lexical', standards_reference=_WHATWG_START_TAGS,
        repair_strategy='Requires manual review — the exact correction depends on what the author actually meant to write.',
        auto_repair_allowed=False,
    ),
    Rule(
        rule_id='duplicate-id', language='html', category='syntax', severity='error',
        description='The same id attribute value is used on more than one element.',
        detection_source='html-structure',
        repair_strategy='Rename the later duplicate to a unique id; update any fragment links that pointed to it.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='duplicate-title', language='html', category='seo', severity='warning',
        description='Document has more than one "<title>" element.',
        detection_source='html-structure',
        repair_strategy='Remove every <title> after the first; never insert a NEW title when one already exists elsewhere in the document.',
        related_rules=('missing-title',),
    ),

    # --- Head metadata (html_seo.py) ---------------------------------------
    Rule(
        rule_id='missing-charset', language='html', category='seo', severity='warning',
        description='Document is missing a character-encoding declaration.',
        detection_source='html-seo',
        repair_strategy='Insert <meta charset="utf-8"> as the FIRST child of <head>.',
        related_rules=('charset-declared-late',),
    ),
    Rule(
        rule_id='charset-declared-late', language='html', category='seo', severity='warning',
        description='The character-encoding declaration is not among the first elements in <head>.',
        detection_source='html-seo',
        repair_strategy=(
            'MOVE the existing <meta charset> declaration to be the first child of <head> — never insert a second '
            'charset declaration, never rebuild <head>/<html> to do this.'
        ),
        related_rules=('missing-charset',),
    ),
    Rule(
        rule_id='missing-viewport', language='html', category='responsive', severity='warning',
        description='Document is missing a viewport meta tag.',
        detection_source='html-seo',
        repair_strategy='Insert <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
        related_rules=('multiple-viewport', 'viewport-missing-width-device-width'),
    ),
    Rule(
        rule_id='multiple-viewport', language='html', category='responsive', severity='warning',
        description='Document declares more than one viewport meta tag.',
        detection_source='html-seo',
        repair_strategy='Remove every viewport meta tag after the first.',
        related_rules=('missing-viewport',),
    ),
    Rule(
        rule_id='viewport-missing-width-device-width', language='html', category='responsive', severity='warning',
        description='The viewport meta tag does not include "width=device-width".',
        detection_source='html-responsive',
        repair_strategy='Add "width=device-width" to the viewport meta tag\'s content attribute.',
        related_rules=('missing-viewport',),
    ),
    Rule(
        rule_id='missing-meta-description', language='html', category='seo', severity='warning',
        description='Document is missing a meta description tag.',
        detection_source='html-seo',
        repair_strategy='Insert <meta name="description" content="..."> inside <head>.',
        auto_repair_allowed=False, requires_context=True,
        related_rules=('empty-meta-description', 'multiple-meta-description'),
    ),
    Rule(
        rule_id='empty-meta-description', language='html', category='seo', severity='warning',
        description='The meta description tag has no content.',
        detection_source='html-seo',
        repair_strategy='Fill in a real, page-specific description — cannot be inferred automatically.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
        related_rules=('missing-meta-description',),
    ),
    Rule(
        rule_id='multiple-meta-description', language='html', category='seo', severity='warning',
        description='Document declares more than one meta description tag.',
        detection_source='html-seo',
        repair_strategy='Remove every meta description tag after the first.',
        related_rules=('missing-meta-description',),
    ),
    Rule(
        rule_id='missing-lang', language='html', category='accessibility', severity='warning',
        description='"<html>" is missing a lang attribute.',
        detection_source='html-seo',
        repair_strategy='Add lang="en" (or the document\'s actual language) to the existing <html> start tag only — never rebuild head/body.',
        related_rules=('invalid-lang-format',),
    ),
    Rule(
        rule_id='invalid-lang-format', language='html', category='accessibility', severity='warning',
        description='The lang attribute value is not a valid BCP 47 language tag format.',
        detection_source='html-seo',
        repair_strategy='Replace the value with a valid BCP 47 tag (e.g. "en", "en-US").',
        related_rules=('missing-lang',),
    ),
    Rule(
        rule_id='missing-h1', language='html', category='seo', severity='warning',
        description='Document has no top-level <h1> heading.',
        detection_source='html-seo',
        repair_strategy='Add one <h1> describing the page — cannot be inferred automatically.',
        auto_repair_allowed=False, requires_context=True, requires_external_input=True,
    ),
    Rule(
        rule_id='skipped-heading-level', language='html', category='accessibility', severity='warning',
        description='A heading level was skipped (e.g. an <h2> followed directly by an <h4>).',
        detection_source='html-seo',
        repair_strategy='Requires manual review — inserting/renumbering headings can change the page\'s intended structure.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='broken-fragment-link', language='html', category='seo', severity='warning',
        description='An in-page link (href="#id") references an id that does not exist in the document.',
        detection_source='html-seo',
        repair_strategy='Fix the href to a real id, or add the missing id to its intended target — cannot be inferred automatically.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Accessibility (html_accessibility.py) ------------------------------
    Rule(
        rule_id='missing-alt', language='html', category='accessibility', severity='warning',
        description='An <img> element has no alt attribute.',
        detection_source='html-accessibility',
        repair_strategy='Add alt="" for a purely decorative image, or a real description when one can be inferred; otherwise requires input.',
        requires_context=True,
    ),
    Rule(
        rule_id='missing-form-label', language='html', category='accessibility', severity='warning',
        description='A form control has no associated accessible label.',
        detection_source='html-accessibility',
        repair_strategy='Associate a <label for="..."> or aria-label with the control — cannot be inferred automatically without the intended field name.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='invalid-aria-reference', language='html', category='accessibility', severity='warning',
        description='An aria-* attribute (e.g. aria-labelledby) references an id that does not exist.',
        detection_source='html-accessibility',
        repair_strategy='Fix the reference to a real id, or add the missing target — cannot be inferred automatically.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Embedded sources (html_inline_event_handler.py, html_style_block.py) ---
    Rule(
        rule_id='html-inline-event-handler:missing-function-reference', language='html', category='syntax', severity='warning',
        description='An inline event-handler attribute (onclick=, etc.) references a function that is not defined anywhere in the page\'s script.',
        detection_source='html-inline-event-handler',
        repair_strategy='Define the referenced function, or fix the reference — requires knowing the intended behavior.',
        auto_repair_allowed=False, requires_context=True,
    ),
    Rule(
        rule_id='html-style-block:preprocessor-not-compiled-in-browser', language='html', category='syntax', severity='warning',
        description='A <style> block contains SCSS/LESS syntax the browser cannot execute directly (only plain CSS runs in an inline <style> tag).',
        detection_source='html-style-block',
        repair_strategy='Compile the preprocessor source to plain CSS before it reaches the browser, or convert the block to plain CSS.',
        auto_repair_allowed=False, requires_context=True,
    ),

    # --- Parametric families -------------------------------------------------
    Rule(
        rule_id='html5lib:*', language='html', category='syntax', severity='error',
        description='A parse error reported by the html5lib reference-implementation parser (one of many possible message codes).',
        detection_source='html-conformance', standards_reference=_WHATWG_PARSE_ERRORS,
        repair_strategy='Correct the malformed construct the parser identified; the message names the specific defect.',
        auto_repair_allowed=False, requires_context=True, is_family=True,
    ),
    Rule(
        rule_id='nu:*', language='html', category='syntax', severity='error',
        description='A conformance error/warning reported by the W3C/WHATWG Nu Html Checker (one of many possible message types).',
        detection_source='nu-html-checker', standards_reference=_NU_CHECKER,
        repair_strategy='Correct the construct the checker identified; the message names the specific defect.',
        auto_repair_allowed=False, requires_context=True, is_family=True,
    ),
    Rule(
        rule_id='parser-error', language='html', category='syntax', severity='error',
        description='The adapter itself could not parse the document at all (a catastrophic, not-otherwise-classified failure).',
        detection_source='html-structure / html-responsive',
        repair_strategy='Requires manual review — the source could not be parsed well enough to identify a specific defect.',
        auto_repair_allowed=False, requires_context=True,
    ),
]

HTML_RULES: dict[str, Rule] = {rule.rule_id: rule for rule in _RULES}

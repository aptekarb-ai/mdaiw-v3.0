"""Feature 14 V2 — Email AI Engineer, Phase A (Engine Foundation).
Deterministic command provider + the shared action allow-list validator,
mirroring yukti/providers.py exactly: `EmailCommandProvider.resolve(message,
context)` is the interface every provider (deterministic, local, or
OpenAI) implements; `RuleBasedEmailCommandProvider` is the always-
available, zero-network baseline and permanent fallback; `validate_action()`
re-checks EVERY provider's output (including the deterministic router's
own) against the same allow-list, so a misbehaving provider can never
produce anything this function wouldn't also accept from the trusted
router — same defense-in-depth as yukti/views.py's `_validate_action`.

Phase A replaces Feature 14 V1's hand-typed 5-module allow-list
(SUPPORTED_MODULE_TYPES / ALLOWED_PROPS_BY_TYPE) with the generated
module-capability manifest (module_capabilities.py, built from
shared/module-capabilities.generated.json — itself generated from
frontend/src/emailbuilder/moduleRegistry.tsx, the ONE source of truth).
Every one of the registry's 53 module types is now a valid `module_type`
in an action; which PROPS are AI-editable on a given type, and their
value semantics (color/number/url/image_asset/etc.), come entirely from
that manifest — there is no second, independently-maintained module or
prop list anywhere in this file.

This is still a natural-language COMMAND router, not a code/content
generator: every action it can propose maps directly onto the EXISTING
builder mutation functions the frontend already exposes (add/update/
delete/duplicate a module, or a bounded global-style sweep) — never a
parallel mutation system, never arbitrary property paths, never raw
HTML/JS.

Composite/repeatable-list fields (header nav links, product cards, social
platform links, feature/icon-text rows) are DELIBERATELY not AI-editable
in Phase A — approved decision: defer rather than approximate. Every
manifest field this module validates is a flat scalar leaf.
"""

import re
from dataclasses import dataclass

from . import module_capabilities
from .composition import compose_from_brief
from .custom_css_security import MAX_CUSTOM_CSS_LENGTH, validate_custom_css_security
from .knowledge.rules import find_rule

MAX_MESSAGE_LENGTH = 500
MAX_GENERATED_MODULES = 5
# D4-E3G — a single conversational compound request naming more than
# this many distinct existing modules is already well past what "make
# the hero heading smaller, CTA green, and footer centered" means —
# bounded the same way MAX_GENERATED_MODULES/MAX_COMPOSITION_ITEMS
# already bound their own operation counts.
MAX_MULTI_MODULE_OPERATIONS = 8

# --- C-2 remediation: deterministic (no-LLM) weak-text-contrast fix -----
#
# Mirrors emailValidation.ts's own contrastRatio()/relativeLuminance()
# formula exactly (same WCAG 2.x math, same 6-digit-hex-only scope) so the
# deterministic router's notion of "passes AA" never diverges from what
# Validation Center itself will report on revalidation. This is a
# DIFFERENT algorithm from emailValidation.ts's jointlySafeReadableColor
# (which only ever snaps to pure black/white and requires the result to
# also survive dark-mode inversion) — this one nudges the EXISTING
# foreground color's own lightness by the smallest amount that clears the
# threshold, preserving hue/brand intent, per the "smallest practical
# adjustment" requirement. Never a second repair engine: this only ever
# produces a prop value for the SAME UPDATE_MODULE_PROPS action every
# other style command already returns, going through the same
# validate_action()/mutation/undo/revalidate path.
WCAG_AA_NORMAL_TEXT_RATIO = 4.5
_HEX_COLOR_RE = re.compile(r'^#?([0-9a-fA-F]{6})$')


def _hex_to_rgb(value):
    if not isinstance(value, str):
        return None
    match = _HEX_COLOR_RE.match(value.strip())
    if not match:
        return None
    hex_digits = match.group(1)
    return tuple(int(hex_digits[i:i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(rgb):
    r, g, b = (max(0, min(255, round(c))) for c in rgb)
    return f'#{r:02x}{g:02x}{b:02x}'


def _relative_luminance(rgb):
    def channel(c):
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def _contrast_ratio(hex_a, hex_b):
    rgb_a = _hex_to_rgb(hex_a)
    rgb_b = _hex_to_rgb(hex_b)
    if rgb_a is None or rgb_b is None:
        return None
    lum_a = _relative_luminance(rgb_a)
    lum_b = _relative_luminance(rgb_b)
    lighter, darker = max(lum_a, lum_b), min(lum_a, lum_b)
    return (lighter + 0.05) / (darker + 0.05)


def _rgb_to_hsl(rgb):
    r, g, b = (c / 255 for c in rgb)
    mx, mn = max(r, g, b), min(r, g, b)
    lightness = (mx + mn) / 2
    if mx == mn:
        return 0.0, 0.0, lightness
    d = mx - mn
    saturation = d / (2 - mx - mn) if lightness > 0.5 else d / (mx + mn)
    if mx == r:
        hue = (g - b) / d + (6 if g < b else 0)
    elif mx == g:
        hue = (b - r) / d + 2
    else:
        hue = (r - g) / d + 4
    return hue / 6, saturation, lightness


def _hue_to_rgb_channel(p, q, t):
    if t < 0:
        t += 1
    if t > 1:
        t -= 1
    if t < 1 / 6:
        return p + (q - p) * 6 * t
    if t < 1 / 2:
        return q
    if t < 2 / 3:
        return p + (q - p) * (2 / 3 - t) * 6
    return p


def _hsl_to_rgb(hue, saturation, lightness):
    if saturation == 0:
        channel = lightness * 255
        return channel, channel, channel
    q = lightness * (1 + saturation) if lightness < 0.5 else lightness + saturation - lightness * saturation
    p = 2 * lightness - q
    r = _hue_to_rgb_channel(p, q, hue + 1 / 3)
    g = _hue_to_rgb_channel(p, q, hue)
    b = _hue_to_rgb_channel(p, q, hue - 1 / 3)
    return r * 255, g * 255, b * 255


def minimal_readable_foreground(foreground_hex, background_hex, target=WCAG_AA_NORMAL_TEXT_RATIO):
    """The smallest same-hue lightness adjustment to `foreground_hex` that
    reaches `target` contrast against `background_hex`, or None when this
    cannot be resolved automatically:
      - either color isn't a plain 6-digit hex (unknown/transparent/
        gradient background, or any color this deterministic check can't
        reason about) — never guessed;
      - the pair already passes (nothing to fix);
      - the foreground is already at the lightness extreme in its natural
        direction (e.g. already pure white against a background it still
        can't clear) — pushing further isn't possible, and flipping to
        the opposite pole would be a large change, not the smallest
        practical one, so this declines rather than forcing it.
    Returns {'old_color', 'new_color', 'old_ratio', 'new_ratio'} on success.
    """
    fg_rgb = _hex_to_rgb(foreground_hex)
    bg_rgb = _hex_to_rgb(background_hex)
    if fg_rgb is None or bg_rgb is None:
        return None
    old_ratio = _contrast_ratio(foreground_hex, background_hex)
    if old_ratio is None or old_ratio >= target:
        return None

    hue, saturation, lightness = _rgb_to_hsl(fg_rgb)
    fg_lum = _relative_luminance(fg_rgb)
    bg_lum = _relative_luminance(bg_rgb)
    # Push the foreground's lightness AWAY from the background's own
    # luminance — the direction that can plausibly increase contrast
    # without crossing over the background (which would be a much bigger
    # perceptual change than "smallest practical adjustment").
    direction = 1 if fg_lum >= bg_lum else -1

    step = 0.01
    new_lightness = lightness
    for _ in range(100):
        new_lightness += direction * step
        if new_lightness < 0.0 or new_lightness > 1.0:
            return None
        candidate_rgb = _hsl_to_rgb(hue, saturation, new_lightness)
        candidate_hex = _rgb_to_hex(candidate_rgb)
        new_ratio = _contrast_ratio(candidate_hex, background_hex)
        if new_ratio is not None and new_ratio >= target:
            return {
                'old_color': foreground_hex, 'new_color': candidate_hex,
                'old_ratio': round(old_ratio, 2), 'new_ratio': round(new_ratio, 2),
            }
    return None

# Words a user might say that map onto one of the deterministic router's
# INSERT_MODULE vocabulary. Deliberately still bounded to the original
# "basic" 5 types — expanding NL insert recognition to the full 53-type
# registry by name (e.g. "add a hero image cta section") is open-ended
# content-authoring work, out of Phase A's scope (infrastructure, not
# vocabulary). This does NOT limit which types can be edited once
# selected — see _extract_style_patch below, which is manifest-driven
# and therefore already works for any of the 53 types.
MODULE_TYPE_ALIASES = {
    'text': 'text', 'paragraph': 'text', 'copy': 'text',
    'heading': 'text', 'headings': 'text', 'title': 'text', 'titles': 'text',
    'image': 'image', 'photo': 'image', 'picture': 'image',
    'button': 'button', 'cta': 'button',
    'divider': 'divider', 'line': 'divider', 'separator': 'divider',
    'spacer': 'spacer', 'space': 'spacer', 'gap': 'spacer',
}

# Brand tokens (DESIGN_SYSTEM.md) plus a handful of common color words —
# never arbitrary CSS color keywords, so "make it look nice" can't resolve
# to something unreviewed. A bare `#rrggbb` the user types is also
# accepted (checked separately, see `_resolve_color`).
COLOR_WORDS = {
    'brand green': '#76C043', 'green': '#76C043', 'accent': '#76C043',
    'brand blue': '#0082AD', 'blue': '#0082AD',
    'dark': '#002D38', 'navy': '#002D38', 'brand dark': '#002D38',
    'white': '#FFFFFF',
    'black': '#333333', 'charcoal': '#333333',
    'red': '#B42318',
    'gray': '#66777D', 'grey': '#66777D',
    # D4-E3F — three of the nine commonly-requested email-builder colors
    # this checkpoint verifies (red/green/blue/black/white/gray were
    # already present; yellow/orange/purple were not, in ANY language,
    # including English — not a multilingual gap specifically, a genuine
    # missing-value gap this checkpoint's own explicit color list
    # surfaced). Chosen as legible, moderate tones consistent with the
    # existing entries' own posture (e.g. 'red' is #B42318, not a raw
    # #FF0000) — real, usable values, not literal CSS keyword colors.
    'yellow': '#F2B705', 'orange': '#E8590C', 'purple': '#7C3AED',
}
_HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
_UNSAFE_URL_PREFIXES = ('javascript:', 'data:', 'vbscript:')

# Sub-phase 6 closure — mirrors frontend/src/emailbuilder/vml.ts's
# supportsVmlButtonPattern/supportsVmlBackgroundPattern. These are now
# THIN WRAPPERS over the module-capability manifest's own
# supportsBulletproofCta/supportsBulletproofBackground flags (see
# module_capabilities.supports_bulletproof_cta/_background) — never a
# second, hand-maintained module-type list here. Covered by
# EmailAiEngineerVmlActionTests's cross-check against vml.ts's own values.
def _is_vml_button_module(module_type):
    return module_capabilities.supports_bulletproof_cta(module_type)


def _is_vml_background_module(module_type):
    return module_capabilities.supports_bulletproof_background(module_type)

# Sub-phase 6, work package D — the bounded, explicit allow-list of
# EmailModuleSettings keys the AI may ever patch via UPDATE_MODULE_SETTINGS.
# Deliberately NOT the whole settings object (outerSpacing/columnGutter
# remain manual-Properties-panel-only) — same "small, explicit, never
# arbitrary" posture _validate_patch already enforces for props via the
# capability manifest.
_SETTINGS_BOOLEAN_FIELDS = frozenset({'outlookVml', 'mobileStack'})
_SETTINGS_ENUM_FIELDS = {'visibility': frozenset({'all', 'hideMobile', 'hideDesktop'})}

# R4-B4 §1/§2 — CHANGE_SPACING. Desktop padding only (mobile inherits
# desktop unless separately overridden, same convention every other
# spacing UI in this app already follows — see edm.ts's own
# resolveSpacing() docstring); bounded 0-200px, matching this app's
# existing padding-slider ranges elsewhere. Every value is validated
# here — a proposal can never carry an out-of-range or non-numeric
# padding value, regardless of which provider produced it.
_SETTINGS_NESTED_NUMERIC_FIELDS = {
    'desktop': {
        'paddingTop': (0, 200), 'paddingRight': (0, 200), 'paddingBottom': (0, 200), 'paddingLeft': (0, 200),
    },
}


def _validate_settings_patch(patch):
    if not isinstance(patch, dict):
        return None
    safe = {}
    for key, value in patch.items():
        if key in _SETTINGS_BOOLEAN_FIELDS:
            if isinstance(value, bool):
                safe[key] = value
            continue
        allowed_values = _SETTINGS_ENUM_FIELDS.get(key)
        if allowed_values is not None and value in allowed_values:
            safe[key] = value
            continue
        nested_fields = _SETTINGS_NESTED_NUMERIC_FIELDS.get(key)
        if nested_fields is not None and isinstance(value, dict):
            safe_nested = {}
            for nested_key, nested_value in value.items():
                bounds = nested_fields.get(nested_key)
                if bounds is None:
                    continue
                if isinstance(nested_value, bool) or not isinstance(nested_value, (int, float)):
                    continue
                low, high = bounds
                if low <= nested_value <= high:
                    safe_nested[nested_key] = nested_value
            if safe_nested:
                safe[key] = safe_nested
    return safe or None


# Sub-phase 6 — mirrors layoutModel.ts's MIN_COLUMN_WIDTH_PERCENT, so a
# structural RESTRUCTURE_LAYOUT proposal can never even be VALIDATED with
# an unusably thin column, let alone applied.
MIN_COLUMN_WIDTH_PERCENT = 10
COLUMN_WIDTH_TOTAL_TOLERANCE = 0.5


class ActionType:
    INSERT_MODULE = 'INSERT_MODULE'
    UPDATE_MODULE_PROPS = 'UPDATE_MODULE_PROPS'
    DELETE_MODULE = 'DELETE_MODULE'
    DUPLICATE_MODULE = 'DUPLICATE_MODULE'
    APPLY_GLOBAL_STYLE = 'APPLY_GLOBAL_STYLE'
    NONE = 'NONE'

    # Email Document Standards Sub-phase 2 — document-level (not EDM/
    # module-level) actions. Pulled forward per approved decision: the AI
    # Engineer may PROPOSE these, never apply them silently — same
    # proposal-before-apply contract as every other action type here.
    SET_RESET_CSS_ENABLED = 'SET_RESET_CSS_ENABLED'
    SET_CUSTOM_CSS_ENABLED = 'SET_CUSTOM_CSS_ENABLED'
    SET_CUSTOM_CSS = 'SET_CUSTOM_CSS'
    CLEAR_CUSTOM_CSS = 'CLEAR_CUSTOM_CSS'

    # Sub-phase 4, item 3 — pulled forward the remaining document-level
    # settings (title/subject/favicon) onto the SAME proposal-before-apply
    # contract as the CSS actions above. No new mutation system: the
    # frontend applies every one of these through
    # builder.updateDocumentSettings, exactly like DocumentSettingsDialog's
    # own Apply button.
    SET_EMAIL_TITLE = 'SET_EMAIL_TITLE'
    SET_EMAIL_SUBJECT = 'SET_EMAIL_SUBJECT'
    SET_FAVICON = 'SET_FAVICON'
    CLEAR_FAVICON = 'CLEAR_FAVICON'

    # Reserved for later Feature 14 V2 phases (Phase C's Repair Engine /
    # Phase D's composition work) — named NOW so the wire contract never
    # needs a breaking rename later, but NOT implemented in Phase A.
    # validate_action() recognizes these as valid `type` values yet always
    # safely reduces them to NONE rather than rejecting the whole action —
    # see IMPLEMENTED below.
    INSERT_NESTED_MODULE = 'INSERT_NESTED_MODULE'
    UPDATE_MODULE_SETTINGS = 'UPDATE_MODULE_SETTINGS'
    RESTRUCTURE_LAYOUT = 'RESTRUCTURE_LAYOUT'
    APPLY_OUTLOOK_WRAPPER = 'APPLY_OUTLOOK_WRAPPER'
    APPLY_VML_PATTERN = 'APPLY_VML_PATTERN'
    REPLACE_UNSUPPORTED_PROPERTY = 'REPLACE_UNSUPPORTED_PROPERTY'

    # Sub-phase 6, work package E — structured add/update/remove/reorder
    # editing for a module's repeatable/composite field (nav links, social
    # links, product cards, feature/icon-text rows), validated item-by-item
    # against the manifest's repeatableField.itemSchema. Not part of the
    # original six reserved names (there was no reserved name for this),
    # but follows the exact same "named, validated, routes through an
    # existing mutator" contract.
    UPDATE_REPEATABLE_FIELD = 'UPDATE_REPEATABLE_FIELD'

    # Sub-phase 7 — the composition engine's one action type: an ORDERED
    # list of composition items (see composition.py's CompositionItem),
    # each an existing registered module type + validated patch, with
    # optional one-level-nested children (layout columns) or seeded
    # repeatable-field items. Never a second mutation system — the
    # frontend applies this through ONE new batch mutator
    # (useEmailBuilderState.ts's addComposedModules) built from the SAME
    # createModule/createDefaultColumns/repeatableField primitives every
    # other insert path already uses.
    COMPOSE_EMAIL = 'COMPOSE_EMAIL'

    # D4-E3 item 7/8 — the ONE compound-request action type for the SAME
    # currently-selected module: bundles a props patch AND a settings
    # patch (e.g. "make this button green, increase the padding to 20px,
    # and center it" — color+align live under UPDATE_MODULE_PROPS,
    # padding lives under UPDATE_MODULE_SETTINGS's nested desktop object;
    # those are two separate, mutually exclusive action types otherwise).
    # Always `target: 'selected'` — same convention as UPDATE_MODULE_PROPS/
    # UPDATE_MODULE_SETTINGS. D4-E3G — deliberately preserved AS single-
    # module; cross-module requests use the SEPARATE MULTI_MODULE_UPDATE
    # type below rather than overloading this one's contract.
    # Each half is validated through the EXACT SAME field-level validators
    # UPDATE_MODULE_PROPS/UPDATE_MODULE_SETTINGS already use — never a
    # second, parallel validation path — and applied through the EXISTING
    # applyRepairPatch batch-commit primitive (frontend), so the whole
    # thing lands as ONE undo step, exactly like a repair batch already does.
    BATCH_UPDATE = 'BATCH_UPDATE'

    # D4-E3G — cross-module compound requests ("make the hero heading
    # smaller, CTA green, and center the footer text"). Each `operations`
    # entry carries its OWN `target_module_id` (resolved CLIENT-SIDE by
    # ReferenceResolver.ts — see that file's own docstring on why: this
    # app never sends the live module tree to any AI provider, so a
    # model can never invent a module id here that wasn't already handed
    # to it as a `resolved_targets` context entry) plus the SAME
    # props_patch/settings_patch shape BATCH_UPDATE already uses for one
    # module. Every operation is validated, scope-gated, and semantic-
    # gate-corrected INDEPENDENTLY (see validate_action()/apply_scope_gate()/
    # apply_semantic_consistency_gate()'s own MULTI_MODULE_UPDATE
    # branches) — an invalid or scope-creeping operation is dropped on
    # its own, never trusted because the outer envelope validated.
    # Applied through the SAME applyRepairPatch batch-commit primitive
    # BATCH_UPDATE uses, just with multiple distinct module ids instead
    # of one — still exactly ONE history/Undo entry (applyRepairPatch's
    # own contract, unchanged).
    MULTI_MODULE_UPDATE = 'MULTI_MODULE_UPDATE'

    values = frozenset({
        INSERT_MODULE, UPDATE_MODULE_PROPS, DELETE_MODULE, DUPLICATE_MODULE, APPLY_GLOBAL_STYLE, NONE,
        INSERT_NESTED_MODULE, UPDATE_MODULE_SETTINGS, RESTRUCTURE_LAYOUT,
        APPLY_OUTLOOK_WRAPPER, APPLY_VML_PATTERN, REPLACE_UNSUPPORTED_PROPERTY, UPDATE_REPEATABLE_FIELD,
        SET_RESET_CSS_ENABLED, SET_CUSTOM_CSS_ENABLED, SET_CUSTOM_CSS, CLEAR_CUSTOM_CSS,
        SET_EMAIL_TITLE, SET_EMAIL_SUBJECT, SET_FAVICON, CLEAR_FAVICON,
        COMPOSE_EMAIL, BATCH_UPDATE, MULTI_MODULE_UPDATE,
    })

    IMPLEMENTED = frozenset({
        INSERT_MODULE, UPDATE_MODULE_PROPS, DELETE_MODULE, DUPLICATE_MODULE, APPLY_GLOBAL_STYLE,
        SET_RESET_CSS_ENABLED, SET_CUSTOM_CSS_ENABLED, SET_CUSTOM_CSS, CLEAR_CUSTOM_CSS,
        SET_EMAIL_TITLE, SET_EMAIL_SUBJECT, SET_FAVICON, CLEAR_FAVICON,
        # Sub-phase 6, work package D — the six actions reserved (named but
        # not implemented) in Phase A now have real validate_action()
        # branches below, each routing to an EXISTING frontend mutator
        # (updateModuleSettings/insertNestedModule/updateColumnWidths/
        # updateModuleProps) — never a parallel mutation system.
        UPDATE_MODULE_SETTINGS, INSERT_NESTED_MODULE, RESTRUCTURE_LAYOUT,
        APPLY_OUTLOOK_WRAPPER, APPLY_VML_PATTERN, REPLACE_UNSUPPORTED_PROPERTY, UPDATE_REPEATABLE_FIELD,
        COMPOSE_EMAIL, BATCH_UPDATE, MULTI_MODULE_UPDATE,
    })

    # Sub-phase 6 — structural tree changes always require confirmation
    # (master prompt item 8: "Structural actions always require an
    # explicit proposal and confirmation"), same posture as
    # requires_confirmation()'s existing DELETE_MODULE/APPLY_GLOBAL_STYLE
    # rules below. Sub-phase 7 — a full composition is the largest
    # structural change this file can propose, so it always requires
    # confirmation too (see requires_confirmation() below).
    STRUCTURAL = frozenset({RESTRUCTURE_LAYOUT, COMPOSE_EMAIL})

    # Document-level actions never carry a `moduleId`/`module_type` —
    # views.py's resolve_asset_references and the frontend's EDM-mutation
    # dispatch both need to tell these apart from module-scope actions.
    DOCUMENT_SCOPE = frozenset({
        SET_RESET_CSS_ENABLED, SET_CUSTOM_CSS_ENABLED, SET_CUSTOM_CSS, CLEAR_CUSTOM_CSS,
        SET_EMAIL_TITLE, SET_EMAIL_SUBJECT, SET_FAVICON, CLEAR_FAVICON,
    })


class EmailCommandProviderUnavailable(Exception):
    """Raised for any condition meaning this provider cannot answer right
    now — not configured, rate-limited, timed out, or the call itself
    failed. The caller always has a working fallback: the deterministic
    router never raises this and never depends on anything external."""


class EmailCommandProviderTimeout(EmailCommandProviderUnavailable):
    """D4-E2 Local-LLM Reachability + Performance Hardening item 6 —
    a strict subclass so every EXISTING `except EmailCommandProviderUnavailable`
    call site (there are several, each expecting "provider cannot answer,
    fall back") keeps working completely unchanged. Raised ONLY for a
    genuine request timeout (the model was reachable but did not finish
    generating in time), never for "server unreachable"/"malformed
    response"/"rate limited" — those remain plain EmailCommandProviderUnavailable.
    Lets DeterministicFirstEmailCommandProvider distinguish "the LLM
    tried and ran out of time" from every other failure mode, so it can
    say so honestly instead of silently returning a generic decline."""


def _resolve_color(word_or_hex):
    if not isinstance(word_or_hex, str):
        return None
    candidate = word_or_hex.strip()
    if _HEX_RE.match(candidate):
        return candidate.upper()
    return COLOR_WORDS.get(candidate.lower())


def _clean_text_value(value):
    if not isinstance(value, str):
        return None
    trimmed = value.strip().strip('"').strip("'").strip()
    if not trimmed or len(trimmed) > 200:
        return None
    return trimmed


def _clean_url_value(value):
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if trimmed == '':
        return ''
    lowered = trimmed.lower()
    if any(lowered.startswith(prefix) for prefix in _UNSAFE_URL_PREFIXES):
        return None
    if not (lowered.startswith('http://') or lowered.startswith('https://')):
        return None
    if len(trimmed) > 500:
        return None
    return trimmed


# Sentinel key names an {'assetId': ...} / {'url': ...} marker may carry —
# anything else in the dict is ignored, never merged into the marker.
_ASSET_MARKER_ASSET_ID_KEY = 'assetId'
_ASSET_MARKER_URL_KEY = 'url'


def _validate_image_asset_value(value):
    """An `image_asset`-valued field's proposed value must be a marker
    object — {'assetId': <int>} or {'url': <safe http(s) string>} — NEVER
    a bare string, so a provider can never smuggle an arbitrary
    AI-invented image URL through by simply omitting the wrapper. This
    function does ONLY structural/format validation (no DB access, keeps
    validate_action() pure/user-agnostic); asset OWNERSHIP is resolved
    later, per-request, by resolve_asset_references() below."""
    if not isinstance(value, dict):
        return None
    if _ASSET_MARKER_ASSET_ID_KEY in value:
        try:
            asset_id = int(value[_ASSET_MARKER_ASSET_ID_KEY])
        except (TypeError, ValueError):
            return None
        if asset_id <= 0:
            return None
        return {_ASSET_MARKER_ASSET_ID_KEY: asset_id}
    if _ASSET_MARKER_URL_KEY in value:
        url = _clean_url_value(value.get(_ASSET_MARKER_URL_KEY))
        if not url:
            return None
        return {_ASSET_MARKER_URL_KEY: url}
    return None


def _validate_field_value(field, value):
    """One manifest-described field's proposed value -> a safe,
    type-checked value (or an unresolved-but-safe asset marker for
    `image_asset`), or None if it doesn't pass. Dispatches purely on the
    field's `valueType` from the capability manifest — never on the key
    name itself, so this works identically for all 53 module types."""
    value_type = field.get('valueType')
    if value_type == 'color':
        return _resolve_color(value)
    if value_type == 'number':
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        low = field.get('min', float('-inf'))
        high = field.get('max', float('inf'))
        return number if low <= number <= high else None
    if value_type == 'align':
        return value if value in ('left', 'center', 'right') else None
    if value_type == 'url':
        url = _clean_url_value(value)
        return url if url is not None else None
    if value_type == 'image_asset':
        return _validate_image_asset_value(value)
    if value_type == 'boolean':
        return value if isinstance(value, bool) else None
    if value_type == 'select':
        options = {opt.get('value') for opt in (field.get('options') or [])}
        return value if value in options else None
    if value_type in ('text', 'font'):
        return _clean_text_value(value)
    return None


def _validate_patch(module_type, patch):
    """One module type's proposed prop patch -> a safe, type-checked patch
    containing only manifest-known keys with manifest-appropriate value
    shapes, or None if nothing in it survives. Never trusts a key or
    value merely because a provider returned it in the right-looking
    shape — every key must be a real editable field of this exact
    module type per the generated capability manifest."""
    if not isinstance(patch, dict):
        return None
    fields_by_key = {field['key']: field for field in module_capabilities.get_editable_fields(module_type)}
    if not fields_by_key:
        return None

    safe = {}
    for key, value in patch.items():
        field = fields_by_key.get(key)
        if not field:
            continue
        validated = _validate_field_value(field, value)
        if validated is not None:
            safe[key] = validated
    return safe or None


# Sub-phase 7 — composition plan bounds. Mirrors composition.py's own
# MAX_COMPOSITION_ITEMS/MAX_COMPOSITION_CHILDREN_PER_COLUMN constants (not
# imported from there — composition.py imports FROM this module for
# _validate_patch/_validate_field_value, so importing the reverse
# direction here would be circular; these two small integers are
# duplicated rather than restructuring either module's import shape for
# it — see composition.py's own module docstring on the deferred-import
# pattern this pair already uses elsewhere).
MAX_COMPOSITION_ITEMS = 14
MAX_COMPOSITION_CHILDREN_PER_COLUMN = 6


def _validate_composition_item(entry, allow_layout):
    """One composition-plan node -> a safe, normalized node, or None.
    Recurses exactly ONE level (children's own `allow_layout=False` mirrors
    INSERT_NESTED_MODULE's "never nest a layout inside a layout column"
    rule), and validates every patch/repeatable-item value through the
    EXACT SAME manifest-driven gates every other action type uses
    (_validate_patch/_validate_field_value) — a composition item can never
    carry a value a hand-typed UPDATE_MODULE_PROPS action wouldn't also be
    allowed to carry."""
    if not isinstance(entry, dict):
        return None
    module_type = entry.get('module_type')
    if module_type not in module_capabilities.get_all_module_types():
        return None
    capability = module_capabilities.get_module_capability(module_type) or {}
    is_layout = bool(capability.get('isLayout'))
    if is_layout and not allow_layout:
        return None

    patch = _validate_patch(module_type, entry.get('patch') or {}) or {}
    result = {'module_type': module_type, 'patch': patch}

    if is_layout:
        raw_children = entry.get('children')
        column_count = capability.get('columnCount') or 0
        children = []
        if isinstance(raw_children, list) and column_count:
            seen_columns = set()
            for group in raw_children[:column_count]:
                if not isinstance(group, dict):
                    continue
                column_index = group.get('column_index')
                if not isinstance(column_index, int) or isinstance(column_index, bool):
                    continue
                if not (0 <= column_index < column_count) or column_index in seen_columns:
                    continue
                raw_modules = group.get('modules')
                if not isinstance(raw_modules, list):
                    continue
                safe_modules = []
                for child_entry in raw_modules[:MAX_COMPOSITION_CHILDREN_PER_COLUMN]:
                    validated_child = _validate_composition_item(child_entry, allow_layout=False)
                    if validated_child is not None:
                        safe_modules.append(validated_child)
                if safe_modules:
                    seen_columns.add(column_index)
                    children.append({'column_index': column_index, 'modules': safe_modules})
        if children:
            result['children'] = children
        return result

    repeatable = module_capabilities.get_repeatable_field(module_type)
    if repeatable:
        raw_items = entry.get('repeatable_items')
        if isinstance(raw_items, list) and raw_items:
            fields_by_key = {field['key']: field for field in repeatable['itemSchema']}
            max_items = repeatable.get('maxItems') or 20
            safe_items = []
            for raw_item in raw_items[:max_items]:
                if not isinstance(raw_item, dict):
                    continue
                safe_item = {}
                for key, value in raw_item.items():
                    field = fields_by_key.get(key)
                    if not field:
                        continue
                    validated = _validate_field_value(field, value)
                    if validated is not None:
                        safe_item[key] = validated
                if safe_item:
                    safe_items.append(safe_item)
            if safe_items:
                result['repeatable_items'] = safe_items
    return result


def validate_action(action):
    """The shared allow-list gate every provider's output passes through
    (see module docstring) — returns a safe action dict, or None. A
    recognized-but-not-yet-implemented ActionType (see ActionType.
    IMPLEMENTED) safely reduces to {'type': NONE} rather than being
    rejected outright — the caller still gets a well-formed response, it
    just does nothing."""
    if action is None or not isinstance(action, dict):
        return None

    action_type = action.get('type')
    if action_type not in ActionType.values:
        return None

    if action_type not in ActionType.IMPLEMENTED:
        return {'type': ActionType.NONE}

    if action_type in (ActionType.DELETE_MODULE, ActionType.DUPLICATE_MODULE):
        return {'type': action_type, 'target': 'selected'}

    if action_type == ActionType.INSERT_MODULE:
        raw_modules = action.get('modules')
        if not isinstance(raw_modules, list) or not raw_modules:
            return None
        all_types = module_capabilities.get_all_module_types()
        safe_modules = []
        for entry in raw_modules[:MAX_GENERATED_MODULES]:
            if not isinstance(entry, dict):
                continue
            module_type = entry.get('module_type')
            if module_type not in all_types:
                continue
            patch = _validate_patch(module_type, entry.get('patch') or {}) or {}
            safe_modules.append({'module_type': module_type, 'patch': patch})
        if not safe_modules:
            return None
        return {'type': ActionType.INSERT_MODULE, 'modules': safe_modules}

    # REPLACE_UNSUPPORTED_PROPERTY reuses the EXACT SAME manifest-driven
    # single-field-patch gate as UPDATE_MODULE_PROPS — the safest possible
    # property-replacement mechanism already exists (_validate_patch);
    # duplicating it under a new name would be the parallel mutation
    # system the module docstring forbids. The two action types differ
    # only in intent/NL-routing/UI copy, never in validation.
    if action_type in (ActionType.UPDATE_MODULE_PROPS, ActionType.APPLY_GLOBAL_STYLE, ActionType.REPLACE_UNSUPPORTED_PROPERTY):
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return None
        patch = _validate_patch(module_type, action.get('patch'))
        if patch is None:
            return None
        return {'type': action_type, 'target': 'selected', 'module_type': module_type, 'patch': patch}

    if action_type == ActionType.UPDATE_MODULE_SETTINGS:
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return None
        patch = _validate_settings_patch(action.get('patch'))
        if patch is None:
            return None
        return {'type': action_type, 'target': 'selected', 'module_type': module_type, 'patch': patch}

    # D4-E3 item 7/8 — BATCH_UPDATE. Each half reuses the EXACT SAME
    # validators UPDATE_MODULE_PROPS/UPDATE_MODULE_SETTINGS already call
    # (_validate_patch/_validate_settings_patch) — never a second,
    # parallel validation path. At least one half must be present and
    # non-empty (an action with neither is not a real request); either
    # half failing its OWN validator drops just that half (never the
    # whole action) unless BOTH end up empty, in which case the whole
    # thing safely reduces to NONE like any other unvalidatable action.
    if action_type == ActionType.BATCH_UPDATE:
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return None
        props_patch = _validate_patch(module_type, action.get('props_patch')) if action.get('props_patch') else None
        settings_patch = _validate_settings_patch(action.get('settings_patch')) if action.get('settings_patch') else None
        if not props_patch and not settings_patch:
            return {'type': ActionType.NONE}
        return {
            'type': action_type, 'target': 'selected', 'module_type': module_type,
            'props_patch': props_patch, 'settings_patch': settings_patch,
        }

    # D4-E3G — MULTI_MODULE_UPDATE. Each operation reuses the EXACT SAME
    # per-module validation BATCH_UPDATE's single operation already uses
    # (_validate_patch/_validate_settings_patch) — never a second,
    # parallel validation path, just applied once per operation. An
    # operation with an unreal module_type, a missing/blank
    # target_module_id, or BOTH halves ending up empty is DROPPED
    # entirely (never included in the validated list) — the REST of the
    # plan is never discarded because one operation failed; if the whole
    # plan ends up with zero surviving operations, this safely reduces to
    # NONE, same posture as BATCH_UPDATE's own "both halves empty" case.
    # Bounded to MAX_MULTI_MODULE_OPERATIONS entries — a message naming
    # more distinct targets than that is already well past what a single
    # conversational compound request means; excess entries are dropped,
    # never silently expanded.
    if action_type == ActionType.MULTI_MODULE_UPDATE:
        raw_operations = action.get('operations')
        if not isinstance(raw_operations, list) or not raw_operations:
            return {'type': ActionType.NONE}
        validated_operations = []
        for raw_operation in raw_operations[:MAX_MULTI_MODULE_OPERATIONS]:
            if not isinstance(raw_operation, dict):
                continue
            target_module_id = raw_operation.get('target_module_id')
            module_type = raw_operation.get('module_type')
            if not isinstance(target_module_id, str) or not target_module_id.strip():
                continue
            if module_type not in module_capabilities.get_all_module_types():
                continue
            props_patch = (
                _validate_patch(module_type, raw_operation.get('props_patch')) if raw_operation.get('props_patch') else None
            )
            settings_patch = (
                _validate_settings_patch(raw_operation.get('settings_patch')) if raw_operation.get('settings_patch') else None
            )
            if not props_patch and not settings_patch:
                continue
            validated_operations.append({
                'target_module_id': target_module_id, 'module_type': module_type,
                'props_patch': props_patch, 'settings_patch': settings_patch,
            })
        if not validated_operations:
            return {'type': ActionType.NONE}
        return {'type': action_type, 'operations': validated_operations}

    # APPLY_VML_PATTERN (buttons) / APPLY_OUTLOOK_WRAPPER (background-image
    # modules) — each a narrow, single-purpose alias that always means
    # "enable the already-implemented VML fallback for this module" (see
    # vml.ts). Disabling it again is available through the general
    # UPDATE_MODULE_SETTINGS action instead of a mirrored "disable" variant
    # here.
    if action_type == ActionType.APPLY_VML_PATTERN:
        module_type = action.get('module_type')
        if not _is_vml_button_module(module_type):
            return None
        return {'type': action_type, 'target': 'selected', 'module_type': module_type}

    if action_type == ActionType.APPLY_OUTLOOK_WRAPPER:
        module_type = action.get('module_type')
        if not _is_vml_background_module(module_type):
            return None
        return {'type': action_type, 'target': 'selected', 'module_type': module_type}

    if action_type == ActionType.RESTRUCTURE_LAYOUT:
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return None
        capability = module_capabilities.get_module_capability(module_type)
        if not capability or not capability.get('isLayout'):
            return None
        raw_widths = action.get('widths')
        if not isinstance(raw_widths, list) or not raw_widths:
            return None
        try:
            widths = [float(w) for w in raw_widths]
        except (TypeError, ValueError):
            return None
        if any(w < MIN_COLUMN_WIDTH_PERCENT for w in widths):
            return None
        if abs(sum(widths) - 100) > COLUMN_WIDTH_TOTAL_TOLERANCE:
            return None
        return {'type': action_type, 'target': 'selected', 'module_type': module_type, 'widths': widths}

    if action_type == ActionType.INSERT_NESTED_MODULE:
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return None
        # One-level nesting only — never permit inserting a layout module
        # inside a layout column (mirrors layoutModel.ts's own
        # LAYOUT_COLUMN_COUNTS-derived constraint; isLayout comes from the
        # SAME manifest UPDATE_MODULE_PROPS already trusts).
        capability = module_capabilities.get_module_capability(module_type)
        if capability and capability.get('isLayout'):
            return None
        patch = _validate_patch(module_type, action.get('patch') or {}) or {}
        return {'type': action_type, 'target': 'selected_column', 'module_type': module_type, 'patch': patch}

    if action_type == ActionType.UPDATE_REPEATABLE_FIELD:
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return None
        repeatable = module_capabilities.get_repeatable_field(module_type)
        if not repeatable:
            return None
        op = action.get('op')
        if op not in ('add', 'update', 'remove', 'reorder'):
            return None
        result = {'type': action_type, 'target': 'selected', 'module_type': module_type, 'op': op}

        if op in ('add', 'update'):
            fields_by_key = {field['key']: field for field in repeatable['itemSchema']}
            raw_item = action.get('item')
            if not isinstance(raw_item, dict):
                return None
            safe_item = {}
            for key, value in raw_item.items():
                field = fields_by_key.get(key)
                if not field:
                    continue
                validated = _validate_field_value(field, value)
                if validated is not None:
                    safe_item[key] = validated
            if not safe_item:
                return None
            result['item'] = safe_item
            if op == 'update':
                index = action.get('index')
                if not isinstance(index, int) or isinstance(index, bool) or index < 0:
                    return None
                result['index'] = index
            return result

        if op == 'remove':
            index = action.get('index')
            if not isinstance(index, int) or isinstance(index, bool) or index < 0:
                return None
            result['index'] = index
            return result

        # op == 'reorder'
        from_index = action.get('fromIndex')
        to_index = action.get('toIndex')
        if not isinstance(from_index, int) or isinstance(from_index, bool) or from_index < 0:
            return None
        if not isinstance(to_index, int) or isinstance(to_index, bool) or to_index < 0:
            return None
        result['fromIndex'] = from_index
        result['toIndex'] = to_index
        return result

    if action_type == ActionType.COMPOSE_EMAIL:
        raw_items = action.get('items')
        if not isinstance(raw_items, list) or not raw_items:
            return None
        # Phase D (AI Generate Email) safety fix: this used to be
        # `raw_items[:MAX_COMPOSITION_ITEMS]` — a SILENT truncation that
        # would quietly keep only the first N items of an oversized
        # provider response and treat the result as valid. An untrusted
        # provider result (this is exactly the boundary where AI-provider
        # output first meets validation) exceeding the authoritative cap
        # must be treated as an invalid composition, not silently
        # shortened — it degrades to the existing NONE-action fallback
        # exactly like any other invalid action (see EmailAICommandView),
        # never a partially-applied result the caller never asked for.
        if len(raw_items) > MAX_COMPOSITION_ITEMS:
            return None
        safe_items = []
        for entry in raw_items:
            validated = _validate_composition_item(entry, allow_layout=True)
            if validated is not None:
                safe_items.append(validated)
        if not safe_items:
            return None
        return {'type': ActionType.COMPOSE_EMAIL, 'items': safe_items}

    if action_type in (ActionType.SET_RESET_CSS_ENABLED, ActionType.SET_CUSTOM_CSS_ENABLED):
        enabled = action.get('enabled')
        if not isinstance(enabled, bool):
            return None
        return {'type': action_type, 'enabled': enabled}

    if action_type == ActionType.SET_CUSTOM_CSS:
        css = action.get('css')
        if not isinstance(css, str):
            return None
        css = css.strip()
        if not css or len(css) > MAX_CUSTOM_CSS_LENGTH:
            return None
        if validate_custom_css_security(css):
            return None
        return {'type': action_type, 'css': css}

    if action_type == ActionType.CLEAR_CUSTOM_CSS:
        return {'type': action_type}

    if action_type in (ActionType.SET_EMAIL_TITLE, ActionType.SET_EMAIL_SUBJECT):
        value = _clean_text_value(action.get('value'))
        if value is None:
            return None
        key = 'title' if action_type == ActionType.SET_EMAIL_TITLE else 'subject'
        return {'type': action_type, key: value}

    if action_type == ActionType.SET_FAVICON:
        # Same http(s)-only allow-list every other URL in this module
        # already goes through — see _clean_url_value's docstring. An
        # empty result is rejected here (use CLEAR_FAVICON to remove it
        # explicitly, never an implicit empty SET).
        url = _clean_url_value(action.get('url'))
        if not url:
            return None
        return {'type': action_type, 'url': url}

    if action_type == ActionType.CLEAR_FAVICON:
        return {'type': action_type}

    return None


# D4-E1 item 2 — exact Builder-schema grounding, shared by both LLM
# providers (imported, never duplicated — this is validate_action-
# adjacent, manifest-derived logic, not per-provider prompt-construction
# logic like _build_safe_context). Deliberately narrow: describes only
# the ONE currently-relevant module type, never the whole 53-module-type
# schema — callers attach this only when a module is actually selected/
# resolved (see ai_command_local.py's own use of it).
def build_active_target_context(module_type, module_id=None):
    """D4-E2 item 2 — extends D4-E1's build_capability_contract() (same
    function, same manifest-driven data, now also carrying the
    module_id/selected/editable_settings/supported_actions fields the
    active-target contract needs) rather than a second, competing
    resolver. ReferenceResolver.ts (frontend) remains the SOLE authority
    on WHICH module is the target — this function only describes WHAT
    that already-resolved target can do, built live from the exact same
    generated manifest validate_action() itself reads. Returns None for
    an unknown/absent module type (nothing to ground)."""
    if not module_type or module_type not in module_capabilities.get_all_module_types():
        return None

    editable_props = []
    for field in module_capabilities.get_editable_fields(module_type):
        entry = {'key': field['key'], 'value_type': field.get('valueType')}
        if field.get('options'):
            entry['allowed_values'] = [opt.get('value') for opt in field['options'] if isinstance(opt, dict)]
        if field.get('min') is not None:
            entry['min'] = field['min']
        if field.get('max') is not None:
            entry['max'] = field['max']
        editable_props.append(entry)

    # D4-E2 item 3 — the settings-side of the action contract, built from
    # the SAME allowlists _validate_settings_patch() itself reads for
    # UPDATE_MODULE_SETTINGS (never a second, competing settings schema).
    # Dotted keys (e.g. "desktop.paddingTop") tell the model explicitly
    # that these live under a NESTED path, not a flat props key — the
    # exact "padding -> UPDATE_MODULE_SETTINGS.patch.desktop.paddingTop"
    # relationship item 3 asks to make explicit.
    editable_settings = []
    for key in sorted(_SETTINGS_BOOLEAN_FIELDS):
        editable_settings.append({'key': key, 'value_type': 'boolean'})
    for key, allowed in _SETTINGS_ENUM_FIELDS.items():
        editable_settings.append({'key': key, 'value_type': 'select', 'allowed_values': sorted(allowed)})
    for group, nested in _SETTINGS_NESTED_NUMERIC_FIELDS.items():
        for nested_key, bounds in nested.items():
            editable_settings.append({
                'key': f'{group}.{nested_key}', 'value_type': 'number', 'min': bounds[0], 'max': bounds[1],
            })

    capability = module_capabilities.get_module_capability(module_type) or {}
    is_layout = bool(capability.get('isLayout'))
    has_repeatable_field = bool(module_capabilities.get_repeatable_field(module_type))

    # D4-E2 item 2 — supported_actions is a pure DERIVATION from the same
    # capability facts above (+ ActionType.IMPLEMENTED, the same allow-
    # list validate_action() itself enforces) — never a second,
    # hand-maintained action list that could drift from what the
    # validator actually accepts.
    supported_actions = [ActionType.UPDATE_MODULE_PROPS, ActionType.DELETE_MODULE, ActionType.DUPLICATE_MODULE, ActionType.APPLY_GLOBAL_STYLE]
    if editable_settings:
        supported_actions.append(ActionType.UPDATE_MODULE_SETTINGS)
        # D4-E3 item 7/8 — BATCH_UPDATE needs BOTH a props field and a
        # settings field on this module type to ever be useful; a module
        # with no settings at all (editable_settings empty) has nothing
        # for its settings_patch half to target.
        supported_actions.append(ActionType.BATCH_UPDATE)
    if is_layout:
        supported_actions.append(ActionType.RESTRUCTURE_LAYOUT)
    if has_repeatable_field:
        supported_actions.append(ActionType.UPDATE_REPEATABLE_FIELD)
    if _is_vml_button_module(module_type):
        supported_actions.append(ActionType.APPLY_VML_PATTERN)
    if _is_vml_background_module(module_type):
        supported_actions.append(ActionType.APPLY_OUTLOOK_WRAPPER)

    return {
        'module_id': module_id,
        'module_type': module_type,
        'selected': True,
        'editable_props': editable_props,
        'editable_settings': editable_settings,
        'has_repeatable_field': has_repeatable_field,
        'is_layout': is_layout,
        'supported_actions': supported_actions,
        # Universal facts about EVERY action this app can ever propose —
        # stated once here rather than repeated in every system prompt.
        'supports_delete_duplicate': True,
        'every_action_requires_user_apply': True,
    }


def describe_action_validation_failure(action, validated):
    """D4-E1 item 5 — a short, precise, model-readable description of why
    `action` failed validate_action() (which produced `validated`), for
    the bounded local-model repair loop. Returns None when nothing was
    wrong (validated is not None) — callers should never build a repair
    message in that case. Every fact disclosed here (real field/action-
    type names) is already public in build_active_target_context()/the
    system prompt's own allowed-type list — this never leaks anything
    the model couldn't already have known."""
    if validated is not None:
        return None
    if not isinstance(action, dict):
        return 'The proposed action was not a JSON object.'

    action_type = action.get('type')
    if action_type not in ActionType.values:
        allowed = ', '.join(sorted(ActionType.IMPLEMENTED))
        return f'"{action_type}" is not a valid action type. Valid action types: {allowed}.'

    if action_type in (ActionType.UPDATE_MODULE_PROPS, ActionType.APPLY_GLOBAL_STYLE, ActionType.REPLACE_UNSUPPORTED_PROPERTY):
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return f'"{module_type}" is not a real module type.'
        proposed_keys = sorted((action.get('patch') or {}).keys())
        valid_keys = sorted(f['key'] for f in module_capabilities.get_editable_fields(module_type))
        return (
            f'None of the proposed patch field name(s) {proposed_keys} are editable on module type '
            f'"{module_type}". Valid field names for this exact module type: {valid_keys}. Correct only the '
            f'field names and/or values to match one of these — do not change what the user asked for.'
        )

    if action_type == ActionType.UPDATE_MODULE_SETTINGS:
        return (
            'The proposed UPDATE_MODULE_SETTINGS patch did not match the module\'s settings schema '
            '(padding/visibility/gutter-style fields only, per-breakpoint). Correct only the field structure.'
        )

    if action_type == ActionType.BATCH_UPDATE:
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return f'"{module_type}" is not a real module type.'
        valid_keys = sorted(f['key'] for f in module_capabilities.get_editable_fields(module_type))
        return (
            'BATCH_UPDATE needs at least one of props_patch/settings_patch to be a real, non-empty object. '
            f'props_patch field names must come from this module\'s editable fields: {valid_keys}. settings_patch '
            'must match the settings schema (padding/visibility/gutter-style fields only, per-breakpoint). '
            'Correct only the field structure — do not change what the user asked for.'
        )

    if action_type == ActionType.MULTI_MODULE_UPDATE:
        return (
            'MULTI_MODULE_UPDATE needs a non-empty `operations` array; each entry needs a real '
            '`target_module_id` (from active_target_context/resolved_targets — never invented), a real '
            '`module_type`, and at least one of props_patch/settings_patch. Correct only the field '
            'structure — do not change what the user asked for.'
        )

    return f'The proposed "{action_type}" action did not pass builder-schema validation. Check field names, value types, and required keys.'


# D4-E1 item 6 — deterministic scope-creep gate, shared by both providers.
# Never touches validate_action() itself (the safety authority stays
# exactly as it was) — this runs AFTER validate_action() already
# succeeded, and only ever REMOVES patch keys the user's own message
# gives no textual signal for; it never adds, invents, or changes a
# value. Conservative by design: a key whose concept can't be classified,
# or a message with no classifiable concept at all, is left untouched —
# "don't strip" is always the safe default when signal is weak.
_FIELD_KEY_CONCEPT_HINTS = (
    ('color', 'color'), ('colour', 'color'),
    ('href', 'link'), ('url', 'link'),
    ('padding', 'spacing'), ('margin', 'spacing'), ('gap', 'spacing'),
    ('align', 'align'),
    ('fontsize', 'size'), ('size', 'size'),
    ('radius', 'radius'),
    ('fontfamily', 'font'), ('font', 'font'),
    ('visib', 'visibility'), ('hidden', 'visibility'),
    ('src', 'image'), ('image', 'image'), ('asset', 'image'),
    ('text', 'text'), ('label', 'text'), ('content', 'text'), ('headline', 'text'), ('caption', 'text'), ('title', 'text'),
    # D4-E3I §8 — "copy" is the standard email-industry word for text
    # content ("don't change the copy") and was a confirmed real gap:
    # _requested_concepts_with_constraints()'s negative-constraint
    # detection could not recognize it at all before this, since the
    # field-key hint table above (shared with the scope gate) had no
    # entry for it.
    ('copy', 'text'),
)

_MESSAGE_CONCEPT_KEYWORDS = {
    # D4-E1 item 7/12 — a bounded, honestly-partial multilingual keyword
    # set (English plus the most common word for the concept in Hindi/
    # Spanish/French/German — the required D4-E1 QA languages). This is
    # NOT full-coverage translation, and never claims to be: a message in
    # a language/phrasing not covered here simply detects zero concepts,
    # which the conservative default already handles safely (no strip —
    # see apply_scope_gate's own docstring). Extending this list is a
    # pure data change, never a logic change.
    'color': (
        'color', 'colour', 'background colour', 'background color', 'red', 'green', 'blue', 'yellow', 'orange',
        'purple', 'pink', 'black', 'white', 'gray', 'grey',
        'रंग', 'रोजो', 'हरा', 'नीला',  # hi: color, red(loan), green, blue
        # D4-E3F — extended to the full nine-color set this checkpoint
        # verifies, reusing the SAME real words already curated in
        # intent_normalization.py's COLOR_WORDS_BY_LANGUAGE (one curated
        # vocabulary, two purposes: concept-detection here, value-
        # resolution there) — never a second, independently-invented list.
        'लाल', 'काला', 'सफ़ेद', 'सफेद', 'पीला', 'नारंगी', 'बैंगनी',  # hi: red, black, white, yellow, orange, purple
        'lal', 'hara', 'neela', 'nila', 'kala', 'safed', 'peela', 'narangi', 'baingani',  # hi-latn (Hinglish)
        'rojo', 'verde', 'azul',  # es: red, green, blue ('color' itself is a shared cognate)
        'negro', 'blanco', 'gris', 'amarillo', 'naranja', 'morado', 'púrpura',  # es
        'couleur', 'rouge', 'vert', 'bleu',  # fr
        'noir', 'blanc', 'gris', 'jaune', 'violet',  # fr
        'farbe', 'rot', 'grün', 'blau',  # de
        'schwarz', 'weiß', 'weiss', 'grau', 'gelb', 'lila', 'violett',  # de
    ),
    'text': (
        'text', 'copy', 'wording', 'caption', 'headline', 'say', 'says', 'reads', 'read', 'label it', 'rename',
        'टेक्स्ट', 'पाठ',  # hi
        'texto',  # es
        'texte',  # fr
        'text',  # de (same word)
    ),
    'link': (
        'link', 'url', 'href', 'destination', 'goes to', 'point to', 'points to',
        'लिंक',  # hi
        'enlace',  # es
        'lien',  # fr
        'verlinkung', 'link',  # de
    ),
    'spacing': (
        # D4-E3G hardening — bare 'space' added (was previously only
        # detected via the two multi-word phrases below): _SPACING_PATTERN
        # (the trigger this concept detector's OWN sibling gate function
        # uses) already special-cased bare "space" as an explicit third
        # union member alongside padding/spacing — this tuple, the single
        # source _requested_concepts()/apply_scope_gate() both read, had
        # silently drifted out of sync with it, meaning a message like
        # "hero ke neeche 20px space add karo" (a required D4-E3G
        # multilingual example, using "space" as an English loanword)
        # would trigger the spacing SETTING via _SPACING_PATTERN but never
        # register as a requested CONCEPT here — a real, confirmed gap
        # this hardening pass closes at its one authoritative source.
        'padding', 'spacing', 'space', 'margin', ' gap', 'space around', 'space between',
        'पैडिंग', 'स्पेसिंग',  # hi
        # D4-E3F — 'espacio' ("space", the plain noun) added: 'espaciado'/
        # 'relleno' alone missed the natural, arguably more common Spanish
        # phrasing "más espacio"/"menos espacio" ("more/less space").
        'relleno', 'espaciado', 'espacio',  # es
        'espacement', 'marge',  # fr
        'abstand', 'polsterung',  # de
    ),
    'align': (
        'align', 'center', 'centre', 'left-align', 'right-align', 'justify',
        'संरेखण', 'बीच में',  # hi
        'alineación', 'centrar',  # es
        'alignement', 'centrer',  # fr
        'ausrichtung', 'zentrieren',  # de
    ),
    'size': ('size', 'bigger', 'smaller', 'larger', 'font size'),
    'radius': ('radius', 'rounded', 'corner', 'round the'),
    'font': (' font', 'typeface', 'font family'),
    'visibility': ('hide', 'show ', 'visible', 'visibility'),
    'image': ('image', 'picture', 'photo', 'logo'),
}


def _concept_for_field_key(key):
    lowered = key.lower()
    for substring, concept in _FIELD_KEY_CONCEPT_HINTS:
        if substring in lowered:
            return concept
    return None


def _requested_concepts(message):
    lowered = (message or '').lower()
    return {concept for concept, keywords in _MESSAGE_CONCEPT_KEYWORDS.items() if any(kw in lowered for kw in keywords)}


# D4-E3H item 4 — negative-constraint scope handling ("keep the text as it
# is", "don't change the image", "without changing the padding") and its
# positive counterpart ("only change the padding"). _requested_concepts()
# above only ever tracks POSITIVE concept mentions — a message like "make
# this button green, but keep the text as it is" would previously let the
# scope gate keep BOTH backgroundColor AND text if the model (or a
# deterministic combiner) proposed both, since "text" genuinely IS
# mentioned in the message. Reuses the EXACT SAME _concept_for_field_key
# mapping apply_scope_gate() already relies on — never a second,
# independently-invented concept vocabulary.
_NEGATIVE_CONSTRAINT_RE = re.compile(
    r"\b(?:don'?t|do\s+not|never)\s+(?:change|touch|modify|alter)\s+(?:the\s+|its\s+|his\s+|her\s+)?(\w+)"
    r"|\bkeep\s+(?:the\s+|its\s+)?(\w+)\s+(?:as\s+(?:it|they)\s+(?:is|are)|unchanged|the\s+same)"
    r"|\bwithout\s+changing\s+(?:the\s+|its\s+)?(\w+)"
    r"|\bleave\s+(?:the\s+|its\s+)?(\w+)\s+(?:alone|as\s+(?:it|they)\s+(?:is|are)|unchanged)"
    # D4-E3I §8 — a bare "keep the images"/"keep the copy" with no
    # trailing "as is"/"unchanged" qualifier — the exact phrasing Phase
    # 8's own worked example uses. Deliberately its OWN, narrower
    # alternative (never merged into the "keep X (qualifier)" branch
    # above) so it only fires for a short, otherwise-unqualified clause —
    # bounded by requiring the captured word be followed by a clause
    # boundary (end of string, comma, or "and"), never mid-sentence noise.
    r"|\bkeep\s+(?:the\s+|its\s+)?(\w+)\b(?=\s*(?:,|\.|$|\band\b))"
    r"|\bskip\s+(?:the\s+|its\s+)?(\w+)",
    re.IGNORECASE,
)
_ONLY_CONSTRAINT_RE = re.compile(
    r'\bonly\s+(?:change|update|adjust|modify)\s+(?:the\s+|its\s+)?(\w+)',
    re.IGNORECASE,
)


def _requested_concepts_with_constraints(message):
    """Returns (requested_concepts: set, is_exhaustive: bool). The set is
    the same shape _requested_concepts() returns, adjusted for two
    bounded phrasings apply_scope_gate() alone needs to honor:
      - "only change/update/adjust/modify the X" — the requested set
        becomes JUST that one concept (is_exhaustive=True: this is a
        positive, EXHAUSTIVE constraint — nothing else should survive,
        even a whole props_patch/settings_patch half emptying out
        entirely is the correct result, not over-stripping), REGARDLESS
        of what else the message happens to mention elsewhere.
      - "don't change/keep/without changing/leave alone the X" — that
        concept is removed from whatever was otherwise requested, even
        though the message DOES mention it (an explicit exclusion, not a
        request); is_exhaustive stays False here (the ordinary
        conservative "don't empty a whole half" guard still applies —
        an exclusion narrows what's kept, it does not assert that
        nothing else in that half may legitimately survive).
    An unclassifiable word in either pattern is silently ignored (same
    conservative "no signal -> don't touch anything" default every other
    concept-detection helper in this file already uses) — never raises,
    never invents a concept name outside the existing vocabulary."""
    lowered = (message or '').lower()
    only_match = _ONLY_CONSTRAINT_RE.search(lowered)
    if only_match:
        only_concept = _concept_for_field_key(only_match.group(1))
        if only_concept:
            return {only_concept}, True

    requested = _requested_concepts(message)
    excluded = set()
    for match in _NEGATIVE_CONSTRAINT_RE.finditer(lowered):
        word = next((g for g in match.groups() if g), None)
        concept = _concept_for_field_key(word) if word else None
        if concept:
            excluded.add(concept)
    return requested - excluded, False


def _scope_gate_patch(patch, requested, strict=False):
    """Given a flat {field_key: value} patch and a set of requested
    concepts, returns (kept_patch, stripped_keys) — the ONE concept-
    filtering primitive apply_scope_gate() itself now uses for every
    action-type branch, never duplicated per branch. A key whose concept
    can't be classified is never stripped (same conservative default as
    _requested_concepts' own "no signal -> don't touch anything").
    Mirrors apply_scope_gate's original, pre-D4-E3-hardening single-patch
    behavior exactly — extracted here only so BATCH_UPDATE's two halves
    can reuse it unchanged rather than re-implementing the loop.

    If stripping would empty the patch entirely, conservatively returns
    the ORIGINAL patch with an empty stripped list — over-aggressive
    concept detection is more likely than a genuinely all-off-topic
    proposal (same guard the pre-D4-E3 single-patch code already had).

    D4-E3H item 4 — `strict=True` (passed ONLY when
    _requested_concepts_with_constraints() found an unambiguous "only
    change/update the X" instruction) skips that conservative guard: an
    explicit "only" is a strong enough signal that a half emptying out
    entirely is the CORRECT outcome (the user said nothing else in this
    half should change), not over-aggressive stripping. Every existing
    caller passes strict=False (the default) and is completely
    unaffected."""
    kept, stripped = {}, []
    for key, value in patch.items():
        concept = _concept_for_field_key(key)
        if concept is None or concept in requested:
            kept[key] = value
        else:
            stripped.append(key)
    if not kept:
        # strict=True: an explicit "only X" constraint genuinely means
        # this whole half should end up empty — return None (not {}), so
        # every downstream consumer (validate_action(), the frontend's
        # own `if (operation.props_patch)` truthiness check) treats it
        # exactly like "this half was never proposed," never an object
        # that happens to be empty.
        return (None, stripped) if strict else (patch, [])
    return kept, stripped


def _scope_gate_settings_patch(patch, requested, strict=False):
    """The settings-shaped counterpart of _scope_gate_patch — for a
    per-breakpoint patch like {"desktop": {paddingTop: 20, ...}, ...}
    (the ONLY shape _validate_settings_patch ever produces; see that
    function's own docstring). Recurses exactly one level (one pass per
    breakpoint key) and reuses _scope_gate_patch UNCHANGED on each
    breakpoint's leaf dict — "paddingTop" already resolves to the
    'spacing' concept via the SAME _FIELD_KEY_CONCEPT_HINTS table a flat
    prop patch uses (see that table's own 'padding'->'spacing' entry) —
    never a second, settings-specific concept system. A non-dict
    breakpoint entry is left untouched (defensive; validate_action()
    already guarantees this never happens in practice).

    D4-E3H item 4 — `strict` is passed straight through to
    _scope_gate_patch (see that function's own docstring)."""
    if not isinstance(patch, dict):
        return patch, []
    new_patch = {}
    all_stripped = []
    for breakpoint_key, breakpoint_patch in patch.items():
        if not isinstance(breakpoint_patch, dict):
            new_patch[breakpoint_key] = breakpoint_patch
            continue
        kept, stripped = _scope_gate_patch(breakpoint_patch, requested, strict=strict)
        new_patch[breakpoint_key] = kept
        all_stripped.extend(stripped)
    if strict and all_stripped and all(not value for value in new_patch.values()):
        # Every breakpoint emptied out under a strict "only X" constraint
        # — the whole settings_patch is None, not {"desktop": None, ...}.
        return None, all_stripped
    return new_patch, all_stripped


def _target_segments_from_context(context):
    """D4-E3G — builds the {target_module_id: matched_phrase} map
    apply_scope_gate()/apply_semantic_consistency_gate() use to gate each
    MULTI_MODULE_UPDATE operation against only its own resolved segment,
    from context['resolved_targets'] (see ResolvedTargetContextSerializer
    — id/type/label/matched_phrase, already vouched for client-side by
    referenceResolver.ts's resolveMultipleReferences). Returns {} when
    absent/malformed — every caller already falls back to the whole
    message per-operation in that case (conservative, never a hard
    failure)."""
    resolved_targets = context.get('resolved_targets') if isinstance(context, dict) else None
    if not isinstance(resolved_targets, list):
        return {}
    segments = {}
    for entry in resolved_targets:
        if not isinstance(entry, dict):
            continue
        target_id = entry.get('id')
        phrase = entry.get('matched_phrase')
        if isinstance(target_id, str) and target_id and isinstance(phrase, str) and phrase:
            segments[target_id] = phrase
    return segments


def _excluded_target_ids_from_context(context):
    """D4-E3J §3/§6 — the deterministic MODULE-level counterpart to
    `_target_segments_from_context` above. Reads context['excluded_targets']
    (same {id, type, label} shape as one `resolved_targets` entry, already
    vouched for client-side by referenceResolver.ts's new resolveExclusions())
    and returns a plain set of module ids. This is a DIFFERENT axis from
    every field-level preservation mechanism in this file
    (_requested_concepts_with_constraints/_scope_gate_patch/
    _FIELD_KEY_CONCEPT_HINTS, all D4-E3H): those decide which PROPERTIES of
    an already-chosen target may change; this decides which MODULES may
    never appear as a target at all, regardless of what any field-level
    gate would otherwise allow on them. Never conflate the two — a message
    can carry both at once ("make all buttons green except the footer
    button, but don't change the text either").

    Returns an empty (falsy) set for anything malformed — the same "absent
    exclusions changes nothing" posture every other optional context field
    in this module already takes."""
    excluded_targets = context.get('excluded_targets') if isinstance(context, dict) else None
    if not isinstance(excluded_targets, list):
        return set()
    ids = set()
    for entry in excluded_targets:
        if isinstance(entry, dict):
            target_id = entry.get('id')
            if isinstance(target_id, str) and target_id:
                ids.add(target_id)
    return ids


def _excluded_labels_from_context(context):
    """Companion to `_excluded_target_ids_from_context` — the human-
    readable labels (never ids) for the reply text a proposal shows the
    user, so an excluded module is named the same way the resolver itself
    described it ("the footer CTA"), never a raw module id."""
    excluded_targets = context.get('excluded_targets') if isinstance(context, dict) else None
    if not isinstance(excluded_targets, list):
        return []
    labels = []
    for entry in excluded_targets:
        if isinstance(entry, dict):
            label = entry.get('label')
            if isinstance(label, str) and label:
                labels.append(label)
    return labels


def _strip_excluded_operations(action, excluded_ids):
    """D4-E3J §3/§4/§5/Core Principle — the REAL enforcement point for
    module-level exclusion against an LLM-PROPOSED MULTI_MODULE_UPDATE.
    Deterministic and unconditional: an operation whose target_module_id
    is in `excluded_ids` is removed from the plan NO MATTER what the model
    proposed for it or why — the LLM may reason about which modules to
    touch, but it can never re-admit a module the deterministic resolver
    already excluded (Core Principle: "It cannot enlarge that target
    set."). Mirrors apply_scope_gate()'s own MULTI_MODULE_UPDATE shape
    (returns action unchanged + empty list when nothing needed stripping)
    but operates at the OPERATION level, never the field level — a
    deliberately separate function from apply_scope_gate() itself so the
    two axes (field-level scope, module-level exclusion) are never
    conflated in one code path.

    Returns (action, removed_target_ids: list[str])."""
    if not excluded_ids or not isinstance(action, dict) or action.get('type') != ActionType.MULTI_MODULE_UPDATE:
        return action, []
    operations = action.get('operations')
    if not isinstance(operations, list) or not operations:
        return action, []
    kept, removed = [], []
    for operation in operations:
        target_id = operation.get('target_module_id') if isinstance(operation, dict) else None
        if target_id in excluded_ids:
            removed.append(target_id)
        else:
            kept.append(operation)
    if not removed:
        return action, []
    if not kept:
        return {'type': ActionType.NONE}, removed
    return {**action, 'operations': kept}, removed


def apply_scope_gate(message, action, target_segments=None):
    """Returns (possibly-narrowed) `action`, and a list of stripped field
    keys (empty when nothing was stripped) — the caller decides how to
    log/report that. Only ever narrows an already-validated
    UPDATE_MODULE_PROPS/APPLY_GLOBAL_STYLE/REPLACE_UNSUPPORTED_PROPERTY
    patch, BATCH_UPDATE's props_patch/settings_patch pair (D4-E3
    scope-gate hardening — a BATCH_UPDATE proposed by the LLM tier
    previously bypassed this gate entirely, since it carries no `patch`
    key at all; that confirmed gap is what this branch closes), or
    MULTI_MODULE_UPDATE's `operations` list (D4-E3G — see below). All
    reuse the SAME _concept_for_field_key/_FIELD_KEY_CONCEPT_HINTS
    tables, never a second, parallel scope-control system. Every other
    action type passes through unchanged (nothing else carries a
    free-form multi-field patch a scope gate applies to).

    `target_segments` (D4-E3G, optional): {target_module_id: message_segment}
    — when the caller already knows which slice of the message a given
    operation's target was resolved from (ReferenceResolver.ts's
    matched_phrase, forwarded through context['resolved_targets']), each
    operation is scope-gated against ONLY its own segment's requested
    concepts, never the whole message's. This is required, not cosmetic:
    "make the hero heading smaller, CTA green, and center the footer"
    mentions size/color/align somewhere in the message, but a single
    whole-message requested-concept set applied uniformly to every
    operation would fail to catch a scope-creeping color field sneaking
    onto the hero-heading operation (the message DOES mention color —
    just for the CTA, not the hero). Falls back to the whole message,
    per-operation, when no segment is available for a given target —
    strictly conservative (still some protection) but only where the
    caller genuinely could not supply a segment."""
    if not isinstance(action, dict):
        return action, []
    action_type = action.get('type')
    if action_type not in (
        ActionType.UPDATE_MODULE_PROPS, ActionType.APPLY_GLOBAL_STYLE, ActionType.REPLACE_UNSUPPORTED_PROPERTY,
        ActionType.BATCH_UPDATE, ActionType.MULTI_MODULE_UPDATE,
    ):
        return action, []

    if action_type == ActionType.MULTI_MODULE_UPDATE:
        operations = action.get('operations')
        if not isinstance(operations, list) or not operations:
            return action, []
        new_operations = []
        total_stripped = []
        for operation in operations:
            if not isinstance(operation, dict):
                new_operations.append(operation)
                continue
            segment = (target_segments or {}).get(operation.get('target_module_id')) or message
            op_requested, op_strict = _requested_concepts_with_constraints(segment)
            if not op_requested:
                new_operations.append(operation)
                continue
            props_patch = operation.get('props_patch')
            settings_patch = operation.get('settings_patch')
            new_props, props_stripped = (
                _scope_gate_patch(props_patch, op_requested, strict=op_strict) if isinstance(props_patch, dict) and props_patch
                else (props_patch, [])
            )
            new_settings, settings_stripped = (
                _scope_gate_settings_patch(settings_patch, op_requested, strict=op_strict) if settings_patch else (settings_patch, [])
            )
            op_stripped = props_stripped + settings_stripped
            total_stripped.extend(op_stripped)
            new_operations.append(
                {**operation, 'props_patch': new_props, 'settings_patch': new_settings} if op_stripped else operation
            )
        if not total_stripped:
            return action, []
        return {**action, 'operations': new_operations}, total_stripped

    requested, requested_strict = _requested_concepts_with_constraints(message)
    if not requested:
        # No classifiable concept anywhere in the message — too weak a
        # signal to strip anything against; pass the whole action through.
        return action, []

    if action_type == ActionType.BATCH_UPDATE:
        props_patch = action.get('props_patch')
        settings_patch = action.get('settings_patch')
        new_props, props_stripped = (
            _scope_gate_patch(props_patch, requested, strict=requested_strict) if isinstance(props_patch, dict) and props_patch
            else (props_patch, [])
        )
        new_settings, settings_stripped = (
            _scope_gate_settings_patch(settings_patch, requested, strict=requested_strict) if settings_patch else (settings_patch, [])
        )
        stripped = props_stripped + settings_stripped
        if not stripped:
            return action, []
        return {**action, 'props_patch': new_props, 'settings_patch': new_settings}, stripped

    patch = action.get('patch')
    if not isinstance(patch, dict) or not patch:
        return action, []
    kept, stripped = _scope_gate_patch(patch, requested, strict=requested_strict)
    if not stripped:
        return action, []
    return {**action, 'patch': kept}, stripped


def _patch_has_asset_marker(module_type, patch):
    for key, value in (patch or {}).items():
        field = module_capabilities.get_editable_field(module_type, key)
        if field and field.get('valueType') == 'image_asset' and isinstance(value, dict):
            return True
    return False


def resolve_asset_references(action, request):
    """Second-pass, per-request resolution for any `image_asset`-valued
    field left as an unresolved {'assetId': N} / {'url': ...} marker by
    validate_action(). Runs AFTER schema validation, in the view, where
    `request.user` is available — validate_action() itself stays a pure,
    user-agnostic function (no DB access), exactly as it was in V1.

    An {'assetId': N} marker resolves to a real URL only if the asset
    exists AND belongs to request.user — never any other user's asset,
    never a nonexistent one. A field that can't be resolved is DROPPED
    from the patch, never left as the raw marker and never replaced with
    an invented URL. Never raises."""
    if action is None or not isinstance(action, dict):
        return action

    action_type = action.get('type')
    if action_type in (
        ActionType.UPDATE_MODULE_PROPS, ActionType.APPLY_GLOBAL_STYLE,
        ActionType.REPLACE_UNSUPPORTED_PROPERTY, ActionType.INSERT_NESTED_MODULE,
    ):
        module_type = action.get('module_type')
        patch = action.get('patch') or {}
        if not _patch_has_asset_marker(module_type, patch):
            return action
        resolved_patch = _resolve_patch_assets(module_type, patch, request)
        if not resolved_patch:
            # INSERT_NESTED_MODULE's patch is optional (a bare insert with
            # no seeded props is still a valid, complete action) — unlike
            # UPDATE_MODULE_PROPS/REPLACE_UNSUPPORTED_PROPERTY, where an
            # empty patch means the action does nothing.
            if action_type == ActionType.INSERT_NESTED_MODULE:
                return {**action, 'patch': {}}
            return {'type': ActionType.NONE}
        return {**action, 'patch': resolved_patch}

    if action_type == ActionType.BATCH_UPDATE:
        module_type = action.get('module_type')
        props_patch = action.get('props_patch') or {}
        if not _patch_has_asset_marker(module_type, props_patch):
            return action
        resolved_patch = _resolve_patch_assets(module_type, props_patch, request)
        return {**action, 'props_patch': resolved_patch or None}

    if action_type == ActionType.MULTI_MODULE_UPDATE:
        operations = action.get('operations')
        if not isinstance(operations, list) or not operations:
            return action
        new_operations = []
        for operation in operations:
            if not isinstance(operation, dict):
                new_operations.append(operation)
                continue
            module_type = operation.get('module_type')
            props_patch = operation.get('props_patch') or {}
            if not _patch_has_asset_marker(module_type, props_patch):
                new_operations.append(operation)
                continue
            resolved_patch = _resolve_patch_assets(module_type, props_patch, request)
            new_operations.append({**operation, 'props_patch': resolved_patch or None})
        return {**action, 'operations': new_operations}

    if action_type == ActionType.UPDATE_REPEATABLE_FIELD and action.get('op') in ('add', 'update'):
        module_type = action.get('module_type')
        item = action.get('item') or {}
        repeatable = module_capabilities.get_repeatable_field(module_type)
        if not repeatable:
            return action
        fields_by_key = {field['key']: field for field in repeatable['itemSchema']}
        has_asset_marker = any(
            fields_by_key.get(key, {}).get('valueType') == 'image_asset' and isinstance(value, dict)
            for key, value in item.items()
        )
        if not has_asset_marker:
            return action
        resolved_item = {}
        for key, value in item.items():
            field = fields_by_key.get(key)
            if field and field.get('valueType') == 'image_asset' and isinstance(value, dict):
                url = _resolve_asset_marker(value, request)
                if url is not None:
                    resolved_item[key] = url
                continue
            resolved_item[key] = value
        if not resolved_item:
            return {'type': ActionType.NONE}
        return {**action, 'item': resolved_item}

    if action_type == ActionType.INSERT_MODULE:
        resolved_modules = []
        for entry in action.get('modules', []):
            module_type = entry.get('module_type')
            patch = entry.get('patch') or {}
            resolved_patch = _resolve_patch_assets(module_type, patch, request) if _patch_has_asset_marker(module_type, patch) else patch
            resolved_modules.append({'module_type': module_type, 'patch': resolved_patch})
        return {**action, 'modules': resolved_modules}

    if action_type == ActionType.COMPOSE_EMAIL:
        resolved_items = [_resolve_composition_item_assets(item, request) for item in action.get('items', [])]
        return {**action, 'items': resolved_items}

    return action


def _resolve_composition_item_assets(item, request):
    """Recursive per-request asset resolution for one already-validated
    composition item (see _validate_composition_item) — same ownership-
    checked resolution as every other action type, just walked across the
    item's own one level of nested children/repeatable items."""
    module_type = item.get('module_type')
    patch = item.get('patch') or {}
    resolved_patch = _resolve_patch_assets(module_type, patch, request) if _patch_has_asset_marker(module_type, patch) else patch
    result = {**item, 'patch': resolved_patch}

    if 'children' in item:
        result['children'] = [
            {
                'column_index': group['column_index'],
                'modules': [_resolve_composition_item_assets(child, request) for child in group['modules']],
            }
            for group in item['children']
        ]

    if 'repeatable_items' in item:
        repeatable = module_capabilities.get_repeatable_field(module_type)
        fields_by_key = {field['key']: field for field in (repeatable['itemSchema'] if repeatable else [])}
        resolved_items = []
        for raw_item in item['repeatable_items']:
            resolved_item = {}
            for key, value in raw_item.items():
                field = fields_by_key.get(key)
                if field and field.get('valueType') == 'image_asset' and isinstance(value, dict):
                    url = _resolve_asset_marker(value, request)
                    if url is not None:
                        resolved_item[key] = url
                    continue
                resolved_item[key] = value
            if resolved_item:
                resolved_items.append(resolved_item)
        result['repeatable_items'] = resolved_items

    return result


def _resolve_patch_assets(module_type, patch, request):
    resolved = {}
    for key, value in patch.items():
        field = module_capabilities.get_editable_field(module_type, key)
        if field and field.get('valueType') == 'image_asset' and isinstance(value, dict):
            url = _resolve_asset_marker(value, request)
            if url is not None:
                resolved[key] = url
            # else: silently dropped — never invented, never raises.
            continue
        resolved[key] = value
    return resolved


def _resolve_asset_marker(marker, request):
    if _ASSET_MARKER_URL_KEY in marker:
        # Already passed _clean_url_value's scheme allow-list in
        # validate_action() — reused as-is, no separate URL-safety path.
        return marker[_ASSET_MARKER_URL_KEY]

    asset_id = marker.get(_ASSET_MARKER_ASSET_ID_KEY)
    if asset_id is None:
        return None

    from .models import EmailAsset, EmailAssetSourceType  # deferred — keeps this module import-light for pure-logic tests

    asset = EmailAsset.objects.filter(user=request.user, id=asset_id).first()
    if not asset:
        return None
    if asset.source_type == EmailAssetSourceType.EXTERNAL:
        return asset.external_url
    if not asset.file:
        return None
    return request.build_absolute_uri(asset.file.url)


# Multi-module changes and destructive changes must never silently
# execute (Feature 14 requirement) — this is the single source of truth
# the view/frontend both read, so the rule can't drift between them.
def requires_confirmation(action):
    if action is None:
        return False
    action_type = action.get('type')
    if action_type == ActionType.DELETE_MODULE:
        return True
    if action_type == ActionType.APPLY_GLOBAL_STYLE:
        return True
    if action_type == ActionType.INSERT_MODULE:
        return len(action.get('modules') or []) > 1
    if action_type in ActionType.DOCUMENT_SCOPE:
        return True
    if action_type in ActionType.STRUCTURAL:
        return True
    if action_type == ActionType.UPDATE_REPEATABLE_FIELD and action.get('op') == 'remove':
        return True
    return False


# Item F — "For substantial Custom CSS replacement, require stronger
# confirmation than a trivial property change." Length is a simple,
# deterministic, zero-token proxy for "substantial": a short one-property
# tweak vs. a large block replacing most/all of the document's styling.
STRONG_CUSTOM_CSS_LENGTH_THRESHOLD = 200


def requires_strong_confirmation(action):
    if action is None:
        return False
    if action.get('type') == ActionType.SET_CUSTOM_CSS:
        return len(action.get('css', '')) > STRONG_CUSTOM_CSS_LENGTH_THRESHOLD
    return False


@dataclass(frozen=True)
class CommandResult:
    reply: str
    action: dict | None
    confidence: float
    provider: str = 'deterministic'


class EmailCommandProvider:
    def resolve(self, message, context):
        raise NotImplementedError


_CLARIFY_REPLY = (
    "I'm not sure how to do that yet. I can add a text/image/button/divider/spacer, "
    "change the selected module's color/text/size/alignment, delete or duplicate the "
    "selected module, or apply a style change to every module of one type."
)

_NO_SELECTION_REPLY = (
    'Select a module on the canvas first, then tell me what to change about it.'
)

_INSERT_PATTERN = re.compile(r'\b(add|insert|create)\b', re.IGNORECASE)
# D4-E3H — a real bug found via this checkpoint's own live QA: "Add a
# countdown timer and also make the button green." has NO real module
# type to insert ("countdown timer" matches nothing in MODULE_TYPE_ALIASES)
# — but _find_all_module_types(), which scans the WHOLE message so that a
# legitimate "add a button and a divider" correctly finds both, ALSO
# matched "button" from the completely unrelated "make the button green"
# mutation clause later in the same sentence, and silently inserted an
# empty button module nobody asked for while dropping the color request
# entirely. When a mutation-verb clause ("make/change/update/set
# the/this/it") is present, module-type matching is now bounded to the
# text BEFORE it — a genuine multi-insert message ("add a button and a
# divider") never contains that phrase at all, so this changes nothing
# for the common case; it only ever narrows the search when there is
# real reason to believe a later clause is asking for something else
# entirely.
_MUTATION_CLAUSE_BOUNDARY_RE = re.compile(r'\b(?:make|change|update|set)\s+(?:the|this|it)\b', re.IGNORECASE)


def _insert_search_window(lowered):
    boundary = _MUTATION_CLAUSE_BOUNDARY_RE.search(lowered)
    return lowered[:boundary.start()] if boundary else lowered
_DELETE_PATTERN = re.compile(r'\b(delete|remove)\b.*\b(this|it|the selected)\b', re.IGNORECASE)
_DUPLICATE_PATTERN = re.compile(r'\b(duplicate|copy)\b.*\b(this|it)\b', re.IGNORECASE)
_GLOBAL_PATTERN = re.compile(r'\b(all|every|each)\b', re.IGNORECASE)

# Sub-phase 6, work package D/E — checked BEFORE the generic
# _INSERT_PATTERN/_DELETE_PATTERN below (same "specific before generic"
# discipline the CSS/title/subject/favicon blocks already use), since
# "add a text module here" and "remove the first nav link" would
# otherwise be misread by those broader patterns.
_NESTED_INSERT_PATTERN = re.compile(
    r'\b(add|insert|create)\b.*\b(here|in this column|into this column|in the column|to this column)\b',
    re.IGNORECASE,
)
_ORDINAL_WORDS = {
    'first': 0, '1st': 0, 'second': 1, '2nd': 1, 'third': 2, '3rd': 2, 'fourth': 3, '4th': 3, 'fifth': 4, '5th': 4,
}


def _ordinal_to_index(token):
    """'second'/'2nd'/'2' -> 1 (0-based). None if unparseable."""
    token = token.lower()
    index = _ORDINAL_WORDS.get(token)
    if index is not None:
        return index
    try:
        return int(token) - 1
    except ValueError:
        return None


# Sub-phase 6 closure — a repeatable item's noun, matched with a loose
# non-greedy gap (".*?") to the ordinal on one side, so an adjective the
# user naturally includes ("navigation link", "social link", "product
# card") never breaks the match — a tightly-anchored "ordinal
# immediately-followed-by-noun" pattern would silently fail on exactly
# the phrasings item 9's own examples use.
_REPEATABLE_ITEM_NOUN = r'(?:link|item|row|card|product)'
_ORDINAL_GROUP = r'(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+)(?:st|nd|rd|th)?'
_REMOVE_REPEATABLE_PATTERN = re.compile(
    rf"\bremove\b.*\b{_ORDINAL_GROUP}\b.*?\b{_REPEATABLE_ITEM_NOUN}\b",
    re.IGNORECASE,
)
# Sub-phase 6 closure — "change/update/set the <ordinal> <noun> <field
# words> to <value>". The field-words segment is matched generically
# against the module's OWN manifest itemSchema (see _match_repeatable_field
# below) — never a hardcoded per-module field list.
_UPDATE_REPEATABLE_PATTERN = re.compile(
    rf"\b(?:change|update|set)\b.*\b{_ORDINAL_GROUP}\b.*?\b{_REPEATABLE_ITEM_NOUN}\b(.+?)\bto\b\s*(.+)$",
    re.IGNORECASE,
)
# Sub-phase 6 closure — "move the <ordinal> <noun> to (position) <N>".
_REORDER_REPEATABLE_PATTERN = re.compile(
    rf"\bmove\b.*\b{_ORDINAL_GROUP}\b.*?\b{_REPEATABLE_ITEM_NOUN}\b.*?\bto\b\s*(?:position|slot|spot)?\s*(\d+)\b",
    re.IGNORECASE,
)
# Sub-phase 6 closure — "add a <noun> called/named/titled/for <identifier>
# with/using (url/text) <content>". Bounded to two-field item schemas
# (see _build_repeatable_add_item) — never invents a value for a field the
# user didn't supply.
_ADD_REPEATABLE_PATTERN = re.compile(
    rf"\badd\b.*?\b{_REPEATABLE_ITEM_NOUN}\b"
    r".*?\b(?:called|named|titled|for)\s+(.+?)\s+(?:with|using|saying)\s+(?:url\s+|text\s+)?(.+)$",
    re.IGNORECASE,
)

# Sub-phase 6 closure — maps a common spoken/typed word to the itemSchema
# KEY it most likely refers to. Only ever consulted when that exact key
# is actually present on the CURRENT module's manifest itemSchema (see
# _match_repeatable_field) — this is a vocabulary hint, not a per-module
# allow-list; a future manifest field named differently is still reachable
# by its own literal key/label, this dict only widens recognition for
# common phrasing on top of that.
_REPEATABLE_FIELD_SYNONYMS = {
    'title': 'name', 'name': 'name', 'heading': 'title',
    'link': 'href', 'url': 'href', 'website': 'href',
    'label': 'label', 'platform': 'label',
    'text': 'text', 'description': 'description', 'desc': 'description',
    'price': 'price', 'cost': 'price',
    'button text': 'ctaText', 'button': 'ctaText', 'cta': 'ctaText',
    'button link': 'ctaHref', 'button url': 'ctaHref', 'cta link': 'ctaHref',
    'image': 'imageSrc', 'photo': 'imageSrc', 'picture': 'imageSrc',
    'alt text': 'imageAlt', 'alt': 'imageAlt',
}


def _match_repeatable_field(item_schema, phrase_lower):
    """Resolves a free-text field reference ("label", "product title",
    "button link") against ONE module's real itemSchema — manifest-driven,
    never a hardcoded per-module field list. Tries, in order: (1) a schema
    field's own key appearing as a whole word, (2) a schema field's own
    label appearing as a substring, (3) the synonym table above, gated on
    the synonym's target key actually existing in this schema. Returns
    None (never guesses) if nothing matches."""
    fields_by_key = {field['key']: field for field in item_schema}
    for field in item_schema:
        if re.search(rf"\b{re.escape(field['key'].lower())}\b", phrase_lower):
            return field
    for field in item_schema:
        if field['label'].lower() in phrase_lower:
            return field
    for word, target_key in _REPEATABLE_FIELD_SYNONYMS.items():
        if word in phrase_lower and target_key in fields_by_key:
            return fields_by_key[target_key]
    return None


def _build_repeatable_add_item(item_schema, identifier_text, content_text):
    """Builds a {key: raw_value} dict for a two-field repeatable item from
    the user's own supplied identifier/content text — NEVER invents a
    value. Only supports item schemas with exactly two fields (every
    family registered today — nav/social/footer-social links, icon/text
    rows); a richer schema (e.g. product cards) returns None rather than
    guessing which of several fields the user meant, and product cards
    are fixed-count anyway (see handleApplyAiAction's maxItems guard)."""
    if len(item_schema) != 2:
        return None
    url_fields = [f for f in item_schema if f.get('valueType') == 'url']
    text_fields = [f for f in item_schema if f.get('valueType') == 'text']
    if len(url_fields) == 1 and len(text_fields) == 1:
        # e.g. NavLink/SocialPlatformLink: one label (text) + one href (url).
        return {text_fields[0]['key']: identifier_text, url_fields[0]['key']: content_text}
    if len(text_fields) == 2:
        # e.g. IconTextRow: title + text — the identifier goes to whichever
        # field looks like a title/heading/label, the content to the other.
        title_field = next(
            (f for f in text_fields if f['key'].lower() in ('title', 'label', 'name', 'heading')), text_fields[0],
        )
        other_field = next((f for f in text_fields if f is not title_field), None)
        if other_field is None:
            return None
        return {title_field['key']: identifier_text, other_field['key']: content_text}
    return None
_VML_PATTERN = re.compile(r'\bvml\b|\boutlook\s+(?:wrapper|fallback)\b', re.IGNORECASE)
_HIDE_MOBILE_PATTERN = re.compile(r'\bhide\b.*\bmobile\b|\bmobile\b.*\bhide\b', re.IGNORECASE)
_HIDE_DESKTOP_PATTERN = re.compile(r'\bhide\b.*\bdesktop\b|\bdesktop\b.*\bhide\b', re.IGNORECASE)
_SHOW_ALL_VISIBILITY_PATTERN = re.compile(r'\bshow\b.*\b(both|everywhere)\b', re.IGNORECASE)
_COLUMN_WIDTHS_PATTERN = re.compile(r'\bcolumns?\b.*\bwidths?\b|\bwidths?\b.*\bcolumns?\b', re.IGNORECASE)
_WIDTH_NUMBERS_PATTERN = re.compile(r'(\d+(?:\.\d+)?)\s*(?:%|percent)?')
# R4-B4 §3 — widened trigger (never a required exact "align" word): also
# recognizes "center this/it/that", "in the middle", "put ... left/
# center/right/middle" — the exact natural-command-variation phrasings
# §3 itself lists ("make this centered", "center it", "align this in
# the middle", "put this button in the center"). VALUE extraction no
# longer relies on this regex's own capture groups — see
# intent_normalization.find_alignment_value(), used by both
# _extract_style_patch below and apply_canonical_intent's multilingual
# path, so English and non-English alignment recognition share the
# SAME word-boundary-matched value lookup, never two implementations.
_ALIGN_PATTERN = re.compile(
    r'\balign(?:ment)?\b'
    r'|\b(?:left|center|centre|right|middle)\s*align'
    r'|\b(?:center|centre|left|right)\s+(?:this|it|that)\b'
    r'|\bin\s+the\s+(?:middle|center|centre)\b'
    r'|\bput\b.{0,20}\b(?:left|center|centre|right|middle)\b'
    r'|\bcentered\b|\bcentred\b',
    re.IGNORECASE,
)
_FONT_SIZE_PATTERN = re.compile(r'\bfont\s*size\s*(?:to|=|:)?\s*(\d+)\b', re.IGNORECASE)
_BIGGER_PATTERN = re.compile(r'\b(bigger|larger|increase)\b', re.IGNORECASE)
_SMALLER_PATTERN = re.compile(r'\b(smaller|decrease)\b', re.IGNORECASE)
_SET_TEXT_PATTERN = re.compile(r'\b(?:set|change)\s+the\s+text\s+to\s+["\']?(.+?)["\']?$', re.IGNORECASE)

# Item F — deterministic (zero-token) recognition for the bounded set of
# document-level CSS commands. "Custom CSS" is checked as its own phrase
# so "add custom css: ..." isn't caught by the generic _INSERT_PATTERN
# (which only knows about MODULE_TYPE_ALIASES) or misread as "add a
# module" — these checks run BEFORE that generic insert check.
_RESET_CSS_PATTERN = re.compile(r'\breset\s*css\b', re.IGNORECASE)
_CUSTOM_CSS_PATTERN = re.compile(r'\bcustom\s*css\b', re.IGNORECASE)
_ENABLE_WORD_PATTERN = re.compile(r'\b(enable|turn\s*on|switch\s*on)\b', re.IGNORECASE)
_DISABLE_WORD_PATTERN = re.compile(r'\b(disable|turn\s*off|switch\s*off)\b', re.IGNORECASE)
_CLEAR_CUSTOM_CSS_PATTERN = re.compile(r'\b(clear|remove|delete)\b.*\bcustom\s*css\b', re.IGNORECASE)
# Captures everything after "to"/"with"/":" as the literal proposed CSS —
# matched against the ORIGINAL (not lowercased) message so CSS casing
# (hex colors, camelCase custom properties) survives. The optional
# "to"/"with" word and optional ":" are each consumed separately (not as
# alternatives sharing one boundary) so "to: " and ": " and " to " all
# leave a cleanly-trimmed capture with no leftover separator characters.
_SET_CUSTOM_CSS_PATTERN = re.compile(
    r'\b(?:set|add|replace|update)\b[^:]*\bcustom\s*css\b\s*(?:to|with)?\s*:?\s*(.+)$', re.IGNORECASE | re.DOTALL,
)

# Sub-phase 4, item 3 — title/subject/favicon commands. Checked as their
# own phrases (mentioning "title"/"subject"/"favicon") so they never
# collide with the CSS/insert/delete vocabulary above or below — same
# "checked before the generic patterns" posture the CSS block already
# established. The captured value comes from the ORIGINAL (not lowercased)
# message, same reasoning as _SET_CUSTOM_CSS_PATTERN: a title/subject
# should keep the casing the user actually typed.
_EMAIL_TITLE_PATTERN = re.compile(r'\b(?:title)\b')
_SET_EMAIL_TITLE_PATTERN = re.compile(
    r'\b(?:set|change|update)\b[^:]*\btitle\b\s*(?:to|as)?\s*:?\s*(.+)$', re.IGNORECASE | re.DOTALL,
)
_EMAIL_SUBJECT_PATTERN = re.compile(r'\bsubject\b')
_SET_EMAIL_SUBJECT_PATTERN = re.compile(
    r'\b(?:set|change|update)\b[^:]*\bsubject\b\s*(?:to|as)?\s*:?\s*(.+)$', re.IGNORECASE | re.DOTALL,
)
_FAVICON_PATTERN = re.compile(r'\bfavicon\b', re.IGNORECASE)
_CLEAR_FAVICON_PATTERN = re.compile(r'\b(clear|remove|delete)\b.*\bfavicon\b', re.IGNORECASE)
# Captures everything after the word "favicon" itself, then a SEPARATE
# strip removes an optional leading "url"/"to"/"as"/":" filler sequence in
# any order/combination ("favicon url to:", "favicon to", "favicon:") —
# simpler and less failure-prone than trying to encode both the filler
# and the value capture in one regex (an earlier version of this pattern
# used [^:]* on both sides of an optional filler group and silently
# failed to capture a real URL because the two greedy segments fought
# over the same input).
_SET_FAVICON_PATTERN = re.compile(r'\bfavicon\b\s*(.*)$', re.IGNORECASE | re.DOTALL)
_FAVICON_VALUE_PREFIX_PATTERN = re.compile(r'^(?:url\s+)?(?:to|as)?\s*:?\s*', re.IGNORECASE)

# C-3 remediation — "fix this placeholder link" (href="#") must never
# invent a destination URL. Scoped narrowly to "placeholder link" or an
# explicit fix/link combination so it doesn't collide with unrelated
# link-styling commands (e.g. "make the link blue").
_PLACEHOLDER_LINK_FIX_PATTERN = re.compile(
    r'\bplaceholder\s+link\b|\bfix\b.*\b(?:this|the|it)\b.*\blink\b|\blink\b.*\bfix\b',
    re.IGNORECASE,
)
# R4-B4 §1 — SET_LINK, broader than the "fix" framing above: "set/change/
# update the link/url [to ...]" — deliberately excludes bare "link" alone
# (would collide with unrelated link-styling commands like "make the
# link blue", same reasoning _PLACEHOLDER_LINK_FIX_PATTERN's own comment
# already gives).
_SET_LINK_PATTERN = re.compile(
    r'\b(?:set|change|update)\b.*\b(?:link|url)\b',
    re.IGNORECASE,
)
_URL_IN_TEXT_PATTERN = re.compile(r'https?://\S+', re.IGNORECASE)
# R4-B4 §1 — SET_IMAGE. "change/set/update/replace the image/picture/
# photo [to ...]".
_SET_IMAGE_PATTERN = re.compile(
    r'\b(?:set|change|update|replace)\b.*\b(?:image|picture|photo)\b',
    re.IGNORECASE,
)
# R4-B4 §1/§3 — CHANGE_SPACING. "give/add/increase/set/change ... padding/
# spacing/space ... [to N]" — deliberately broad on the verb (natural-
# command-variation coverage — §3's own "give this 20px padding" / "add
# some space inside" / "increase internal spacing to 20" examples) but
# always requires one of padding/spacing/space as the noun, so it can
# never collide with an unrelated numeric command.
# D4-E3F — widened to ALSO match _MESSAGE_CONCEPT_KEYWORDS['spacing']'s
# real, curated hi/es/fr/de vocabulary (defined above — see that table's
# own comments), so a message using a genuine non-English spacing word
# (with no English "padding" loanword) now reaches this branch's
# deterministic extraction too. The three original bare English words
# stay EXPLICIT here (never derived solely from the concept-keywords
# tuple, which was curated for a different purpose and does not itself
# contain bare "space" as a standalone entry — only the multi-word
# "space around"/"space between" phrases — deriving the trigger from it
# alone silently DROPPED "space" as a standalone match, a real
# regression this explicit union avoids).
_SPACING_PATTERN = re.compile(
    r'\b(?:padding|spacing|space|' +
    '|'.join(re.escape(word.strip()) for word in _MESSAGE_CONCEPT_KEYWORDS['spacing']) + r')\b',
    re.IGNORECASE,
)
_SPACING_NUMBER_PATTERN = re.compile(r'(\d+(?:\.\d+)?)\s*(?:px)?', re.IGNORECASE)

# C-2 remediation — "fix this weak contrast" / "fix the text contrast".
_WEAK_CONTRAST_FIX_PATTERN = re.compile(
    r'\b(?:weak|low|poor)\s+(?:text\s+)?contrast\b|\bfix\b.*\bcontrast\b|\bcontrast\b.*\bfix\b',
    re.IGNORECASE,
)

# Sub-phase 3, item 13 — deterministic, zero-OpenAI-token "explain X"
# intent, sourced entirely from knowledge/rules.py's 9 Outlook/MSO
# explainer entries. Never mutates the document (action is always NONE) —
# this is a read-only knowledge lookup, never a proposal, so it does not
# need an ActionType or DOCUMENT_SCOPE entry. Checked FIRST in resolve(),
# before every mutating pattern, so a purely informational question (e.g.
# "why does VML need a fallback?") is never misread as a CSS/insert
# command. Patterns are checked in order — more specific phrases (e.g.
# "vml ... namespace") are listed before the bare "vml" catch-all so a
# fully-specific question still resolves to the more precise rule.
_EXPLAIN_PATTERN = re.compile(
    r'\b(explain|what\s+is|what\'?s|why\s+does|why\s+is|why\s+did|why\s+might|why\s+would|why\s+can\'?t|'
    r'what\s+causes|how\s+come|tell\s+me\s+about|can\s+you\s+explain)\b',
    re.IGNORECASE,
)

# D4-E3 item 6 — QUESTION + MUTATION REQUEST detection. Deliberately
# narrow: requires the literal word "and" immediately followed by a known
# imperative action verb — never a bare action-sounding word anywhere in
# the sentence, which is exactly the false-positive D4-E2 already had to
# guard against ("Why did you change the column widths?" contains "change"
# but never "and change", so this correctly does NOT match it; "Why is
# this button inconsistent, and fix it." does).
_COMPOUND_ACTION_HINT_PATTERN = re.compile(
    r'\band\s+(fix|correct|change|update|make\s+it|improve|increase|decrease|add|remove|adjust)\b',
    re.IGNORECASE,
)
# D4-E3F — the SAME "connector + imperative verb" shape as
# _COMPOUND_ACTION_HINT_PATTERN above, in the other three languages this
# checkpoint verifies (Hindi/Spanish/German) — a real, curated, bounded
# vocabulary, not a phrase-specific shortcut for any one QA sentence.
# French intentionally omitted: no French compound-question-plus-mutation
# scenario is required by this checkpoint, and this codebase's own
# established posture (see the module docstring's "honestly-partial
# vocabulary" note) is to add real coverage only where it is actually
# needed/verified, never speculative completeness.
_COMPOUND_ACTION_HINT_PATTERN_BY_LANGUAGE = {
    'hi': re.compile(r'और\s+(ठीक\s+करो|ठीक\s+कर\s+दो|बदल\s+दो|सुधार\s+दो)'),
    'es': re.compile(r'\by\s+(arréglalo|arreglalo|corrígelo|corrigelo|cámbialo|cambialo|mejóralo|mejoralo)\b', re.IGNORECASE),
    'de': re.compile(r'\bund\s+(repariere|korrigiere|ändere|verbessere)\b', re.IGNORECASE),
}


def _has_compound_action_hint(text, lowered, language):
    if _COMPOUND_ACTION_HINT_PATTERN.search(lowered):
        return True
    pattern = _COMPOUND_ACTION_HINT_PATTERN_BY_LANGUAGE.get(language)
    haystack = text if language == 'hi' else lowered
    return bool(pattern and pattern.search(haystack))
# Sub-phase 5 — extended from 16 to ~60 topic patterns as the knowledge
# base grew from 14 to 50 rules. ORDERING DISCIPLINE (unchanged from
# Sub-phase 3, now load-bearing at this size): a client+concern COMBO
# pattern (e.g. "dark mode" + "gmail") must be listed BEFORE any single-
# keyword pattern it could otherwise collide with (e.g. the bare "new
# outlook" pattern below would swallow "explain new outlook dark mode"
# if the dark-mode-specific combo weren't checked first) — first match
# in this tuple wins, always.
_EXPLAIN_TOPICS = (
    # --- Dark mode: client-specific combos BEFORE any bare client/topic
    # pattern that could otherwise steal the match. ---
    (re.compile(r'\bdark\s*mode\b.*\bgmail\b|\bgmail\b.*\bdark\s*mode\b', re.IGNORECASE), 'gmail-dark-mode-auto-invert'),
    (re.compile(r'\bdark\s*mode\b.*\bapple\b|\bapple\b.*\bdark\s*mode\b', re.IGNORECASE), 'apple-mail-dark-mode-auto-invert'),
    (re.compile(r'\bdark\s*mode\b.*\bnew\s*outlook\b|\bnew\s*outlook\b.*\bdark\s*mode\b', re.IGNORECASE), 'new-outlook-auto-dark-mode'),
    (re.compile(r'\bdark\s*mode\b.*\bclassic\s*outlook\b|\bclassic\s*outlook\b.*\bdark\s*mode\b', re.IGNORECASE), 'outlook-classic-no-auto-dark-mode'),
    # bare "dark mode" + "outlook" (no classic/new qualifier) deliberately
    # does NOT default to Classic — routes to the honest cross-client
    # strategy rule instead, same non-conflation discipline as everywhere
    # else in this codebase.
    (re.compile(r'\bwcag\b|\bcontrast\s*ratio\b|\baa\s*contrast\b', re.IGNORECASE), 'email-accessibility-wcag-contrast'),
    (re.compile(r'\bdark\s*mode\b', re.IGNORECASE), 'email-dark-mode-general-strategy'),

    # --- New Outlook vs Outlook.com, and New Outlook CSS, BEFORE the
    # bare "new outlook" catch-all. ---
    (re.compile(r'\boutlook\.?com\b|\bwebmail\s*outlook\b', re.IGNORECASE), 'new-outlook-vs-outlook-com'),
    (re.compile(r'\bnew\s*outlook\b.*\bcss\b|\bcss\b.*\bnew\s*outlook\b', re.IGNORECASE), 'new-outlook-modern-css-support'),

    # --- iOS Mail specific, BEFORE the generic format-detection pattern. ---
    (re.compile(r'\bios\b.*\b(auto[\s-]*link|format[\s-]*detection|phone|address)\b', re.IGNORECASE), 'ios-mail-format-detection'),
    (re.compile(r'\bdynamic\s*type\b', re.IGNORECASE), 'ios-mail-dynamic-type-scaling'),
    (re.compile(r'\bios\s*mail\b', re.IGNORECASE), 'ios-mail-format-detection'),

    # --- Gmail specific. ---
    (re.compile(r'\bgmail\b.*\bclip', re.IGNORECASE), 'gmail-clipping-threshold'),
    (re.compile(r'\bgmail\b.*\bimage\b|\bimage\b.*\bgmail\b', re.IGNORECASE), 'gmail-image-proxying-and-blocking'),
    (re.compile(r'\bgmail\b.*\b(style|css)\b', re.IGNORECASE), 'gmail-embedded-style-support'),
    (re.compile(r'\bgmail\b.*\bmedia\s*quer', re.IGNORECASE), 'gmail-media-query-support'),
    (re.compile(r'\bgmail\b', re.IGNORECASE), 'gmail-embedded-style-support'),

    # --- Apple Mail specific. ---
    (re.compile(r'\bapple\s*mail\b', re.IGNORECASE), 'apple-mail-best-css-support'),

    # --- Yahoo / AOL specific. ---
    (re.compile(r'\byahoo\b.*\bimage\b|\bimage\b.*\byahoo\b', re.IGNORECASE), 'yahoo-mail-image-blocking'),
    (re.compile(r'\byahoo\b', re.IGNORECASE), 'yahoo-mail-css-support'),
    (re.compile(r'\baol\b', re.IGNORECASE), 'aol-mail-shared-yahoo-infrastructure'),

    # --- New Outlook bare catch-all (after every combo above). ---
    (re.compile(r'\bnew\s*outlook\b|\bword\s*engine\b', re.IGNORECASE), 'outlook-word-engine-vs-new-outlook'),
    (re.compile(r'\b96[\s-]*dpi\b|\bpixels\s*per\s*inch\b|\bpixelsperinch\b', re.IGNORECASE), 'office-96-dpi'),
    (re.compile(r'\ballow\s*png\b|\ballowpng\b', re.IGNORECASE), 'outlook-allow-png'),
    (re.compile(r'\bvml\b.*\bnamespace\b|\bnamespace\b.*\bvml\b', re.IGNORECASE), 'vml-namespace-purpose'),
    (re.compile(r'\bvml\b.*\bfallback\b|\bfallback\b.*\bvml\b', re.IGNORECASE), 'vml-requires-html-fallback'),
    (re.compile(r'\bbulletproof\b.*\bbutton\b|\bbutton\b.*\bvml\b|\bvml\b.*\bbutton\b', re.IGNORECASE), 'outlook-bulletproof-button-pattern'),
    (re.compile(r'\bbackground\s*image\b.*\boutlook\b|\boutlook\b.*\bbackground\s*image\b', re.IGNORECASE), 'outlook-background-image-needs-vml'),
    (re.compile(r'\bbackground\s*image\b', re.IGNORECASE), 'email-bulletproof-background-pattern'),
    (re.compile(r'\brow[\s-]*collapse\b|\bzero[\s-]*height\b', re.IGNORECASE), 'global-row-collapse-danger'),
    (re.compile(r'\bspacer\b', re.IGNORECASE), 'spacer-row-safe-scoping'),
    (re.compile(r'\bmso[\s-]*hide\b', re.IGNORECASE), 'outlook-mso-hide-preheader'),
    (re.compile(r'\bpreheader\b', re.IGNORECASE), 'email-preheader-pattern-general'),
    (re.compile(r'\bfont\s*fallback\b', re.IGNORECASE), 'outlook-font-fallback-mso-only'),
    (re.compile(r'\bconditional\s*comment\b|mso\s*condition', re.IGNORECASE), 'conditional-comment-scope'),
    (re.compile(r'\btable[\s-]*layout\b|\btables?\b.*\blayout\b', re.IGNORECASE), 'outlook-table-layout-required'),
    (re.compile(r'\bline[\s-]*height\b.*\b(outlook|mso|exactly)\b|\b(outlook|mso)\b.*\bline[\s-]*height\b', re.IGNORECASE), 'outlook-line-height-exactly'),
    (re.compile(r'\bline[\s-]*height\b', re.IGNORECASE), 'email-explicit-line-height-general'),
    (re.compile(r'\bcss\s*support\b.*\boutlook\b|\boutlook\b.*\bcss\s*support\b', re.IGNORECASE), 'outlook-css-support-subset'),
    (re.compile(r'\blist\b.*\b(padding|indent)\b.*\boutlook\b|\boutlook\b.*\blist\b', re.IGNORECASE), 'outlook-list-padding-behavior'),
    (re.compile(r'\blist\b.*\b(padding|indent)\b', re.IGNORECASE), 'email-list-cross-client-indentation'),
    (re.compile(r'\bhybrid\b.*\bwidth\b|\bfluid\b.*\bwidth\b', re.IGNORECASE), 'email-hybrid-width-strategy'),
    (re.compile(r'\bmedia\s*quer', re.IGNORECASE), 'email-media-query-support-general'),
    (re.compile(r'\bfont\s*fallback\b|\bfont\s*stack\b', re.IGNORECASE), 'email-font-fallback-stack-general'),
    (re.compile(r'\babsolute\b.*\blinks?\b|\bhttps?\s*links?\b', re.IGNORECASE), 'email-links-absolute-https-only'),
    (re.compile(r'\binline\s*style\b|\bstyle\s*block\b', re.IGNORECASE), 'email-css-inline-vs-style-block-strategy'),
    (re.compile(r'\bchromium\b|\bwebkit\b', re.IGNORECASE), 'email-webmail-chromium-webkit-family'),
    # Sub-phase 4, item 6 — document-standards explainer rules.
    (re.compile(r'\btitle\b.*\b(name|subject)\b|\b(name|subject)\b.*\btitle\b', re.IGNORECASE), 'email-title-vs-document-name'),
    (re.compile(r'\bsubject\b', re.IGNORECASE), 'email-subject-is-send-metadata'),
    (re.compile(r'\btitle\b', re.IGNORECASE), 'email-title-vs-document-name'),
    (re.compile(r'\bfavicon\b', re.IGNORECASE), 'favicon-url-requirements'),
    (re.compile(r'\breset\s*css\b', re.IGNORECASE), 'reset-css-purpose'),
    (re.compile(r'\bmeta\s*(?:data)?\s*baseline\b|\brequired\s*meta\b|\bformat[\s-]*detection\b', re.IGNORECASE), 'required-email-meta-baseline'),
    (re.compile(r'\bvml\b', re.IGNORECASE), 'vml-namespace-purpose'),
    (re.compile(r'\balt\s*text\b|\bimage\b.*\baccessib', re.IGNORECASE), 'email-accessibility-alt-text-general'),
    (re.compile(r'\bcss\s*support\b', re.IGNORECASE), 'email-css-inline-vs-style-block-strategy'),
)

_EXPLAIN_CLARIFY_REPLY = (
    'Which one? I can explain a wide range of email-client compatibility topics — Classic and New Outlook, '
    'Gmail, Apple Mail, iOS Mail, Yahoo Mail, AOL Mail, VML, MSO conditional comments, dark mode, tables, '
    'fonts, line-height, backgrounds, buttons, lists, links, accessibility, and this document\'s own title/'
    'subject/favicon/Reset CSS/required meta baseline. Ask about a specific topic or client and I\'ll '
    'explain it.'
)


def _find_explain_rule(lowered):
    """First pattern match wins — order in _EXPLAIN_TOPICS matters (see
    that constant's docstring)."""
    for pattern, rule_id in _EXPLAIN_TOPICS:
        if pattern.search(lowered):
            return find_rule(rule_id)
    return None


def _find_module_type(lowered):
    for word, module_type in MODULE_TYPE_ALIASES.items():
        # `s?` tolerates a simple plural ("buttons", "images") without a
        # second alias entry for every word.
        if re.search(rf'\b{re.escape(word)}s?\b', lowered):
            return module_type
    return None


def _find_all_module_types(lowered):
    found = []
    for word, module_type in MODULE_TYPE_ALIASES.items():
        if re.search(rf'\b{re.escape(word)}s?\b', lowered) and module_type not in found:
            found.append(module_type)
    return found


def _find_color(lowered):
    """D4-E3F — every existing call site already passes already-lowered
    text; passing that SAME string straight into intent_normalization's
    find_color_value() is always safe (Devanagari has no case, and
    find_color_value lowercases its own Latin-script comparisons
    internally regardless — see that function's own docstring), so this
    extension needs no new parameter and changes behavior for NO existing
    caller except by finding MORE (never fewer, never different) colors
    than before. The canonical name it returns is resolved to a hex value
    through the SAME COLOR_WORDS dict every English word already uses —
    never a second, per-language hex mapping."""
    if match := re.search(r'#[0-9a-fA-F]{6}', lowered):
        return match.group(0).upper()
    for phrase in sorted(COLOR_WORDS, key=len, reverse=True):
        if re.search(rf'\b{re.escape(phrase)}\b', lowered):
            return COLOR_WORDS[phrase]
    from .intent_normalization import find_color_value

    canonical_name = find_color_value(lowered)
    if canonical_name and canonical_name in COLOR_WORDS:
        return COLOR_WORDS[canonical_name]
    return None


# R4-B3 §A — extracted, unchanged in behavior, from
# RuleBasedEmailCommandProvider.resolve()'s own weak-contrast-fix branch
# (C-2 remediation) so the SAME deterministic logic is callable from a
# second entry point: canonical-intent dispatch for a non-English message
# (see apply_canonical_intent() below and intent_normalization.py). This
# is not a second contrast-fix implementation — the English-trigger
# branch below calls this exact function too, so the two paths can never
# diverge in behavior, only in how they were reached.
def compute_contrast_fix_result(selected_type, props):
    if not selected_type:
        return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
    props = props if isinstance(props, dict) else {}
    # Different module types name their text-color field differently
    # (e.g. Text uses 'color', Button uses 'textColor') — same fallback
    # order emailValidation.ts's own contrast check already uses, never a
    # hardcoded single key.
    color_key = 'color' if module_capabilities.get_editable_field(selected_type, 'color') else (
        'textColor' if module_capabilities.get_editable_field(selected_type, 'textColor') else None
    )
    if color_key is None:
        return CommandResult(
            reply=f'The selected {selected_type} module does not have a text color I can adjust.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    if props.get('backgroundImage'):
        return CommandResult(
            reply=(
                "I can't reliably compute contrast here — this module has a background image, so its "
                'true effective background is not just the flat background color. Please pick a color '
                'manually with the contrast in mind.'
            ),
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    foreground = props.get(color_key)
    background = props.get('backgroundColor')
    fix = minimal_readable_foreground(foreground, background) if foreground and background else None
    if fix is None:
        return CommandResult(
            reply=(
                "I can't compute a safe automatic fix here — either the current color isn't a plain "
                'value I can reason about, or the contrast already can\'t be closed with a small change '
                'to the text color alone. Please choose a color manually.'
            ),
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    return CommandResult(
        reply=(
            f"The current text color {fix['old_color']} has a contrast ratio of {fix['old_ratio']}:1 "
            f"against {background} — WCAG AA needs at least {WCAG_AA_NORMAL_TEXT_RATIO}:1. I will change "
            f"the text color to {fix['new_color']} (ratio {fix['new_ratio']}:1). Please confirm."
        ),
        action={
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected',
            'module_type': selected_type, 'patch': {color_key: fix['new_color']},
        },
        confidence=0.85,
    )


# R4-B4 §1 — extracted, unchanged in behavior, from
# RuleBasedEmailCommandProvider.resolve()'s own Outlook-VML-fallback
# branch (Sub-phase 6 work package D) — see compute_contrast_fix_result's
# own docstring for why this extraction pattern (never a second
# implementation) is used throughout this module.
def compute_outlook_fallback_result(selected_type):
    if not selected_type:
        return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
    # Background is checked first: hero-background-image is the one
    # module type with BOTH capabilities (its own CTA button VML nests
    # inside its background ghost-table VML — see heroCatalog.tsx), so
    # APPLY_OUTLOOK_WRAPPER is the single correct action that covers
    # both for that type.
    if _is_vml_background_module(selected_type):
        return CommandResult(
            reply=f'I will enable the Classic Outlook VML background fallback for the selected {selected_type} module.',
            action={'type': ActionType.APPLY_OUTLOOK_WRAPPER, 'module_type': selected_type}, confidence=0.85,
        )
    if _is_vml_button_module(selected_type):
        return CommandResult(
            reply=f'I will enable the Classic Outlook VML fallback for the selected {selected_type} module.',
            action={'type': ActionType.APPLY_VML_PATTERN, 'module_type': selected_type}, confidence=0.85,
        )
    return CommandResult(
        reply=f'The selected {selected_type} module does not support a VML fallback.',
        action={'type': ActionType.NONE}, confidence=0.3,
    )


# R4-B4 §1 — extracted from the (now broadened — see _SET_LINK_PATTERN's
# own comment) placeholder-link-fix branch. `message_text` is the ORIGINAL
# (not lowercased) message — URLs are case-sensitive.
def compute_set_link_result(selected_type, message_text):
    if not selected_type:
        return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
    href_field = module_capabilities.get_editable_field(selected_type, 'href')
    if href_field is None:
        return CommandResult(
            reply=f'The selected {selected_type} module does not have a link to set.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    url_match = _URL_IN_TEXT_PATTERN.search(message_text)
    if not url_match:
        return CommandResult(
            reply=(
                "I won't guess a destination for this link. What URL should it go to? "
                '(e.g. "use https://example.com/shop")'
            ),
            action={'type': ActionType.NONE}, confidence=0.4,
        )
    url = _clean_url_value(url_match.group(0))
    if not url:
        return CommandResult(
            reply="That URL doesn't look valid — please give a full https:// (or http://) link.",
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    return CommandResult(
        reply=f"I will set the selected {selected_type} module's link to {url}. Please confirm.",
        action={
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected',
            'module_type': selected_type, 'patch': {'href': url},
        },
        confidence=0.85,
    )


# R4-B4 §1/§2 — SET_IMAGE. Same "never guess a source" posture as
# compute_set_link_result — a bare {'url': ...} marker, resolved/
# validated the SAME way any other image_asset-valued field already is
# (see _validate_image_asset_value/resolve_asset_references) — never a
# second image-resolution path.
def compute_set_image_result(selected_type, message_text):
    if not selected_type:
        return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
    image_field = next(
        (f for f in module_capabilities.get_editable_fields(selected_type) if f.get('valueType') == 'image_asset'),
        None,
    )
    if image_field is None:
        return CommandResult(
            reply=f'The selected {selected_type} module does not have an image I can change.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    url_match = _URL_IN_TEXT_PATTERN.search(message_text)
    if not url_match:
        return CommandResult(
            reply=(
                "I won't invent an image source. What URL should the image use? "
                '(e.g. "use https://example.com/photo.jpg")'
            ),
            action={'type': ActionType.NONE}, confidence=0.4,
        )
    url = _clean_url_value(url_match.group(0))
    if not url:
        return CommandResult(
            reply="That image URL doesn't look valid — please give a full https:// (or http://) link.",
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    return CommandResult(
        reply=f"I will set the selected {selected_type} module's image to {url}. Please confirm.",
        action={
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected',
            'module_type': selected_type, 'patch': {image_field['key']: {'url': url}},
        },
        confidence=0.85,
    )


# R4-B4 §1/§2/§3 — CHANGE_SPACING. Uniform desktop padding on all four
# sides — matches every one of §3's own example phrasings ("20px
# padding around this", "add some space inside", "increase internal
# spacing to 20"), none of which name a single side. A per-side
# ("more padding on top only") variant is intentionally not attempted
# here — out of scope, would need new vocabulary this checkpoint's
# examples never ask for; declines honestly (falls through to the
# generic clarify reply) rather than guess a side.
# R4-B4 §3 — "add some space inside" and "increase internal spacing to
# 20" must both use this SAME capability; the former genuinely names no
# amount at all. Rather than block on a clarifying question for the
# no-amount case (which "give this 20px padding" never needs), apply
# this one clearly-disclosed standard amount — the reply always states
# the exact value used, so it is never a silent guess, and the proposal
# still requires explicit Apply like every other change.
_DEFAULT_SPACING_PX = 16


def compute_spacing_result(selected_type, lowered_text):
    if not selected_type:
        return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
    numbers = _SPACING_NUMBER_PATTERN.findall(lowered_text)
    px = float(numbers[0]) if numbers else float(_DEFAULT_SPACING_PX)
    value = _validate_settings_patch({'desktop': {
        'paddingTop': px, 'paddingRight': px, 'paddingBottom': px, 'paddingLeft': px,
    }})
    if not value:
        return CommandResult(
            reply='That padding value is out of the supported range (0-200px).',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    px_label = int(px) if px == int(px) else px
    default_note = f' (no exact amount was given, so I used a standard {_DEFAULT_SPACING_PX}px)' if not numbers else ''
    return CommandResult(
        reply=(
            f"I will set the selected {selected_type} module's padding to {px_label}px on all sides"
            f'{default_note}. Please confirm.'
        ),
        action={
            'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': selected_type, 'patch': value,
        },
        confidence=0.85 if numbers else 0.6,
    )


# R4-B4 §1 — extracted, unchanged in behavior for the English-widths
# phrasing, from RuleBasedEmailCommandProvider.resolve()'s own layout-
# column-widths branch (Sub-phase 6 work package D) — widened trigger
# only (see the two call sites), never a second widths-validation path;
# RESTRUCTURE_LAYOUT still goes through the exact same
# MIN_COLUMN_WIDTH_PERCENT/COLUMN_WIDTH_TOTAL_TOLERANCE checks in
# validate_action() every other caller of this action type already does.
def compute_column_ratio_result(selected_type, lowered_text):
    if not selected_type:
        return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
    capability = module_capabilities.get_module_capability(selected_type)
    if not capability or not capability.get('isLayout'):
        return CommandResult(
            reply=f'The selected {selected_type} module is not a layout, so it has no column widths to change.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    numbers = [float(n) for n in _WIDTH_NUMBERS_PATTERN.findall(lowered_text)]
    column_count = capability.get('columnCount') or 0
    if len(numbers) != column_count:
        return CommandResult(
            reply=f'Tell me {column_count} width percentages for this layout, e.g. "change the column widths to 70/30".',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    widths_label = '/'.join(str(int(n)) if n == int(n) else str(n) for n in numbers)
    return CommandResult(
        reply=f'This will change the column widths to {widths_label}%. Please confirm.',
        action={'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': selected_type, 'widths': numbers},
        confidence=0.85,
    )


# R4-B4 §1 — EXPLAIN_VALIDATION_ISSUE. Prefers the SPECIFIC selected
# issue's own title/detail (already validated/whitelisted upstream —
# see ai_command_openai.py/ai_command_local.py's own
# selected_validation_issue bounding) over a keyword-topic lookup, since
# "explain this issue"/explain-selected-issue is fundamentally about
# WHICH issue the user is looking at, not a general glossary query —
# the frontend's own local matchDocumentIntent()/resolveDocumentIntent()
# already does this for English; this is the same behavior for the
# canonical-intent (potentially non-English) path, and the same
# fallback (_find_explain_rule) the English deterministic router
# already uses when no issue is selected.
def compute_explain_validation_issue_result(context):
    context = context if isinstance(context, dict) else {}
    issue = context.get('selected_validation_issue')
    if isinstance(issue, dict) and issue.get('title') and issue.get('detail'):
        return CommandResult(
            reply=f"{issue['title']}. {issue['detail']}", action={'type': ActionType.NONE}, confidence=0.9,
        )
    message = context.get('_retrieval_message') if isinstance(context.get('_retrieval_message'), str) else ''
    rule = _find_explain_rule(message.lower())
    if rule is not None:
        return CommandResult(reply=f'{rule.title}. {rule.description}', action={'type': ActionType.NONE}, confidence=0.8)
    return CommandResult(reply=_EXPLAIN_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.3)


# R4-B4 §1/§8 — COMPARE_IMPORT_RECONSTRUCTION as a canonical intent is
# EXPLAIN-ONLY here — never mutates, never proposes a correction (R4-C's
# job, explicitly out of scope for R4-B4 too — see this module's own
# apply_canonical_intent docstring). Summarizes the ALREADY-COMPUTED,
# already-bounded fidelity_categories this exact request carried —
# never a second comparison/classification engine (that's
# reconstructionReview.ts's job, frontend-side); this only narrates
# what it was already told.
def compute_reconstruction_explain_result(context):
    context = context if isinstance(context, dict) else {}
    reconstruction = context.get('import_reconstruction')
    if not isinstance(reconstruction, dict):
        return CommandResult(
            reply='This conversation has no imported-email reconstruction to compare against.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    categories = reconstruction.get('fidelity_categories')
    if not isinstance(categories, list) or not categories:
        return CommandResult(
            reply='I have reconstruction context, but no per-category fidelity summary to explain yet.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    non_preserved = [c for c in categories if isinstance(c, dict) and c.get('status') != 'preserved']
    if not non_preserved:
        return CommandResult(
            reply='Everything I checked was preserved during reconstruction — no differences to explain.',
            action={'type': ActionType.NONE}, confidence=0.8,
        )
    parts = [f"{c.get('id')} ({c.get('status')}): {c.get('summary')}" for c in non_preserved if c.get('summary')]
    return CommandResult(reply=' '.join(parts), action={'type': ActionType.NONE}, confidence=0.8)


# R4-D Checkpoint D1-B — IMPROVE_IMPORT_RECONSTRUCTION's executor.
# Deliberately NEVER mutates (action is always NONE) — this request's
# own `context['import_reconstruction']` is the SAME bounded, category-
# level summary compute_reconstruction_explain_result already reads
# (fidelity_categories: 8 entries, each one of 'preserved'/'normalized'/
# 'approximated'/'removed'/'unsupported' — see htmlImportFidelity.ts's
# own FidelityStatus type), never the live module tree or the raw
# source HTML. Building a real, per-property repair candidate needs
# BOTH of those — that is exactly why R4-C's real candidate generation/
# Apply flow is 100% frontend (reconstructionCorrectionLoop.ts) and
# stays there; this function's only honest job is to (a) confirm the
# request was understood, (b) summarize what genuinely needs attention
# using ONLY the category-level facts this request actually carries,
# and (c) point at where the real fix lives — never claim to have
# fixed anything, never invent a per-item repairable/not-repairable
# verdict this payload cannot support. In practice this path is a
# graceful-degradation safety net: the FRONTEND's own local matcher
# (reconstructionIntentMatcher.ts, now multilingual per D1-C) already
# intercepts "fix everything you safely can" and its close variants in
# en/hi/es/fr BEFORE any network request — see that file's own
# docstring — so this backend path is reached only for a phrasing/
# language the bounded local matcher does not (yet) cover.
def compute_improve_reconstruction_result(context):
    context = context if isinstance(context, dict) else {}
    reconstruction = context.get('import_reconstruction')
    if not isinstance(reconstruction, dict):
        return CommandResult(
            reply='This conversation has no imported-email reconstruction to improve yet.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    categories = reconstruction.get('fidelity_categories')
    if not isinstance(categories, list) or not categories:
        return CommandResult(
            reply='I have reconstruction context, but no per-category fidelity summary to work from yet.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    approximated = [c for c in categories if isinstance(c, dict) and c.get('status') == 'approximated']
    removed = [c for c in categories if isinstance(c, dict) and c.get('status') == 'removed']
    unsupported = [c for c in categories if isinstance(c, dict) and c.get('status') == 'unsupported']
    needs_attention = approximated + removed + unsupported
    if not needs_attention:
        return CommandResult(
            reply=(
                'Everything I can check is already preserved or safely normalized — there is nothing left '
                'for me to safely fix.'
            ),
            action={'type': ActionType.NONE}, confidence=0.8,
        )
    lines = ["I'll go through what still needs attention:"]
    for c in approximated:
        lines.append(f"- {c.get('id')}: approximation — {c.get('summary')}")
    for c in removed:
        lines.append(f"- {c.get('id')}: removed — {c.get('summary')}")
    for c in unsupported:
        lines.append(f"- {c.get('id')}: unsupported — {c.get('summary')}")
    lines.append(
        'Open the reconstruction comparison panel and ask me to "fix everything you safely can" there — '
        'I will show you the exact safe repairs as a proposal before anything changes, and be upfront about '
        'whatever this builder genuinely cannot reproduce exactly.'
    )
    return CommandResult(reply='\n'.join(lines), action={'type': ActionType.NONE}, confidence=0.8)


# R4-B4 Closure §B/§C — builds a canonical mutation proposal from a
# property value the FRONTEND has already read from a resolved source
# module/column (see frontend/src/emailbuilder/referenceResolver.ts's
# resolveCopySourceRequest) for a "same X as the previous section/column
# N" request. This function never resolves "previous section" or
# "column 1" itself, and never reads a second module's JSON on its own
# — it receives exactly one already-whitelisted {property, value,
# source_label} triple and does nothing but build + validate the SAME
# existing action every other canonical intent already uses
# (UPDATE_MODULE_SETTINGS for padding, UPDATE_MODULE_PROPS for
# backgroundColor, RESTRUCTURE_LAYOUT for column ratio — see §C). Never
# a second mutation system, never a second capability-check system:
# validate_action() (padding's own _validate_settings_patch, and for
# backgroundColor/columnRatio the real validate_action() call below) is
# still the SOLE authority on whether the target module type actually
# supports the property — "confirm target supports property" is this
# existing gate, not a new one. An unsupported/incompatible target
# yields an honest decline naming the property and target type — never
# a silent guess, never a partial/best-effort mutation.
_COPY_SOURCE_PROPERTIES = frozenset({'padding', 'backgroundColor', 'align', 'columnRatio'})
_COPY_SOURCE_PROPERTY_LABELS = {'backgroundColor': 'background color', 'align': 'alignment'}


def compute_copy_source_result(selected_type, copy_source):
    if not selected_type:
        return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)

    copy_source = copy_source if isinstance(copy_source, dict) else {}
    prop = copy_source.get('property')
    value = copy_source.get('value')
    source_label = copy_source.get('source_label') if isinstance(copy_source.get('source_label'), str) and copy_source.get('source_label').strip() else 'the referenced source'

    if prop not in _COPY_SOURCE_PROPERTIES:
        return CommandResult(
            reply=f"I can't copy that property from {source_label} yet.",
            action={'type': ActionType.NONE}, confidence=0.2,
        )

    if prop == 'padding':
        if not isinstance(value, dict):
            return CommandResult(
                reply=f'I could not read a padding value from {source_label}.',
                action={'type': ActionType.NONE}, confidence=0.3,
            )
        patch = _validate_settings_patch({'desktop': value})
        # _validate_settings_patch drops each nested side INDEPENDENTLY
        # (see its own per-field loop) — fine for compute_spacing_result,
        # whose four sides are always identical by construction, but a
        # copy-source padding value can legitimately have asymmetric
        # sides. A partial result here (three of four sides applied)
        # would be exactly the "silent guess" §B forbids, so any side
        # that failed validation must decline the WHOLE copy, never
        # apply an incomplete patch.
        if not patch or set(patch.get('desktop', {})) != set(value):
            return CommandResult(
                reply='That padding value is out of the supported range (0-200px).',
                action={'type': ActionType.NONE}, confidence=0.3,
            )
        return CommandResult(
            reply=f"I will match the selected {selected_type} module's padding to {source_label}. Please confirm.",
            action={'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': selected_type, 'patch': patch},
            confidence=0.85,
        )

    if prop in ('backgroundColor', 'align'):
        label = _COPY_SOURCE_PROPERTY_LABELS[prop]
        if not isinstance(value, str) or not value.strip():
            return CommandResult(
                reply=f'{source_label} has no {label} set, so there is nothing to copy.',
                action={'type': ActionType.NONE}, confidence=0.3,
            )
        candidate = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected',
            'module_type': selected_type, 'patch': {prop: value},
        }
        validated = validate_action(candidate)
        if not validated or not validated.get('patch'):
            return CommandResult(
                reply=f"The selected {selected_type} module does not support {label}, so I can't copy {source_label}'s.",
                action={'type': ActionType.NONE}, confidence=0.3,
            )
        return CommandResult(
            reply=f"I will match the selected {selected_type} module's {label} to {source_label}. Please confirm.",
            action=validated, confidence=0.85,
        )

    # prop == 'columnRatio' (§C) — the SOURCE layout's own builder-level
    # column widths (never rendered pixel widths — see referenceResolver.
    # ts's own read of LayoutModuleProps.columnWidths), fed through the
    # EXACT SAME RESTRUCTURE_LAYOUT action + validate_action() width-sum/
    # min-width gate every other column-ratio change already uses —
    # computeLayoutAvailableWidthPx/resolveColumnPixelWidths and outer
    # spacing/gutter/internal padding remain fully authoritative on the
    # frontend's own render side; this never bypasses or recomputes them.
    if not isinstance(value, list) or not value:
        return CommandResult(
            reply=f'I could not read column widths from {source_label}.',
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    candidate = {'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': selected_type, 'widths': value}
    validated = validate_action(candidate)
    if not validated:
        return CommandResult(
            reply=(
                f"{source_label}'s column ratio does not carry over to the selected layout "
                '(different column count, or widths that do not fit here).'
            ),
            action={'type': ActionType.NONE}, confidence=0.3,
        )
    widths = validated['widths']
    widths_label = '/'.join(str(int(w)) if w == int(w) else str(w) for w in widths)
    return CommandResult(
        reply=f'This will change the column widths to {widths_label}%, matching {source_label}. Please confirm.',
        action=validated, confidence=0.85,
    )


# R4-B3 §A / R4-B4 §1 — the canonical-intent execution entry point.
# `message` is the raw (not lowercased) user text — several executors
# (SET_LINK/SET_IMAGE need the real URL casing; CHANGE_SPACING/
# CHANGE_COLUMN_RATIO only need digits, which are language-neutral, so
# lower-casing is harmless for them). Every CanonicalIntent value now has
# a real executor here EXCEPT none are silently skipped — an intent this
# function doesn't recognize returns None, and the caller (see
# CanonicalIntentEmailCommandProvider below) falls through to the normal
# English-pattern deterministic router or the LLM tier, exactly as if
# canonical-intent detection had not run at all. Never a second,
# parallel action-producing system: every branch here calls the SAME
# functions the English-triggered path already uses.
def apply_canonical_intent(intent, context, message=''):
    from .intent_normalization import CanonicalIntent, detect_language, find_alignment_value

    context = context if isinstance(context, dict) else {}
    selected = context.get('selected_module')
    selected_type = selected.get('type') if isinstance(selected, dict) else None
    props = selected.get('props') if isinstance(selected, dict) else None
    text = message or ''
    lowered = text.lower()

    if intent == CanonicalIntent.FIX_CONTRAST:
        return compute_contrast_fix_result(selected_type, props)
    if intent == CanonicalIntent.SET_LINK:
        return compute_set_link_result(selected_type, text)
    if intent == CanonicalIntent.CHANGE_SPACING:
        # D4-E3F — was compute_spacing_result(selected_type, lowered)
        # directly: a real, live-QA-caught bug, since THIS is the code
        # path a non-English CHANGE_SPACING message reaches through
        # CanonicalIntentEmailCommandProvider (checked BEFORE
        # RuleBasedEmailCommandProvider ever runs) — calling the plain,
        # non-combining function here meant a message like German "Mach
        # den Button grün und erhöhe den Abstand auf 20px." had its
        # color request silently dropped, even though the EXACT SAME
        # message phrased in English or Hindi correctly produced a
        # BATCH_UPDATE. Now calls the SAME shared combiner the English/
        # loanword path uses — see that function's own docstring.
        return compute_spacing_result_with_props_combining(selected_type, lowered, text)
    if intent == CanonicalIntent.CHANGE_ALIGNMENT:
        if not selected_type:
            return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
        current_props = props if isinstance(props, dict) else {}
        patch = _extract_style_patch(lowered, selected_type, current_props)
        # R4-B4 §4 — the English-only _ALIGN_PATTERN above finds nothing
        # for a genuinely non-English alignment word (e.g. Hindi
        # "बीच में") — find_alignment_value() is the same-language-
        # independent supplement, tried only when the English regex
        # found nothing, using the SAME 'align' field/allow-list check.
        if (not patch or 'align' not in patch) and 'align' in {f['key'] for f in module_capabilities.get_editable_fields(selected_type)}:
            alignment_value = find_alignment_value(text, detect_language(text))
            if alignment_value:
                patch = {**(patch or {}), 'align': alignment_value}
        align_patch = {'align': patch['align']} if patch and 'align' in patch else None
        if not align_patch:
            return CommandResult(
                reply=f'The selected {selected_type} module does not have an alignment I can change, or I could not tell which alignment you want (left/center/right).',
                action={'type': ActionType.NONE}, confidence=0.3,
            )
        return CommandResult(
            reply=f'I will update the selected {selected_type} module\'s alignment. Please confirm.',
            action={'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': selected_type, 'patch': align_patch},
            confidence=0.85,
        )
    if intent == CanonicalIntent.SET_BACKGROUND:
        if not selected_type:
            return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
        current_props = props if isinstance(props, dict) else {}
        patch = _extract_style_patch(f'background {lowered}', selected_type, current_props)
        bg_patch = {'backgroundColor': patch['backgroundColor']} if patch and 'backgroundColor' in patch else None
        if not bg_patch:
            return CommandResult(
                reply=f'The selected {selected_type} module does not have a background color I can change, or I could not recognize the color.',
                action={'type': ActionType.NONE}, confidence=0.3,
            )
        return CommandResult(
            reply=f'I will update the selected {selected_type} module\'s background. Please confirm.',
            action={'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': selected_type, 'patch': bg_patch},
            confidence=0.85,
        )
    if intent == CanonicalIntent.ENABLE_OUTLOOK_FALLBACK:
        return compute_outlook_fallback_result(selected_type)
    if intent == CanonicalIntent.EXPLAIN_VALIDATION_ISSUE:
        context_with_message = {**context, '_retrieval_message': text}
        return compute_explain_validation_issue_result(context_with_message)
    if intent == CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION:
        return compute_reconstruction_explain_result(context)
    if intent == CanonicalIntent.CHANGE_COLUMN_RATIO:
        return compute_column_ratio_result(selected_type, lowered)
    if intent == CanonicalIntent.SET_IMAGE:
        return compute_set_image_result(selected_type, text)
    if intent == CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION:
        return compute_improve_reconstruction_result(context)
    return None


# R4-B3 §D — the bounded, Email-Builder-specific tool loop. This is
# NOT a generic tool-executor: every name here is a fixed, whitelisted
# READ over data that is ALREADY present in `safe_context` for this
# exact request (selected_module, selected_column, selected_validation_
# issue, import_reconstruction, knowledge, plan) — see
# ai_command_local.py/ai_command_openai.py's own tool-loop docstrings.
# No tool here ever fetches anything beyond what the request already
# carried, executes code, or mutates a document. An unrecognized tool
# name returns None rather than raising — the caller treats that as
# "stop looping, answer with whatever the model has," never a crash.
READ_TOOL_NAMES = frozenset({
    'GET_SELECTED_MODULE', 'GET_SELECTED_COLUMN', 'GET_DOCUMENT_SUMMARY', 'GET_EMAIL_SETTINGS',
    'GET_VALIDATION_REPORT', 'GET_IMPORT_RECONSTRUCTION', 'GET_MODULE_CAPABILITIES', 'COMPARE_RECONSTRUCTION',
})

# R4-B3 §D — hard iteration cap. Never configurable at runtime (a prompt
# cannot raise its own budget) — see execute_tool_loop() below.
MAX_TOOL_LOOP_ITERATIONS = 5


def execute_tool_call(name, args, safe_context, document_summary=None):
    """Returns a small, bounded, JSON-serializable dict (never None for
    a whitelisted name, even when the requested data is absent — an
    absent value is itself useful information, e.g. "no module
    selected"), or None for an unrecognized tool name.

    D4-E3I §3 — `document_summary` (optional) is deliberately NOT part of
    `safe_context`: unlike every other field there, which is always
    serialized into the main "Current context JSON" system message on
    EVERY call, this one is only ever spent when the model itself asks
    for GET_DOCUMENT_SUMMARY via the existing bounded tool loop — an
    ordinary single-field turn never pays for it. Already validated/
    filtered by the caller (see ai_command_local.py/ai_command_openai.py's
    own _build_safe_document_summary) before it ever reaches here."""
    args = args if isinstance(args, dict) else {}
    safe_context = safe_context if isinstance(safe_context, dict) else {}

    if name == 'GET_SELECTED_MODULE':
        return {'selected_module': safe_context.get('selected_module')}
    if name == 'GET_SELECTED_COLUMN':
        return {'selected_column': safe_context.get('selected_column')}
    if name == 'GET_DOCUMENT_SUMMARY':
        # Bounded on purpose — platform/width/editor_mode, plus (D4-E3I)
        # an ordered list of top-level module TYPES only, never the full
        # module tree (which this app never sends to any AI provider at
        # all — see resolve_asset_references()'s own posture on never
        # sending raw document content). `document_summary` is None on
        # any older/omitting client — the key is still always present
        # (possibly null), same "never omit a documented key" posture as
        # every other tool result here.
        return {
            'platform': safe_context.get('platform'), 'width': safe_context.get('width'),
            'editor_mode': safe_context.get('editor_mode'),
            'document_summary': document_summary,
        }
    if name == 'GET_EMAIL_SETTINGS':
        return {'platform': safe_context.get('platform'), 'width': safe_context.get('width')}
    if name == 'GET_VALIDATION_REPORT':
        return {'selected_validation_issue': safe_context.get('selected_validation_issue')}
    if name == 'GET_IMPORT_RECONSTRUCTION':
        return {'import_reconstruction': safe_context.get('import_reconstruction')}
    if name == 'GET_MODULE_CAPABILITIES':
        module_type = args.get('module_type')
        if not isinstance(module_type, str) or module_type not in module_capabilities.get_all_module_types():
            return {'module_type': module_type, 'editable_fields': []}
        fields = module_capabilities.get_editable_fields(module_type)
        return {'module_type': module_type, 'editable_fields': [f.get('key') for f in fields]}
    if name == 'COMPARE_RECONSTRUCTION':
        reconstruction = safe_context.get('import_reconstruction')
        categories = reconstruction.get('fidelity_categories') if isinstance(reconstruction, dict) else None
        return {'fidelity_categories': categories or []}
    return None


class RuleBasedEmailCommandProvider(EmailCommandProvider):
    """Zero-network, always-available. Understands a bounded, explicitly
    documented set of English command patterns — NOT arbitrary natural
    language, and NOT other languages (see feature report). Anything
    outside this vocabulary returns ActionType.NONE with a clarifying
    reply, exactly like Yukti's RuleBasedIntentProvider falls through to
    Intent.UNKNOWN for out-of-vocabulary input.

    INSERT-by-name recognition (_find_module_type/_find_all_module_types)
    stays bounded to MODULE_TYPE_ALIASES's original 5 types (see that
    constant's docstring) — but selected-module property edits and
    global-style sweeps below are manifest-driven and therefore already
    work for ANY of the registry's 53 types, whenever the selected/
    targeted type actually has the relevant editable field."""

    def resolve(self, message, context):
        text = (message or '').strip()
        if not text:
            return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.0)

        lowered = text.lower()
        selected = (context or {}).get('selected_module')
        selected_type = selected.get('type') if isinstance(selected, dict) else None

        # Sub-phase 3, item 13 — the read-only "explain X" knowledge
        # lookup, checked before every mutating pattern (see
        # _EXPLAIN_PATTERN's docstring above). D4-E3 item 6 — a QUESTION
        # is not the same turn shape as a QUESTION + MUTATION REQUEST
        # ("Why is this button inconsistent, and fix it."): the second
        # shape must still produce a real proposed correction, not just
        # an explanation with the "fix it" half silently dropped. This
        # deterministic explain-branch only ever answers pure questions —
        # when a compound-action hint also matches, this branch steps
        # aside (falls through the rest of resolve() unchanged) so the
        # message can reach a genuine NO_MATCH and route to the LLM tier,
        # which can produce both the grounded explanation (the same rule
        # is independently retrieved for it via retrieve_relevant_
        # knowledge — see that function's own docstring) AND a proposed
        # action in one turn. A bare question with no compound-action hint
        # is completely unaffected — still answered here, deterministically,
        # with zero LLM involvement, exactly as before.
        #
        # D4-E3F — _EXPLAIN_PATTERN itself is English-only; is_explanation_seeking()
        # (intent_normalization.py, the SAME canonical multilingual layer
        # this checkpoint's color/spacing/alignment resolution already
        # reuses) is checked as a second, OR'd signal so a genuinely non-
        # English question (or question+mutation) is correctly classified
        # too — never misread as a plain, silently-partial mutation
        # attempt. _find_explain_rule() itself (the KNOWLEDGE-BASE lookup)
        # remains English-only — a disclosed, separate, much larger
        # undertaking (60+ hand-curated topic patterns) out of this
        # checkpoint's scope; a non-English question therefore still
        # safely reaches genuine NO_MATCH -> the LLM tier here (same
        # eventual outcome as before this change), while a non-English
        # QUESTION+MUTATION message is now correctly kept together rather
        # than silently treated as explanation-only.
        from .intent_normalization import detect_language, is_explanation_seeking

        detected_language = detect_language(lowered)
        is_question = _EXPLAIN_PATTERN.search(lowered) or (
            detected_language != 'en' and is_explanation_seeking(text, detected_language)
        )
        if is_question and not _has_compound_action_hint(text, lowered, detected_language):
            rule = _find_explain_rule(lowered)
            if rule is not None:
                from . import local_ai_diagnostics

                local_ai_diagnostics.record_knowledge_rules_used([rule.id])
                return CommandResult(
                    reply=f'{rule.title}. {rule.description}',
                    action={'type': ActionType.NONE}, confidence=1.0,
                )
            return CommandResult(reply=_EXPLAIN_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.3)

        # Sub-phase 7 — email COMPOSITION ("create a promotional email for
        # a summer sale with ... "). Checked BEFORE every other pattern in
        # this function, including the generic _INSERT_PATTERN below (which
        # also matches "create"/"add"): compose_from_brief() itself only
        # ever matches text that clearly says "...email..." AND uses a
        # compose verb (create/build/generate/make/compose/draft), so a
        # plain "create a button" (no "email") safely falls through
        # unaffected to the ordinary insert-module handling further down.
        composition = compose_from_brief(text)
        if composition is not None:
            item_count = len(composition['items'])
            top_level_types = ', '.join(item['module_type'] for item in composition['items'])
            return CommandResult(
                reply=(
                    f"I will compose a {composition['pattern_label']} email with {item_count} section"
                    f"{'s' if item_count != 1 else ''}: {top_level_types}. Review the proposal and Apply "
                    'to insert it, or Cancel to change nothing.'
                ),
                action={'type': ActionType.COMPOSE_EMAIL, 'items': composition['items']},
                confidence=0.8,
            )

        # Sub-phase 6 closure — repeatable-field ADD ("add a navigation
        # link called Pricing with URL https://..."). Checked BEFORE
        # _NESTED_INSERT_PATTERN below — a phrase like "... saying great
        # stuff here" legitimately ends in the word "here" without meaning
        # the location marker _NESTED_INSERT_PATTERN looks for, so the
        # more specific called/named/titled/for ... with/using/saying
        # structure must win first.
        if _ADD_REPEATABLE_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            repeatable = module_capabilities.get_repeatable_field(selected_type)
            if not repeatable:
                return CommandResult(
                    reply=f"The selected {selected_type} module doesn't have a list I can edit item-by-item.",
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            match = _ADD_REPEATABLE_PATTERN.search(text)
            if not match:
                return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)
            identifier_raw = match.group(1).strip().strip('"\'').strip()
            content_raw = match.group(2).strip().strip('"\'').strip()
            item_schema = repeatable['itemSchema']
            raw_item = _build_repeatable_add_item(item_schema, identifier_raw, content_raw)
            if raw_item is None:
                return CommandResult(
                    reply=(
                        f"I can add a simple two-field item to the selected {selected_type} module's list "
                        '(e.g. "add a link called Pricing with URL https://..."), but not a richer item like this one.'
                    ),
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            fields_by_key = {field['key']: field for field in item_schema}
            safe_item = {}
            for key, raw_value in raw_item.items():
                field = fields_by_key[key]
                validated = _validate_field_value(field, raw_value)
                if validated is None:
                    return CommandResult(
                        reply=f'I couldn\'t use "{raw_value}" for {field["label"]} — please provide a valid value.',
                        action={'type': ActionType.NONE}, confidence=0.3,
                    )
                safe_item[key] = validated
            return CommandResult(
                reply=f"I will add a new item to the selected {selected_type} module's list.",
                action={'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': selected_type, 'op': 'add', 'item': safe_item},
                confidence=0.85,
            )

        # Sub-phase 6, work package E -- nested insert ("add a text module
        # here"/"insert a button into this column"). Checked before the
        # generic _INSERT_PATTERN below, and AFTER repeatable-field ADD
        # (see that block's docstring for why the ordering matters).
        if _NESTED_INSERT_PATTERN.search(lowered):
            module_type = _find_module_type(lowered)
            if not module_type:
                return CommandResult(
                    reply='I can insert a text, image, button, divider, or spacer here -- which one?',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            return CommandResult(
                reply=f'I will insert a {module_type} module into the selected column.',
                action={'type': ActionType.INSERT_NESTED_MODULE, 'module_type': module_type, 'patch': {}},
                confidence=0.85,
            )

        # Sub-phase 6 closure — repeatable-field UPDATE ("change the
        # second navigation link label to Services"). Checked before the
        # generic style-patch fallthrough near the end of this function.
        if _UPDATE_REPEATABLE_PATTERN.search(text):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            repeatable = module_capabilities.get_repeatable_field(selected_type)
            if not repeatable:
                return CommandResult(
                    reply=f"The selected {selected_type} module doesn't have a list I can edit item-by-item.",
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            match = _UPDATE_REPEATABLE_PATTERN.search(text)
            index = _ordinal_to_index(match.group(1))
            if index is None or index < 0:
                return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)
            field = _match_repeatable_field(repeatable['itemSchema'], match.group(2).lower())
            if not field:
                return CommandResult(
                    reply=f'Which field on item {index + 1} would you like to change?',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            raw_value = match.group(3).strip().strip('"\'').strip()
            if not raw_value:
                return CommandResult(
                    reply=f'Tell me the new value for {field["label"]}.',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            validated = _validate_field_value(field, raw_value)
            if validated is None:
                return CommandResult(
                    reply=f'I couldn\'t use "{raw_value}" for {field["label"]} — please provide a valid value.',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            return CommandResult(
                reply=f'This will change item {index + 1}\'s {field["label"]} to "{validated}". Please confirm.',
                action={
                    'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': selected_type,
                    'op': 'update', 'index': index, 'item': {field['key']: validated},
                },
                confidence=0.85,
            )

        # Sub-phase 6 closure — repeatable-field REORDER ("move the
        # fourth navigation link to position 2").
        if _REORDER_REPEATABLE_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            repeatable = module_capabilities.get_repeatable_field(selected_type)
            if not repeatable:
                return CommandResult(
                    reply=f"The selected {selected_type} module doesn't have a list I can edit item-by-item.",
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            match = _REORDER_REPEATABLE_PATTERN.search(lowered)
            from_index = _ordinal_to_index(match.group(1))
            try:
                to_index = int(match.group(2)) - 1
            except ValueError:
                to_index = None
            if from_index is None or from_index < 0 or to_index is None or to_index < 0:
                return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)
            return CommandResult(
                reply=f'This will move item {from_index + 1} to position {to_index + 1}. Please confirm.',
                action={
                    'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': selected_type,
                    'op': 'reorder', 'fromIndex': from_index, 'toIndex': to_index,
                },
                confidence=0.85,
            )

        # Sub-phase 6, work package E — repeatable-field item removal
        # ("remove the first nav link"). Checked before the generic
        # _DELETE_PATTERN below.
        if _REMOVE_REPEATABLE_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            repeatable = module_capabilities.get_repeatable_field(selected_type)
            if not repeatable:
                return CommandResult(
                    reply=f"The selected {selected_type} module doesn't have a list I can edit item-by-item.",
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            match = _REMOVE_REPEATABLE_PATTERN.search(lowered)
            index = _ordinal_to_index(match.group(1))
            if index is None or index < 0:
                return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)
            return CommandResult(
                reply=f'This will remove item {index + 1} from the selected {selected_type} module. Please confirm.',
                action={
                    'type': ActionType.UPDATE_REPEATABLE_FIELD, 'module_type': selected_type,
                    'op': 'remove', 'index': index,
                },
                confidence=0.85,
            )

        # Document-level CSS commands — checked BEFORE the generic
        # insert/delete/global-style patterns below, since phrases like
        # "add custom css: ..." or "remove custom css" would otherwise be
        # misread by the module-oriented patterns (_INSERT_PATTERN,
        # _DELETE_PATTERN) that follow.
        if _RESET_CSS_PATTERN.search(lowered) and not _CUSTOM_CSS_PATTERN.search(lowered):
            if _ENABLE_WORD_PATTERN.search(lowered):
                return CommandResult(
                    reply='I will enable Email Reset CSS — the compatibility baseline for this email.',
                    action={'type': ActionType.SET_RESET_CSS_ENABLED, 'enabled': True}, confidence=0.9,
                )
            if _DISABLE_WORD_PATTERN.search(lowered):
                return CommandResult(
                    reply=(
                        'This will disable Email Reset CSS, which may reduce consistency across email '
                        'clients. Please confirm.'
                    ),
                    action={'type': ActionType.SET_RESET_CSS_ENABLED, 'enabled': False}, confidence=0.9,
                )
            return CommandResult(
                reply='Would you like me to enable or disable Email Reset CSS?',
                action={'type': ActionType.NONE}, confidence=0.3,
            )

        if _CUSTOM_CSS_PATTERN.search(lowered):
            if _CLEAR_CUSTOM_CSS_PATTERN.search(lowered):
                return CommandResult(
                    reply='This will remove your Custom CSS. Please confirm.',
                    action={'type': ActionType.CLEAR_CUSTOM_CSS}, confidence=0.9,
                )
            set_match = _SET_CUSTOM_CSS_PATTERN.search(text)
            if set_match:
                css = set_match.group(1).strip()
                if not css:
                    return CommandResult(
                        reply='Tell me the CSS to use, e.g. "set custom css to: .my-class { color: red; }".',
                        action={'type': ActionType.NONE}, confidence=0.3,
                    )
                if len(css) > MAX_CUSTOM_CSS_LENGTH:
                    return CommandResult(
                        reply=f'That is too long (maximum {MAX_CUSTOM_CSS_LENGTH} characters). Please shorten it.',
                        action={'type': ActionType.NONE}, confidence=0.3,
                    )
                security_violations = validate_custom_css_security(css)
                if security_violations:
                    return CommandResult(
                        reply=f'I cannot apply that CSS: {security_violations[0]}',
                        action={'type': ActionType.NONE}, confidence=0.3,
                    )
                return CommandResult(
                    reply='I will update your Custom CSS. Please review the proposed change.',
                    action={'type': ActionType.SET_CUSTOM_CSS, 'css': css}, confidence=0.85,
                )
            if _ENABLE_WORD_PATTERN.search(lowered):
                return CommandResult(
                    reply='I will enable Custom CSS.',
                    action={'type': ActionType.SET_CUSTOM_CSS_ENABLED, 'enabled': True}, confidence=0.9,
                )
            if _DISABLE_WORD_PATTERN.search(lowered):
                return CommandResult(
                    reply='This will disable Custom CSS (your saved CSS is kept, just not applied). Please confirm.',
                    action={'type': ActionType.SET_CUSTOM_CSS_ENABLED, 'enabled': False}, confidence=0.9,
                )
            return CommandResult(
                reply='Tell me what to set your Custom CSS to, e.g. "set custom css to: .my-class { color: red; }".',
                action={'type': ActionType.NONE}, confidence=0.3,
            )

        # Sub-phase 4, item 3 — title/subject/favicon. Checked before the
        # generic insert/delete patterns below for the same reason the CSS
        # block above is: "set the title to My Email" must never be misread
        # as a module command.
        if _EMAIL_TITLE_PATTERN.search(lowered):
            set_match = _SET_EMAIL_TITLE_PATTERN.search(text)
            value = _clean_text_value(set_match.group(1)) if set_match else None
            if value is None:
                return CommandResult(
                    reply='Tell me the new email title, e.g. "set the title to Summer Sale".',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            return CommandResult(
                reply=f'I will set the email title to "{value}".',
                action={'type': ActionType.SET_EMAIL_TITLE, 'value': value}, confidence=0.85,
            )

        if _EMAIL_SUBJECT_PATTERN.search(lowered):
            set_match = _SET_EMAIL_SUBJECT_PATTERN.search(text)
            value = _clean_text_value(set_match.group(1)) if set_match else None
            if value is None:
                return CommandResult(
                    reply='Tell me the new email subject, e.g. "set the subject to Summer Sale is here".',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            return CommandResult(
                reply=f'I will set the email subject to "{value}".',
                action={'type': ActionType.SET_EMAIL_SUBJECT, 'value': value}, confidence=0.85,
            )

        if _FAVICON_PATTERN.search(lowered):
            if _CLEAR_FAVICON_PATTERN.search(lowered):
                return CommandResult(
                    reply='This will remove the favicon. Please confirm.',
                    action={'type': ActionType.CLEAR_FAVICON}, confidence=0.9,
                )
            set_match = _SET_FAVICON_PATTERN.search(text)
            raw_value = _FAVICON_VALUE_PREFIX_PATTERN.sub('', set_match.group(1), count=1) if set_match else ''
            url = _clean_url_value(raw_value)
            if not url:
                return CommandResult(
                    reply='Tell me the favicon URL to use, e.g. "set favicon url to https://example.com/favicon.png".',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            return CommandResult(
                reply=f'I will set the favicon to {url}.',
                action={'type': ActionType.SET_FAVICON, 'url': url}, confidence=0.85,
            )

        # C-3 remediation, extended R4-B4 §1 (SET_LINK) — never guess a
        # destination link; ask for it unless the user already gave one
        # in this same message, and only ever write it through the
        # module's own manifest-allow-listed 'href' field (never a
        # second, parallel link-mutation path — same UPDATE_MODULE_PROPS
        # every other property change already goes through). Two
        # trigger phrasings share the SAME executor: the original
        # "fix ... link" (placeholder-repair framing) and the newer,
        # broader "set/change/update ... link/url" (plain SET_LINK
        # framing) — see _SET_LINK_PATTERN's own comment.
        if _PLACEHOLDER_LINK_FIX_PATTERN.search(lowered) or _SET_LINK_PATTERN.search(lowered):
            return compute_set_link_result(selected_type, text)

        # C-2 remediation — deterministic (no-LLM) weak-text-contrast fix.
        # Computes a real WCAG AA-compliant color via
        # minimal_readable_foreground() and proposes it through the same
        # UPDATE_MODULE_PROPS path every other style command uses — never
        # a second repair engine. Declines (explain-only) rather than
        # guess when the module's background isn't a plain resolvable
        # color (a background image makes the flat backgroundColor prop
        # not the true effective background) or when no smaller-than-
        # extreme adjustment can reach the threshold.
        if _WEAK_CONTRAST_FIX_PATTERN.search(lowered):
            return compute_contrast_fix_result(selected_type, selected.get('props') if isinstance(selected, dict) else None)

        # Sub-phase 6, work package D — VML fallback toggle ("enable
        # outlook vml for this button" / "add an outlook wrapper").
        if _VML_PATTERN.search(lowered):
            return compute_outlook_fallback_result(selected_type)

        # Sub-phase 6, work package D — responsive visibility ("hide this
        # on mobile" / "hide on desktop" / "show it on both").
        if _HIDE_MOBILE_PATTERN.search(lowered) or _HIDE_DESKTOP_PATTERN.search(lowered) \
                or _SHOW_ALL_VISIBILITY_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            if _SHOW_ALL_VISIBILITY_PATTERN.search(lowered):
                visibility, phrase = 'all', 'visible on both desktop and mobile'
            elif _HIDE_MOBILE_PATTERN.search(lowered):
                visibility, phrase = 'hideMobile', 'hidden on mobile'
            else:
                visibility, phrase = 'hideDesktop', 'hidden on desktop'
            return CommandResult(
                reply=f'I will make the selected {selected_type} module {phrase}.',
                action={
                    'type': ActionType.UPDATE_MODULE_SETTINGS, 'module_type': selected_type,
                    'patch': {'visibility': visibility},
                },
                confidence=0.85,
            )

        # Sub-phase 6, work package D — layout column widths ("change the
        # column widths to 70/30"). R4-B4 §1/§2/§3 — widened, capability-
        # aware: also matches the shorter "make these columns 70/30" /
        # even bare "make this 70/30" (no "column"/"width" word at all)
        # WHEN the currently selected module is itself a layout type —
        # the selection itself is the disambiguating signal here, the
        # same "capability-aware execution" posture §2 asks for
        # elsewhere (never require MORE words just because the target is
        # already unambiguous from context).
        _selected_is_layout = bool(
            selected_type and (module_capabilities.get_module_capability(selected_type) or {}).get('isLayout'),
        )
        if len(_WIDTH_NUMBERS_PATTERN.findall(lowered)) >= 2 and (
            _COLUMN_WIDTHS_PATTERN.search(lowered) or 'column' in lowered or _selected_is_layout
        ):
            return compute_column_ratio_result(selected_type, lowered)

        # R4-B4 §1/§3 — CHANGE_SPACING ("give this 20px padding" / "add
        # some space inside" / "increase internal spacing to 20"). D4-E3
        # item 7/8 / D4-E3F — the spacing-plus-props BATCH_UPDATE combiner
        # (color/align/text combined with padding when genuinely present,
        # with an explicit "partial understanding" disclosure when a
        # requested concept can't be resolved) now lives in ONE shared
        # function, compute_spacing_result_with_props_combining(), so
        # this ENGLISH-and-loanword entry point and
        # apply_canonical_intent()'s CanonicalIntent.CHANGE_SPACING
        # branch (the entry point a non-English message reaches through
        # CanonicalIntentEmailCommandProvider, checked BEFORE this
        # provider ever runs) behave identically — see that function's
        # own docstring for the real bug this consolidation fixes.
        if _SPACING_PATTERN.search(lowered):
            return compute_spacing_result_with_props_combining(selected_type, lowered, text)

        # R4-B4 §1/§2 — SET_IMAGE. Checked BEFORE the generic style-patch
        # fallback below (which has no image_asset handling at all) —
        # never guesses a source, same "ask, don't invent" posture as
        # SET_LINK.
        if _SET_IMAGE_PATTERN.search(lowered):
            return compute_set_image_result(selected_type, text)

        # Insert — checked before delete/duplicate so "add a button" never
        # collides with "remove"/"duplicate" phrasing.
        if _INSERT_PATTERN.search(lowered):
            module_types = _find_all_module_types(_insert_search_window(lowered))
            if module_types:
                modules = [{'module_type': t, 'patch': {}} for t in module_types[:MAX_GENERATED_MODULES]]
                names = ', '.join(t for t in module_types[:MAX_GENERATED_MODULES])
                reply = (
                    f'I will add a {names} module.' if len(modules) == 1
                    else f'I will add {len(modules)} modules: {names}.'
                )
                return CommandResult(
                    reply=reply, action={'type': ActionType.INSERT_MODULE, 'modules': modules}, confidence=0.9,
                )
            return CommandResult(
                reply="I can add a text, image, button, divider, or spacer — which one?",
                action={'type': ActionType.NONE}, confidence=0.3,
            )

        if _DELETE_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            return CommandResult(
                reply='This will delete the selected module. Please confirm.',
                action={'type': ActionType.DELETE_MODULE, 'target': 'selected'}, confidence=0.9,
            )

        if _DUPLICATE_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            return CommandResult(
                reply='I will duplicate the selected module.',
                action={'type': ActionType.DUPLICATE_MODULE, 'target': 'selected'}, confidence=0.9,
            )

        # Global style — "make all buttons green", "change every heading to..."
        # Still keyed off the same bounded MODULE_TYPE_ALIASES as INSERT
        # (a global sweep needs a TYPE NAME in the sentence, same as
        # insert does) — but the patch it builds is manifest-driven, so it
        # correctly reflects whatever style fields that type really has.
        if _GLOBAL_PATTERN.search(lowered):
            module_type = _find_module_type(lowered)
            if not module_type:
                return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)
            patch = _extract_style_patch(lowered, module_type, current_props=None)
            if not patch:
                return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            return CommandResult(
                reply=(
                    f'This will change {patch} on every {module_type} module in the email. Please confirm.'
                ),
                action={'type': ActionType.APPLY_GLOBAL_STYLE, 'target': 'selected', 'module_type': module_type, 'patch': patch},
                confidence=0.85,
            )

        # Everything below targets the currently selected module — now ANY
        # of the 53 registered types, not just the original 5. Only the
        # "select a module first" reply implies the command WAS otherwise
        # recognized as a property change — a command that matches no
        # pattern at all (e.g. a structural layout-conversion request this
        # router does not support) must get the generic clarify reply
        # instead, never a misleading "select something" prompt.
        selected_editable_fields = module_capabilities.get_editable_fields(selected_type) if selected_type else []
        if not selected_type or selected_type not in module_capabilities.get_all_module_types():
            if selected_type:
                return CommandResult(
                    reply=f"I don't recognize a {selected_type} module.",
                    action={'type': ActionType.NONE}, confidence=0.2,
                )
            if _has_style_keywords(lowered, text):
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)

        if not selected_editable_fields:
            # A real, known module type (e.g. any layout-* type) that
            # simply has no flat AI-editable property yet — honest, not a
            # generic "I don't understand" reply.
            return CommandResult(
                reply=f"The selected {selected_type} module doesn't have any properties I can change yet.",
                action={'type': ActionType.NONE}, confidence=0.2,
            )

        current_props = selected.get('props') if isinstance(selected.get('props'), dict) else {}
        patch = _extract_style_patch(lowered, selected_type, current_props)
        set_text_match = _SET_TEXT_PATTERN.search(text)
        text_field = next((f for f in selected_editable_fields if f['key'] == 'text' and f['valueType'] == 'text'), None)
        if set_text_match and text_field:
            patch = {**(patch or {}), 'text': set_text_match.group(1).strip()}

        if patch:
            return CommandResult(
                reply=f'I will update the selected {selected_type} module.',
                action={'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': selected_type, 'patch': patch},
                confidence=0.85,
            )

        return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)


def _has_style_keywords(lowered, text):
    """True when the message contains SOME recognized style-change
    vocabulary (color/font size/alignment/text-set), regardless of
    whether a module is currently selected — used only to decide which
    fallback reply applies (see resolve())."""
    return bool(
        _find_color(lowered) or _FONT_SIZE_PATTERN.search(lowered) or _BIGGER_PATTERN.search(lowered)
        or _SMALLER_PATTERN.search(lowered) or _ALIGN_PATTERN.search(lowered) or _SET_TEXT_PATTERN.search(text),
    )


def _extract_style_patch(lowered, module_type, current_props):
    """Same key-name-based heuristic as Feature 14 V1 — the only change is
    where `allowed` comes from: the generated capability manifest instead
    of a hand-typed 5-type dict. Because several of the registry's other
    48 types happen to use the SAME conventional field names
    (backgroundColor/textColor/align), this already extends coverage to
    them for free, with zero new vocabulary."""
    patch = {}
    allowed = {f['key'] for f in module_capabilities.get_editable_fields(module_type)}

    color = _find_color(lowered)
    if color:
        if 'background' in lowered and 'backgroundColor' in allowed:
            patch['backgroundColor'] = color
        elif 'textColor' in allowed and ('text color' in lowered or 'font color' in lowered):
            patch['textColor'] = color
        elif 'color' in allowed:
            patch['color'] = color
        elif 'backgroundColor' in allowed:
            patch['backgroundColor'] = color

    if 'fontSize' in allowed:
        size_match = _FONT_SIZE_PATTERN.search(lowered)
        if size_match:
            patch['fontSize'] = int(size_match.group(1))
        elif _BIGGER_PATTERN.search(lowered):
            base = (current_props or {}).get('fontSize') or 16
            patch['fontSize'] = base + 4
        elif _SMALLER_PATTERN.search(lowered):
            base = (current_props or {}).get('fontSize') or 16
            patch['fontSize'] = base - 4

    if 'align' in allowed and _ALIGN_PATTERN.search(lowered):
        from .intent_normalization import detect_language, find_alignment_value

        # D4-E3F — was hardcoded to language='en', which actually BLOCKED
        # find_alignment_value's own "always also check English words"
        # fallback (only fires when language != 'en') — meaning this call
        # site could never recognize a non-English alignment word, even
        # though the function it calls supports exactly that. Mirrors
        # apply_canonical_intent()'s own CHANGE_ALIGNMENT branch, which
        # already detects language correctly for its OWN supplemental check.
        alignment_value = find_alignment_value(lowered, detect_language(lowered))
        if alignment_value:
            patch['align'] = alignment_value

    return patch or None


# D4-E3 item 7/8 — the color/alignment-only subset of _extract_style_patch(),
# for the ONE call site (the spacing-plus-props BATCH_UPDATE combiner
# above) that must never pick up the fontSize heuristic's ambiguous bare
# "bigger"/"increase"/"smaller"/"decrease" match, which collides with
# spacing vocabulary ("increase the padding"). Deliberately duplicates
# only the color+align branches (never the fontSize one) — not a second,
# competing patch-extraction system, just a narrower slice of the SAME one.
def _extract_unambiguous_props_patch(lowered, module_type):
    patch = {}
    allowed = {f['key'] for f in module_capabilities.get_editable_fields(module_type)}

    color = _find_color(lowered)
    if color:
        if 'background' in lowered and 'backgroundColor' in allowed:
            patch['backgroundColor'] = color
        elif 'textColor' in allowed and ('text color' in lowered or 'font color' in lowered):
            patch['textColor'] = color
        elif 'color' in allowed:
            patch['color'] = color
        elif 'backgroundColor' in allowed:
            patch['backgroundColor'] = color

    if 'align' in allowed:
        from .intent_normalization import detect_language, find_alignment_value

        # D4-E3F — unlike _extract_style_patch's own alignment branch
        # above, this function deliberately does NOT gate on the
        # English-only _ALIGN_PATTERN first: this is the narrow,
        # single-purpose combiner for the spacing-plus-props BATCH_UPDATE
        # path (see this function's own docstring), and a message like
        # German "zentriere es" has no English "align"/"center" substring
        # for _ALIGN_PATTERN to find at all — find_alignment_value already
        # safely returns None when nothing matches, so calling it
        # unconditionally costs nothing and only adds coverage. Was also
        # hardcoded to language='en' — same bug, same fix, as the
        # instance above.
        alignment_value = find_alignment_value(lowered, detect_language(lowered))
        if alignment_value:
            patch['align'] = alignment_value

    return patch or None


# D4-E3F — "partial understanding must never be silent." Reuses
# _requested_concepts()/_MESSAGE_CONCEPT_KEYWORDS — the SAME concept
# detector the scope gate already relies on — as the "did the message
# ALSO ask about X" signal; never a second, competing concept system.
# Bounded to the two concepts _extract_unambiguous_props_patch itself
# can ever resolve (color, alignment) — a concept neither this app nor
# that function has a resolver for is never flagged as "unresolved"
# here, since this only reports on what its caller actually attempted.
def _describe_unresolved_concepts(message, resolved_concepts):
    requested = _requested_concepts(message)
    return sorted(c for c in ('color', 'align') if c in requested and c not in resolved_concepts)


_UNRESOLVED_CONCEPT_LABELS = {'color': 'color', 'align': 'alignment'}


def _build_partial_understanding_reply(selected_type, understood, unresolved_concepts):
    """Builds the explicit disclosure this checkpoint requires whenever a
    compound request has SOME concepts resolved and others not — the
    caller must never silently apply only the resolved half (see this
    function's own call site's comment). `understood` is a list of
    (label, value) tuples already successfully resolved; `unresolved_concepts`
    comes from _describe_unresolved_concepts()."""
    lines = ['Understood:']
    for label, value in understood:
        lines.append(f' • {label} -> {value}')
    lines.append("I couldn't confidently resolve:")
    for concept in unresolved_concepts:
        label = _UNRESOLVED_CONCEPT_LABELS.get(concept, concept)
        lines.append(f' • {selected_type or "module"} {label}' if selected_type else f' • {label}')
    lines.append('Please tell me the specific value(s) you want (e.g. a recognized color name), and I will include them.')
    return '\n'.join(lines)


# D4-E3F — the spacing-plus-props BATCH_UPDATE combiner (D4-E3 item 7/8,
# hardened by this checkpoint's "partial understanding must never be
# silent" rule), extracted into ONE shared function so it is reachable
# from BOTH entry points a spacing request can arrive through:
#   1. RuleBasedEmailCommandProvider.resolve()'s own _SPACING_PATTERN
#      branch (the ENGLISH-and-loanword path, checked for every message).
#   2. apply_canonical_intent()'s CanonicalIntent.CHANGE_SPACING branch
#      (the path a genuinely non-English message reaches THROUGH
#      CanonicalIntentEmailCommandProvider, which — critically — is
#      checked and can short-circuit BEFORE RuleBasedEmailCommandProvider
#      ever runs; see get_default_email_command_provider()'s own
#      docstring). A REAL bug this checkpoint's own live QA caught: before
#      this extraction, a German message matching a CHANGE_SPACING phrase
#      (e.g. "Mach den Button grün und erhöhe den Abstand auf 20px.")
#      was intercepted by CanonicalIntentEmailCommandProvider and handed
#      straight to the OLD, non-combining compute_spacing_result() —
#      silently dropping the co-occurring color request, exactly the
#      "silent partial understanding" failure mode this checkpoint exists
#      to close, just reached through a code path the original D4-E3
#      item 7/8 combiner never accounted for. Never a second, duplicated
#      combining implementation — both call sites now call this ONE
#      function, so the fix applies uniformly regardless of which
#      provider layer a given message happens to route through first.
def compute_spacing_result_with_props_combining(selected_type, lowered, text):
    spacing_result = compute_spacing_result(selected_type, lowered)
    if not selected_type or spacing_result.action.get('type') != ActionType.UPDATE_MODULE_SETTINGS:
        return spacing_result

    # D4-E3 item 7/8 — deliberately NOT the full _extract_style_patch()
    # here: its fontSize heuristic matches bare "bigger"/"increase"/
    # "smaller"/"decrease" with no font-specific qualifier, which would
    # misfire on "increase the padding to 20px" (a SPACING instruction,
    # not a font-size one) and silently bundle in an unrequested size
    # change. Only color/alignment are unambiguous enough to safely
    # combine with a spacing request this way.
    props_patch = _extract_unambiguous_props_patch(lowered, selected_type)
    set_text_match = _SET_TEXT_PATTERN.search(text)
    if set_text_match:
        text_field = next(
            (f for f in module_capabilities.get_editable_fields(selected_type)
             if f['key'] == 'text' and f['valueType'] == 'text'),
            None,
        )
        if text_field:
            props_patch = {**(props_patch or {}), 'text': set_text_match.group(1).strip()}

    # D4-E3F — "partial understanding must never be silent." If the
    # message ALSO seems to request color/alignment (via
    # _requested_concepts — the SAME concept detector the scope gate
    # already relies on) but no value for it could be resolved, this
    # must NEVER silently fall through to a spacing-only (or partially-
    # resolved) proposal — the user asked for two things; applying only
    # one without saying so is exactly the failure mode this checkpoint
    # exists to close. Uses the EXISTING clarification contract (action
    # NONE, an explanatory reply) rather than a new UI.
    resolved_concepts = set()
    if props_patch:
        if any(key in props_patch for key in ('backgroundColor', 'color', 'textColor')):
            resolved_concepts.add('color')
        if 'align' in props_patch:
            resolved_concepts.add('align')
    unresolved_concepts = _describe_unresolved_concepts(text, resolved_concepts)
    if unresolved_concepts:
        padding_px = spacing_result.action['patch']['desktop']['paddingTop']
        padding_label = int(padding_px) if padding_px == int(padding_px) else padding_px
        understood = [('Padding', f'{padding_label}px on all sides')]
        if props_patch:
            if 'text' in props_patch:
                understood.append(('Text', repr(props_patch['text'])))
            for key in ('backgroundColor', 'color', 'textColor'):
                if key in props_patch:
                    understood.append((key, props_patch[key]))
            if 'align' in props_patch:
                understood.append(('Alignment', props_patch['align']))
        return CommandResult(
            reply=_build_partial_understanding_reply(selected_type, understood, unresolved_concepts),
            action={'type': ActionType.NONE}, confidence=0.4,
        )

    if props_patch:
        return CommandResult(
            reply=f'I will update the selected {selected_type} module and adjust its padding. Please confirm.',
            action={
                'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': selected_type,
                'props_patch': props_patch, 'settings_patch': spacing_result.action['patch'],
            },
            confidence=0.85,
        )

    return spacing_result


# D4-E2 item 1 — Intelligence Router. The distinction this function draws
# is the load-bearing one: a message the deterministic chain confidently
# ACTED on, DECLINED with real/specific information, or ANSWERED from the
# knowledge base must never be silently retried through an LLM — only a
# genuine "nothing in my vocabulary applies" outcome should reach the LLM
# tier at all. _CLARIFY_REPLY and _EXPLAIN_CLARIFY_REPLY are, BY
# CONSTRUCTION, the only two reply strings this file ever returns for
# exactly that "I don't know how to help with this" case (every other
# NONE-action branch returns a SPECIFIC, situation-naming reply — "select
# a module first", "that padding value is out of range", "I don't
# recognize a {type} module", the real knowledge-base answer, etc. — see
# this file's own dozens of CommandResult(...) call sites). Checking
# reply identity against these two constants is therefore a precise,
# zero-duplication way to ask "did the deterministic chain genuinely have
# nothing to say" without re-implementing or re-running any of its regex
# matching a second time.
def _is_no_match_result(result):
    return result.action.get('type') == ActionType.NONE and result.reply in (_CLARIFY_REPLY, _EXPLAIN_CLARIFY_REPLY)


# D4-E2 item 5 — semantic consistency safety net for the residual
# LLM-routed path. Bounded to the SAME deterministically-checkable value
# kinds item 4 already resolves (color, alignment, spacing/padding,
# explicitly-quoted text, explicit URLs) — never universal semantic
# validation. Runs AFTER validate_action()/apply_scope_gate() have
# already produced a safe, schema-valid action; only ever OVERRIDES a
# value the model itself already proposed for a field it already touched
# — never adds a new field, never touches validate_action() itself.
_QUOTED_TEXT_RE = re.compile(r'["“”‘’\'](.{1,200}?)["“”‘’\']')
_EXPLICIT_URL_RE = re.compile(r'\bhttps?://\S+\b', re.IGNORECASE)


def _correct_props_patch(message, module_type, patch):
    """Returns (possibly-corrected patch dict, corrections list) — the
    UPDATE_MODULE_PROPS-shaped half of the semantic consistency gate,
    factored out so BATCH_UPDATE's props_patch can reuse it unchanged
    (see apply_semantic_consistency_gate's own docstring)."""
    if not isinstance(patch, dict) or not patch:
        return patch, []
    corrections = []
    new_patch = dict(patch)
    for key, value in patch.items():
        field = module_capabilities.get_editable_field(module_type, key) if module_type else None
        value_type = field.get('valueType') if field else None
        if value_type == 'color':
            requested = _find_color((message or '').lower())
            if requested and requested != value:
                new_patch[key] = requested
                corrections.append(f'{key}: {value!r} -> {requested!r} (message named an explicit color)')
        elif value_type == 'align':
            from .intent_normalization import find_alignment_value

            requested = find_alignment_value((message or '').lower(), 'en')
            if requested and requested != value:
                new_patch[key] = requested
                corrections.append(f'{key}: {value!r} -> {requested!r} (message named an explicit alignment)')
        elif value_type == 'text':
            quoted = _QUOTED_TEXT_RE.search(message or '')
            if quoted:
                requested = _clean_text_value(quoted.group(1))
                if requested and requested != value:
                    new_patch[key] = requested
                    corrections.append(f'{key}: {value!r} -> {requested!r} (message quoted an explicit text value)')
        elif value_type == 'url':
            explicit = _EXPLICIT_URL_RE.search(message or '')
            if explicit:
                requested = _clean_url_value(explicit.group(0))
                if requested and requested != value:
                    new_patch[key] = requested
                    corrections.append(f'{key}: {value!r} -> {requested!r} (message contained an explicit URL)')
    return (new_patch if corrections else patch), corrections


def _correct_settings_patch(message, patch):
    """Returns (possibly-corrected patch dict, corrections list) — the
    UPDATE_MODULE_SETTINGS-shaped half, factored out for the same reason
    as _correct_props_patch above."""
    if not isinstance(patch, dict) or not isinstance(patch.get('desktop'), dict):
        return patch, []
    desktop = patch['desktop']
    padding_keys = [k for k in desktop if k.startswith('padding')]
    if padding_keys and _SPACING_PATTERN.search((message or '').lower()):
        numbers = _SPACING_NUMBER_PATTERN.findall((message or '').lower())
        if numbers:
            requested_px = float(numbers[0])
            new_desktop = dict(desktop)
            changed = False
            for key in padding_keys:
                if desktop[key] != requested_px:
                    new_desktop[key] = requested_px
                    changed = True
            if changed:
                return {**patch, 'desktop': new_desktop}, [f'desktop padding -> {requested_px}px (message named an explicit value)']
    return patch, []


def apply_semantic_consistency_gate(message, action, target_segments=None):
    """Returns (possibly-corrected `action`, list of correction descriptions).

    `target_segments` (D4-E3G, optional): same {target_module_id: segment}
    map apply_scope_gate() accepts — see its docstring. Corrections for a
    MULTI_MODULE_UPDATE operation are derived from ONLY that operation's
    own segment when available, never the whole message: an explicit
    "20px" named for the footer's spacing must never get silently applied
    to the hero operation's settings_patch just because both operations
    happen to share one outer message."""
    if not isinstance(action, dict):
        return action, []
    action_type = action.get('type')

    if action_type in (ActionType.UPDATE_MODULE_PROPS, ActionType.APPLY_GLOBAL_STYLE, ActionType.REPLACE_UNSUPPORTED_PROPERTY):
        new_patch, corrections = _correct_props_patch(message, action.get('module_type'), action.get('patch'))
        if corrections:
            return {**action, 'patch': new_patch}, corrections
        return action, []

    if action_type == ActionType.UPDATE_MODULE_SETTINGS:
        new_patch, corrections = _correct_settings_patch(message, action.get('patch'))
        if corrections:
            return {**action, 'patch': new_patch}, corrections
        return action, []

    # D4-E3 item 7/8 — BATCH_UPDATE carries BOTH shapes at once; each half
    # is corrected through the EXACT SAME two helpers above, independently
    # (never a third, parallel correction path).
    if action_type == ActionType.BATCH_UPDATE:
        new_props, props_corrections = _correct_props_patch(message, action.get('module_type'), action.get('props_patch'))
        new_settings, settings_corrections = _correct_settings_patch(message, action.get('settings_patch'))
        corrections = props_corrections + settings_corrections
        if corrections:
            return {**action, 'props_patch': new_props, 'settings_patch': new_settings}, corrections
        return action, []

    # D4-E3G — MULTI_MODULE_UPDATE. Each operation is corrected against
    # its OWN message segment (falling back to the whole message only
    # when no segment is available for that target), independently —
    # never a third, parallel correction path, and never one operation's
    # correction bleeding into another's.
    if action_type == ActionType.MULTI_MODULE_UPDATE:
        operations = action.get('operations')
        if not isinstance(operations, list) or not operations:
            return action, []
        new_operations = []
        all_corrections = []
        for operation in operations:
            if not isinstance(operation, dict):
                new_operations.append(operation)
                continue
            segment = (target_segments or {}).get(operation.get('target_module_id')) or message
            new_props, props_corrections = _correct_props_patch(segment, operation.get('module_type'), operation.get('props_patch'))
            new_settings, settings_corrections = _correct_settings_patch(segment, operation.get('settings_patch'))
            op_corrections = props_corrections + settings_corrections
            all_corrections.extend(op_corrections)
            new_operations.append(
                {**operation, 'props_patch': new_props, 'settings_patch': new_settings} if op_corrections else operation
            )
        if all_corrections:
            return {**action, 'operations': new_operations}, all_corrections
        return action, []

    return action, []


def get_default_email_command_provider():
    """3-way provider selection (Phase A): deterministic | local | openai.

      - EMAILBUILDER_AI_COMMAND_PROVIDER == 'openai' AND OPENAI_API_KEY set
        -> deterministic-first, OpenAI only on genuine NO_MATCH.
      - EMAILBUILDER_AI_COMMAND_PROVIDER == 'local' AND
        EMAILBUILDER_LOCAL_AI_BASE_URL set -> deterministic-first, the
        local OpenAI-compatible endpoint (Ollama/llama.cpp/LM Studio/etc.)
        only on genuine NO_MATCH.
      - Anything else (unset, misconfigured, or explicitly
        'deterministic') -> the deterministic router alone. No API key or
        local server is ever required for normal operation.

    D4-E2 item 1 — Intelligence Router: the deterministic chain
    (CanonicalIntentEmailCommandProvider wrapping RuleBasedEmailCommandProvider
    — UNCHANGED, not duplicated) now gets the FIRST bounded attempt at
    every message, for every provider mode; an optional LLM tier is
    consulted ONLY when that chain returns a genuine NO_MATCH (see
    _is_no_match_result and DeterministicFirstEmailCommandProvider's own
    docstring for the precise, load-bearing distinction from a
    deterministic DECLINE or EXPLANATION, which must never be silently
    retried through an LLM). This still keeps "deterministic is the
    baseline, AI is optional" true in the strongest possible sense: with
    neither provider configured, behavior is identical to before this
    checkpoint."""
    from django.conf import settings

    deterministic = CanonicalIntentEmailCommandProvider(fallback=RuleBasedEmailCommandProvider())

    if settings.EMAILBUILDER_AI_COMMAND_PROVIDER == 'openai' and settings.OPENAI_API_KEY:
        from .ai_command_openai import OpenAIEmailCommandProvider

        return DeterministicFirstEmailCommandProvider(llm=OpenAIEmailCommandProvider(), deterministic=deterministic)

    if settings.EMAILBUILDER_AI_COMMAND_PROVIDER == 'local' and settings.EMAILBUILDER_LOCAL_AI_BASE_URL:
        from .ai_command_local import LocalEmailCommandProvider

        return DeterministicFirstEmailCommandProvider(llm=LocalEmailCommandProvider(), deterministic=deterministic)

    return deterministic


# D4-E3G hardening — deterministic cross-module planner. Built because the
# first D4-E3G pass routed EVERY 2+-target message to the local LLM tier
# unconditionally, even for messages this app already knows how to resolve
# deterministically for a single module ("make this button green", "center
# this", "increase the padding to 20px") — the architecture's own
# "deterministic first, LLM only for genuinely unresolved reasoning" rule
# was being violated the moment a message named more than one module.
#
# Reuses, never duplicates: _extract_unambiguous_props_patch (color/align,
# capability-gated per module_type), _find_color/find_alignment_value (the
# same multilingual value tables color/align resolution already uses),
# compute_spacing_result (the SAME absolute-value spacing resolver
# BATCH_UPDATE's own combiner uses — needs no current-state data at all,
# since it sets an explicit value, never a delta), the fontSize
# bigger/smaller heuristic _extract_style_patch already applies (only for
# a target whose module_type actually has a fontSize field — hero/footer
# module types do not, so "make the hero heading smaller" is correctly
# UNSUPPORTED here, not silently ignored — see _resolve_deterministic_
# operation_for_target's own docstring), _requested_concepts (the SAME
# concept detector the scope gate uses, for "what did THIS target's own
# segment actually ask for" bookkeeping), and validate_action() (every
# assembled operation still passes through the SAME schema gate every
# other action type uses).
#
# `apply_scope_gate()`/`apply_semantic_consistency_gate()` are deliberately
# NOT run on the result — the same posture RuleBasedEmailCommandProvider's
# own BATCH_UPDATE combiner already takes (see that combiner's own
# comment): a patch built FROM the message's own per-target segment, using
# only fields that segment's own concept keywords named, can never contain
# scope creep by construction — there is no second, untrusted source (an
# LLM) whose output needs re-checking here.
_SAME_TRIGGER_RE = re.compile(
    r'\b(?:do\s+)?the\s+same\b|\bsame\s+(?:thing\s+)?(?:to|for|with)\b|\bsame\s+as\s+(?:the\s+)?first\b'
    r'|\brepeat\s+(?:that|this|it)\b|\blikewise\b',
    re.IGNORECASE,
)


def _resolve_deterministic_operation_for_target(segment, module_type, current_props):
    """Returns (props_patch: dict|None, settings_patch: dict|None,
    resolved_concepts: set[str], understood: list[(label, value)]) for ONE
    resolved target's own matched-phrase segment. Never looks at any other
    target's segment, and never receives more of `current_props` than that
    ONE module's own already-editable fields (the exact same shape
    selected_module.props already carries for the single-module path —
    used here ONLY for the fontSize bigger/smaller relative heuristic,
    mirroring _extract_style_patch's own use of it)."""
    lowered = (segment or '').lower()
    allowed = {f['key'] for f in module_capabilities.get_editable_fields(module_type)}
    resolved_concepts = set()
    understood = []

    props_patch = dict(_extract_unambiguous_props_patch(lowered, module_type) or {})
    if any(key in props_patch for key in ('backgroundColor', 'color', 'textColor')):
        resolved_concepts.add('color')
        for key in ('backgroundColor', 'color', 'textColor'):
            if key in props_patch:
                understood.append((key, props_patch[key]))
    if 'align' in props_patch:
        resolved_concepts.add('align')
        understood.append(('align', props_patch['align']))

    # fontSize — capability-gated (hero/footer types have no fontSize field
    # at all, so a "smaller"/"bigger" request against one of them correctly
    # never resolves here; it surfaces as an unsupported concept instead of
    # being silently ignored — see build_deterministic_multi_module_plan).
    # The bigger/smaller RELATIVE heuristic is skipped when this SAME
    # segment also matches _SPACING_PATTERN — "increase the padding" must
    # never be misread as a font-size request just because "increase" is
    # also _BIGGER_PATTERN's own trigger word (the exact collision
    # _extract_unambiguous_props_patch's own docstring documents for the
    # single-module combiner; the explicit-number case below has no such
    # ambiguity and is never skipped).
    if 'fontSize' in allowed:
        size_match = _FONT_SIZE_PATTERN.search(lowered)
        if size_match:
            props_patch['fontSize'] = int(size_match.group(1))
            resolved_concepts.add('size')
            understood.append(('fontSize', f'{props_patch["fontSize"]}px'))
        elif not _SPACING_PATTERN.search(lowered):
            if _BIGGER_PATTERN.search(lowered):
                base = (current_props or {}).get('fontSize') or 16
                props_patch['fontSize'] = base + 4
                resolved_concepts.add('size')
                understood.append(('fontSize', f'{props_patch["fontSize"]}px'))
            elif _SMALLER_PATTERN.search(lowered):
                base = (current_props or {}).get('fontSize') or 16
                props_patch['fontSize'] = max(1, base - 4)
                resolved_concepts.add('size')
                understood.append(('fontSize', f'{props_patch["fontSize"]}px'))

    settings_patch = None
    if _SPACING_PATTERN.search(lowered):
        spacing_result = compute_spacing_result(module_type, lowered)
        if spacing_result.action.get('type') == ActionType.UPDATE_MODULE_SETTINGS:
            settings_patch = spacing_result.action['patch']
            resolved_concepts.add('spacing')
            px = settings_patch['desktop']['paddingTop']
            px_label = int(px) if px == int(px) else px
            understood.append(('padding', f'{px_label}px'))

    return (props_patch or None), settings_patch, resolved_concepts, understood


def build_deterministic_multi_module_plan(message, resolved_targets):
    """D4-E3G hardening — the deterministic MULTI_MODULE_UPDATE builder.
    `resolved_targets` is the SAME bounded, already-vouched-for list
    apply_scope_gate()'s target_segments already consume (id/type/label/
    matched_phrase, plus D4-E3G-hardening's new optional `props` — that
    ONE target's own current editable props, never any other module's).

    Returns None when NOT EVEN ONE target's own segment contains a single
    classifiable concept (_requested_concepts) — genuinely nothing here a
    deterministic keyword/value resolver could ever act on (e.g. "make it
    match the other CTA" — "match" names no concept at all), so the
    caller should consult the LLM tier. Otherwise ALWAYS returns a dict
    (never partially-silent): a target with a requested-but-unresolvable
    concept is recorded, never dropped — see `fully_understood` below.

    Returns {
      'operations': [validated MULTI_MODULE_UPDATE operation dicts],
      'per_target': [{
          target_module_id, module_type, label, matched_phrase,
          requested_concepts: sorted list, resolved_concepts: sorted list,
          unresolved_concepts: sorted list, understood: [(label, value)],
      } for each target that had at least one requested OR propagated concept],
      'fully_understood': bool,  # False -> caller must clarify, never Apply
    }

    "Do the same to the second CTA" (§4): a target whose OWN segment
    matches _SAME_TRIGGER_RE and requests no concept of its own inherits
    the PRECEDING target's own resolved (concept, value) pairs ONLY — not
    its whole props object, and not any concept that target itself did not
    resolve (e.g. if the first CTA got a padding change too, "do the same"
    still only copies concepts, tracked per-key, never a blind clone).

    D4-E3J §3/§4 — the minimum was relaxed from 2 to 1: a genuine 2+-target
    compound request can legitimately collapse to exactly one remaining
    target once module-level exclusions are subtracted (e.g. "make both
    CTAs green except the footer one" against a document with only two
    CTAs total). The frontend itself still never sets context
    ['resolved_targets'] for an ordinary single-target message (see
    AIEngineerPanel.tsx's own `distinctTargetIds.size >= 2` gate) — the
    ONLY way this function is ever called with exactly one entry is via
    CanonicalIntentEmailCommandProvider's own post-exclusion filtering
    below, never from an unmodified frontend request."""
    if not isinstance(resolved_targets, list) or len(resolved_targets) < 1:
        return None

    per_target = []
    operations = []
    any_concept_found = False
    all_understood = True
    previous_resolved = None  # (module_type, props_patch, settings_patch, understood) of the last target with a real resolution

    for entry in resolved_targets:
        if not isinstance(entry, dict):
            continue
        target_id = entry.get('id')
        module_type = entry.get('type')
        label = entry.get('label') or module_type or 'this module'
        matched_phrase = entry.get('matched_phrase') or message
        current_props = entry.get('props') if isinstance(entry.get('props'), dict) else {}
        if not isinstance(target_id, str) or not target_id or module_type not in module_capabilities.get_all_module_types():
            continue

        lowered_segment = (matched_phrase or '').lower()

        # D4-E3G hardening — a real false-positive found during live QA:
        # "Explain the Outlook SPACING issue in these sections" mentions
        # "spacing" only as the NOUN naming what is being diagnosed, never
        # as an instruction to change it — without this guard, the
        # planner would silently propose an unrequested default-16px
        # padding mutation for a purely diagnostic question. Reuses the
        # EXACT SAME explain-vs-mutation distinction RuleBasedEmailCommandProvider.resolve()
        # already applies for the single-target case (D4-E3 item 6):
        # _EXPLAIN_PATTERN alone means "this segment is a question, skip
        # concept resolution for it entirely" — UNLESS _has_compound_action_hint
        # also matches ("...and fix it"), in which case the segment
        # genuinely combines a question with a real mutation request and
        # concept resolution proceeds normally. A target skipped here
        # contributes nothing to `any_concept_found` on its own (same as
        # any other target with zero classifiable concepts) — it is never
        # recorded as "unresolved" either, since nothing was actually
        # asked of it as a mutation.
        from .intent_normalization import detect_language

        segment_language = detect_language(lowered_segment)
        if _EXPLAIN_PATTERN.search(lowered_segment) and not _has_compound_action_hint(matched_phrase, lowered_segment, segment_language):
            continue

        requested_concepts = _requested_concepts(matched_phrase)
        # D4-E3G hardening — a real false-positive found during audit:
        # "center THE FOOTER TEXT" mentions the word "text" only as a
        # NOUN naming what is being aligned, never as a request to change
        # the text CONTENT — but _requested_concepts()'s 'text' keyword
        # list (bare 'text'/'headline'/'caption'/'title', shared with the
        # scope gate) matches it anyway. Scoped to THIS planner only
        # (never touching the shared _requested_concepts() other callers
        # already rely on, to avoid any regression risk to the already-
        # verified scope-gate behavior elsewhere): 'text' is only treated
        # as genuinely requested here when the segment also carries a
        # real content-change signal (an explicit quoted replacement, or
        # the "set/change the text to ..." pattern) — this planner has no
        # deterministic resolver for arbitrary text content anyway (too
        # much room for silently mangling exact wording), so a genuine
        # text-content request still correctly surfaces as unresolved,
        # just never a false one from an innocent noun reference.
        if 'text' in requested_concepts and not (_SET_TEXT_PATTERN.search(matched_phrase or '') or _QUOTED_TEXT_RE.search(matched_phrase or '')):
            requested_concepts = requested_concepts - {'text'}
        props_patch, settings_patch, resolved_concepts, understood = _resolve_deterministic_operation_for_target(
            matched_phrase, module_type, current_props,
        )

        propagated = False
        if not requested_concepts and _SAME_TRIGGER_RE.search(lowered_segment):
            if previous_resolved is None:
                # "Do the same" with NOTHING real preceding it in this
                # plan to copy from — an explicit, user-authored request
                # for this target with genuinely nothing to resolve it
                # against. Must surface as unresolved, never silently
                # produce zero operations for a target the user named.
                requested_concepts = {'same-as-reference'}
            else:
                prev_type, prev_props_patch, prev_settings_patch, prev_understood = previous_resolved
                # Only ever copies fields the PREVIOUS target's own
                # resolution actually produced, and only into fields THIS
                # target's own capability manifest also allows — a "same"
                # propagated onto a module type that cannot represent
                # that field is itself an unresolved concept for this
                # target (see below), never a silently-invented field.
                allowed = {f['key'] for f in module_capabilities.get_editable_fields(module_type)}
                copied_props = {k: v for k, v in (prev_props_patch or {}).items() if k in allowed}
                if copied_props:
                    props_patch = {**(props_patch or {}), **copied_props}
                    for key, value in copied_props.items():
                        concept = _concept_for_field_key(key) or 'style'
                        resolved_concepts.add(concept)
                        understood.append((f'{key} (same as previous)', value))
                if prev_settings_patch and settings_patch is None:
                    settings_patch = prev_settings_patch
                    resolved_concepts.add('spacing')
                    understood.append(('padding (same as previous)', 'matched previous target'))
                if not copied_props and not (prev_settings_patch and settings_patch):
                    requested_concepts = {'same-as-reference'}  # nothing on the source side to copy — genuinely unresolved
                else:
                    propagated = True

        unresolved_concepts = (requested_concepts - resolved_concepts) if not propagated else set()
        # A propagated "same" that copied something real is fully resolved
        # even though its OWN segment named no concept keyword — tracked
        # via `propagated`, never inferred from an empty requested set.
        if propagated:
            requested_concepts = set(resolved_concepts)

        if not requested_concepts:
            # This target's own segment named nothing this planner
            # classifies at all (and was not a resolvable "same" either) —
            # not itself a failure signal for THIS target (it may just be
            # continuing the previous target's phrase, e.g. "and increase
            # the padding to 20px" describing the SAME already-recorded
            # target again within one matched_phrase) — only contributes
            # to the overall "was anything classifiable found anywhere"
            # check below.
            continue

        any_concept_found = True
        if unresolved_concepts:
            all_understood = False

        per_target.append({
            'target_module_id': target_id, 'module_type': module_type, 'label': label,
            'matched_phrase': matched_phrase,
            'requested_concepts': sorted(requested_concepts), 'resolved_concepts': sorted(resolved_concepts),
            'unresolved_concepts': sorted(unresolved_concepts), 'understood': understood,
        })

        if resolved_concepts and (props_patch or settings_patch):
            validated_props = _validate_patch(module_type, props_patch) if props_patch else None
            validated_settings = _validate_settings_patch(settings_patch) if settings_patch else None
            if validated_props or validated_settings:
                operations.append({
                    'target_module_id': target_id, 'module_type': module_type,
                    'props_patch': validated_props, 'settings_patch': validated_settings,
                })
                previous_resolved = (module_type, validated_props, validated_settings, understood)

    if not any_concept_found:
        return None

    return {'operations': operations, 'per_target': per_target, 'fully_understood': all_understood and bool(operations)}


def _describe_target_change(target):
    parts = [f'{key} -> {value}' for key, value in target['understood']]
    return f"{target['label']}: {', '.join(parts)}" if parts else f"{target['label']}: no change"


def _command_result_from_multi_module_plan(plan, excluded_labels=None):
    """Builds the CommandResult for a deterministic multi-module plan.
    NEVER returns a real MULTI_MODULE_UPDATE action unless
    `fully_understood` is True — a target with a requested-but-unresolved
    concept forces a clarification (action NONE) instead, per D4-E3G
    hardening §5/§6: partial understanding must never masquerade as a
    complete, Apply-ready proposal.

    D4-E3J §11 — `excluded_labels` (optional, plain display strings from
    _excluded_labels_from_context) names modules this plan deliberately
    left out, so the proposal text states the preservation explicitly
    ("I'll leave the footer CTA unchanged.") rather than silently omitting
    it — Phase 11's own "never say an excluded target will be changed,
    and never say nothing about it either" requirement.

    Deliberately does NOT call local_ai_diagnostics.record_cross_module_plan()
    itself — views.py already does that exactly once, for EVERY provider
    (deterministic or LLM), right after validate_action() re-validates the
    final action; recording it here too would double-count every
    deterministic plan (this function's own CommandResult always reaches
    that same views.py code path). The one diagnostic genuinely unique to
    THIS function — user_requested_unsupported_operations, which has no
    equivalent anywhere else — is still recorded directly below."""
    if plan['fully_understood']:
        operations = plan['operations']
        # D4-E3J — the exclusion-collapse case (§3/§4) makes a genuine
        # single-operation plan reachable here for the first time; this
        # singular/plural split was unreachable before (the frontend never
        # sends resolved_targets with fewer than 2 entries on its own).
        module_word = 'module' if len(operations) == 1 else 'modules'
        lines = [f"I'll update {len(operations)} {module_word}:"]
        lines.extend(f'- {_describe_target_change(t)}' for t in plan['per_target'])
        if excluded_labels:
            lines.append(f"I'll leave {', '.join(excluded_labels)} unchanged.")
        lines.append('Review and Apply, or Cancel to change nothing.')
        return CommandResult(
            reply='\n'.join(lines), action={'type': ActionType.MULTI_MODULE_UPDATE, 'operations': operations},
            confidence=0.85,
        )

    lines = ["I understood part of this, but not all of it — nothing will change until you confirm:"]
    unsupported_count = 0
    for t in plan['per_target']:
        if t['understood']:
            lines.append(f"- {_describe_target_change(t)}")
        if t['unresolved_concepts']:
            unsupported_count += len(t['unresolved_concepts'])
            concepts = ', '.join(t['unresolved_concepts'])
            lines.append(f"- {t['label']}: I can't change its {concepts} — this module type does not support that.")
    lines.append('Tell me how to handle the unsupported part(s), or ask me to apply just what I understood.')
    from . import local_ai_diagnostics

    local_ai_diagnostics.record_user_requested_unsupported_operations(unsupported_count)
    return CommandResult(reply='\n'.join(lines), action={'type': ActionType.NONE}, confidence=0.4)


class CanonicalIntentEmailCommandProvider(EmailCommandProvider):
    """R4-B3 §A — wraps `fallback` (always RuleBasedEmailCommandProvider
    in practice) with ONE extra check: for a non-English message that
    matches a canonical intent this app can execute directly today (see
    intent_normalization.EXECUTABLE_INTENTS), execute it via
    apply_canonical_intent() instead of ever reaching `fallback`'s
    English-only regex matching (which would simply never match non-
    English text and fall through to its own generic reply). An English
    message, or a non-English message with no executable canonical-
    intent match, always reaches `fallback` completely unchanged — this
    class changes behavior ONLY for the specific non-English + executable
    -intent case.

    R4-B4 Closure §A — after apply_canonical_intent() has ALREADY built
    the final `action` (English-language `reply` included), this wrapper
    makes ONE best-effort attempt to REPHRASE just the reply text into
    the detected language via localize_reply() — a separate, later,
    read-only step that is structurally incapable of touching `action`
    (see localize_reply()'s own docstring: it takes a string, returns a
    string or None, nothing else). Only ever attempted when a local
    endpoint is actually configured (EMAILBUILDER_LOCAL_AI_BASE_URL) —
    never OpenAI, regardless of what EMAILBUILDER_AI_COMMAND_PROVIDER is
    set to (§F: "no OpenAI call when Local AI is selected"). On any
    failure (server down, timeout, malformed response), the ORIGINAL
    English CommandResult is returned unchanged — never blocks, never
    raises, the action still applies exactly as it would have."""

    def __init__(self, fallback, localization_client_factory=None):
        self.fallback = fallback
        self._localization_client_factory = localization_client_factory

    def resolve(self, message, context):
        from .intent_normalization import CanonicalIntent, EXECUTABLE_INTENTS, is_explanation_seeking, normalize_intent

        # D4-E3G hardening — a genuine cross-module compound request (the
        # frontend already resolved 2+ distinct real targets for this
        # message via referenceResolver.ts's resolveMultipleReferences,
        # carried in context['resolved_targets']). Every canonical-intent/
        # rule-based branch below (and inside `self.fallback`) only ever
        # reasons about the SINGLE currently selected module — matching
        # one of them here would silently apply a single-target mutation
        # to a message that actually names multiple different modules
        # (the "silent partial understanding" failure mode D4-E3F's own
        # rule exists to close, just for a different message shape), so
        # those branches are still never reached for a 2+-target message.
        #
        # D4-E3G's FIRST pass then routed every such message straight to
        # the LLM tier — but that violated "deterministic first" for
        # exactly the compound requests this app already knows how to
        # resolve deterministically per module (color/align/spacing/
        # explicit font-size). build_deterministic_multi_module_plan()
        # attempts that FIRST, reusing the SAME resolvers a single-module
        # message already uses, one target at a time, against ONLY that
        # target's own matched-phrase segment. Three outcomes:
        #   1. Every target's requested concept resolved -> a real
        #      MULTI_MODULE_UPDATE proposal, ZERO LLM calls.
        #   2. At least one target had a requested-but-unresolvable
        #      concept (e.g. no matching capability) -> a deterministic
        #      clarification, ZERO LLM calls, action NONE — never a
        #      silent partial plan (D4-E3G hardening §5/§6).
        #   3. Not even one target's segment contained a single
        #      classifiable concept at all (genuine semantic reasoning
        #      needed, e.g. "make it match the other CTA") -> falls
        #      through to the SAME NO_MATCH shape _is_no_match_result()
        #      recognizes, so DeterministicFirstEmailCommandProvider
        #      routes ONLY this residual case to the LLM tier. A single
        #      resolved target (0 or 1 entries — the overwhelming common
        #      case) never trips any of this; the whole deterministic
        #      chain below is unaffected.
        # D4-E3J §3/§4 — module-level exclusion is subtracted from the
        # candidate list BEFORE planning, never after — the excluded
        # module never has an operation built for it in the first place,
        # rather than being built then discarded. Only ever has an effect
        # when the frontend already resolved 2+ distinct targets AND at
        # least one of them was also named in an exclusion phrase (e.g.
        # "make all CTAs green except the footer CTA" — resolveExclusions()
        # + the "all X" resolver both fire from the SAME message); an
        # ordinary compound request with no exclusion phrase is completely
        # unaffected (excluded_ids is empty, filtered_targets == resolved_targets).
        resolved_targets = (context or {}).get('resolved_targets')
        if isinstance(resolved_targets, list) and len(resolved_targets) >= 2:
            excluded_ids = _excluded_target_ids_from_context(context or {})
            filtered_targets = (
                [t for t in resolved_targets if not (isinstance(t, dict) and t.get('id') in excluded_ids)]
                if excluded_ids else resolved_targets
            )
            if excluded_ids:
                removed_count = len(resolved_targets) - len(filtered_targets)
                if removed_count:
                    from . import local_ai_diagnostics

                    local_ai_diagnostics.record_module_exclusion_enforced(removed_count)
            if not filtered_targets:
                # Every genuinely resolved target was also excluded —
                # an honest no-op, never a clarification (nothing is
                # actually ambiguous here) and never silently falling
                # through to the LLM tier to invent something to do.
                return CommandResult(
                    reply="Every module in that request is also one you asked me to leave unchanged, so there's nothing left to change.",
                    action={'type': ActionType.NONE}, confidence=0.6,
                )
            plan = build_deterministic_multi_module_plan(message, filtered_targets)
            if plan is not None:
                excluded_labels = _excluded_labels_from_context(context or {}) if excluded_ids else None
                return _command_result_from_multi_module_plan(plan, excluded_labels=excluded_labels)
            return CommandResult(reply=_CLARIFY_REPLY, action={'type': ActionType.NONE}, confidence=0.2)

        # R4-D Checkpoint D1-A/D1-C — the two reconstruction-conversation
        # intents have NO independent English equivalent anywhere else
        # in this provider chain (unlike every other canonical intent,
        # which already has its own working English path inside
        # RuleBasedEmailCommandProvider — see that class's own
        # docstring). Checked regardless of language, unlike the
        # `language != 'en'`-gated dispatch below, so "fix everything
        # you safely can"/"what changed during import" behave
        # identically whether the message is English or hi/es/fr — see
        # compute_improve_reconstruction_result's own docstring for why
        # this never itself mutates.
        language_unconditional_intents = frozenset({
            CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION,
        })

        intent, _confidence, language = normalize_intent(message)

        if intent in language_unconditional_intents:
            result = apply_canonical_intent(intent, context, message)
            if result is not None:
                return self._localize(result, language) if language != 'en' else result

        if intent in EXECUTABLE_INTENTS and language != 'en':
            result = apply_canonical_intent(intent, context, message)
            if result is not None:
                return self._localize(result, language)

        # R4-D Checkpoint D1-A — a reconstruction-context question that
        # didn't literally match COMPARE_IMPORT_RECONSTRUCTION's own
        # (necessarily bounded) phrase list still deserves a real,
        # context-aware answer rather than silence or a wrong mutation
        # attempt — "Why is this button different?", "What changed
        # here?" and similar unpredictable phrasings all land here.
        # Language-unconditional for the same reason as above (English
        # has no equivalent catch-all elsewhere in this chain either).
        if (
            intent is None and is_explanation_seeking(message, language)
            and isinstance(context, dict) and context.get('import_reconstruction')
        ):
            result = compute_reconstruction_explain_result(context)
            return self._localize(result, language) if language != 'en' else result

        return self.fallback.resolve(message, context)

    def _localize(self, result, language):
        from .ai_command_local import localize_reply

        translated = localize_reply(result.reply, language, self._localization_client_factory)
        if translated is None:
            return result
        return CommandResult(reply=translated, action=result.action, confidence=result.confidence, provider=result.provider)


class DeterministicFirstEmailCommandProvider(EmailCommandProvider):
    """D4-E2 item 1 — Intelligence Router. Tries `deterministic` FIRST,
    always. Only consults `llm` when `deterministic` returns a genuine
    NO_MATCH (see `_is_no_match_result`) — never for a DECLINE (a
    specific, informative reason the router already gave — "select a
    module first", "I don't recognize a {type} module", an out-of-range
    value, etc.) and never for an EXPLANATION (a real answer pulled from
    the knowledge base). Those two outcomes are returned as-is: retrying
    them through an LLM would risk turning an authoritative "no" or a
    correct answer into a worse, hallucinated one, for zero benefit.

    Concretely this means a message like "Why did you change the column
    widths?" — which contains the words "change column width" but is a
    QUESTION, not an instruction — is handled correctly with no routing
    change of its own: RuleBasedEmailCommandProvider's own patterns (see
    _EXPLAIN_PATTERN, widened in this same checkpoint to catch "why did")
    already classify it as an explanation-seeking message before any
    width-change pattern gets a chance to match, so `deterministic`
    itself returns an EXPLANATION or a specific decline, never NO_MATCH —
    this router never even considers sending it to the LLM.

    If `llm` itself raises EmailCommandProviderUnavailable (down,
    misconfigured, malformed response), the already-computed deterministic
    NO_MATCH result is returned rather than a hard failure — same fail-
    open posture as the old FallbackEmailCommandProvider. D4-E2 Local-LLM
    Reachability Hardening item 6 — a genuine timeout (EmailCommandProviderTimeout,
    a subclass) is handled distinctly: rather than silently returning the
    same generic decline as if the LLM had never been tried, the reply
    says plainly that local AI reasoning did not finish in time, then
    still falls back to the same safe NONE action — never pretending the
    LLM understood the request, never leaving the action any less safe."""

    def __init__(self, llm, deterministic):
        self.llm = llm
        self.deterministic = deterministic

    def resolve(self, message, context):
        from . import local_ai_diagnostics

        result = self.deterministic.resolve(message, context)
        if not _is_no_match_result(result):
            local_ai_diagnostics.record_llm_call_avoided()
            return result

        local_ai_diagnostics.record_llm_call_required()
        try:
            llm_result = self.llm.resolve(message, context)
        except EmailCommandProviderTimeout:
            return CommandResult(
                reply='Local AI reasoning did not complete in time for this request. ' + result.reply,
                action={'type': ActionType.NONE}, confidence=0.0, provider='deterministic',
            )
        except EmailCommandProviderUnavailable:
            return result
        corrected_action, corrections = apply_semantic_consistency_gate(
            message, llm_result.action, target_segments=_target_segments_from_context(context),
        )
        if corrections:
            # Item 11 — never weaken validate_action(): a semantic-gate
            # correction still passes back through the SAME validator
            # (bounds/enum/allowlist checks included) before it can ever
            # reach the caller. If the corrected patch is somehow invalid
            # (e.g. a spoken padding value outside the allowed range), the
            # correction is discarded and the original, already-validated
            # llm_result is returned unchanged — a failed improvement
            # attempt must never downgrade an already-safe result.
            re_validated = validate_action(corrected_action)
            if re_validated is not None:
                local_ai_diagnostics.record_semantic_gate_corrections(len(corrections))
                return CommandResult(
                    reply=llm_result.reply, action=re_validated,
                    confidence=llm_result.confidence, provider=llm_result.provider,
                )
        return llm_result


class FallbackEmailCommandProvider(EmailCommandProvider):
    """Tries `primary` first; falls back to `fallback` (the deterministic
    router, which never fails) whenever the primary signals it cannot
    answer safely — same shape as yukti/providers.py::FallbackYuktiProvider."""

    def __init__(self, primary, fallback):
        self.primary = primary
        self.fallback = fallback

    def resolve(self, message, context):
        try:
            return self.primary.resolve(message, context)
        except EmailCommandProviderUnavailable:
            return self.fallback.resolve(message, context)

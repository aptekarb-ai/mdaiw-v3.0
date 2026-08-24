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
# Deliberately NOT the whole settings object (padding/outerSpacing/
# columnGutter are left to the manual Properties panel for now) — same
# "small, explicit, never arbitrary" posture _validate_patch already
# enforces for props via the capability manifest.
_SETTINGS_BOOLEAN_FIELDS = frozenset({'outlookVml', 'mobileStack'})
_SETTINGS_ENUM_FIELDS = {'visibility': frozenset({'all', 'hideMobile', 'hideDesktop'})}


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

    values = frozenset({
        INSERT_MODULE, UPDATE_MODULE_PROPS, DELETE_MODULE, DUPLICATE_MODULE, APPLY_GLOBAL_STYLE, NONE,
        INSERT_NESTED_MODULE, UPDATE_MODULE_SETTINGS, RESTRUCTURE_LAYOUT,
        APPLY_OUTLOOK_WRAPPER, APPLY_VML_PATTERN, REPLACE_UNSUPPORTED_PROPERTY, UPDATE_REPEATABLE_FIELD,
        SET_RESET_CSS_ENABLED, SET_CUSTOM_CSS_ENABLED, SET_CUSTOM_CSS, CLEAR_CUSTOM_CSS,
        SET_EMAIL_TITLE, SET_EMAIL_SUBJECT, SET_FAVICON, CLEAR_FAVICON,
        COMPOSE_EMAIL,
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
        COMPOSE_EMAIL,
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
        safe_items = []
        for entry in raw_items[:MAX_COMPOSITION_ITEMS]:
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
_ALIGN_PATTERN = re.compile(r'\balign(?:ment)?\b.*\b(left|center|right)\b|\b(left|center|right)\s*align', re.IGNORECASE)
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
_EXPLAIN_PATTERN = re.compile(r'\b(explain|what\s+is|what\'?s|why\s+does|why\s+is|tell\s+me\s+about)\b', re.IGNORECASE)
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
    if match := re.search(r'#[0-9a-fA-F]{6}', lowered):
        return match.group(0).upper()
    for phrase in sorted(COLOR_WORDS, key=len, reverse=True):
        if re.search(rf'\b{re.escape(phrase)}\b', lowered):
            return COLOR_WORDS[phrase]
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
        # _EXPLAIN_PATTERN's docstring above).
        if _EXPLAIN_PATTERN.search(lowered):
            rule = _find_explain_rule(lowered)
            if rule is not None:
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

        # Sub-phase 6, work package D — VML fallback toggle ("enable
        # outlook vml for this button" / "add an outlook wrapper").
        if _VML_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            # Background is checked first: hero-background-image is the one
            # module type with BOTH capabilities (its own CTA button VML
            # nests inside its background ghost-table VML — see
            # heroCatalog.tsx), so APPLY_OUTLOOK_WRAPPER is the single
            # correct action that covers both for that type.
            if _is_vml_background_module(selected_type):
                return CommandResult(
                    reply=(
                        f'I will enable the Classic Outlook VML background fallback for the selected '
                        f'{selected_type} module.'
                    ),
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
        # column widths to 70/30").
        if _COLUMN_WIDTHS_PATTERN.search(lowered):
            if not selected_type:
                return CommandResult(reply=_NO_SELECTION_REPLY, action={'type': ActionType.NONE}, confidence=0.3)
            capability = module_capabilities.get_module_capability(selected_type)
            if not capability or not capability.get('isLayout'):
                return CommandResult(
                    reply=f'The selected {selected_type} module is not a layout, so it has no column widths to change.',
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            numbers = [float(n) for n in _WIDTH_NUMBERS_PATTERN.findall(lowered)]
            column_count = capability.get('columnCount') or 0
            if len(numbers) != column_count:
                return CommandResult(
                    reply=(
                        f'Tell me {column_count} width percentages for this layout, e.g. '
                        '"change the column widths to 70/30".'
                    ),
                    action={'type': ActionType.NONE}, confidence=0.3,
                )
            widths_label = '/'.join(str(int(n)) if n == int(n) else str(n) for n in numbers)
            return CommandResult(
                reply=f'This will change the column widths to {widths_label}%. Please confirm.',
                action={'type': ActionType.RESTRUCTURE_LAYOUT, 'module_type': selected_type, 'widths': numbers},
                confidence=0.85,
            )

        # Insert — checked before delete/duplicate so "add a button" never
        # collides with "remove"/"duplicate" phrasing.
        if _INSERT_PATTERN.search(lowered):
            module_types = _find_all_module_types(lowered)
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

    if 'align' in allowed:
        align_match = _ALIGN_PATTERN.search(lowered)
        if align_match:
            patch['align'] = align_match.group(1) or align_match.group(2)

    return patch or None


def get_default_email_command_provider():
    """3-way provider selection (Phase A): deterministic | local | openai.
    Mirrors yukti/providers.py::get_default_provider()'s posture exactly —
    the deterministic router is ALWAYS the fallback, regardless of which
    (if any) optional provider is selected/configured.

      - EMAILBUILDER_AI_COMMAND_PROVIDER == 'openai' AND OPENAI_API_KEY set
        -> OpenAI, falling back to deterministic.
      - EMAILBUILDER_AI_COMMAND_PROVIDER == 'local' AND
        EMAILBUILDER_LOCAL_AI_BASE_URL set -> local OpenAI-compatible
        endpoint (Ollama/llama.cpp/LM Studio/etc.), falling back to
        deterministic.
      - Anything else (unset, misconfigured, or explicitly
        'deterministic') -> the deterministic router alone. No API key or
        local server is ever required for normal operation."""
    from django.conf import settings

    fallback = RuleBasedEmailCommandProvider()

    if settings.EMAILBUILDER_AI_COMMAND_PROVIDER == 'openai' and settings.OPENAI_API_KEY:
        from .ai_command_openai import OpenAIEmailCommandProvider

        return FallbackEmailCommandProvider(primary=OpenAIEmailCommandProvider(), fallback=fallback)

    if settings.EMAILBUILDER_AI_COMMAND_PROVIDER == 'local' and settings.EMAILBUILDER_LOCAL_AI_BASE_URL:
        from .ai_command_local import LocalEmailCommandProvider

        return FallbackEmailCommandProvider(primary=LocalEmailCommandProvider(), fallback=fallback)

    return fallback


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

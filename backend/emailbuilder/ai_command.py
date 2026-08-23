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


class ActionType:
    INSERT_MODULE = 'INSERT_MODULE'
    UPDATE_MODULE_PROPS = 'UPDATE_MODULE_PROPS'
    DELETE_MODULE = 'DELETE_MODULE'
    DUPLICATE_MODULE = 'DUPLICATE_MODULE'
    APPLY_GLOBAL_STYLE = 'APPLY_GLOBAL_STYLE'
    NONE = 'NONE'

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

    values = frozenset({
        INSERT_MODULE, UPDATE_MODULE_PROPS, DELETE_MODULE, DUPLICATE_MODULE, APPLY_GLOBAL_STYLE, NONE,
        INSERT_NESTED_MODULE, UPDATE_MODULE_SETTINGS, RESTRUCTURE_LAYOUT,
        APPLY_OUTLOOK_WRAPPER, APPLY_VML_PATTERN, REPLACE_UNSUPPORTED_PROPERTY,
    })

    IMPLEMENTED = frozenset({INSERT_MODULE, UPDATE_MODULE_PROPS, DELETE_MODULE, DUPLICATE_MODULE, APPLY_GLOBAL_STYLE})


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

    if action_type in (ActionType.UPDATE_MODULE_PROPS, ActionType.APPLY_GLOBAL_STYLE):
        module_type = action.get('module_type')
        if module_type not in module_capabilities.get_all_module_types():
            return None
        patch = _validate_patch(module_type, action.get('patch'))
        if patch is None:
            return None
        return {'type': action_type, 'target': 'selected', 'module_type': module_type, 'patch': patch}

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
    if action_type in (ActionType.UPDATE_MODULE_PROPS, ActionType.APPLY_GLOBAL_STYLE):
        module_type = action.get('module_type')
        patch = action.get('patch') or {}
        if not _patch_has_asset_marker(module_type, patch):
            return action
        resolved_patch = _resolve_patch_assets(module_type, patch, request)
        if not resolved_patch:
            return {'type': ActionType.NONE}
        return {**action, 'patch': resolved_patch}

    if action_type == ActionType.INSERT_MODULE:
        resolved_modules = []
        for entry in action.get('modules', []):
            module_type = entry.get('module_type')
            patch = entry.get('patch') or {}
            resolved_patch = _resolve_patch_assets(module_type, patch, request) if _patch_has_asset_marker(module_type, patch) else patch
            resolved_modules.append({'module_type': module_type, 'patch': resolved_patch})
        return {**action, 'modules': resolved_modules}

    return action


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
_ALIGN_PATTERN = re.compile(r'\balign(?:ment)?\b.*\b(left|center|right)\b|\b(left|center|right)\s*align', re.IGNORECASE)
_FONT_SIZE_PATTERN = re.compile(r'\bfont\s*size\s*(?:to|=|:)?\s*(\d+)\b', re.IGNORECASE)
_BIGGER_PATTERN = re.compile(r'\b(bigger|larger|increase)\b', re.IGNORECASE)
_SMALLER_PATTERN = re.compile(r'\b(smaller|decrease)\b', re.IGNORECASE)
_SET_TEXT_PATTERN = re.compile(r'\b(?:set|change)\s+the\s+text\s+to\s+["\']?(.+?)["\']?$', re.IGNORECASE)


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

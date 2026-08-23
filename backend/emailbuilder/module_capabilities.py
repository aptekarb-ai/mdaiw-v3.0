"""Feature 14 V2 — Phase A. Reads the committed cross-language capability
artifact (shared/module-capabilities.generated.json) generated from the
frontend's module registry (frontend/src/emailbuilder/moduleRegistry.tsx
via moduleCapabilities.ts + scripts/generateModuleCapabilities.ts) — the
ONE source of truth for "which module types exist and what can the Email
AI Engineer edit on each one."

This module never hand-lists module types or editable fields itself.
ai_command.py's validate_action() reads everything it needs about a
module type through the functions here; if the manifest is stale relative
to the live registry, the drift-check tests (moduleCapabilities.test.ts on
the frontend, ModuleCapabilitiesDriftTests below) fail — not this loader.
"""

import json
from pathlib import Path

from django.conf import settings

_MANIFEST_FILENAME = 'module-capabilities.generated.json'


def _shared_dir():
    return Path(settings.BASE_DIR).parent / 'shared'


def _manifest_path():
    return _shared_dir() / _MANIFEST_FILENAME


class ModuleCapabilityManifestError(Exception):
    """Raised when the generated manifest is missing or malformed — a
    real configuration problem (forgot to run `npm run
    generate:module-capabilities`), never silently swallowed into an
    empty capability set that would make every module type look
    unsupported."""


_cache = None


def _load():
    global _cache
    if _cache is not None:
        return _cache
    path = _manifest_path()
    try:
        raw = path.read_text(encoding='utf-8')
    except FileNotFoundError as exc:
        raise ModuleCapabilityManifestError(
            f'{_MANIFEST_FILENAME} not found at {path}. Run '
            '`npm run generate:module-capabilities` in frontend/.',
        ) from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ModuleCapabilityManifestError(f'{_MANIFEST_FILENAME} is not valid JSON: {exc}') from exc

    modules_by_type = {}
    for entry in data.get('modules', []):
        module_type = entry.get('type')
        if not module_type:
            continue
        modules_by_type[module_type] = entry

    _cache = {
        'version': data.get('version'),
        'moduleCount': data.get('moduleCount'),
        'modules_by_type': modules_by_type,
    }
    return _cache


def reset_cache_for_tests():
    """Test-only escape hatch — lets a test point settings.BASE_DIR at a
    fixture shared/ directory (or mutate the real one) and see the change
    without process restart. Never called from application code."""
    global _cache
    _cache = None


def get_all_module_types():
    """frozenset of every module type the manifest knows about — the
    single replacement for ai_command.py's old hand-typed
    SUPPORTED_MODULE_TYPES 5-entry tuple."""
    return frozenset(_load()['modules_by_type'].keys())


def get_module_capability(module_type):
    """The full manifest entry for one type, or None if unknown. Callers
    that only need editable fields should prefer get_editable_fields()."""
    return _load()['modules_by_type'].get(module_type)


def get_editable_fields(module_type):
    """list of field-capability dicts ({key, label, valueType, group,
    options?, min?, max?}) for one module type, or [] if the type is
    unknown or genuinely has no flat AI-editable field (e.g. every
    layout-* type — see moduleCapabilities.ts's isLayout docstring)."""
    capability = get_module_capability(module_type)
    if not capability:
        return []
    return capability.get('editableFields', [])


def get_editable_field(module_type, field_key):
    """One field's capability dict, or None if that key isn't an
    AI-editable field of that module type."""
    for field in get_editable_fields(module_type):
        if field.get('key') == field_key:
            return field
    return None


def manifest_version():
    return _load()['version']


def manifest_module_count():
    return _load()['moduleCount']

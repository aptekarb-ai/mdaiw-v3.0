"""Email Document Model (EDM) validation.

The EDM is the structured, versioned module tree stored in
EmailDocument.content — never raw DOM/HTML. This module is the single
source of truth for "is this a valid EDM", shared by the serializer's
validate_content(). The allowed module-type set mirrors Feature 03's
frontend module registry (frontend/src/emailbuilder/moduleRegistry.tsx);
Feature 04's module library extends this set, not a redesign of it.
"""

ALLOWED_MODULE_TYPES = frozenset({
    'layout-1col',
    'layout-2col-50-50',
    'layout-2col-40-60',
    'layout-2col-60-40',
    'layout-3col',
    'text',
    'image',
    'image-text',
    'text-image',
    'button',
    'divider',
    'spacer',
})

PADDING_KEYS = ('paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft')
MAX_PADDING = 200
CURRENT_VERSION = 1


class EdmValidationError(ValueError):
    pass


def validate_edm(content):
    if not isinstance(content, dict):
        raise EdmValidationError('content must be an object.')

    version = content.get('version')
    if version != CURRENT_VERSION:
        raise EdmValidationError(f'content.version must be {CURRENT_VERSION}.')

    modules = content.get('modules')
    if not isinstance(modules, list):
        raise EdmValidationError('content.modules must be a list.')

    seen_ids = set()
    for index, module in enumerate(modules):
        _validate_module(module, index, seen_ids)

    return content


def _validate_module(module, index, seen_ids):
    prefix = f'content.modules[{index}]'
    if not isinstance(module, dict):
        raise EdmValidationError(f'{prefix} must be an object.')

    module_id = module.get('id')
    if not isinstance(module_id, str) or not module_id.strip():
        raise EdmValidationError(f'{prefix}.id must be a non-empty string.')
    if module_id in seen_ids:
        raise EdmValidationError(f'{prefix}.id "{module_id}" is duplicated.')
    seen_ids.add(module_id)

    module_type = module.get('type')
    if module_type not in ALLOWED_MODULE_TYPES:
        raise EdmValidationError(f'{prefix}.type "{module_type}" is not a recognized module type.')

    order = module.get('order')
    if not isinstance(order, int) or isinstance(order, bool):
        raise EdmValidationError(f'{prefix}.order must be an integer.')

    props = module.get('props')
    if not isinstance(props, dict):
        raise EdmValidationError(f'{prefix}.props must be an object.')

    settings = module.get('settings')
    if not isinstance(settings, dict):
        raise EdmValidationError(f'{prefix}.settings must be an object.')

    for key in PADDING_KEYS:
        if key not in settings:
            continue
        value = settings[key]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > MAX_PADDING:
            raise EdmValidationError(f'{prefix}.settings.{key} must be an integer between 0 and {MAX_PADDING}.')

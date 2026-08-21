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
    'layout-2col-30-70',
    'layout-2col-70-30',
    'layout-3col',
    'layout-4col',
    'layout-5col',
    'layout-6col',
    'text',
    'image',
    'image-text',
    'text-image',
    'button',
    'divider',
    'spacer',
    # Feature 04 — Module Library catalog families. Mirrors
    # frontend/src/emailbuilder/edm.ts's EmailModuleType union exactly.
    'header-logo-center',
    'header-logo-left',
    'header-logo-nav',
    'header-logo-cta',
    'header-preheader-logo',
    'header-compact',
    'hero-image-cta',
    'hero-background-image',
    'hero-text-only',
    'hero-image-left',
    'hero-image-right',
    'hero-centered-promo',
    'content-heading-text',
    'content-heading-text-cta',
    'content-image-left',
    'content-image-right',
    'content-image-top',
    'content-quote',
    'content-article-teaser',
    'content-feature-list',
    'content-icon-text-rows',
    'product-single',
    'product-two-cards',
    'product-three-cards',
    'product-image-price-cta',
    'product-grid',
    'cta-centered',
    'cta-banner',
    'cta-text-cta',
    'cta-dual',
    'social-icon-row',
    'social-follow-us',
    'footer-simple-legal',
    'footer-social-legal',
    'footer-address-contact',
    'footer-preference-unsubscribe',
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

    order = module.get('order')
    if not isinstance(order, int) or isinstance(order, bool):
        raise EdmValidationError(f'{prefix}.order must be an integer.')

    validate_module_instance(module.get('type'), module.get('props'), module.get('settings'), prefix)


def validate_module_instance(module_type, props, settings, prefix='module'):
    """Validate the (type, props, settings) triple shared by every EDM
    module instance — used both by a full EDM's per-module validation
    above and, unchanged, by SavedEmailModule (Feature 04's Saved
    Modules), which stores that exact same triple outside of any
    document. `id`/`order` are EDM-tree-position concepts and are
    intentionally validated separately, not here."""
    if module_type not in ALLOWED_MODULE_TYPES:
        raise EdmValidationError(f'{prefix}.type "{module_type}" is not a recognized module type.')

    if not isinstance(props, dict):
        raise EdmValidationError(f'{prefix}.props must be an object.')

    _validate_settings(f'{prefix}.settings', settings)


def _validate_padding_keys(prefix, spacing, required):
    """Validates whichever of PADDING_KEYS are present as ints in
    [0, MAX_PADDING]. `required=True` (desktop) additionally requires
    every key to be present; `required=False` (mobile overrides) allows
    any subset, including none."""
    if not isinstance(spacing, dict):
        raise EdmValidationError(f'{prefix} must be an object.')
    for key in PADDING_KEYS:
        if key not in spacing:
            if required:
                raise EdmValidationError(f'{prefix}.{key} is required.')
            continue
        value = spacing[key]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > MAX_PADDING:
            raise EdmValidationError(f'{prefix}.{key} must be an integer between 0 and {MAX_PADDING}.')


def _validate_dimension_value(prefix, dimension):
    if not isinstance(dimension, dict):
        raise EdmValidationError(f'{prefix} must be an object.')
    unit = dimension.get('unit')
    if unit not in ('px', '%'):
        raise EdmValidationError(f'{prefix}.unit must be "px" or "%".')
    value = dimension.get('value')
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise EdmValidationError(f'{prefix}.value must be a number.')
    if value != value or value in (float('inf'), float('-inf')):  # NaN/Infinity
        raise EdmValidationError(f'{prefix}.value must be a finite number.')
    if value < 0:
        raise EdmValidationError(f'{prefix}.value must not be negative.')
    if unit == '%' and value > 100:
        raise EdmValidationError(f'{prefix}.value must be between 0 and 100 for a percentage.')
    if unit == 'px' and value > MAX_PADDING:
        raise EdmValidationError(f'{prefix}.value must be between 0 and {MAX_PADDING} for pixels.')


def _validate_outer_spacing_sides(prefix, sides, required):
    if not isinstance(sides, dict):
        raise EdmValidationError(f'{prefix} must be an object.')
    for side in ('left', 'right'):
        if side in sides:
            _validate_dimension_value(f'{prefix}.{side}', sides[side])
        elif required:
            raise EdmValidationError(f'{prefix}.{side} is required.')


def _validate_outer_spacing_percent_sum(prefix, sides):
    left = sides.get('left')
    right = sides.get('right')
    if isinstance(left, dict) and isinstance(right, dict) and left.get('unit') == '%' and right.get('unit') == '%':
        total = left.get('value', 0) + right.get('value', 0)
        if total >= 100:
            raise EdmValidationError(f'{prefix} left + right percentage spacers must leave room for content (< 100%).')


def _validate_outer_spacing(prefix, outer_spacing):
    # Optional at the backend validation layer — older documents saved
    # before this architecture have no outerSpacing key yet; the frontend
    # normalizes those to desktop 0px/0px on load (see
    # frontend/src/emailbuilder/edmMigration.ts). A present value must be
    # well-formed, in either the current desktop/mobile shape or the
    # older flat {left,right} shape (pre-Desktop/Mobile-split — see
    # edmMigration.ts's upgradeOuterSpacing for the frontend equivalent).
    if outer_spacing is None:
        return
    if not isinstance(outer_spacing, dict):
        raise EdmValidationError(f'{prefix} must be an object.')

    if 'desktop' in outer_spacing or 'mobile' in outer_spacing:
        desktop = outer_spacing.get('desktop', {})
        _validate_outer_spacing_sides(f'{prefix}.desktop', desktop, required=True)
        _validate_outer_spacing_percent_sum(f'{prefix}.desktop', desktop)

        if 'mobile' in outer_spacing:
            mobile = outer_spacing.get('mobile', {})
            _validate_outer_spacing_sides(f'{prefix}.mobile', mobile, required=False)
            # Validate the RESOLVED mobile pair (desktop values with
            # mobile overrides applied) — a partial override can still
            # push the combined percentage over budget even when the
            # desktop pair alone was fine.
            resolved_mobile = {**desktop, **mobile}
            _validate_outer_spacing_percent_sum(f'{prefix}.mobile (resolved)', resolved_mobile)
        return

    # Legacy flat {left,right} shape (Feature 04.5's first pass, before
    # the Desktop/Mobile split) — still accepted, no forced migration.
    _validate_outer_spacing_sides(prefix, outer_spacing, required=False)
    _validate_outer_spacing_percent_sum(prefix, outer_spacing)


def _validate_settings(prefix, settings):
    if not isinstance(settings, dict):
        raise EdmValidationError(f'{prefix} must be an object.')

    if 'desktop' in settings or 'mobile' in settings or 'outerSpacing' in settings:
        # Current (Desktop/Mobile + outer-spacing) shape.
        _validate_padding_keys(f'{prefix}.desktop', settings.get('desktop', {}), required=True)
        if 'mobile' in settings:
            _validate_padding_keys(f'{prefix}.mobile', settings.get('mobile', {}), required=False)
        _validate_outer_spacing(f'{prefix}.outerSpacing', settings.get('outerSpacing'))
        return

    # Legacy flat shape (pre-Desktop/Mobile-architecture drafts) — still
    # accepted so existing Feature 02/03/04 documents keep saving/loading
    # without a forced migration; the frontend upgrades this shape to the
    # current one on load (edmMigration.ts), never the backend.
    _validate_padding_keys(prefix, settings, required=False)

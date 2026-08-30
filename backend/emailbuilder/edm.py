"""Email Document Model (EDM) validation.

The EDM is the structured, versioned module tree stored in
EmailDocument.content — never raw DOM/HTML. This module is the single
source of truth for "is this a valid EDM", shared by the serializer's
validate_content(). The allowed module-type set mirrors Feature 03's
frontend module registry (frontend/src/emailbuilder/moduleRegistry.tsx);
Feature 04's module library extends this set, not a redesign of it.
"""
import re

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

# Feature 05 — Layout Builder. Column count is inherent in the layout
# module TYPE (mirrors frontend/src/emailbuilder/layoutModel.ts's
# LAYOUT_COLUMN_COUNTS exactly — duplicated here as a small static map,
# not imported, since this is a separate Python codebase).
LAYOUT_COLUMN_COUNTS = {
    'layout-1col': 1,
    'layout-2col-50-50': 2,
    'layout-2col-40-60': 2,
    'layout-2col-60-40': 2,
    'layout-2col-30-70': 2,
    'layout-2col-70-30': 2,
    'layout-3col': 3,
    'layout-4col': 4,
    'layout-5col': 5,
    'layout-6col': 6,
}
LAYOUT_MODULE_TYPES = frozenset(LAYOUT_COLUMN_COUNTS.keys())

# Same floor as layoutModel.ts's MIN_COLUMN_WIDTH_PERCENT — below this a
# column is rejected outright, not just warned about (see that file's
# docstring for why: an unusably thin column is never a legitimate
# design intent).
MIN_COLUMN_WIDTH_PERCENT = 10
COLUMN_WIDTH_TOTAL_TOLERANCE = 0.05
MAX_COLUMN_GUTTER_PX = 100
COLUMN_VALIGN_VALUES = ('top', 'middle', 'bottom')


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

    validate_module_instance(
        module.get('type'), module.get('props'), module.get('settings'),
        columns=module.get('columns'), prefix=prefix, seen_ids=seen_ids,
    )


def validate_module_instance(module_type, props, settings, columns=None, prefix='module', seen_ids=None):
    """Validate the (type, props, settings, columns) tuple shared by every
    EDM module instance — used both by a full EDM's per-module validation
    above and by SavedEmailModule (Feature 04's Saved Modules / Feature
    05's nested-layout Saved Modules), which stores that exact same tuple
    outside of any document. `id`/`order` are EDM-tree-position concepts
    and are intentionally validated separately, not here.

    `columns` (Feature 05) is only meaningful for a layout-type module and
    is optional even then — an older/raw payload may omit it entirely;
    the frontend backfills empty columns at load time (see
    edmMigration.ts), so the backend never forces a document to already
    have it. `seen_ids` collects nested module ids into the SAME set as
    top-level module ids when validating a full document (so ids stay
    unique across the whole tree — instruction 34); a saved module passed
    with no `seen_ids` gets its own fresh set (ids unique within just that
    one saved module's tree)."""
    if module_type not in ALLOWED_MODULE_TYPES:
        raise EdmValidationError(f'{prefix}.type "{module_type}" is not a recognized module type.')

    if not isinstance(props, dict):
        raise EdmValidationError(f'{prefix}.props must be an object.')

    if module_type in LAYOUT_MODULE_TYPES:
        _validate_column_widths(f'{prefix}.props.columnWidths', props.get('columnWidths'), module_type)

    _validate_prop_conventions(f'{prefix}.props', props)
    _validate_settings(f'{prefix}.settings', settings, columns)
    _validate_columns(f'{prefix}.columns', columns, module_type, seen_ids if seen_ids is not None else set())


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


def _validate_settings(prefix, settings, columns=None):
    if not isinstance(settings, dict):
        raise EdmValidationError(f'{prefix} must be an object.')

    # Feature 05 — independent of the desktop/mobile-vs-legacy-flat branch
    # below; both shapes may carry these two new, optional keys.
    _validate_column_gutter(f'{prefix}.columnGutter', settings.get('columnGutter'))
    _validate_mobile_column_order(f'{prefix}.mobileColumnOrder', settings.get('mobileColumnOrder'), columns)

    # Feature 07 — same "independent of shape" convention as columnGutter/
    # mobileColumnOrder above; all optional, absent = safe default.
    _validate_enum(f'{prefix}.visibility', settings.get('visibility'), MODULE_VISIBILITY_VALUES)
    mobile_stack = settings.get('mobileStack')
    if mobile_stack is not None and not isinstance(mobile_stack, bool):
        raise EdmValidationError(f'{prefix}.mobileStack must be a boolean.')
    if settings.get('mobileColumnGap') is not None:
        _validate_gutter_dimension(f'{prefix}.mobileColumnGap', settings['mobileColumnGap'])

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


def _validate_gutter_dimension(prefix, dimension):
    if not isinstance(dimension, dict):
        raise EdmValidationError(f'{prefix} must be an object.')
    if dimension.get('unit') != 'px':
        raise EdmValidationError(f'{prefix}.unit must be "px".')
    value = dimension.get('value')
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise EdmValidationError(f'{prefix}.value must be a number.')
    if value != value or value in (float('inf'), float('-inf')):  # NaN/Infinity
        raise EdmValidationError(f'{prefix}.value must be a finite number.')
    if value < 0 or value > MAX_COLUMN_GUTTER_PX:
        raise EdmValidationError(f'{prefix}.value must be between 0 and {MAX_COLUMN_GUTTER_PX} pixels.')


def _validate_column_gutter(prefix, gutter):
    # Optional — absent on every non-layout module, and on layout modules
    # saved before Feature 05 (0px/no-gutter is the frontend's own
    # fallback — see edm.ts's resolveColumnGutter).
    if gutter is None:
        return
    if not isinstance(gutter, dict):
        raise EdmValidationError(f'{prefix} must be an object.')
    if 'desktop' not in gutter:
        raise EdmValidationError(f'{prefix}.desktop is required.')
    _validate_gutter_dimension(f'{prefix}.desktop', gutter['desktop'])
    if gutter.get('mobile') is not None:
        _validate_gutter_dimension(f'{prefix}.mobile', gutter['mobile'])


def _validate_mobile_column_order(prefix, order, columns):
    if order is None:
        return
    if not isinstance(order, list):
        raise EdmValidationError(f'{prefix} must be a list.')
    if isinstance(columns, list) and len(order) != len(columns):
        raise EdmValidationError(f'{prefix} must list every column index exactly once.')
    if sorted(order) != list(range(len(order))):
        raise EdmValidationError(f'{prefix} must be a permutation of column indexes starting at 0.')


def _validate_column_settings(prefix, settings):
    if not isinstance(settings, dict):
        raise EdmValidationError(f'{prefix} must be an object.')
    _validate_padding_keys(f'{prefix}.desktop', settings.get('desktop', {}), required=True)
    if 'mobile' in settings:
        _validate_padding_keys(f'{prefix}.mobile', settings.get('mobile', {}), required=False)
    background = settings.get('backgroundColor', '')
    if not isinstance(background, str):
        raise EdmValidationError(f'{prefix}.backgroundColor must be a string.')
    # E5 — generic per-column background image. Optional, same convention
    # as every other optional string field here: absent is fine, present
    # must be a string.
    if settings.get('backgroundImage') is not None and not isinstance(settings['backgroundImage'], str):
        raise EdmValidationError(f'{prefix}.backgroundImage must be a string.')
    valign = settings.get('verticalAlign', 'top')
    if valign not in COLUMN_VALIGN_VALUES:
        raise EdmValidationError(f'{prefix}.verticalAlign must be one of {COLUMN_VALIGN_VALUES}.')


def _validate_columns(prefix, columns, module_type, seen_ids):
    """Feature 05 — validates a layout module's nested columns[]. Nesting
    is deliberately capped at exactly one level: a nested module may never
    itself be a layout type or carry its own `columns` key (instruction
    33: "avoid unsafe arbitrary-depth recursion") — enforced below rather
    than by recursing into this function again."""
    if columns is None:
        return  # optional — see validate_module_instance's docstring.
    if not isinstance(columns, list):
        raise EdmValidationError(f'{prefix} must be a list.')
    if len(columns) == 0:
        return  # not-yet-backfilled — same tolerance as `columns is None`.

    expected_count = LAYOUT_COLUMN_COUNTS.get(module_type)
    if expected_count is None:
        raise EdmValidationError(f'{prefix} is only allowed on layout modules.')
    if len(columns) != expected_count:
        raise EdmValidationError(f'{prefix} must have exactly {expected_count} column(s) for "{module_type}".')

    column_ids = set()
    for col_index, column in enumerate(columns):
        col_prefix = f'{prefix}[{col_index}]'
        if not isinstance(column, dict):
            raise EdmValidationError(f'{col_prefix} must be an object.')

        column_id = column.get('id')
        if not isinstance(column_id, str) or not column_id.strip():
            raise EdmValidationError(f'{col_prefix}.id must be a non-empty string.')
        if column_id in column_ids:
            raise EdmValidationError(f'{col_prefix}.id "{column_id}" is duplicated.')
        column_ids.add(column_id)

        _validate_column_settings(f'{col_prefix}.settings', column.get('settings', {}))

        nested_modules = column.get('modules')
        if not isinstance(nested_modules, list):
            raise EdmValidationError(f'{col_prefix}.modules must be a list.')
        for nested_index, nested in enumerate(nested_modules):
            nested_prefix = f'{col_prefix}.modules[{nested_index}]'
            if not isinstance(nested, dict):
                raise EdmValidationError(f'{nested_prefix} must be an object.')

            nested_id = nested.get('id')
            if not isinstance(nested_id, str) or not nested_id.strip():
                raise EdmValidationError(f'{nested_prefix}.id must be a non-empty string.')
            if nested_id in seen_ids:
                raise EdmValidationError(f'{nested_prefix}.id "{nested_id}" is duplicated.')
            seen_ids.add(nested_id)

            nested_order = nested.get('order')
            if not isinstance(nested_order, int) or isinstance(nested_order, bool):
                raise EdmValidationError(f'{nested_prefix}.order must be an integer.')

            nested_type = nested.get('type')
            if nested_type in LAYOUT_MODULE_TYPES:
                raise EdmValidationError(f'{nested_prefix}.type — a layout cannot be nested inside a layout column.')
            if nested.get('columns') is not None:
                raise EdmValidationError(f'{nested_prefix}.columns is not allowed — nesting is limited to one level.')

            validate_module_instance(
                nested_type, nested.get('props'), nested.get('settings'),
                columns=None, prefix=nested_prefix, seen_ids=seen_ids,
            )

    # Column WIDTH itself lives on the parent layout module's own
    # props.columnWidths[index] (see layoutModel.ts's EmailColumn
    # docstring for why it isn't duplicated onto the column object) —
    # validated by _validate_column_widths (called from
    # validate_module_instance, which has access to `props`). This
    # function only validates the column CONTAINER: id/settings/nested
    # modules.


def _validate_column_widths(prefix, column_widths, module_type):
    """Feature 05 — validates a layout module's props.columnWidths[] —
    the single source of truth for column width (see _validate_columns'
    docstring). Required whenever module_type is a layout type; a
    mismatched length against the type's expected column count, a
    below-minimum width, or a total that doesn't sum to 100% (within
    floating-point tolerance) are all rejected outright — instruction 5:
    "do not allow invalid persistence... if the layout would be
    structurally invalid." """
    expected_count = LAYOUT_COLUMN_COUNTS.get(module_type)
    if expected_count is None:
        return
    if not isinstance(column_widths, list) or len(column_widths) != expected_count:
        raise EdmValidationError(f'{prefix} must be a list of {expected_count} number(s) for "{module_type}".')

    total = 0.0
    for index, width in enumerate(column_widths):
        item_prefix = f'{prefix}[{index}]'
        if not isinstance(width, (int, float)) or isinstance(width, bool):
            raise EdmValidationError(f'{item_prefix} must be a number.')
        if width != width or width in (float('inf'), float('-inf')):
            raise EdmValidationError(f'{item_prefix} must be a finite number.')
        if width < MIN_COLUMN_WIDTH_PERCENT or width > 100:
            raise EdmValidationError(f'{item_prefix} must be between {MIN_COLUMN_WIDTH_PERCENT} and 100 percent.')
        total += width

    if abs(total - 100) > COLUMN_WIDTH_TOTAL_TOLERANCE:
        raise EdmValidationError(f'{prefix} must total 100 percent (got {round(total, 2)}).')


# --- Feature 06 — Module Element Editor: generic prop-value validation ---
# The backend never trusted individual prop VALUES before this feature —
# only the module tree's structural shape (id/type/order/settings/
# columns). Building a full per-module-type JSON-schema validator for
# every one of the 53 module prop shapes is out of proportion for this
# pass (and was never required by any earlier feature either); instead,
# this validates by KEY PATTERN, uniformly across every module type's
# props (one level of nesting, matching SchemaField's own documented
# one-level-nesting scope) — catching exactly the categories instructions
# 39-42 call out (colors, font ids, unsafe URL schemes, bounded
# repeatable lists) without a bespoke validator per type.
HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
UNSAFE_URL_PREFIXES = ('javascript:', 'data:', 'vbscript:')
# Mirrors frontend/src/emailbuilder/fonts.ts's EMAIL_SAFE_FONTS ids exactly.
EMAIL_SAFE_FONT_IDS = frozenset({'arial', 'helvetica', 'verdana', 'georgia', 'tahoma', 'trebuchet', 'times'})
URL_KEY_NAMES = frozenset({'src', 'imageSrc', 'logoSrc'})
# Mirrors the exact repeatable-list keys the frontend builds a bounded
# RepeatableItemEditor for (headerCatalog.tsx/socialCatalog.tsx/
# footerCatalog.tsx/productCatalog.tsx) — same max as each editor's own
# `maxItems`, plus a generous cap on product `items` as a safety
# backstop (product's own count is fixed per variant, not user-resizable,
# but a malformed/tampered payload should still be rejected outright).
REPEATABLE_LIST_MAX_LENGTH = {
    'navLinks': 6,
    'platforms': 6,
    'socialPlatforms': 6,
    'items': 12,
}

# Feature 07 — mirrors frontend/src/emailbuilder/TypographyControls.tsx's
# FONT_SIZE_MIN/MAX and LINE_HEIGHT_MIN/MAX exactly, applied generically
# to ANY key ending in "FontSize"/"LineHeight" (fontSize, mobileFontSize,
# lineHeight, mobileLineHeight, ...) so a future responsive-typography
# field gets the same bound for free.
FONT_SIZE_BOUNDS = (8, 72)
LINE_HEIGHT_BOUNDS = (10, 120)
BUTTON_WIDTH_MODES = frozenset({'auto', 'fixed', 'full'})
HORIZONTAL_ALIGN_VALUES = frozenset({'left', 'center', 'right'})
MODULE_VISIBILITY_VALUES = frozenset({'all', 'hideMobile', 'hideDesktop'})


def _validate_hex_color(prefix, value):
    if value == '':
        return  # '' = "no color" — the convention used by every optional color field this feature introduces.
    if not isinstance(value, str) or not HEX_COLOR_RE.match(value):
        raise EdmValidationError(f'{prefix} must be a hex color like #003B49, or an empty string.')


def _validate_safe_url_value(prefix, value):
    if not isinstance(value, str):
        return  # a non-string here is a shape error for something else to catch; this only screens strings.
    lowered = value.strip().lower()
    for scheme in UNSAFE_URL_PREFIXES:
        if lowered.startswith(scheme):
            raise EdmValidationError(f'{prefix} must not use an unsafe URL scheme ("{scheme}").')


def _validate_font_id(prefix, value):
    if value is None:
        return
    if not isinstance(value, str) or value not in EMAIL_SAFE_FONT_IDS:
        raise EdmValidationError(f'{prefix} must be one of the whitelisted email-safe font ids.')


def _validate_bounded_number(prefix, value, bounds):
    if value is None:
        return
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise EdmValidationError(f'{prefix} must be a number.')
    if value != value or value in (float('inf'), float('-inf')):  # NaN/Infinity
        raise EdmValidationError(f'{prefix} must be a finite number.')
    low, high = bounds
    if value < low or value > high:
        raise EdmValidationError(f'{prefix} must be between {low} and {high}.')


def _validate_enum(prefix, value, allowed):
    if value is None:
        return
    if value not in allowed:
        raise EdmValidationError(f'{prefix} must be one of {sorted(allowed)}.')


def _validate_prop_conventions(prefix, value, depth=0):
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        key_prefix = f'{prefix}.{key}'
        if key.lower().endswith('color'):
            _validate_hex_color(key_prefix, item)
        elif key == 'fontFamily':
            _validate_font_id(key_prefix, item)
        elif key.endswith('Href') or key.endswith('href') or key in URL_KEY_NAMES:
            _validate_safe_url_value(key_prefix, item)
        elif key.lower().endswith('fontsize'):
            _validate_bounded_number(key_prefix, item, FONT_SIZE_BOUNDS)
        elif key.lower().endswith('lineheight'):
            _validate_bounded_number(key_prefix, item, LINE_HEIGHT_BOUNDS)
        elif key.lower().endswith('widthmode'):
            _validate_enum(key_prefix, item, BUTTON_WIDTH_MODES)
        elif key.endswith('Align') or key == 'align':
            _validate_enum(key_prefix, item, HORIZONTAL_ALIGN_VALUES)
        elif key in REPEATABLE_LIST_MAX_LENGTH and isinstance(item, list):
            max_length = REPEATABLE_LIST_MAX_LENGTH[key]
            if len(item) > max_length:
                raise EdmValidationError(f'{key_prefix} must have at most {max_length} items.')
            for index, entry in enumerate(item):
                _validate_prop_conventions(f'{key_prefix}[{index}]', entry, depth + 1)
        elif isinstance(item, dict) and depth < 1:
            _validate_prop_conventions(key_prefix, item, depth + 1)

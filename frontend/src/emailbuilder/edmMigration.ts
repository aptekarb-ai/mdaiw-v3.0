// Backward compatibility for drafts created before the Desktop/Mobile +
// outer-spacing + px/% width architecture. Existing Feature 02/03/04
// documents must keep loading — EDM stays version 1; older module
// settings/props shapes are normalized to the current shape ONCE, at
// load time (see useEmailBuilderState.loadModules callers), so every
// other part of the builder (registry factories, renderer, canvas) can
// assume the current shape everywhere else.
import type {
  ColumnContainerSettings, EmailColumn, EmailDocumentContent, EmailModule, EmailModuleSettings, EmailModuleType,
  ModuleSpacingValues, OuterSpacing, OuterSpacingSides,
} from './edm';
import type { DimensionValue, ResponsiveDimension } from './dimensions';
import { percent, px } from './dimensions';
import { createDefaultOuterSpacing } from './registryCore';
import { createEmptyColumns, isLayoutModuleType } from './layoutModel';
import { generateId } from './idGenerator';
import { DEFAULT_FONT_ID } from './fonts';

// Feature 06 — every new optional prop added this feature, with its
// exact pre-Feature-06 rendered-appearance default (instruction 49/50:
// "avoid undefined-state explosions... old drafts must normalize
// cleanly... rather than destructive migrations"). Shallow, top-level
// keys only; `composite.text` (one level nested) is handled separately
// below since these tables assume a flat prop bag.
const TOP_LEVEL_PROP_DEFAULTS: Partial<Record<EmailModuleType, Record<string, unknown>>> = {
  text: { fontFamily: DEFAULT_FONT_ID, backgroundColor: '', width: { desktop: percent(100) } },
  image: { backgroundColor: '' },
  button: {
    widthMode: 'auto', fixedWidth: 200, borderColor: '', borderWidth: 0, paddingHorizontal: 24, paddingVertical: 12,
  },
  divider: { width: { desktop: percent(100) }, align: 'center' },
  'header-logo-center': { logoHref: '' },
  'header-logo-left': { logoHref: '' },
  'header-logo-nav': { logoHref: '' },
  'header-logo-cta': { logoHref: '' },
  'header-preheader-logo': { logoHref: '' },
  'header-compact': { logoHref: '' },
  'cta-centered': { ctaBackgroundColor: '#76C043', ctaTextColor: '#002D38', secondaryCtaBackgroundColor: '', secondaryCtaTextColor: '#0082AD' },
  'cta-banner': { ctaBackgroundColor: '#76C043', ctaTextColor: '#002D38', secondaryCtaBackgroundColor: '', secondaryCtaTextColor: '#0082AD' },
  'cta-text-cta': { ctaBackgroundColor: '#76C043', ctaTextColor: '#002D38', secondaryCtaBackgroundColor: '', secondaryCtaTextColor: '#0082AD' },
  'cta-dual': { ctaBackgroundColor: '#76C043', ctaTextColor: '#002D38', secondaryCtaBackgroundColor: '', secondaryCtaTextColor: '#0082AD' },
  'product-single': { textAlign: 'left', ctaBackgroundColor: '#0082AD', ctaTextColor: '#FFFFFF' },
  'product-two-cards': { textAlign: 'left', ctaBackgroundColor: '#0082AD', ctaTextColor: '#FFFFFF' },
  'product-three-cards': { textAlign: 'left', ctaBackgroundColor: '#0082AD', ctaTextColor: '#FFFFFF' },
  'product-image-price-cta': { textAlign: 'left', ctaBackgroundColor: '#0082AD', ctaTextColor: '#FFFFFF' },
  'product-grid': { textAlign: 'left', ctaBackgroundColor: '#0082AD', ctaTextColor: '#FFFFFF' },
  'footer-simple-legal': { preferenceText: '', preferenceHref: '' },
  'footer-social-legal': { preferenceText: '', preferenceHref: '' },
  'footer-address-contact': { preferenceText: '', preferenceHref: '' },
  'footer-preference-unsubscribe': { preferenceText: '', preferenceHref: '' },
};

const COMPOSITE_TEXT_DEFAULTS = { fontFamily: DEFAULT_FONT_ID, fontSize: 15, color: '#333333', ctaText: '', ctaHref: '' };
const COMPOSITE_TYPES: EmailModuleType[] = ['image-text', 'text-image'];

function backfillDefaults(type: EmailModuleType, props: Record<string, unknown>): Record<string, unknown> {
  const defaults = TOP_LEVEL_PROP_DEFAULTS[type];
  let next = props;
  if (defaults) {
    const missing: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in next) || next[key] === undefined) missing[key] = value;
    }
    if (Object.keys(missing).length > 0) next = { ...next, ...missing };
  }
  if (COMPOSITE_TYPES.includes(type) && next.text && typeof next.text === 'object') {
    const text = next.text as Record<string, unknown>;
    const missing: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(COMPOSITE_TEXT_DEFAULTS)) {
      if (!(key in text) || text[key] === undefined) missing[key] = value;
    }
    if (Object.keys(missing).length > 0) next = { ...next, text: { ...text, ...missing } };
  }
  return next;
}

// Module types whose top-level props.width was a plain px number before
// this architecture (now ResponsiveDimension).
const TOP_LEVEL_WIDTH_TYPES: EmailModuleType[] = ['image'];

// Module types whose props.image.width was a plain px number before
// (now ResponsiveDimension) — composite + image-bearing content blocks.
const NESTED_IMAGE_WIDTH_TYPES: EmailModuleType[] = [
  'image-text', 'text-image',
  'content-heading-text', 'content-heading-text-cta', 'content-image-left', 'content-image-right',
  'content-image-top', 'content-article-teaser',
];

function upgradeWidth(width: unknown): ResponsiveDimension {
  if (width && typeof width === 'object' && 'desktop' in (width as Record<string, unknown>)) {
    return width as ResponsiveDimension;
  }
  const numeric = typeof width === 'number' ? width : 100;
  return { desktop: { value: numeric, unit: 'px' } };
}

function normalizeProps(type: EmailModuleType, rawProps: Record<string, unknown>): Record<string, unknown> {
  let props = rawProps;
  if (TOP_LEVEL_WIDTH_TYPES.includes(type) && 'width' in props) {
    props = { ...props, width: upgradeWidth(props.width) };
  }
  if (NESTED_IMAGE_WIDTH_TYPES.includes(type) && props.image && typeof props.image === 'object') {
    const image = props.image as Record<string, unknown>;
    if ('width' in image) {
      props = { ...props, image: { ...image, width: upgradeWidth(image.width) } };
    }
  }
  return backfillDefaults(type, props);
}

function asPaddingNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isDimensionValue(value: unknown): value is DimensionValue {
  return Boolean(value) && typeof value === 'object' && 'value' in (value as object) && 'unit' in (value as object);
}

// Upgrades outerSpacing from either of two older shapes into the current
// {desktop:{left,right}, mobile:{left?,right?}} one:
//   - missing entirely (pre-Feature-04.5) -> desktop 0px/0px, no mobile
//   - flat {left,right} (Feature-04.5's first pass) -> becomes desktop,
//     no mobile override
// Already-current shape passes through, backfilling any missing piece.
function upgradeOuterSpacing(raw: unknown): OuterSpacing {
  const value = (raw ?? {}) as Record<string, unknown>;

  if ('desktop' in value || 'mobile' in value) {
    const desktop = (value.desktop ?? {}) as Partial<OuterSpacingSides>;
    return {
      desktop: {
        left: isDimensionValue(desktop.left) ? desktop.left : px(0),
        right: isDimensionValue(desktop.right) ? desktop.right : px(0),
      },
      mobile: (value.mobile ?? {}) as Partial<OuterSpacingSides>,
    };
  }

  if ('left' in value || 'right' in value) {
    return {
      desktop: {
        left: isDimensionValue(value.left) ? value.left : px(0),
        right: isDimensionValue(value.right) ? value.right : px(0),
      },
      mobile: {},
    };
  }

  return createDefaultOuterSpacing();
}

// Feature 05 — columnGutter is new; any pre-Feature-05 document simply
// lacks the key, which upgradeWidth-style logic reads as "no gutter"
// (0px, no gutter <td> emitted — see registryCore.ts's wrapWithOuterSpacing
// docstring for the identical "0 emits nothing" convention). A present
// value is passed through as-is (already the current ResponsiveDimension
// shape — columnGutter didn't exist before this feature, so there is no
// older shape to upgrade from).
function normalizeColumnGutter(raw: unknown): ResponsiveDimension | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (!isDimensionValue(value.desktop)) return undefined;
  const mobile = isDimensionValue(value.mobile) ? value.mobile : undefined;
  return mobile ? { desktop: value.desktop, mobile } : { desktop: value.desktop };
}

const MODULE_VISIBILITY_VALUES = new Set(['all', 'hideMobile', 'hideDesktop']);

// Feature 07 — both new settings keys are optional; absent means the
// module's existing (pre-Feature-07) behavior exactly (visible on both
// viewports, no mobile column gap). No destructive migration/version
// bump needed (instruction 41) — every pre-Feature-07 document simply
// has neither key.
function normalizeVisibility(raw: unknown): EmailModuleSettings['visibility'] {
  return typeof raw === 'string' && MODULE_VISIBILITY_VALUES.has(raw)
    ? (raw as EmailModuleSettings['visibility'])
    : undefined;
}

const LAYOUT_COLUMN_DIRECTION_VALUES = new Set(['ltr', 'rtl']);

// Module-4 Final Gap Closure, Correction 2 (Feature 05) — optional,
// absent means today's exact existing behavior (LTR/identity order). No
// destructive migration/version bump needed, same convention as
// normalizeVisibility above.
function normalizeDesktopColumnDirection(raw: unknown): EmailModuleSettings['desktopColumnDirection'] {
  return typeof raw === 'string' && LAYOUT_COLUMN_DIRECTION_VALUES.has(raw)
    ? (raw as EmailModuleSettings['desktopColumnDirection'])
    : undefined;
}

function normalizeMobileColumnGap(raw: unknown): EmailModuleSettings['mobileColumnGap'] {
  return isDimensionValue(raw) ? raw : undefined;
}

// Sub-phase 6 — same "independent of desktop/mobile-vs-legacy-flat shape"
// convention as visibility/mobileColumnGap above. undefined (not false)
// when absent/invalid, so the conditional spread below omits the key
// entirely rather than persisting an explicit `false` on every module
// that never opted in.
function normalizeOutlookVml(raw: unknown): EmailModuleSettings['outlookVml'] {
  return typeof raw === 'boolean' ? raw : undefined;
}

// Configurable Mobile Gutter Behavior — same "undefined (not a default
// value) when absent/invalid" convention as normalizeOutlookVml above, so
// the conditional spread below omits the key entirely on every
// pre-existing document that never opted out of the default (true =
// hide on mobile, today's exact existing behavior).
function normalizeHideGutterOnMobile(raw: unknown): EmailModuleSettings['hideGutterOnMobile'] {
  return typeof raw === 'boolean' ? raw : undefined;
}

// Independently Configurable Desktop/Mobile Gutter — same "undefined
// when absent/invalid" convention as the normalizers above, so these two
// genuinely independent numeric fields each survive Save + Reload on
// their own (this exact allowlist-drop bug already happened once this
// session for hideGutterOnMobile — see edmMigration.test.ts).
function normalizeGutterPx(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : undefined;
}

function normalizeSettings(rawSettings: unknown): EmailModuleSettings {
  const settings = (rawSettings ?? {}) as Record<string, unknown>;
  const columnGutter = normalizeColumnGutter(settings.columnGutter);
  const mobileColumnOrder = Array.isArray(settings.mobileColumnOrder)
    ? (settings.mobileColumnOrder as number[])
    : undefined;
  // Feature 07 — same "independent of desktop/mobile-vs-legacy-flat
  // shape" convention as columnGutter/mobileColumnOrder above.
  const visibility = normalizeVisibility(settings.visibility);
  const mobileColumnGap = normalizeMobileColumnGap(settings.mobileColumnGap);
  const outlookVml = normalizeOutlookVml(settings.outlookVml);
  const desktopColumnDirection = normalizeDesktopColumnDirection(settings.desktopColumnDirection);
  const hideGutterOnMobile = normalizeHideGutterOnMobile(settings.hideGutterOnMobile);
  const columnGutterPx = normalizeGutterPx(settings.columnGutterPx);
  const mobileColumnGutterPx = normalizeGutterPx(settings.mobileColumnGutterPx);

  if ('desktop' in settings) {
    // Already the current shape — still backfill any field an even-older
    // partially-migrated document might be missing.
    const desktop = (settings.desktop ?? {}) as ModuleSpacingValues;
    return {
      desktop: {
        paddingTop: asPaddingNumber(desktop.paddingTop),
        paddingRight: asPaddingNumber(desktop.paddingRight),
        paddingBottom: asPaddingNumber(desktop.paddingBottom),
        paddingLeft: asPaddingNumber(desktop.paddingLeft),
      },
      mobile: (settings.mobile as Partial<ModuleSpacingValues>) ?? {},
      outerSpacing: upgradeOuterSpacing(settings.outerSpacing),
      mobileOrder: settings.mobileOrder as EmailModuleSettings['mobileOrder'],
      mobileStack: typeof settings.mobileStack === 'boolean' ? settings.mobileStack : true,
      ...(columnGutter ? { columnGutter } : {}),
      ...(mobileColumnOrder ? { mobileColumnOrder } : {}),
      ...(visibility ? { visibility } : {}),
      ...(mobileColumnGap ? { mobileColumnGap } : {}),
      ...(outlookVml !== undefined ? { outlookVml } : {}),
      ...(desktopColumnDirection ? { desktopColumnDirection } : {}),
      ...(hideGutterOnMobile !== undefined ? { hideGutterOnMobile } : {}),
      ...(columnGutterPx !== undefined ? { columnGutterPx } : {}),
      ...(mobileColumnGutterPx !== undefined ? { mobileColumnGutterPx } : {}),
    };
  }

  // Legacy flat shape (Feature 03/04's original {paddingTop, ...}).
  return {
    desktop: {
      paddingTop: asPaddingNumber(settings.paddingTop),
      paddingRight: asPaddingNumber(settings.paddingRight),
      paddingBottom: asPaddingNumber(settings.paddingBottom),
      paddingLeft: asPaddingNumber(settings.paddingLeft),
    },
    mobile: {},
    outerSpacing: upgradeOuterSpacing(settings.outerSpacing),
    mobileOrder: settings.mobileOrder as EmailModuleSettings['mobileOrder'],
    mobileStack: true,
    ...(columnGutter ? { columnGutter } : {}),
    ...(mobileColumnOrder ? { mobileColumnOrder } : {}),
    ...(visibility ? { visibility } : {}),
    ...(mobileColumnGap ? { mobileColumnGap } : {}),
    ...(outlookVml !== undefined ? { outlookVml } : {}),
    ...(desktopColumnDirection ? { desktopColumnDirection } : {}),
    ...(hideGutterOnMobile !== undefined ? { hideGutterOnMobile } : {}),
    ...(columnGutterPx !== undefined ? { columnGutterPx } : {}),
    ...(mobileColumnGutterPx !== undefined ? { mobileColumnGutterPx } : {}),
  };
}

function normalizeColumnSettings(raw: unknown): ColumnContainerSettings {
  const settings = (raw ?? {}) as Record<string, unknown>;
  const desktop = (settings.desktop ?? {}) as ModuleSpacingValues;
  const verticalAlign = settings.verticalAlign;
  return {
    desktop: {
      paddingTop: asPaddingNumber(desktop.paddingTop),
      paddingRight: asPaddingNumber(desktop.paddingRight),
      paddingBottom: asPaddingNumber(desktop.paddingBottom),
      paddingLeft: asPaddingNumber(desktop.paddingLeft),
    },
    mobile: (settings.mobile as Partial<ModuleSpacingValues>) ?? {},
    backgroundColor: typeof settings.backgroundColor === 'string' ? settings.backgroundColor : '',
    verticalAlign: verticalAlign === 'middle' || verticalAlign === 'bottom' ? verticalAlign : 'top',
  };
}

// Feature 05 — builds/backfills a layout module's nested columns[]. Three
// cases: (1) not a layout type at all -> undefined, no columns key ever
// added to non-layout modules; (2) a layout type with columns already
// present (current shape, possibly from an older Feature-05 session) ->
// pass each column through normalizeColumnSettings + recursively
// normalize its nested modules (nesting is exactly one level, so this
// recursion never goes deeper than that — see layoutModel.ts's
// ModulePath docstring); (3) a layout type with NO columns yet (every
// Feature 03/04 document ever saved) -> backward-compat per the brief:
// "old: layout-2-40-60 becomes logically column1=40%, column2=60% with
// empty modules arrays" — build fresh empty columns, one per
// columnWidths entry, entirely at runtime, no destructive DB migration.
function normalizeColumns(type: EmailModuleType, rawColumns: unknown, columnCount: number): EmailColumn[] | undefined {
  if (!isLayoutModuleType(type)) return undefined;

  if (Array.isArray(rawColumns) && rawColumns.length > 0) {
    return rawColumns.map((raw) => {
      const column = (raw ?? {}) as Record<string, unknown>;
      const id = typeof column.id === 'string' && column.id.trim() ? column.id : generateId();
      const nestedModules = Array.isArray(column.modules) ? (column.modules as EmailModule[]) : [];
      return {
        id,
        settings: normalizeColumnSettings(column.settings),
        modules: nestedModules.map(normalizeModule),
      };
    });
  }

  return createEmptyColumns(columnCount);
}

export function normalizeModule(module: EmailModule): EmailModule {
  const props = normalizeProps(module.type, module.props as Record<string, unknown>);
  const columnWidths = Array.isArray((props as { columnWidths?: unknown }).columnWidths)
    ? (props as { columnWidths: number[] }).columnWidths
    : [];
  const columns = normalizeColumns(module.type, module.columns, columnWidths.length);
  return {
    ...module,
    props,
    settings: normalizeSettings(module.settings),
    ...(columns ? { columns } : {}),
  };
}

export function normalizeContent(content: EmailDocumentContent): EmailDocumentContent {
  return { ...content, modules: content.modules.map(normalizeModule) };
}

// Backward compatibility for drafts created before the Desktop/Mobile +
// outer-spacing + px/% width architecture. Existing Feature 02/03/04
// documents must keep loading — EDM stays version 1; older module
// settings/props shapes are normalized to the current shape ONCE, at
// load time (see useEmailBuilderState.loadModules callers), so every
// other part of the builder (registry factories, renderer, canvas) can
// assume the current shape everywhere else.
import type {
  EmailDocumentContent, EmailModule, EmailModuleSettings, EmailModuleType, ModuleSpacingValues, OuterSpacing,
  OuterSpacingSides,
} from './edm';
import type { DimensionValue, ResponsiveDimension } from './dimensions';
import { px } from './dimensions';
import { createDefaultOuterSpacing } from './registryCore';

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

function normalizeProps(type: EmailModuleType, props: Record<string, unknown>): Record<string, unknown> {
  if (TOP_LEVEL_WIDTH_TYPES.includes(type) && 'width' in props) {
    return { ...props, width: upgradeWidth(props.width) };
  }
  if (NESTED_IMAGE_WIDTH_TYPES.includes(type) && props.image && typeof props.image === 'object') {
    const image = props.image as Record<string, unknown>;
    if ('width' in image) {
      return { ...props, image: { ...image, width: upgradeWidth(image.width) } };
    }
  }
  return props;
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

function normalizeSettings(rawSettings: unknown): EmailModuleSettings {
  const settings = (rawSettings ?? {}) as Record<string, unknown>;

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
  };
}

export function normalizeModule(module: EmailModule): EmailModule {
  return {
    ...module,
    props: normalizeProps(module.type, module.props as Record<string, unknown>),
    settings: normalizeSettings(module.settings),
  };
}

export function normalizeContent(content: EmailDocumentContent): EmailDocumentContent {
  return { ...content, modules: content.modules.map(normalizeModule) };
}

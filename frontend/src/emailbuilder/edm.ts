// The Email Document Model (EDM) — a structured, versioned module tree.
// Never raw DOM/HTML. This is the single persisted shape
// (EmailDocument.content on the backend); the table-first HTML renderer
// (htmlRenderer.ts) is a pure function OF this data, never stored itself.

import type { DimensionValue, ResponsiveDimension } from './dimensions';

export type { DimensionUnit, DimensionValue, ResponsiveDimension } from './dimensions';

export type EmailModuleType =
  | 'layout-1col'
  | 'layout-2col-50-50'
  | 'layout-2col-40-60'
  | 'layout-2col-60-40'
  | 'layout-2col-30-70'
  | 'layout-2col-70-30'
  | 'layout-3col'
  | 'layout-4col'
  | 'layout-5col'
  | 'layout-6col'
  | 'text'
  | 'image'
  | 'image-text'
  | 'text-image'
  | 'button'
  | 'divider'
  | 'spacer'
  // Feature 04 — Module Library catalog families. See
  // docs/module-4/03_Implementation_Plan/06_Module_Library_Strategy.md.
  | 'header-logo-center'
  | 'header-logo-left'
  | 'header-logo-nav'
  | 'header-logo-cta'
  | 'header-preheader-logo'
  | 'header-compact'
  | 'hero-image-cta'
  | 'hero-background-image'
  | 'hero-text-only'
  | 'hero-image-left'
  | 'hero-image-right'
  | 'hero-centered-promo'
  | 'content-heading-text'
  | 'content-heading-text-cta'
  | 'content-image-left'
  | 'content-image-right'
  | 'content-image-top'
  | 'content-quote'
  | 'content-article-teaser'
  | 'content-feature-list'
  | 'content-icon-text-rows'
  | 'product-single'
  | 'product-two-cards'
  | 'product-three-cards'
  | 'product-image-price-cta'
  | 'product-grid'
  | 'cta-centered'
  | 'cta-banner'
  | 'cta-text-cta'
  | 'cta-dual'
  | 'social-icon-row'
  | 'social-follow-us'
  | 'footer-simple-legal'
  | 'footer-social-legal'
  | 'footer-address-contact'
  | 'footer-preference-unsubscribe';

export type ModuleCategory = 'layout' | 'header' | 'hero' | 'content' | 'images' | 'products' | 'cta' | 'social' | 'footer';

export type HorizontalAlign = 'left' | 'center' | 'right';

export interface ModuleSpacingValues {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}

export const DEFAULT_SPACING: ModuleSpacingValues = {
  paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
};

export const ZERO_SPACING: ModuleSpacingValues = {
  paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
};

export const MIN_PADDING = 0;
export const MAX_PADDING = 200;

// Left/right OUTER spacing (gutters) — separate from internal content
// padding above. Email-safe: rendered as spacer <td>s around the
// module's own table (see registryCore.ts's wrapWithOuterSpacing),
// never as CSS margin on a div. A side is only emitted in the exported
// HTML when > 0 — no unnecessary spacer cells.
export interface OuterSpacingSides {
  left: DimensionValue;
  right: DimensionValue;
}

// Same desktop/mobile-override shape as padding (see EmailModuleSettings
// below) — desktop is always fully populated, mobile carries only
// explicit per-side overrides.
export interface OuterSpacing {
  desktop: OuterSpacingSides;
  mobile: Partial<OuterSpacingSides>;
}

// desktop = primary/default configuration (also the source of truth for
// today's single static HTML export — see htmlRenderer.ts). mobile
// carries explicit overrides only; any key absent from `mobile` inherits
// the desktop value. This is the data-model foundation Feature 07
// (Responsive Editor) will build a full per-property UI on top of — the
// generated HTML does not yet emit per-viewport CSS from `mobile`.
export interface EmailModuleSettings {
  desktop: ModuleSpacingValues;
  mobile: Partial<ModuleSpacingValues>;
  outerSpacing: OuterSpacing;
  // Composite (image-text/text-image) modules only — which side leads on
  // a narrow/mobile client.
  mobileOrder?: 'image-first' | 'content-first';
  // Layout/composite modules only — whether columns stack to 100% width
  // on mobile (the email-safe default). Feature 07 may expose a control
  // to turn this off for advanced side-by-side-on-mobile layouts.
  mobileStack?: boolean;
  // Layout modules only (Feature 05) — the fixed-px gap between adjacent
  // columns, rendered as a real spacer <td> (never CSS margin/gap) — see
  // registryCore.ts's wrapWithOuterSpacing docstring for why outer
  // spacing uses the identical spacer-<td> technique. px-only (no %) —
  // see docs/module-4 Feature-05 brief section 8. Desktop is the static-
  // HTML-export source of truth, same convention as outerSpacing/padding;
  // `mobile` is an explicit override only, absent = inherits desktop.
  columnGutter?: ResponsiveDimension;
  // Layout modules only (Feature 05) — the order columns are shown in
  // when mobileStack is on, as an array of desktop column indexes (e.g.
  // [1, 0] shows desktop column 2 first). Canvas-preview + data-model
  // only for this feature, same as mobileStack itself — not yet emitted
  // as @media CSS in the static export (Feature 07 scope). Absent/undefined
  // means "desktop order" (identity).
  mobileColumnOrder?: number[];
}

// --- Feature 05 — Layout Builder: nested column content -----------------
// A layout module's per-column container. Column WIDTH is intentionally
// NOT duplicated here — it lives in the layout module's own
// LayoutModuleProps.columnWidths[index] (the existing Feature 03/04
// field), so there is exactly one source of truth for widths whether or
// not nested content exists yet. This column only owns what's genuinely
// per-column: its nested module tree and its own container settings.
export type ColumnVerticalAlign = 'top' | 'middle' | 'bottom';

export interface ColumnContainerSettings {
  desktop: ModuleSpacingValues;
  mobile: Partial<ModuleSpacingValues>;
  backgroundColor: string;
  verticalAlign: ColumnVerticalAlign;
}

export interface EmailColumn {
  id: string;
  modules: EmailModule[];
  settings: ColumnContainerSettings;
}

// Generic over any {desktop, mobile} padding-shaped settings object — both
// EmailModuleSettings (module-level padding) and ColumnContainerSettings
// (Feature 05 — per-column padding) satisfy this shape, so column padding
// reuses the exact same resolver instead of a second copy of the logic.
export function resolveSpacing<T extends { desktop: ModuleSpacingValues; mobile: Partial<ModuleSpacingValues> }>(
  settings: T, viewport: 'desktop' | 'mobile',
): ModuleSpacingValues {
  if (viewport === 'desktop') return settings.desktop;
  return { ...settings.desktop, ...settings.mobile };
}

// True only when the given padding key has an explicit mobile override —
// distinguishes "inherits desktop" from "mobile value happens to match
// desktop" for the Properties panel's inherit/override indicator.
export function isMobileOverridden(settings: EmailModuleSettings, key: keyof ModuleSpacingValues): boolean {
  return key in settings.mobile;
}

// Centralized resolver (instruction: "do not duplicate this logic inside
// module renderers") — the single place that knows how outer spacing
// inherits from desktop to mobile. Desktop always returns the desktop
// pair; mobile returns each side's explicit override where present,
// otherwise that side's desktop value.
export function resolveOuterSpacing(
  settings: EmailModuleSettings, viewport: 'desktop' | 'mobile',
): OuterSpacingSides {
  if (viewport === 'desktop') return settings.outerSpacing.desktop;
  return { ...settings.outerSpacing.desktop, ...settings.outerSpacing.mobile };
}

export function isMobileOuterSpacingOverridden(settings: EmailModuleSettings, side: keyof OuterSpacingSides): boolean {
  return side in settings.outerSpacing.mobile;
}

const ZERO_GUTTER: DimensionValue = { value: 0, unit: 'px' };

// Layout modules only — resolves settings.columnGutter for the given
// viewport, defaulting to 0px (no gutter) when the module has none set at
// all (e.g. a non-layout module, or an older document normalized before
// Feature 05). Desktop is the static-HTML-export source of truth, same
// convention as resolveOuterSpacing/resolveSpacing above.
export function resolveColumnGutter(
  settings: EmailModuleSettings, viewport: 'desktop' | 'mobile',
): DimensionValue {
  const gutter = settings.columnGutter;
  if (!gutter) return ZERO_GUTTER;
  if (viewport === 'mobile' && gutter.mobile) return gutter.mobile;
  return gutter.desktop;
}

export interface EmailModule<Props = Record<string, unknown>> {
  id: string;
  type: EmailModuleType;
  order: number;
  props: Props;
  settings: EmailModuleSettings;
  // Feature 05 — present only on layout-family modules; one EmailColumn
  // per LayoutModuleProps.columnWidths entry (same length, same index
  // order). Undefined for every other module type, and undefined on any
  // module already nested inside a column (nesting is one level deep —
  // layouts cannot contain layouts, see layoutModel.ts's LAYOUT_TYPES).
  columns?: EmailColumn[];
}

export interface EmailDocumentContent {
  version: 1;
  modules: EmailModule[];
}

export function createEmptyContent(): EmailDocumentContent {
  return { version: 1, modules: [] };
}

// --- Per-module prop shapes --------------------------------------------

export interface TextModuleProps {
  text: string;
  align: HorizontalAlign;
  fontSize: number;
  fontWeight: 400 | 700;
  color: string;
  lineHeight: number;
}

export interface ImageModuleProps {
  src: string;
  alt: string;
  width: ResponsiveDimension;
  align: HorizontalAlign;
  href: string;
}

export interface ButtonModuleProps {
  text: string;
  href: string;
  align: HorizontalAlign;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  borderRadius: number;
}

export interface LayoutModuleProps {
  // Percentages, one per column — visual/structural only in Feature 03.
  // Nested per-column content lands with Feature 05 (Layout Builder).
  columnWidths: number[];
}

export interface ImageRef {
  src: string;
  alt: string;
  width: ResponsiveDimension;
}

export interface CompositeModuleProps {
  image: ImageRef;
  text: Pick<TextModuleProps, 'text' | 'align'>;
}

export interface DividerModuleProps {
  color: string;
  thickness: number;
}

export interface SpacerModuleProps {
  height: number;
}

// --- Feature 04 catalog-family prop shapes -----------------------------
// Repeating sub-lists (navLinks/items/platforms) are curated defaults
// only in Feature 04 — per-item editing is Feature 06 (Module Element
// Editor) scope. See registryCore.ts's SchemaField docstring.

export interface NavLink {
  label: string;
  href: string;
}

export interface HeaderModuleProps {
  logoSrc: string;
  logoAlt: string;
  logoWidth: number;
  preheaderText: string;
  navLinks: NavLink[];
  ctaText: string;
  ctaHref: string;
  backgroundColor: string;
  align: HorizontalAlign;
}

export interface HeroModuleProps {
  headline: string;
  subtext: string;
  ctaText: string;
  ctaHref: string;
  imageSrc: string;
  imageAlt: string;
  backgroundColor: string;
  textColor: string;
  align: HorizontalAlign;
}

export interface ContentBlockModuleProps {
  heading: string;
  text: string;
  image: ImageRef;
  ctaText: string;
  ctaHref: string;
  align: HorizontalAlign;
}

export interface QuoteModuleProps {
  quoteText: string;
  authorName: string;
  authorRole: string;
  align: HorizontalAlign;
}

export interface ArticleTeaserModuleProps {
  eyebrow: string;
  heading: string;
  text: string;
  image: ImageRef;
  ctaText: string;
  ctaHref: string;
}

export interface FeatureListItem {
  title: string;
  text: string;
}

export interface FeatureListModuleProps {
  heading: string;
  items: FeatureListItem[];
}

export interface IconTextRow {
  title: string;
  text: string;
}

export interface IconTextRowsModuleProps {
  items: IconTextRow[];
}

export interface ProductItem {
  imageSrc: string;
  imageAlt: string;
  name: string;
  price: string;
  ctaText: string;
  ctaHref: string;
}

export interface ProductGridModuleProps {
  items: ProductItem[];
}

export interface CtaModuleProps {
  heading: string;
  text: string;
  ctaText: string;
  ctaHref: string;
  secondaryCtaText: string;
  secondaryCtaHref: string;
  backgroundColor: string;
  textColor: string;
  align: HorizontalAlign;
}

export interface SocialPlatformLink {
  label: string;
  href: string;
}

export interface SocialModuleProps {
  headingText: string;
  platforms: SocialPlatformLink[];
  align: HorizontalAlign;
}

export interface FooterModuleProps {
  companyName: string;
  address: string;
  legalText: string;
  unsubscribeText: string;
  unsubscribeHref: string;
  socialPlatforms: SocialPlatformLink[];
  align: HorizontalAlign;
}

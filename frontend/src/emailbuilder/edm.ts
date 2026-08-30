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

// Module-4 Final Gap Closure, Correction 2 (Feature 05) — the Desktop
// column display sequence. 'ltr' (or absent) = today's exact existing
// order; 'rtl' = the same columns in reverse visual order. Column
// SEQUENCE only — never text direction, locale, alignment, or a
// mutation of the canonical columns[] array.
export type LayoutColumnDirection = 'ltr' | 'rtl';

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
  // Deprecated — superseded by the independent columnGutterPx/
  // mobileColumnGutterPx pair below. Kept only so an already-normalized
  // document from before that split (this same Feature 05 arc, never
  // shipped to real users) still resolves a sane gutter value — see
  // resolveDesktopGutterPx/resolveMobileGutterPx's legacy fallback. Never
  // written by the UI or the renderer anymore.
  columnGutter?: ResponsiveDimension;
  // Layout modules only — Independently Configurable Desktop/Mobile
  // Gutter. Desktop gutter, in px, always a real fixed-width spacer <td>
  // between adjacent columns (see catalog/layoutCatalog.tsx's
  // resolveColumnPixelWidths call). Undefined = 0 (no gutter), the same
  // default as before this field existed.
  columnGutterPx?: number;
  // Layout modules only — the Mobile gutter, in px, fully INDEPENDENT of
  // columnGutterPx (never derived/defaulted from it, never overwritten
  // by editing the desktop value or vice versa). On Mobile this becomes
  // real VERTICAL spacing between stacked columns (a block-level spacer
  // <td> with an explicit height) — it never participates in Mobile
  // column WIDTH math, which is always a flat 100% regardless of any
  // gutter value (see responsiveStyles.ts's layoutRules). Preserved even
  // while hideGutterOnMobile is true, so unchecking it restores exactly
  // this value — hiding never clears it. Undefined = 0.
  mobileColumnGutterPx?: number;
  // Layout modules only — whether the gutter is rendered as vertical
  // spacing on Mobile at all. true (default) = no vertical gutter,
  // today's original auto-collapse behavior. false = render exactly
  // mobileColumnGutterPx between adjacent stacked columns. Never
  // mutates/resets either gutter value — purely a display toggle.
  // Desktop rendering is completely independent of this setting either
  // way. Undefined = true (backward compatible).
  hideGutterOnMobile?: boolean;
  // Layout modules only (Feature 05) — the order columns are shown in
  // when mobileStack is on, as an array of desktop column indexes (e.g.
  // [1, 0] shows desktop column 2 first). Canvas-preview + data-model
  // only — see MOBILE_COLUMN_ORDER_LIMITATION in responsiveStyles.ts for
  // why true DOM reordering is not emitted in the static export (no
  // flex/grid `order` allowed, and duplicating markup per breakpoint was
  // judged unsafe/unproven for Feature 07's scope). Absent/undefined
  // means "desktop order" (identity).
  mobileColumnOrder?: number[];
  // Module-4 Final Gap Closure, Correction 2 (Feature 05) — layout
  // modules only. Which visual sequence columns render in on Desktop:
  // 'ltr' (or absent/undefined) = column 0, 1, 2... left to right —
  // today's exact existing behavior, so this is purely additive.
  // 'rtl' = the same columns rendered right to left. This is a DISPLAY
  // ORDER only — it never mutates, reverses, or duplicates the
  // canonical `columns[]` array; every renderer resolves the visual
  // sequence at render time (see LayoutCanvasModule.tsx's
  // desktopOrderedIndexes / catalog/layoutCatalog.tsx's renderEmailHtml),
  // keyed back to each column's ORIGINAL index for width/class/valign/
  // background/content, so reversing the sequence can never attach one
  // column's styling or content to another. Unlike mobileColumnOrder,
  // this DOES affect the real exported/rendered HTML (Desktop is
  // already the static-export source of truth) — see
  // MOBILE_COLUMN_ORDER_LIMITATION in responsiveStyles.ts for why an
  // absent mobileColumnOrder means Mobile-stacked order inherits
  // whatever this setting produces on Desktop.
  desktopColumnDirection?: LayoutColumnDirection;
  // Feature 07 — layout modules only. Vertical gap between stacked
  // columns on Mobile (instruction 24), rendered as a real spacer <tr>
  // between stacked column rows — never CSS margin. Undefined/0 means no
  // gap.
  mobileColumnGap?: DimensionValue;
  // Feature 07 — per-module responsive visibility (instruction 10).
  // 'all' (or undefined) is visible on both viewports — the default for
  // every existing module, so this is purely additive/backward-compatible.
  // Desktop is still the STRUCTURAL fallback either way (the module
  // always renders in the base HTML); hiding is layered on top via the
  // responsive <style> block (see responsiveStyles.ts) rather than never
  // rendering the module at all — never deletes it from the EDM.
  visibility?: ModuleVisibility;
  // Feature 14 V3 Sub-phase 6 — when true, renderEmailHtml pairs this
  // module's normal HTML output with a real VML fallback for Classic
  // Outlook (see vml.ts). Only meaningful for module types
  // vml.ts::supportsVmlButtonPattern/supportsVmlBackgroundPattern
  // recognize; every other module type ignores this flag entirely.
  // Undefined/false = today's exact existing behavior (no VML), so this
  // is purely additive.
  outlookVml?: boolean;
}

export type ModuleVisibility = 'all' | 'hideMobile' | 'hideDesktop';

export function resolveVisible(settings: EmailModuleSettings, viewport: 'desktop' | 'mobile'): boolean {
  const visibility = settings.visibility ?? 'all';
  if (viewport === 'mobile') return visibility !== 'hideMobile';
  return visibility !== 'hideDesktop';
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

// Layout modules only — resolves settings.columnGutterPx, defaulting to
// 0 (no gutter) when the module has none set at all (e.g. a non-layout
// module, or a document normalized before this field existed). Falls
// back to the deprecated `columnGutter.desktop` shape only when the new
// field is genuinely absent, so an already-normalized document from
// earlier in this same feature arc still resolves correctly.
export function resolveDesktopGutterPx(settings: EmailModuleSettings): number {
  if (typeof settings.columnGutterPx === 'number') return Math.max(0, Math.round(settings.columnGutterPx));
  const legacy = settings.columnGutter?.desktop;
  return legacy && legacy.unit === 'px' ? Math.max(0, Math.round(legacy.value)) : 0;
}

// Layout modules only — resolves settings.mobileColumnGutterPx. This is
// a genuinely INDEPENDENT value (never derived from columnGutterPx) —
// see EmailModuleSettings.mobileColumnGutterPx's own docstring. Falls
// back to the deprecated `columnGutter.mobile` shape only when the new
// field is absent; otherwise defaults to 0, same convention as the
// desktop resolver above.
export function resolveMobileGutterPx(settings: EmailModuleSettings): number {
  if (typeof settings.mobileColumnGutterPx === 'number') return Math.max(0, Math.round(settings.mobileColumnGutterPx));
  const legacyMobile = settings.columnGutter?.mobile;
  return legacyMobile && legacyMobile.unit === 'px' ? Math.max(0, Math.round(legacyMobile.value)) : 0;
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
  // Feature 06 — a whitelisted EMAIL_SAFE_FONTS id, never raw CSS (see
  // fonts.ts). Optional so pre-Feature-06 drafts normalize to the
  // default rather than requiring a destructive migration.
  fontFamily?: string;
  fontSize: number;
  fontWeight: 400 | 700;
  color: string;
  lineHeight: number;
  // Feature 06 — '' (the normalized default) means "no background",
  // matching every other optional color field's convention in this file.
  backgroundColor?: string;
  // Feature 06 — optional; undefined/omitted behaves exactly as before
  // (fluid, no explicit width attribute/style beyond 100% content flow).
  width?: ResponsiveDimension;
  // Feature 07 — selected responsive typography overrides (instruction
  // 18: "Font size, Line height, Text alignment... where the schema
  // declares them responsive" — Text is the one module family that
  // declares them). Flat `mobileX?` fields, same convention as
  // SpacerModuleProps.mobileHeight; undefined inherits the desktop value.
  mobileFontSize?: number;
  mobileLineHeight?: number;
  mobileAlign?: HorizontalAlign;
}

export interface ImageModuleProps {
  src: string;
  alt: string;
  width: ResponsiveDimension;
  align: HorizontalAlign;
  href: string;
  // Feature 06 — '' means "no background" (transparent).
  backgroundColor?: string;
}

export type ButtonWidthMode = 'auto' | 'fixed' | 'full';

export interface ButtonModuleProps {
  text: string;
  href: string;
  align: HorizontalAlign;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  borderRadius: number;
  // Feature 06 — width/border/padding controls (instruction 15). All
  // optional so pre-Feature-06 drafts normalize to the exact prior
  // rendered appearance (auto width, no border, 12px/24px padding).
  widthMode?: ButtonWidthMode;
  fixedWidth?: number;
  borderColor?: string;
  borderWidth?: number;
  paddingHorizontal?: number;
  paddingVertical?: number;
  // Feature 07 — instruction 29: "Desktop Auto, Mobile Full Width".
  // Undefined inherits the desktop widthMode (no responsive override).
  mobileWidthMode?: ButtonWidthMode;
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

export interface CompositeTextRef {
  text: string;
  align: HorizontalAlign;
  // Feature 06 — optional typography, defaults match the pre-Feature-06
  // rendered appearance exactly (15px, #333333, Arial).
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  // Feature 06 — optional CTA (instruction 21: "CTA text/URL if module
  // includes CTA"). Empty ctaText means no CTA renders, same convention
  // as CtaModuleProps's optional heading/text.
  ctaText?: string;
  ctaHref?: string;
}

export interface CompositeModuleProps {
  image: ImageRef;
  text: CompositeTextRef;
}

export interface DividerModuleProps {
  color: string;
  thickness: number;
  // Feature 06 — instruction 19: "width, alignment". Optional so old
  // drafts normalize to the prior full-width/centered appearance.
  width?: ResponsiveDimension;
  align?: HorizontalAlign;
}

export interface SpacerModuleProps {
  height: number;
  // Feature 06 — instruction 20: "Desktop / Mobile override". Optional;
  // undefined means "inherit the desktop height", same convention as
  // ResponsiveDimension.mobile elsewhere in this file.
  mobileHeight?: number;
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
  // Feature 06 — instruction 25: "Logo Link". '' means the logo renders
  // unlinked, same convention as every other optional href in this file.
  logoHref?: string;
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
  // Feature 06 — instruction 28: "Optional description". '' = omitted
  // from the rendered card, same convention as every optional text field.
  description?: string;
  ctaText: string;
  ctaHref: string;
}

export interface ProductGridModuleProps {
  items: ProductItem[];
  // Feature 06 — instruction 28 Style: "Image width, Text alignment,
  // Colors, CTA style" — applied uniformly across every card in the
  // module (not per-item, to keep the editor to one style section rather
  // than N). Optional; undefined normalizes to the pre-Feature-06
  // hardcoded appearance (#0082AD / #FFFFFF, left-aligned text).
  textAlign?: HorizontalAlign;
  ctaBackgroundColor?: string;
  ctaTextColor?: string;
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
  // Feature 06 — instruction 27: "Button colors". Optional; undefined
  // normalizes to the pre-Feature-06 hardcoded button colors
  // (#76C043/#002D38 primary, transparent/#0082AD secondary outline).
  ctaBackgroundColor?: string;
  ctaTextColor?: string;
  secondaryCtaBackgroundColor?: string;
  secondaryCtaTextColor?: string;
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
  // Feature 06 — instruction 31: "Preference text, Preference URL".
  // Plain editable value fields only — no platform token scripting
  // (that's Feature 10). '' = the preference link is omitted from output.
  preferenceText?: string;
  preferenceHref?: string;
  socialPlatforms: SocialPlatformLink[];
  align: HorizontalAlign;
}

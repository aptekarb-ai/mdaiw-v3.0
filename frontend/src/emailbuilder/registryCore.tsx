import type { ReactNode } from 'react';
import { useState } from 'react';
import type {
  EmailColumn, EmailModule, EmailModuleSettings, EmailModuleType, HorizontalAlign, ModuleCategory,
  ModuleSpacingValues, OuterSpacing, OuterSpacingSides,
} from './edm';
import { DEFAULT_SPACING, resolveOuterSpacing, resolveSpacing, ZERO_SPACING } from './edm';
import type { DimensionValue, PixelBounds } from './dimensions';
import { px, widthCssValue } from './dimensions';
import { escapeAttribute, sanitizeUrl } from './sanitize';
import { estimateColumnVmlContentAllowancePx, renderVmlBackground } from './vmlBackground';

// --- Builder viewport ----------------------------------------------------
// The Desktop/Mobile switch in the builder toolbar. Threaded through the
// canvas and Properties panel so both preview AND edit the viewport-
// specific settings (see edm.ts's resolveSpacing) — not just a scaled
// preview of the same values.
export type BuilderViewMode = 'desktop' | 'mobile';

// --- Module Library metadata (Feature 04) ------------------------------
// This is registry-only metadata — never persisted in the EDM instance
// (EmailModule/EmailDocumentContent). Registry = reusable definition,
// EDM = email-specific instance. Keeping that boundary strict is what
// lets the library scale to hundreds/thousands of definitions without
// bloating every saved document.

// Mirrors emailbuilder/types.ts's EmailPlatform values. Declared locally
// (not imported) to avoid a circular import — edm.ts/registryCore.tsx sit
// below types.ts in the dependency graph.
export type ModulePlatform = 'generic' | 'sfmc' | 'marketo' | 'hubspot' | 'pardot' | 'other';

export type ModuleImagePosition = 'left' | 'right' | 'top' | 'background';

// Feature 14 V2 — the SEMANTIC contract a field's value carries, distinct
// from `kind` (which is only a UI-control-rendering hint). This is what
// the Email AI Engineer's server-side validator dispatches on — a `kind:
// 'url'` field is NOT safe for the AI to set to an arbitrary string
// unless its `valueType` also says so; an `image_asset` field requires
// the asset-ownership-resolution flow (see backend/emailbuilder/
// ai_command.py) instead of accepting a bare URL. Deliberately does NOT
// include a "rich_text"/HTML-formatted value type — no field anywhere in
// this registry carries HTML/markdown-formatted content today, and
// listing an unused category here would misrepresent a capability that
// does not exist.
export type SchemaFieldValueType =
  | 'text' | 'number' | 'color' | 'url' | 'image_asset' | 'boolean' | 'select' | 'align' | 'font';

// A single scalar-leaf field a module's Properties panel can edit
// generically (propertyEditor: 'schema'), OR — as of Feature 14 V2 — a
// field a bespoke-editor module type (propertyEditor: 'text'/'image'/
// 'button'/'basic'/'composite') additionally declares here purely as AI/
// capability-manifest metadata, without changing which component renders
// its Properties-panel UI. One level of nesting is supported via a dot
// path (e.g. 'image.src'). Repeating list fields (nav links, product
// items, social platforms, feature rows) are intentionally NOT
// schema-editable — item-by-item list editing (manual UI: Feature 06;
// AI: deferred to a future phase, see Feature 14 V2's Phase A report) —
// modules ship these with curated, sensible defaults instead.
export interface SchemaField {
  key: string;
  label: string;
  // Feature 06 additions: 'select' (a closed enum — pass `options`),
  // 'align' (the shared left/center/right control), 'toggle' (boolean
  // checkbox), 'font' (the EMAIL_SAFE_FONTS whitelist select).
  kind: 'text' | 'textarea' | 'url' | 'color' | 'number' | 'select' | 'align' | 'toggle' | 'font';
  group: 'content' | 'style';
  // Required when kind === 'select'; ignored otherwise.
  options?: { value: string; label: string }[];
  // Feature 14 V2 — semantic value contract for the AI/capability-
  // manifest layer. Optional: when omitted, the manifest generator
  // infers it from `kind` (see moduleCapabilities.ts's inferValueType).
  // MUST be set explicitly (never inferred) on any field whose value is
  // a real image/asset URL — see the module-level docstring above and
  // moduleCapabilities.ts's hand-reviewed image_asset audit.
  valueType?: SchemaFieldValueType;
  // Optional bounds the AI layer enforces for 'number' fields (ignored
  // for every other valueType). Mirrors what
  // backend/emailbuilder/ai_command.py's INT_PROP_RANGES hand-maintained
  // today; Feature 14 V2 moves this into the registry itself so it's
  // derived from the manifest instead of duplicated in Python.
  min?: number;
  max?: number;
}

// Feature 06 — see ModuleDefinition.repeatableField's docstring.
export interface RepeatableFieldConfig<Item> {
  path: string;
  group: 'content' | 'style';
  label: string;
  itemLabel: (item: Item, index: number) => string;
  createItem: () => Item;
  renderItemFields: (item: Item, update: (patch: Partial<Item>) => void) => ReactNode;
  minItems?: number;
  maxItems?: number;
  addLabel?: string;
  // Feature 14 V3 Sub-phase 6, work package E — the JSON-serializable
  // per-item field contract the Email AI Engineer's capability manifest
  // needs to validate add/update operations item-by-item (see
  // moduleCapabilities.ts's buildModuleCapabilityManifest and
  // ai_command.py's UPDATE_REPEATABLE_FIELD). Deliberately a SEPARATE
  // declaration from renderItemFields (a React render function, never
  // JSON-serializable) rather than trying to derive one from the other —
  // every field here must correspond to a real key `createItem()`/
  // `renderItemFields` already handles.
  itemSchema: SchemaField[];
}

// A module definition owns everything the builder needs for one module
// type: how to create it, how to preview it on the (React/div) canvas,
// how to export it as table-first email HTML, and (Feature 04) the
// searchable/filterable metadata the Module Library browses by.
// `renderPreview` takes an optional viewport so layout/composite modules
// can show mobile-stacked behaviour in the canvas; modules that don't
// care about viewport simply ignore the second argument (a function
// `(module) => X` is a valid `(module, viewport?) => X`).
export interface ModuleDefinition<Props = Record<string, unknown>> {
  type: EmailModuleType;
  label: string;
  category: ModuleCategory;
  icon: string;
  description: string;
  tags: string[];
  keywords: string[];
  columnCount: number | null;
  imagePosition: ModuleImagePosition | null;
  platformCompatibility: ModulePlatform[];
  propertyEditor: 'text' | 'image' | 'button' | 'composite' | 'basic' | 'schema';
  editableFields?: SchemaField[];
  // Feature 06 — declarative repeatable-list editing (instruction 1:
  // schema-driven, not a growing switch). Used by any module whose props
  // contain a bounded user-editable array (header nav links, social/
  // footer platform links, product cards) — one shared
  // RepeatableItemEditor renders it, keyed off `path` (dot path into
  // props, one level, matching SchemaField's own path convention).
  // `any` here mirrors AnyModuleDefinition's existing heterogeneity —
  // each definition supplies its own item shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repeatableField?: RepeatableFieldConfig<any>;
  createDefaultProps: () => Props;
  createDefaultSettings: () => EmailModuleSettings;
  // Layout-family definitions only (Feature 05) — one EmailColumn per
  // createDefaultProps().columnWidths entry. Absent for every other
  // module type; moduleFactory.ts only calls this when present.
  createDefaultColumns?: () => EmailColumn[];
  // Feature 14 V3 Sub-phase 6 closure — capability metadata for the
  // shared bulletproof-VML renderer (vml.ts). Set explicitly, once, at
  // the module DEFINITION that genuinely renders a clickable CTA/button
  // (real background fill or border, padding, corner radius — never a
  // plain text/nav/social link) or a real CSS background-image — never
  // inferred from the type name. This is the single source of truth
  // vml.ts's supportsVmlButtonPattern/supportsVmlBackgroundPattern read
  // through the registry resolver; a module NOT listed here is never
  // VML-wrapped, no matter what its settings say.
  supportsBulletproofCta?: boolean;
  supportsBulletproofBackground?: boolean;
  renderPreview: (module: EmailModule<Props>, viewport?: BuilderViewMode) => ReactNode;
  // Column Width + Gutter Rendering Correction — `availableWidthPx` is the
  // actual pixel width of THIS module's immediate parent container (the
  // document width at top level, narrowed by any px/%-valued outer
  // spacing already applied above it — see renderModuleWithOuterStructure
  // below). Optional because only catalog/layoutCatalog.tsx's layout
  // definitions actually use it (for gutter-aware column pixel math);
  // every other module definition safely ignores the extra argument, and
  // existing tests that call a non-layout definition's renderEmailHtml
  // directly (bypassing the centralized entry point below, where a real
  // value is always supplied) keep working unchanged.
  renderEmailHtml: (module: EmailModule<Props>, availableWidthPx?: number) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry is intentionally heterogeneous (each entry has its own Props shape); callers narrow via getModuleDefinition() + a type-specific cast where they need one.
export type AnyModuleDefinition = ModuleDefinition<any>;

// --- Nested-module render resolver (Feature 05) --------------------------
// catalog/layoutCatalog.tsx's renderEmailHtml needs to render each nested
// column module using ITS OWN definition's renderEmailHtml — the exact
// same table-first contract every top-level module already uses (no
// div-wrapping special case for nested content). It cannot import
// moduleRegistry.tsx directly to look that up: moduleRegistry.tsx imports
// every catalog/*.tsx file (including layoutCatalog.tsx), so the reverse
// import would be circular.
//
// Dependency injection breaks the cycle: moduleRegistry.tsx registers its
// own getModuleDefinition as the resolver once, at its own module-eval
// time (see moduleRegistry.tsx's bottom). By the time any renderEmailHtml
// actually RUNS (a later event, never during module evaluation), the
// resolver is always already registered — catalog files never call this
// during their own top-level evaluation, only inside functions.
type ModuleDefinitionResolver = (type: EmailModuleType) => AnyModuleDefinition | undefined;

let moduleDefinitionResolver: ModuleDefinitionResolver = () => undefined;

export function registerModuleDefinitionResolver(resolver: ModuleDefinitionResolver): void {
  moduleDefinitionResolver = resolver;
}

export function resolveModuleDefinition(type: EmailModuleType): AnyModuleDefinition | undefined {
  return moduleDefinitionResolver(type);
}

// All Feature-04 built-in modules are Generic-compatible first (rule #22
// in the feature brief) — platform-specific scripting is a later
// platform-adapter feature, not implemented here.
export const GENERIC_ONLY: ModulePlatform[] = ['generic'];

// --- Responsive settings / outer spacing — centralized factories -------
// Every catalog family calls these instead of hand-building its own
// settings object, so all 53+ built-ins pick up the desktop/mobile split
// and outer-spacing shape uniformly (one place to change, not 53).

export const DEFAULT_OUTER_SPACING: OuterSpacing = { desktop: { left: px(0), right: px(0) }, mobile: {} };

export function createDefaultOuterSpacing(): OuterSpacing {
  return { desktop: { left: px(0), right: px(0) }, mobile: {} };
}

export function createResponsiveSettings(
  desktop: ModuleSpacingValues = DEFAULT_SPACING,
  extra?: Partial<Pick<EmailModuleSettings, 'mobileOrder' | 'mobileStack'>>,
): EmailModuleSettings {
  return {
    desktop: { ...desktop },
    mobile: {},
    outerSpacing: createDefaultOuterSpacing(),
    ...extra,
  };
}

export { DEFAULT_SPACING, ZERO_SPACING };

// Property-specific px bounds (instruction: never one universal pixel
// range for every property).
export const PADDING_PX_BOUNDS: PixelBounds = { pxMin: 0, pxMax: 200 };
export const OUTER_SPACING_PX_BOUNDS: PixelBounds = { pxMin: 0, pxMax: 200 };
export const IMAGE_WIDTH_PX_BOUNDS: PixelBounds = { pxMin: 1, pxMax: 1200 };

export function paddingStyle(spacing: ModuleSpacingValues): string {
  return `padding:${spacing.paddingTop}px ${spacing.paddingRight}px ${spacing.paddingBottom}px ${spacing.paddingLeft}px;`;
}

export interface CellAttrs {
  // Emits an explicit HTML `width` attribute alongside the CSS width
  // already carried in `extraStyle` — belt-and-suspenders for older/
  // partial email-client CSS support, same convention already used by
  // the Image module's own <img width="..." style="width:..."> pairing.
  width?: string;
  // Feature 06 (instruction 10) — pairs with an inline background-color
  // in `extraStyle`; the `bgcolor` HTML attribute is honored by clients
  // that ignore or strip inline background-color CSS.
  bgcolor?: string;
}

export function cell(content: string, extraStyle = '', attrs: CellAttrs = {}): string {
  const widthPart = attrs.width !== undefined ? ` width="${attrs.width}"` : '';
  const bgcolorPart = attrs.bgcolor ? ` bgcolor="${attrs.bgcolor}"` : '';
  return `<td${widthPart}${bgcolorPart} style="${extraStyle}">${content}</td>`;
}

export function multiCell(cellsHtml: string[]): string {
  return `<tr>${cellsHtml.join('')}</tr>`;
}

// Every module's exported HTML is one presentation table — table-first,
// no structural divs, per the Module-4 email HTML rules.
export function moduleTable(innerRowsHtml: string): string {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + innerRowsHtml
    + '</table>'
  );
}

export function moduleTableRow(innerRowHtml: string): string {
  return moduleTable(`<tr>${innerRowHtml}</tr>`);
}

// Stacked text lines (headings, paragraphs) in generated email HTML use
// this instead of <p>/<h1>-<h6> — those carry inconsistent browser/
// email-client default margins that would otherwise need a `margin:0`
// reset, and generated email HTML must never contain a `margin`
// declaration at all (spacing is TD padding or spacer cells only, never
// CSS margin — see wrapWithOuterSpacing above for the outer-spacer
// case). A <span> has no default margin, so `display:block` is enough
// on its own; `gapBelow` becomes this line's own padding-bottom instead
// of a trailing margin on the block before it.
export function textLine(content: string, style = '', gapBelow = 0): string {
  const gap = gapBelow > 0 ? `padding-bottom:${gapBelow}px;` : '';
  return `<span style="display:block; ${gap}${style}">${content}</span>`;
}

// Every module ALWAYS renders through this standard outer module table —
// see renderModuleWithOuterStructure below, the single per-module call
// site (used for both top-level modules and modules nested inside a
// Layout column). The outer table exists even at Left=0/Right=0 (a
// single content <td>, no spacer <td>s) — every module has the SAME
// structural contract (OUTER TABLE > TR > optional left spacer TD,
// required content TD, optional right spacer TD), not "wrapped only if
// spacing is non-zero". Email-safe: spacer <td>s in a nested
// presentation table, never CSS margin on a div. Takes an
// already-resolved {left,right} pair — callers resolve the viewport via
// edm.ts::resolveOuterSpacing first, so this stays viewport-agnostic.
// Feature 07 — optional, purely additive. `mobileOuterSpacing` only
// widens WHICH sides get a spacer <td> in the base (Desktop) HTML — a
// side that is 0 on Desktop but > 0 on Mobile still needs a real <td> in
// the DOM (at 0 width on Desktop) for the responsive <style> block to be
// able to widen it later; it never changes the Desktop-rendered WIDTH
// itself. `className` (from responsiveStyles.ts's moduleResponsiveClassName)
// tags the table/cells so the responsive generator can target this exact
// module instance; omitted when the module needs no responsive rules at
// all, keeping the base HTML byte-identical to pre-Feature-07 output.
export interface WrapOuterSpacingOptions {
  mobileOuterSpacing?: OuterSpacingSides;
  className?: string;
}

export function wrapWithOuterSpacing(
  bodyHtml: string, outerSpacing: OuterSpacingSides | undefined, options: WrapOuterSpacingOptions = {},
): string {
  const left = outerSpacing?.left;
  const right = outerSpacing?.right;
  const mobileLeft = options.mobileOuterSpacing?.left;
  const mobileRight = options.mobileOuterSpacing?.right;
  const leftActive = Boolean(left && left.value > 0) || Boolean(mobileLeft && mobileLeft.value > 0);
  const rightActive = Boolean(right && right.value > 0) || Boolean(mobileRight && mobileRight.value > 0);
  // class is appended AFTER the existing attributes (never inserted
  // before them) so the literal outer-table-open prefix used throughout
  // the test suite/tooling (`<table role="presentation" width="100%"
  // cellpadding="0" cellspacing="0" border="0"><tr>`) stays byte-identical
  // whether or not a className is present — adding responsive classes
  // must never change how existing structural checks locate this table.
  const cls = options.className;
  const classAttr = (suffix: string) => (cls ? ` class="${cls}${suffix}"` : '');

  const spacerCell = (dimension: DimensionValue | undefined, suffix: string) => {
    const resolved = dimension ?? { value: 0, unit: 'px' as const };
    const widthValue = resolved.unit === '%' ? `${resolved.value}%` : String(Math.round(resolved.value));
    return `<td width="${widthValue}"${classAttr(suffix)} style="width:${widthCssValue(resolved)}; font-size:0; line-height:0;">&nbsp;</td>`;
  };

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${classAttr('')}><tr>`
    + (leftActive ? spacerCell(left, '-l') : '')
    + `<td${classAttr('-c')}>${bodyHtml}</td>`
    + (rightActive ? spacerCell(right, '-r') : '')
    + '</tr></table>'
  );
}

// The single centralized "outer module structure" entry point (feature
// spec: "Do NOT manually implement this in all 53 module renderers").
// Every module — top-level (htmlRenderer.ts) or nested inside a Layout
// column (layoutCatalog.tsx) — is rendered through THIS function, never
// by calling definition.renderEmailHtml directly. It resolves the
// module's own outer-spacer settings and wraps its (unmodified) internal
// content HTML with wrapWithOuterSpacing — the module definition itself
// only ever renders its internal content and never has to know about
// outer spacer columns. Desktop is the resolution source of truth here,
// same convention as every other Desktop/Mobile property in the static
// HTML export (see edm.ts's EmailModuleSettings docstring).
// Feature 07 — deterministic, safe CSS class for one module instance
// (instruction 6: "do not expose raw database/module IDs directly if
// unsafe characters are possible"). Strips everything but letters/digits
// from the id and prefixes with a letter so the class is always a valid
// CSS identifier even if the id itself started with a digit (e.g. a raw
// UUID). Renderer metadata only — never persisted, never the EDM source
// of truth (see responsiveStyles.ts).
export function moduleResponsiveClassName(moduleId: string): string {
  return `m-eb-${moduleId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

// Column Width + Gutter Rendering Correction — the pixel width actually
// available to a module's OWN content, after this module's own outer
// spacer columns (left/right) are subtracted from its immediate parent's
// width. Handles both px-valued sides (fixed subtraction) and %-valued
// sides (proportional subtraction) — "immediate parent width" must stay
// accurate whichever unit outer spacing happens to use, since a layout
// module's own column/gutter pixel math (see catalog/layoutCatalog.tsx)
// depends on it being correct, not just approximate.
// Column Width Display + Responsive Gutter UI Correction — exported so
// computeLayoutAvailableWidthPx (below) and the Properties panel can
// compute the EXACT SAME "available width" the real renderer uses for a
// layout module's own column/gutter math, rather than a second, UI-only
// approximation.
export function narrowWidthByOuterSpacing(widthPx: number, outerSpacing: OuterSpacingSides): number {
  const sideReduction = (side: DimensionValue): number => {
    if (side.value <= 0) return 0;
    return side.unit === 'px' ? side.value : (widthPx * side.value) / 100;
  };
  const reduced = widthPx - sideReduction(outerSpacing.left) - sideReduction(outerSpacing.right);
  return Math.max(0, Math.round(reduced));
}

// Column Width Display + Responsive Gutter UI Correction, extended by the
// Structural Width Contract correction — the single function the
// Properties panel calls to learn a top-level layout module's real
// available pixel width for COLUMN/GUTTER math (the "C" content-region
// value in the width contract: P = document width narrowed by this
// module's own Outer Spacer Columns, exactly what
// renderModuleWithOuterStructure computes right before calling
// definition.renderEmailHtml; C = P minus this SAME module's own
// Desktop Internal Padding left/right). layoutCatalog.tsx's renderEmailHtml
// performs the identical P -> C step itself (it receives P as its
// `availableWidthPx` argument, then subtracts its own padding before
// calling resolveColumnPixelWidths) — this function exists so the
// Properties panel arrives at the exact same C without a second,
// independent calculation, never diverging from what the renderer
// actually produces. A layout module is always top-level in this
// architecture (a layout can never nest inside another layout's column —
// see layoutModel.ts's isLayoutModuleType/one-level-nesting guarantee),
// so "immediate parent width" for a layout is always documentWidthPx
// narrowed this same way, never a deeper recursive case.
export function computeLayoutAvailableWidthPx(module: EmailModule, documentWidthPx: number): number {
  const parentWidthPx = narrowWidthByOuterSpacing(documentWidthPx, resolveOuterSpacing(module.settings, 'desktop'));
  const layoutSpacing = resolveSpacing(module.settings, 'desktop');
  return Math.max(0, parentWidthPx - layoutSpacing.paddingLeft - layoutSpacing.paddingRight);
}

// Structural Width Contract — Layout Background scope correction. The
// Layout/Parent Background (module.settings.backgroundColor/
// backgroundImage — currently only exposed in the UI for layout modules,
// but read generically here so every other module type, which never has
// these fields set, is completely unaffected) covers the FULL physical
// module row — left Outer Spacer Column, central structure (padding +
// columns + gutters), right Outer Spacer Column — never just the central
// region. This is why the wrap happens HERE, around the ALREADY
// Outer-Spacer-wrapped `spacedHtml` (wrapWithOuterSpacing's own output),
// using the FULL `availableWidthPx` (before this module's own outer
// spacing narrows it) — not inside layoutCatalog.tsx's renderEmailHtml,
// which only ever sees the narrowed inner width and could never reach
// the spacer <td>s at all. One outer wrapper owns the paint, per the
// contract ("do not duplicate the same background independently onto
// left/right spacer TDs") — the spacer <td>s themselves stay exactly as
// wrapWithOuterSpacing already emits them (transparent), and simply show
// this wrapper's background through, the same way a child column's own
// background (set independently, unaffected by this) overlays it inside
// that column only. Skipped entirely (byte-identical output) when
// neither field is set — the overwhelming default case for every module.
function wrapWithModuleBackground(spacedHtml: string, module: EmailModule, fullWidthPx: number): string {
  const backgroundColor = module.settings.backgroundColor;
  const safeBackgroundImageUrl = module.settings.backgroundImage
    ? escapeAttribute(sanitizeUrl(module.settings.backgroundImage))
    : '';
  if (!backgroundColor && !safeBackgroundImageUrl) return spacedHtml;

  const backgroundCss = (
    (backgroundColor ? `background-color:${backgroundColor};` : '')
    + (safeBackgroundImageUrl ? `background-image:url('${safeBackgroundImageUrl}'); background-size:cover; background-position:center;` : '')
  );
  const backgroundAttr = safeBackgroundImageUrl ? ` background="${safeBackgroundImageUrl}"` : '';
  const bgcolorAttr = backgroundColor ? ` bgcolor="${backgroundColor}"` : '';

  let inner = spacedHtml;
  // Classic Outlook VML fallback for the FULL parent/layout background —
  // reused via the SAME renderVmlBackground function every other
  // background-image VML fallback in the app uses (Hero, per-column
  // backgrounds) — never a second VML engine. Sized to fullWidthPx (the
  // FULL parent/layout background region, including Outer Spacer
  // Columns) — never the narrowed central-structure width.
  if (safeBackgroundImageUrl && module.settings.outlookVml) {
    inner = renderVmlBackground(
      {
        imageSrc: module.settings.backgroundImage!,
        backgroundColor: backgroundColor ?? '',
        paddingTop: 0,
        paddingBottom: 0,
        contentAllowancePx: estimateColumnVmlContentAllowancePx(module.columns?.length ?? 1),
      },
      fullWidthPx,
      inner,
    );
  }

  return moduleTableRow(
    `<td width="${fullWidthPx}"${bgcolorAttr}${backgroundAttr} style="width:${fullWidthPx}px; ${backgroundCss}">${inner}</td>`,
  );
}

export function renderModuleWithOuterStructure(module: EmailModule, availableWidthPx: number): string {
  const definition = resolveModuleDefinition(module.type);
  if (!definition) return '';
  const resolvedOuterSpacing = resolveOuterSpacing(module.settings, 'desktop');
  const mobileOuterSpacing = resolveOuterSpacing(module.settings, 'mobile');
  const innerWidthPx = narrowWidthByOuterSpacing(availableWidthPx, resolvedOuterSpacing);
  const spacedHtml = wrapWithOuterSpacing(definition.renderEmailHtml(module, innerWidthPx), resolvedOuterSpacing, {
    mobileOuterSpacing,
    className: moduleResponsiveClassName(module.id),
  });
  return wrapWithModuleBackground(spacedHtml, module, availableWidthPx);
}

// --- Sub-phase 3, items 7/8 — deterministic module HTML comments -------
//
// The ONE place that owns the `<!--===== MODULE-... =====-->` comment
// syntax — htmlRenderer.ts (top-level modules) and catalog/
// layoutCatalog.tsx (nested modules, one column-level deep — the only
// nesting depth this architecture supports, see layoutModel.test.ts's
// "layouts cannot nest inside a layout column" coverage) both call this
// rather than hand-formatting the comment independently. Numbers are
// always computed fresh at render time from the CURRENT sorted render
// order — never read from persisted module data, so duplicating/
// deleting/reordering modules always renumbers correctly with zero
// stale-metadata risk (there is no metadata to go stale).
export function wrapModuleComment(html: string, numberAndLabel: string): string {
  return (
    `<!--===== MODULE-${numberAndLabel} - START =====-->\n`
    + `${html}\n`
    + `<!--===== MODULE-${numberAndLabel} - ENDS =====-->\n`
  );
}

// A nested module (rendered inside catalog/layoutCatalog.tsx, which has
// no way to know its OWN parent layout's top-level render-order number)
// is wrapped with this literal placeholder in place of the parent
// number; htmlRenderer.ts resolves it to the real number once it knows
// which top-level slot the layout itself occupies — see
// resolveNestedModuleParentPlaceholder below. Safe as a plain string
// search/replace: every module's text content is HTML-escaped before it
// ever reaches this string (escapeHtml turns `<` into `&lt;`), so the
// literal, UNescaped sequence "MODULE-__PARENT__." can only ever have
// been produced by this exact code path — never by user-entered module
// content — making a global replace collision-proof.
export const NESTED_MODULE_PARENT_PLACEHOLDER = '__PARENT__';

export function resolveNestedModuleParentPlaceholder(html: string, parentNumber: string): string {
  return html.split(`MODULE-${NESTED_MODULE_PARENT_PLACEHOLDER}.`).join(`MODULE-${parentNumber}.`);
}

// Builder-canvas-only: shown whenever no image URL is set yet, or the
// given URL fails to load — a polished placeholder instead of the
// browser's native broken-image icon. Never affects the exported email
// HTML, which always uses a real <img src alt> pair (see sanitize.ts).
export function ImagePreview({ src, alt, width, align }: {
  src: string; alt: string; width: DimensionValue; align: HorizontalAlign;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="email-canvas__image-placeholder" style={{ textAlign: align }}>
        <span className="mdaiw-icon mdaiw-icon--camera" aria-hidden="true" />
        <span className="email-canvas__image-placeholder-label">Image</span>
        <span className="email-canvas__image-placeholder-hint">Add an image URL from Properties</span>
      </div>
    );
  }

  return (
    <div style={{ textAlign: align }}>
      <img
        src={src}
        alt={alt}
        style={{ maxWidth: '100%', width: widthCssValue(width), height: 'auto', display: 'inline-block' }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

// One level of nesting only — matches SchemaField's documented scope.
export function setPath(source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) {
    return { ...source, [head]: value };
  }
  const nested = (source[head] && typeof source[head] === 'object') ? source[head] as Record<string, unknown> : {};
  return { ...source, [head]: { ...nested, [rest.join('.')]: value } };
}

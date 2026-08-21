import type { ReactNode } from 'react';
import { useState } from 'react';
import type {
  EmailColumn, EmailModule, EmailModuleSettings, EmailModuleType, HorizontalAlign, ModuleCategory,
  ModuleSpacingValues, OuterSpacing, OuterSpacingSides,
} from './edm';
import { DEFAULT_SPACING, resolveOuterSpacing, ZERO_SPACING } from './edm';
import type { DimensionValue, PixelBounds } from './dimensions';
import { px, widthCssValue } from './dimensions';

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

// A single scalar-leaf field a module's Properties panel can edit
// generically (propertyEditor: 'schema'). One level of nesting is
// supported via a dot path (e.g. 'image.src'). Repeating list fields
// (nav links, product items, social platforms, feature rows) are
// intentionally NOT schema-editable in Feature 04 — item-by-item list
// editing is Feature 06 (Module Element Editor) territory; Feature 04
// ships these modules with curated, sensible defaults instead.
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
  renderPreview: (module: EmailModule<Props>, viewport?: BuilderViewMode) => ReactNode;
  renderEmailHtml: (module: EmailModule<Props>) => string;
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

export function renderModuleWithOuterStructure(module: EmailModule): string {
  const definition = resolveModuleDefinition(module.type);
  if (!definition) return '';
  const resolvedOuterSpacing = resolveOuterSpacing(module.settings, 'desktop');
  const mobileOuterSpacing = resolveOuterSpacing(module.settings, 'mobile');
  return wrapWithOuterSpacing(definition.renderEmailHtml(module), resolvedOuterSpacing, {
    mobileOuterSpacing,
    className: moduleResponsiveClassName(module.id),
  });
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

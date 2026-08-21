import type { ReactNode } from 'react';
import { useState } from 'react';
import type {
  EmailModule, EmailModuleSettings, EmailModuleType, HorizontalAlign, ModuleCategory,
  ModuleSpacingValues, OuterSpacing, OuterSpacingSides,
} from './edm';
import { DEFAULT_SPACING, ZERO_SPACING } from './edm';
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
  kind: 'text' | 'textarea' | 'url' | 'color' | 'number';
  group: 'content' | 'style';
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
  createDefaultProps: () => Props;
  createDefaultSettings: () => EmailModuleSettings;
  renderPreview: (module: EmailModule<Props>, viewport?: BuilderViewMode) => ReactNode;
  renderEmailHtml: (module: EmailModule<Props>) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry is intentionally heterogeneous (each entry has its own Props shape); callers narrow via getModuleDefinition() + a type-specific cast where they need one.
export type AnyModuleDefinition = ModuleDefinition<any>;

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

export function cell(content: string, extraStyle = ''): string {
  return `<td style="${extraStyle}">${content}</td>`;
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

// Left/right OUTER spacing (gutters), applied once, uniformly, around
// EVERY module's own HTML — see htmlRenderer.ts::renderEmailBody, the
// single call site. Email-safe: spacer <td>s in a nested presentation
// table, never CSS margin on a div. A side with value 0 emits no cell at
// all (no unnecessary spacer markup). Takes an already-resolved
// {left,right} pair — callers resolve the viewport via
// edm.ts::resolveOuterSpacing first, so this stays viewport-agnostic.
export function wrapWithOuterSpacing(bodyHtml: string, outerSpacing: OuterSpacingSides | undefined): string {
  const left = outerSpacing?.left;
  const right = outerSpacing?.right;
  const leftActive = Boolean(left && left.value > 0);
  const rightActive = Boolean(right && right.value > 0);
  if (!leftActive && !rightActive) return bodyHtml;

  const spacerCell = (dimension: DimensionValue) => {
    const widthValue = dimension.unit === '%' ? `${dimension.value}%` : String(Math.round(dimension.value));
    return `<td width="${widthValue}" style="width:${widthCssValue(dimension)}; font-size:0; line-height:0;">&nbsp;</td>`;
  };

  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + (leftActive ? spacerCell(left as DimensionValue) : '')
    + `<td>${bodyHtml}</td>`
    + (rightActive ? spacerCell(right as DimensionValue) : '')
    + '</tr></table>'
  );
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

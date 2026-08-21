// Feature 07 — the ONE centralized responsive-email stylesheet generator
// (instruction 4: "Do NOT put responsive logic separately into 53
// renderers"). Walks the actual EmailDocumentContent (top-level modules,
// nested-in-column modules, and layout columns/gutters) and emits ONLY
// the CSS rules a module genuinely needs — never a blanket per-module
// stylesheet regardless of whether anything differs between viewports
// (instruction 43/44).
//
// Technique: every module already carries a deterministic class from
// registryCore.ts's wrapWithOuterSpacing (moduleResponsiveClassName) on
// its outer table (`m-eb-ID`), content <td> (`m-eb-ID-c`), and any
// spacer <td>s (`m-eb-ID-l`/`m-eb-ID-r`). Properties that live INSIDE a
// module's own internal markup (padding, Text typography, Image/Text
// width) are reached via an attribute-contains selector matching the
// EXACT inline style declaration the module's own renderEmailHtml would
// produce for the DESKTOP value — computed here with the SAME shared
// formatting helpers the renderers use (paddingStyle/widthCssValue), so
// the match is correct by construction, not by parsing rendered HTML.
// This means zero of the 53 module-family renderers need to know
// anything about responsive CSS.
import type {
  ButtonModuleProps, ButtonWidthMode, EmailColumn, EmailDocumentContent, EmailModule, ImageModuleProps,
  SpacerModuleProps, TextModuleProps,
} from './edm';
import { resolveOuterSpacing, resolveSpacing, resolveVisible } from './edm';
import { percent, resolveDimension, widthCssValue, type DimensionValue, type ResponsiveDimension } from './dimensions';
import { moduleResponsiveClassName, paddingStyle } from './registryCore';

// Recommended standard email breakpoint (instruction 5) — centralized so
// it is never scattered/hard-coded across renderers.
export const MOBILE_BREAKPOINT_PX = 600;

export function columnResponsiveClassName(layoutId: string, columnIndex: number): string {
  return `${moduleResponsiveClassName(layoutId)}-col${columnIndex}`;
}

export function gutterResponsiveClassName(layoutId: string, gutterIndex: number): string {
  return `${moduleResponsiveClassName(layoutId)}-gut${gutterIndex}`;
}

function pxAttrValue(dimension: DimensionValue): string {
  return dimension.unit === '%' ? `${dimension.value}%` : String(Math.round(dimension.value));
}

// --- Per-module rule collection ------------------------------------------

// Returns the plain (unconditional, applies regardless of viewport/media
// support) and media (only inside the @media block) visibility rules for
// one module. Desktop is the structural/base fallback (instruction 1):
// hiding on Desktop is a PLAIN rule (so a client that ignores the whole
// <style> block — some Outlook builds — degrades to "shown", the safer
// default, per instruction 47), optionally revealed again at the mobile
// breakpoint; hiding on Mobile only is purely a media rule, since Desktop
// stays visible by default either way.
function visibilityRulePair(cls: string, module: EmailModule): { plain: string[]; media: string[] } {
  const visibleDesktop = resolveVisible(module.settings, 'desktop');
  const visibleMobile = resolveVisible(module.settings, 'mobile');
  const plain: string[] = [];
  const media: string[] = [];
  if (!visibleDesktop) {
    plain.push(`.${cls}{display:none !important;}`);
    if (visibleMobile) media.push(`.${cls}{display:table !important;}`);
  } else if (!visibleMobile) {
    media.push(`.${cls}{display:none !important;}`);
  }
  return { plain, media };
}

function outerSpacerRules(cls: string, module: EmailModule): string[] {
  const rules: string[] = [];
  const desktop = resolveOuterSpacing(module.settings, 'desktop');
  const mobile = resolveOuterSpacing(module.settings, 'mobile');
  if (desktop.left.value !== mobile.left.value || desktop.left.unit !== mobile.left.unit) {
    rules.push(`.${cls}-l{width:${pxAttrValue(mobile.left)} !important; ${widthCssRule(mobile.left)}}`);
  }
  if (desktop.right.value !== mobile.right.value || desktop.right.unit !== mobile.right.unit) {
    rules.push(`.${cls}-r{width:${pxAttrValue(mobile.right)} !important; ${widthCssRule(mobile.right)}}`);
  }
  return rules;
}

function widthCssRule(dimension: DimensionValue): string {
  return `width:${widthCssValue(dimension)} !important;`;
}

function paddingRules(cls: string, module: EmailModule): string[] {
  const desktop = resolveSpacing(module.settings, 'desktop');
  const mobile = resolveSpacing(module.settings, 'mobile');
  const desktopStyle = paddingStyle(desktop);
  const mobileStyle = paddingStyle(mobile);
  if (desktopStyle === mobileStyle) return [];
  // paddingStyle() always returns exactly one `padding:...;` declaration
  // — swap its single trailing `;` for ` !important;`.
  const mobileImportant = mobileStyle.replace(/;$/, ' !important;');
  return [`.${cls}-c [style*="${desktopStyle}"]{${mobileImportant}}`];
}

function textTypographyRules(cls: string, module: EmailModule<TextModuleProps>): string[] {
  const { props } = module;
  const rules: string[] = [];
  if (props.mobileFontSize !== undefined && props.mobileFontSize !== props.fontSize) {
    rules.push(`.${cls}-c [style*="font-size:${props.fontSize}px;"]{font-size:${props.mobileFontSize}px !important;}`);
  }
  if (props.mobileLineHeight !== undefined && props.mobileLineHeight !== props.lineHeight) {
    rules.push(`.${cls}-c [style*="line-height:${props.lineHeight}px;"]{line-height:${props.mobileLineHeight}px !important;}`);
  }
  if (props.mobileAlign !== undefined && props.mobileAlign !== props.align) {
    rules.push(`.${cls}-c [style*="text-align:${props.align};"]{text-align:${props.mobileAlign} !important;}`);
  }
  return rules;
}

function widthResponsiveRules(cls: string, module: EmailModule<{ width?: ResponsiveDimension }>): string[] {
  const responsive = module.props.width ?? { desktop: percent(100) };
  if (!responsive.mobile) return [];
  const desktop = resolveDimension(responsive, 'desktop');
  const mobile = resolveDimension(responsive, 'mobile');
  if (desktop.value === mobile.value && desktop.unit === mobile.unit) return [];
  const desktopCss = `width:${widthCssValue(desktop)};`;
  return [`.${cls}-c [style*="${desktopCss}"]{width:${widthCssValue(mobile)} !important;}`];
}

function buttonWidthModeRules(cls: string, module: EmailModule<ButtonModuleProps>): string[] {
  const { props } = module;
  const desktopMode: ButtonWidthMode = props.widthMode ?? 'auto';
  const mobileMode = props.mobileWidthMode;
  if (!mobileMode || mobileMode === desktopMode) return [];
  if (mobileMode === 'full') {
    return [
      `.${cls}-c table{width:100% !important;}`,
      `.${cls}-c a{display:block !important; width:auto !important;}`,
    ];
  }
  if (mobileMode === 'auto') {
    return [`.${cls}-c a{display:inline-block !important; width:auto !important;}`];
  }
  return [];
}

function spacerHeightRules(cls: string, module: EmailModule<SpacerModuleProps>): string[] {
  const { props } = module;
  if (props.mobileHeight === undefined || props.mobileHeight === props.height) return [];
  return [
    `.${cls}-c td[height="${props.height}"]{height:${props.mobileHeight}px !important; `
    + `font-size:${props.mobileHeight}px !important; line-height:${props.mobileHeight}px !important;}`,
  ];
}

function moduleRules(module: EmailModule): { plain: string[]; media: string[] } {
  const cls = moduleResponsiveClassName(module.id);
  const visibility = visibilityRulePair(cls, module);
  const media = [
    ...visibility.media,
    ...outerSpacerRules(cls, module),
    ...paddingRules(cls, module),
  ];
  if (module.type === 'text') {
    const text = module as unknown as EmailModule<TextModuleProps>;
    media.push(...textTypographyRules(cls, text));
    media.push(...widthResponsiveRules(cls, text));
  }
  if (module.type === 'image') {
    media.push(...widthResponsiveRules(cls, module as unknown as EmailModule<ImageModuleProps>));
  }
  if (module.type === 'button') {
    media.push(...buttonWidthModeRules(cls, module as unknown as EmailModule<ButtonModuleProps>));
  }
  if (module.type === 'spacer') {
    media.push(...spacerHeightRules(cls, module as unknown as EmailModule<SpacerModuleProps>));
  }
  return { plain: visibility.plain, media };
}

// --- Layout stacking / gutter collapse / mobile column gap ---------------

// See MOBILE_COLUMN_ORDER_LIMITATION below — column reordering is
// deliberately NOT emitted here.
function layoutRules(module: EmailModule): string[] {
  const columns = module.columns;
  if (!columns || columns.length === 0) return [];
  const stack = module.settings.mobileStack !== false;
  if (!stack) return [];

  const rules: string[] = [];
  const gutterDesktop = module.settings.columnGutter?.desktop;
  const gutterMobileExplicit = module.settings.columnGutter?.mobile;
  // Mobile gutter: explicit override wins; otherwise stacking auto-
  // collapses the horizontal gutter to 0 (instruction 23 — "should
  // normally collapse to 0... do not leave a 20px spacer TD creating
  // strange horizontal indentation on stacked columns").
  const mobileGutterValue = gutterMobileExplicit
    ? gutterMobileExplicit.value
    : (gutterDesktop && gutterDesktop.value > 0 ? 0 : undefined);

  columns.forEach((_column: EmailColumn, index: number) => {
    const colCls = columnResponsiveClassName(module.id, index);
    rules.push(`.${colCls}{display:block !important; width:100% !important;}`);
    if (index < columns.length - 1) {
      const gutCls = gutterResponsiveClassName(module.id, index);
      if (mobileGutterValue !== undefined && gutterDesktop && mobileGutterValue !== gutterDesktop.value) {
        rules.push(`.${gutCls}{display:none !important; width:0 !important; height:0 !important;}`);
      }
      // Mobile vertical gap between stacked columns (instruction 24) —
      // a real TD-compatible spacer via padding-bottom on every stacked
      // column except the last, never CSS margin.
      const gap = module.settings.mobileColumnGap;
      if (gap && gap.value > 0) {
        rules.push(`.${colCls}{padding-bottom:${widthCssValue(gap)} !important;}`);
      }
    }
  });
  return rules;
}

// Documented, deliberate limitation (instruction 22 option B): true
// column reordering at the mobile breakpoint would require either the
// forbidden flex/grid `order` property, or duplicating each column's
// markup once per breakpoint and hiding one copy via responsive
// visibility — both rejected as unproven/unsafe for Feature 07 (doubles
// image loads/content for screen readers, and email-client support for
// hidden-duplicate patterns is inconsistent). `mobileColumnOrder`
// therefore remains BUILDER-PREVIEW-ONLY, exactly as it already was
// before Feature 07 — the exported HTML keeps columns in Desktop
// source/DOM order even when stacked (Desktop left-to-right becomes
// Mobile top-to-bottom in that same order). Revisit once Feature 12
// (Validation Center) can prove a duplicate-markup strategy safe across
// target clients.
export const MOBILE_COLUMN_ORDER_LIMITATION =
  'mobileColumnOrder affects the builder canvas preview only; exported HTML keeps Desktop column order when stacked on Mobile.';

function walkModules(modules: EmailModule[], plainOut: string[], mediaOut: string[]): void {
  for (const module of modules) {
    const { plain, media } = moduleRules(module);
    plainOut.push(...plain);
    mediaOut.push(...media);
    if (module.columns && module.columns.length > 0) {
      mediaOut.push(...layoutRules(module));
      for (const column of module.columns) {
        walkModules(column.modules, plainOut, mediaOut);
      }
    }
  }
}

// The single public entry point (instruction 43: "renderResponsiveStyles(document)").
// Returns a complete `<style>...</style>` block (with the module-hidden-
// on-Desktop plain rules followed by one @media block), or '' when the
// document needs no responsive overrides at all — never a fixed-size
// stylesheet regardless of content (instruction 44).
export function renderResponsiveStyles(content: EmailDocumentContent): string {
  const plainRules: string[] = [];
  const mediaRules: string[] = [];
  walkModules(content.modules, plainRules, mediaRules);

  if (mediaRules.length === 0 && plainRules.length === 0) return '';

  const plain = plainRules.join('');
  const media = mediaRules.length > 0
    ? `@media only screen and (max-width:${MOBILE_BREAKPOINT_PX}px){${mediaRules.join('')}}`
    : '';
  return `<style type="text/css">${plain}${media}</style>`;
}

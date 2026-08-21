import { describe, expect, it } from 'vitest';
import { renderResponsiveStyles, MOBILE_BREAKPOINT_PX, MOBILE_COLUMN_ORDER_LIMITATION } from './responsiveStyles';
import { moduleResponsiveClassName } from './registryCore';
import { createModule } from './moduleFactory';
import type {
  ButtonModuleProps, EmailModule, ImageModuleProps, SpacerModuleProps, TextModuleProps,
} from './edm';

function withModules(modules: EmailModule[]) {
  return { version: 1 as const, modules };
}

describe('renderResponsiveStyles', () => {
  it('emits nothing for a document with no responsive overrides at all', () => {
    const text = createModule('text', 0);
    const image = createModule('image', 0);
    expect(renderResponsiveStyles(withModules([text, image]))).toBe('');
  });

  it('uses the recommended 600px breakpoint, centralized', () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(600);
    const textModule = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    textModule.props = { ...textModule.props, mobileFontSize: 12 };
    const css = renderResponsiveStyles(withModules([textModule as unknown as EmailModule]));
    expect(css).toContain(`@media only screen and (max-width:${MOBILE_BREAKPOINT_PX}px)`);
  });

  // --- Test 54: Image responsive width ------------------------------------
  it('Image: Desktop 300px / Mobile 100% generates a media rule overriding the desktop width', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    imageModule.props = {
      ...imageModule.props,
      width: { desktop: { value: 300, unit: 'px' }, mobile: { value: 100, unit: '%' } },
    };
    const cls = moduleResponsiveClassName(imageModule.id);
    const css = renderResponsiveStyles(withModules([imageModule as unknown as EmailModule]));
    expect(css).toContain(`.${cls}-c [style*="width:300px;"]{width:100% !important;}`);
  });

  it('Image: no media rule when Mobile width is unset (pure inheritance)', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    imageModule.props = { ...imageModule.props, width: { desktop: { value: 300, unit: 'px' } } };
    expect(renderResponsiveStyles(withModules([imageModule as unknown as EmailModule]))).toBe('');
  });

  // --- Test 55: Outer spacers ----------------------------------------------
  it('Outer spacers: Desktop 30/20, Mobile 8/8 generates independent left/right media rules', () => {
    const module = createModule('button', 0);
    module.settings.outerSpacing = {
      desktop: { left: { value: 30, unit: 'px' }, right: { value: 20, unit: 'px' } },
      mobile: { left: { value: 8, unit: 'px' }, right: { value: 8, unit: 'px' } },
    };
    const cls = moduleResponsiveClassName(module.id);
    const css = renderResponsiveStyles(withModules([module]));
    expect(css).toContain(`.${cls}-l{width:8 !important; width:8px !important;}`);
    expect(css).toContain(`.${cls}-r{width:8 !important; width:8px !important;}`);
    expect(css).not.toMatch(/margin/);
  });

  it('Outer spacers: Mobile Zero — Desktop Left 30px collapses to 0 at the breakpoint', () => {
    const module = createModule('button', 0);
    module.settings.outerSpacing = {
      desktop: { left: { value: 30, unit: 'px' }, right: { value: 0, unit: 'px' } },
      mobile: { left: { value: 0, unit: 'px' } },
    };
    const cls = moduleResponsiveClassName(module.id);
    const css = renderResponsiveStyles(withModules([module]));
    expect(css).toContain(`.${cls}-l{width:0 !important; width:0px !important;}`);
  });

  // --- Test 56: Padding -----------------------------------------------------
  it('Padding: Desktop 20/30/20/30, Mobile 12/12/12/12 generates an attribute-scoped override', () => {
    const module = createModule('text', 0);
    module.settings.desktop = { paddingTop: 20, paddingRight: 30, paddingBottom: 20, paddingLeft: 30 };
    module.settings.mobile = { paddingTop: 12, paddingRight: 12, paddingBottom: 12, paddingLeft: 12 };
    const cls = moduleResponsiveClassName(module.id);
    const css = renderResponsiveStyles(withModules([module]));
    expect(css).toContain(`.${cls}-c [style*="padding:20px 30px 20px 30px;"]{padding:12px 12px 12px 12px !important;}`);
  });

  it('Padding: no rule when no mobile padding overrides are set', () => {
    const module = createModule('text', 0);
    expect(renderResponsiveStyles(withModules([module]))).toBe('');
  });

  // --- Test 57: Typography ---------------------------------------------------
  it('Typography: Heading Desktop 32/40 -> Mobile 24/30 generates font-size and line-height rules', () => {
    const textModule = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    textModule.props = {
      ...textModule.props, fontSize: 32, lineHeight: 40, mobileFontSize: 24, mobileLineHeight: 30,
    };
    const cls = moduleResponsiveClassName(textModule.id);
    const css = renderResponsiveStyles(withModules([textModule as unknown as EmailModule]));
    expect(css).toContain(`.${cls}-c [style*="font-size:32px;"]{font-size:24px !important;}`);
    expect(css).toContain(`.${cls}-c [style*="line-height:40px;"]{line-height:30px !important;}`);
  });

  it('Typography: mobileAlign generates a text-align override', () => {
    const textModule = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    textModule.props = { ...textModule.props, align: 'left', mobileAlign: 'center' };
    const cls = moduleResponsiveClassName(textModule.id);
    const css = renderResponsiveStyles(withModules([textModule as unknown as EmailModule]));
    expect(css).toContain(`.${cls}-c [style*="text-align:left;"]{text-align:center !important;}`);
  });

  // --- Test 58: Visibility ----------------------------------------------------
  it('Visibility: hideMobile hides only inside the media block, Desktop stays a plain visible fallback', () => {
    const module = createModule('text', 0);
    module.settings.visibility = 'hideMobile';
    const cls = moduleResponsiveClassName(module.id);
    const css = renderResponsiveStyles(withModules([module]));
    expect(css).toContain(`@media only screen and (max-width:${MOBILE_BREAKPOINT_PX}px){.${cls}{display:none !important;}`);
    // No plain (non-media) hide rule — Desktop remains visible by default.
    expect(css.indexOf(`.${cls}{display:none`)).toBe(css.indexOf('@media') + '@media only screen and (max-width:600px){'.length);
  });

  it('Visibility: hideDesktop hides unconditionally (plain rule) and reveals only inside the media block', () => {
    const module = createModule('text', 0);
    module.settings.visibility = 'hideDesktop';
    const cls = moduleResponsiveClassName(module.id);
    const css = renderResponsiveStyles(withModules([module]));
    expect(css.indexOf(`.${cls}{display:none !important;}`)).toBeLessThan(css.indexOf('@media'));
    expect(css).toContain(`@media only screen and (max-width:${MOBILE_BREAKPOINT_PX}px){.${cls}{display:table !important;}`);
  });

  it('Visibility: "all" (default) emits nothing', () => {
    const module = createModule('text', 0);
    expect(renderResponsiveStyles(withModules([module]))).toBe('');
  });

  // --- Test 59/60: Column stacking --------------------------------------------
  it('2-column stacking: Desktop 35/65 gutter 20px, Mobile stack ON collapses the gutter and stacks both columns full-width', () => {
    const layout = createModule('layout-2col-40-60', 0);
    layout.props = { columnWidths: [35, 65] };
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } }, mobileStack: true };
    const layoutCls = moduleResponsiveClassName(layout.id);
    const css = renderResponsiveStyles(withModules([layout]));
    expect(css).toContain(`.${layoutCls}-col0{display:block !important; width:100% !important;}`);
    expect(css).toContain(`.${layoutCls}-col1{display:block !important; width:100% !important;}`);
    expect(css).toContain(`.${layoutCls}-gut0{display:none !important; width:0 !important; height:0 !important;}`);
    expect(css).not.toMatch(/display:\s*flex/);
    expect(css).not.toMatch(/display:\s*grid/);
  });

  it('3-column stacking: each column gets its own full-width stacking rule', () => {
    const layout = createModule('layout-3col', 0);
    const layoutCls = moduleResponsiveClassName(layout.id);
    const css = renderResponsiveStyles(withModules([layout]));
    expect(css).toContain(`.${layoutCls}-col0{display:block !important; width:100% !important;}`);
    expect(css).toContain(`.${layoutCls}-col1{display:block !important; width:100% !important;}`);
    expect(css).toContain(`.${layoutCls}-col2{display:block !important; width:100% !important;}`);
  });

  // --- Test 61: Stack off ------------------------------------------------------
  it('Stack off: mobileStack=false emits no stacking rules at all — Desktop multi-column layout is preserved on Mobile', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, mobileStack: false };
    expect(renderResponsiveStyles(withModules([layout]))).toBe('');
  });

  // --- Instruction 24: mobile column gap ---------------------------------------
  it('Mobile column gap adds padding-bottom on every stacked column except the last', () => {
    const layout = createModule('layout-3col', 0);
    layout.settings = { ...layout.settings, mobileColumnGap: { value: 12, unit: 'px' } };
    const layoutCls = moduleResponsiveClassName(layout.id);
    const css = renderResponsiveStyles(withModules([layout]));
    expect(css).toContain(`.${layoutCls}-col0{padding-bottom:12px !important;}`);
    expect(css).toContain(`.${layoutCls}-col1{padding-bottom:12px !important;}`);
    expect(css).not.toContain(`.${layoutCls}-col2{padding-bottom:12px !important;}`);
    expect(css).not.toMatch(/margin/);
  });

  // --- Nested modules ------------------------------------------------------------
  it('Test 62: a nested Text module inside a Layout column gets its own responsive rules, independent of the parent Layout', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const nestedText = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    nestedText.props = { ...nestedText.props, fontSize: 20, mobileFontSize: 16 };
    layout.columns![0].modules.push(nestedText as unknown as EmailModule);
    const nestedCls = moduleResponsiveClassName(nestedText.id);
    const css = renderResponsiveStyles(withModules([layout]));
    expect(css).toContain(`.${nestedCls}-c [style*="font-size:20px;"]{font-size:16px !important;}`);
  });

  it('a nested Button module supports its own mobileWidthMode independent of the parent', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const nestedButton = createModule('button', 0) as unknown as EmailModule<ButtonModuleProps>;
    nestedButton.props = { ...nestedButton.props, widthMode: 'auto', mobileWidthMode: 'full' };
    layout.columns![1].modules.push(nestedButton as unknown as EmailModule);
    const cls = moduleResponsiveClassName(nestedButton.id);
    const css = renderResponsiveStyles(withModules([layout]));
    expect(css).toContain(`.${cls}-c a{display:block !important; width:auto !important;}`);
  });

  // --- Spacer module -----------------------------------------------------------
  it('Spacer: Desktop 40px height, Mobile 20px generates a height/font-size/line-height override', () => {
    const spacerModule = createModule('spacer', 0) as unknown as EmailModule<SpacerModuleProps>;
    spacerModule.props = { height: 40, mobileHeight: 20 };
    const cls = moduleResponsiveClassName(spacerModule.id);
    const css = renderResponsiveStyles(withModules([spacerModule as unknown as EmailModule]));
    expect(css).toContain(`.${cls}-c td[height="40"]{height:20px !important; font-size:20px !important; line-height:20px !important;}`);
  });

  // --- Documented mobile column-order limitation --------------------------------
  it('mobileColumnOrder is documented as builder-preview-only and never emits a reorder rule', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, mobileColumnOrder: [1, 0] };
    const css = renderResponsiveStyles(withModules([layout]));
    expect(css).not.toMatch(/order\s*:/);
    expect(MOBILE_COLUMN_ORDER_LIMITATION).toContain('builder canvas preview only');
  });

  // --- 53-module sweep never introduces flex/grid/div/script ---------------------
  it('never emits flex, grid, div, or script for any responsive rule combination', () => {
    const module = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    module.props = { ...module.props, width: { desktop: { value: 300, unit: 'px' }, mobile: { value: 100, unit: '%' } } };
    module.settings.visibility = 'hideMobile';
    module.settings.outerSpacing = {
      desktop: { left: { value: 30, unit: 'px' }, right: { value: 0, unit: 'px' } },
      mobile: { left: { value: 8, unit: 'px' } },
    };
    const css = renderResponsiveStyles(withModules([module as unknown as EmailModule]));
    expect(css).not.toContain('<div');
    expect(css).not.toMatch(/[\s;"]margin/);
    expect(css).not.toMatch(/display:\s*flex/);
    expect(css).not.toMatch(/display:\s*grid/);
    expect(css).not.toContain('<script');
  });
});

import { describe, expect, it } from 'vitest';
import { getAllModuleDefinitions, getModuleDefinition, MODULE_PANEL_ORDER, MODULE_REGISTRY } from './moduleRegistry';
import { createModule } from './moduleFactory';
import { MODULE_CATEGORIES } from './moduleCategories';
import { renderEmailBody } from './htmlRenderer';

const VALID_CATEGORIES = new Set(MODULE_CATEGORIES.map((c) => c.key));

describe('module registry (Feature 04 catalog)', () => {
  const definitions = getAllModuleDefinitions();

  it('has a meaningful curated catalog size (~40-60 definitions)', () => {
    expect(definitions.length).toBeGreaterThanOrEqual(40);
    expect(definitions.length).toBeLessThanOrEqual(70);
  });

  it('every definition id (type) is unique', () => {
    const types = definitions.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('MODULE_PANEL_ORDER and MODULE_REGISTRY agree on the full type set', () => {
    expect(new Set(MODULE_PANEL_ORDER)).toEqual(new Set(Object.keys(MODULE_REGISTRY)));
    expect(MODULE_PANEL_ORDER.length).toBe(definitions.length);
  });

  it('every definition has a valid, known category', () => {
    for (const definition of definitions) {
      expect(VALID_CATEGORIES.has(definition.category), `${definition.type} has unknown category "${definition.category}"`).toBe(true);
    }
  });

  it('every definition has a non-empty label, description, tags and keywords', () => {
    for (const definition of definitions) {
      expect(definition.label.length, definition.type).toBeGreaterThan(0);
      expect(definition.description.length, definition.type).toBeGreaterThan(0);
      expect(definition.tags.length, definition.type).toBeGreaterThan(0);
      expect(definition.keywords.length, definition.type).toBeGreaterThan(0);
    }
  });

  it('every definition declares Generic platform compatibility', () => {
    for (const definition of definitions) {
      expect(definition.platformCompatibility, definition.type).toContain('generic');
    }
  });

  it('every layout definition has a column count between 1 and 6', () => {
    const layoutDefinitions = definitions.filter((d) => d.category === 'layout');
    expect(layoutDefinitions.length).toBeGreaterThan(0);
    for (const definition of layoutDefinitions) {
      expect(definition.columnCount, definition.type).not.toBeNull();
      expect(definition.columnCount as number).toBeGreaterThanOrEqual(1);
      expect(definition.columnCount as number).toBeLessThanOrEqual(6);
    }
  });

  it('every definition has createDefaultProps/createDefaultSettings/renderPreview/renderEmailHtml', () => {
    for (const definition of definitions) {
      expect(typeof definition.createDefaultProps, definition.type).toBe('function');
      expect(typeof definition.createDefaultSettings, definition.type).toBe('function');
      expect(typeof definition.renderPreview, definition.type).toBe('function');
      expect(typeof definition.renderEmailHtml, definition.type).toBe('function');
    }
  });

  it('createModule() succeeds for every registered type and produces valid props/settings', () => {
    for (const definition of definitions) {
      const module = createModule(definition.type, 0);
      expect(module.props, definition.type).toBeTruthy();
      expect(module.settings, definition.type).toBeTruthy();
      expect(module.type).toBe(definition.type);
    }
  });

  it('renderEmailHtml() never introduces script tags or javascript: URLs from defaults', () => {
    for (const definition of definitions) {
      const module = createModule(definition.type, 0);
      const html = definition.renderEmailHtml(module);
      expect(html.toLowerCase(), definition.type).not.toContain('<script');
      expect(html.toLowerCase(), definition.type).not.toContain('javascript:');
    }
  });

  it('renderEmailHtml() never emits a structural <div> for ANY registered module (Generic mode)', () => {
    for (const definition of definitions) {
      const module = createModule(definition.type, 0);
      const html = definition.renderEmailHtml(module);
      expect(html, definition.type).not.toContain('<div');
      expect(html, definition.type).not.toMatch(/display:\s*flex/);
      expect(html, definition.type).not.toMatch(/display:\s*grid/);
    }
  });

  it('renderEmailHtml() never emits a CSS margin declaration for ANY registered module (Generic mode)', () => {
    for (const definition of definitions) {
      const module = createModule(definition.type, 0);
      const html = definition.renderEmailHtml(module);
      expect(html, definition.type).not.toMatch(/[\s;"]margin/);
    }
  });

  it('renderEmailHtml() is table-first for ANY registered module (table/tr/td present)', () => {
    for (const definition of definitions) {
      const module = createModule(definition.type, 0);
      const html = definition.renderEmailHtml(module);
      expect(html, definition.type).toContain('<table');
      expect(html, definition.type).toContain('<tr');
      expect(html, definition.type).toContain('<td');
    }
  });

  it('the outer-spacing wrapper (renderEmailBody) never introduces a margin either', () => {
    for (const definition of definitions) {
      const module = createModule(definition.type, 0);
      module.settings.outerSpacing = { desktop: { left: { value: 20, unit: 'px' }, right: { value: 20, unit: 'px' } }, mobile: {} };
      const html = renderEmailBody({ width: 700, content: { version: 1, modules: [module] } });
      expect(html, definition.type).not.toMatch(/[\s;"]margin/);
      expect(html, definition.type).not.toContain('<div');
    }
  });

  it('every registered module (all 53+) renders the centralized outer-module spacer TDs correctly — 0/0, left-only, right-only, both', () => {
    // Matches the module outer-wrapper table (bare, or with a
    // `class="m-eb-ID"` responsive attribute) but NOT renderEmailBody's
    // own unrelated outer content table, which shares the same literal
    // prefix but always carries a `style=` attribute instead.
    const OUTER_TABLE_OPEN = /<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"(?: class="[^"]*")?><tr>/g;
    const countOf = (haystack: string) => (haystack.match(OUTER_TABLE_OPEN) ?? []).length;

    for (const definition of definitions) {
      // 0/0 — the standard outer module table is STILL present (one
      // content <td>, no spacer <td>s) — not "no wrapper at all". Some
      // modules, e.g. Divider, legitimately have their OWN internal
      // font-size:0/line-height:0 cell, so the spacer-absence check
      // matches the specific width-prefixed style wrapWithOuterSpacing
      // emits, not the bare font-size:0/line-height:0 pair alone. The
      // "wrapper applied exactly once" check compares against the
      // module's raw (unwrapped) renderEmailHtml output — renderEmailBody
      // must add exactly one more occurrence of the outer-table-open
      // literal, proving the wrapper exists and is not double-applied.
      const zero = createModule(definition.type, 0);
      const zeroHtml = renderEmailBody({ width: 700, content: { version: 1, modules: [zero] } });
      expect(zeroHtml, `${definition.type} (0/0)`).not.toMatch(/style="width:\d+(\.\d+)?(px|%); font-size:0; line-height:0;">&nbsp;<\/td>/);
      const rawHtml = definition.renderEmailHtml(zero);
      expect(countOf(zeroHtml), `${definition.type} (0/0 wrapper applied exactly once)`).toBe(countOf(rawHtml) + 1);

      // Left-only.
      const left = createModule(definition.type, 0);
      left.settings.outerSpacing = { desktop: { left: { value: 12, unit: 'px' }, right: { value: 0, unit: 'px' } }, mobile: {} };
      const leftHtml = renderEmailBody({ width: 700, content: { version: 1, modules: [left] } });
      expect(leftHtml.match(/width:12px;[^>]*>&nbsp;<\/td>/g) ?? [], `${definition.type} (left-only)`).toHaveLength(1);
      expect(countOf(leftHtml), `${definition.type} (left-only wrapper applied exactly once)`).toBe(countOf(rawHtml) + 1);

      // Right-only.
      const right = createModule(definition.type, 0);
      right.settings.outerSpacing = { desktop: { left: { value: 0, unit: 'px' }, right: { value: 18, unit: 'px' } }, mobile: {} };
      const rightHtml = renderEmailBody({ width: 700, content: { version: 1, modules: [right] } });
      expect(rightHtml.match(/width:18px;[^>]*>&nbsp;<\/td>/g) ?? [], `${definition.type} (right-only)`).toHaveLength(1);
      expect(countOf(rightHtml), `${definition.type} (right-only wrapper applied exactly once)`).toBe(countOf(rawHtml) + 1);

      // Both.
      const both = createModule(definition.type, 0);
      both.settings.outerSpacing = { desktop: { left: { value: 12, unit: 'px' }, right: { value: 18, unit: 'px' } }, mobile: {} };
      const bothHtml = renderEmailBody({ width: 700, content: { version: 1, modules: [both] } });
      expect(bothHtml.match(/width:12px;[^>]*>&nbsp;<\/td>/g) ?? [], `${definition.type} (both) left`).toHaveLength(1);
      expect(bothHtml.match(/width:18px;[^>]*>&nbsp;<\/td>/g) ?? [], `${definition.type} (both) right`).toHaveLength(1);
      expect(countOf(bothHtml), `${definition.type} (both wrapper applied exactly once)`).toBe(countOf(rawHtml) + 1);
    }
  });

  it('every definition\'s createDefaultSettings() returns the current desktop/mobile/outerSpacing shape', () => {
    for (const definition of definitions) {
      const settings = definition.createDefaultSettings();
      expect(settings.desktop, definition.type).toBeTruthy();
      expect(settings.mobile, definition.type).toBeTruthy();
      expect(settings.outerSpacing, definition.type).toBeTruthy();
      expect(settings.outerSpacing.desktop).toEqual({ left: { value: 0, unit: 'px' }, right: { value: 0, unit: 'px' } });
      expect(settings.outerSpacing.mobile).toEqual({});
    }
  });

  it('getModuleDefinition resolves every catalog type', () => {
    for (const definition of definitions) {
      expect(getModuleDefinition(definition.type)).toBe(definition);
    }
  });
});

// Feature 07 — instruction 37: "Mobile preview chrome must show ... Mobile
// font sizes ... Mobile alignment". renderPreview() must itself resolve
// mobileFontSize/mobileLineHeight/mobileAlign/mobileWidthMode for the
// given viewport — it's not enough for the DATA MODEL and the EXPORTED
// HTML to be responsive if the canvas the user is actually looking at
// silently ignores the viewport and always shows Desktop.
describe('module registry — Feature 07 canvas preview is viewport-aware', () => {
  it('Text: renderPreview resolves mobile font-size/line-height/align independently of Desktop', () => {
    const definition = getModuleDefinition('text');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic module factory result narrowed per-test
    const module = createModule('text', 0) as any;
    module.props = {
      ...module.props, fontSize: 32, lineHeight: 40, align: 'left',
      mobileFontSize: 24, mobileLineHeight: 30, mobileAlign: 'center',
    };
    const desktopPreview = definition.renderPreview(module, 'desktop') as { props: { style: Record<string, unknown> } };
    expect(desktopPreview.props.style.fontSize).toBe(32);
    expect(desktopPreview.props.style.lineHeight).toBe('40px');
    expect(desktopPreview.props.style.textAlign).toBe('left');

    const mobilePreview = definition.renderPreview(module, 'mobile') as { props: { style: Record<string, unknown> } };
    expect(mobilePreview.props.style.fontSize).toBe(24);
    expect(mobilePreview.props.style.lineHeight).toBe('30px');
    expect(mobilePreview.props.style.textAlign).toBe('center');
  });

  it('Text: Mobile preview falls back to Desktop values when no mobile override is set', () => {
    const definition = getModuleDefinition('text');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic module factory result narrowed per-test
    const module = createModule('text', 0) as any;
    module.props = { ...module.props, fontSize: 18, lineHeight: 26, align: 'right' };
    const mobilePreview = definition.renderPreview(module, 'mobile') as { props: { style: Record<string, unknown> } };
    expect(mobilePreview.props.style.fontSize).toBe(18);
    expect(mobilePreview.props.style.lineHeight).toBe('26px');
    expect(mobilePreview.props.style.textAlign).toBe('right');
  });

  it('Button: renderPreview resolves mobileWidthMode independently of Desktop widthMode', () => {
    const definition = getModuleDefinition('button');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic module factory result narrowed per-test
    const module = createModule('button', 0) as any;
    module.props = { ...module.props, widthMode: 'auto', mobileWidthMode: 'full' };
    const desktopPreview = definition.renderPreview(module, 'desktop') as { props: { children: { props: { style: Record<string, unknown> } } } };
    expect(desktopPreview.props.children.props.style.display).toBe('inline-block');

    const mobilePreview = definition.renderPreview(module, 'mobile') as { props: { children: { props: { style: Record<string, unknown> } } } };
    expect(mobilePreview.props.children.props.style.display).toBe('block');
    expect(mobilePreview.props.children.props.style.width).toBe('100%');
  });
});

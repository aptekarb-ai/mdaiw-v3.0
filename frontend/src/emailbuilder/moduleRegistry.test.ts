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

import { describe, expect, it } from 'vitest';
import { normalizeContent, normalizeModule } from './edmMigration';
import { createResponsiveSettings } from './registryCore';
import type { EmailModule, ImageModuleProps } from './edm';

describe('edmMigration — backward compatibility for pre-responsive drafts', () => {
  it('upgrades a legacy flat-padding settings object to the desktop/mobile shape', () => {
    const legacy: EmailModule = {
      id: 'm1', type: 'text', order: 0,
      props: { text: 'Hi' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately simulating an old, pre-migration document shape
      settings: { paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20 } as any,
    };

    const upgraded = normalizeModule(legacy);

    expect(upgraded.settings.desktop).toEqual({
      paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
    });
    expect(upgraded.settings.mobile).toEqual({});
    expect(upgraded.settings.outerSpacing).toEqual({
      desktop: { left: { value: 0, unit: 'px' }, right: { value: 0, unit: 'px' } },
      mobile: {},
    });
  });

  it('upgrades a legacy flat outerSpacing {left,right} (pre-Desktop/Mobile-split) to outerSpacing.desktop', () => {
    const legacy: EmailModule = {
      id: 'm1', type: 'text', order: 0,
      props: { text: 'Hi' },
      settings: {
        paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating the flat outerSpacing shape from the first responsive-settings pass
        outerSpacing: { left: { value: 30, unit: 'px' }, right: { value: 15, unit: '%' } },
      } as any,
    };

    const upgraded = normalizeModule(legacy);

    expect(upgraded.settings.outerSpacing).toEqual({
      desktop: { left: { value: 30, unit: 'px' }, right: { value: 15, unit: '%' } },
      mobile: {},
    });
  });

  it('preserves an already-current-shape outerSpacing with a mobile override', () => {
    const current: EmailModule = {
      id: 'm1', type: 'text', order: 0,
      props: { text: 'Hi' },
      settings: {
        ...createResponsiveSettings(),
        outerSpacing: {
          desktop: { left: { value: 20, unit: 'px' }, right: { value: 30, unit: 'px' } },
          mobile: { left: { value: 8, unit: 'px' } },
        },
      },
    };

    const upgraded = normalizeModule(current);
    expect(upgraded.settings.outerSpacing).toEqual(current.settings.outerSpacing);
  });

  it('leaves an already-current-shape module unchanged (idempotent)', () => {
    const current: EmailModule = {
      id: 'm1', type: 'text', order: 0,
      props: { text: 'Hi' },
      settings: createResponsiveSettings({ paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 }),
    };

    const result = normalizeModule(current);
    expect(result.settings.desktop).toEqual(current.settings.desktop);
    expect(result.settings.mobile).toEqual(current.settings.mobile);
    expect(result.settings.outerSpacing).toEqual(current.settings.outerSpacing);
  });

  it('preserves an existing mobile override and mobileOrder while upgrading', () => {
    const legacy: EmailModule = {
      id: 'm1', type: 'image-text', order: 0,
      props: { image: { src: '', alt: '', width: 280 }, text: { text: 'x', align: 'left' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings: { paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20, mobileOrder: 'content-first' } as any,
    };

    const upgraded = normalizeModule(legacy);
    expect(upgraded.settings.mobileOrder).toBe('content-first');
  });

  it('upgrades a legacy plain-number image width to a ResponsiveDimension', () => {
    const legacy: EmailModule<ImageModuleProps> = {
      id: 'm1', type: 'image', order: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: { src: 'https://example.com/a.png', alt: 'a', width: 300 as any, align: 'center', href: '' },
      settings: createResponsiveSettings(),
    };

    const upgraded = normalizeModule(legacy as unknown as EmailModule);
    expect((upgraded.props as unknown as ImageModuleProps).width).toEqual({ desktop: { value: 300, unit: 'px' } });
  });

  it('upgrades a legacy plain-number composite image width to a ResponsiveDimension', () => {
    const legacy: EmailModule = {
      id: 'm1', type: 'text-image', order: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: { image: { src: '', alt: '', width: 280 as any }, text: { text: 'x', align: 'left' } },
      settings: createResponsiveSettings(),
    };

    const upgraded = normalizeModule(legacy);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((upgraded.props as any).image.width).toEqual({ desktop: { value: 280, unit: 'px' } });
  });

  it('leaves an already-ResponsiveDimension image width unchanged', () => {
    const current: EmailModule<ImageModuleProps> = {
      id: 'm1', type: 'image', order: 0,
      props: { src: '', alt: '', width: { desktop: { value: 100, unit: '%' } }, align: 'center', href: '' },
      settings: createResponsiveSettings(),
    };

    const result = normalizeModule(current as unknown as EmailModule);
    expect((result.props as unknown as ImageModuleProps).width).toEqual({ desktop: { value: 100, unit: '%' } });
  });

  it('Feature 05 — backfills empty columns for a legacy layout module with no columns key', () => {
    const legacy: EmailModule = {
      id: 'layout-1', type: 'layout-2col-40-60', order: 0,
      props: { columnWidths: [40, 60] },
      settings: createResponsiveSettings(),
    };

    const upgraded = normalizeModule(legacy);
    expect(upgraded.columns).toHaveLength(2);
    expect(upgraded.columns?.every((column) => column.modules.length === 0)).toBe(true);
    expect(upgraded.columns?.[0].settings.verticalAlign).toBe('top');
    // Every backfilled column gets a fresh, non-empty id.
    const ids = upgraded.columns?.map((column) => column.id) ?? [];
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.trim().length > 0)).toBe(true);
  });

  it('Feature 05 — never adds a columns key to a non-layout module', () => {
    const legacy: EmailModule = {
      id: 'm1', type: 'text', order: 0, props: { text: 'a' }, settings: createResponsiveSettings(),
    };
    expect(normalizeModule(legacy).columns).toBeUndefined();
  });

  it('Feature 05 — leaves already-populated columns/nested modules unchanged (idempotent) and normalizes nested settings', () => {
    const current: EmailModule = {
      id: 'layout-1', type: 'layout-2col-50-50', order: 0,
      props: { columnWidths: [50, 50] },
      settings: createResponsiveSettings(),
      columns: [
        {
          id: 'col-a',
          settings: { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' },
          modules: [
            {
              id: 'nested-1', type: 'text', order: 0, props: { text: 'hi' },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating a pre-migration nested module settings shape
              settings: { paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4 } as any,
            },
          ],
        },
        {
          id: 'col-b',
          settings: { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' },
          modules: [],
        },
      ],
    };

    const upgraded = normalizeModule(current);
    expect(upgraded.columns?.[0].id).toBe('col-a');
    expect(upgraded.columns?.[1].id).toBe('col-b');
    // Nested module settings recursively normalized to the current shape.
    expect(upgraded.columns?.[0].modules[0].settings.desktop).toEqual({
      paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4,
    });
  });

  it('normalizeContent maps every module in a document', () => {
    const content = {
      version: 1 as const,
      modules: [
        {
          id: 'm1', type: 'text' as const, order: 0, props: { text: 'a' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          settings: { paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4 } as any,
        },
      ],
    };

    const result = normalizeContent(content);
    expect(result.modules[0].settings.desktop).toEqual({ paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4 });
  });
});

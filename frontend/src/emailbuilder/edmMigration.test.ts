import { describe, expect, it } from 'vitest';
import { normalizeModule } from './edmMigration';
import type { EmailModule } from './edm';

// Feature 07 — normalizeSettings() reconstructs EmailModuleSettings from
// an explicit field allowlist (desktop/mobile/outerSpacing/mobileOrder/
// mobileStack/columnGutter/mobileColumnOrder) rather than a spread
// passthrough. Adding a new settings key (visibility, mobileColumnGap)
// without also adding it to that allowlist means normalizeModule()
// silently drops it on every document load — this file guards against
// that regression.
describe('normalizeModule — Feature 07 responsive settings survive normalization', () => {
  function rawModule(settingsOverrides: Record<string, unknown>): EmailModule {
    return {
      id: 'm1',
      type: 'text',
      order: 0,
      props: { text: 'Hi', align: 'left', fontSize: 16, fontWeight: 400, color: '#333333', lineHeight: 24 },
      settings: {
        desktop: { paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20 },
        mobile: {},
        outerSpacing: { desktop: { left: { value: 0, unit: 'px' }, right: { value: 0, unit: 'px' } }, mobile: {} },
        ...settingsOverrides,
      },
    } as unknown as EmailModule;
  }

  it('preserves visibility through normalization (current desktop/mobile shape)', () => {
    const normalized = normalizeModule(rawModule({ visibility: 'hideMobile' }));
    expect(normalized.settings.visibility).toBe('hideMobile');
  });

  it('preserves mobileColumnGap through normalization', () => {
    const normalized = normalizeModule(rawModule({ mobileColumnGap: { value: 12, unit: 'px' } }));
    expect(normalized.settings.mobileColumnGap).toEqual({ value: 12, unit: 'px' });
  });

  it('an invalid visibility string is dropped (normalizes to undefined -> "all")', () => {
    const normalized = normalizeModule(rawModule({ visibility: 'hideEverything' }));
    expect(normalized.settings.visibility).toBeUndefined();
  });

  it('a document with neither key (pre-Feature-07) normalizes with both absent — no destructive default injected', () => {
    const normalized = normalizeModule(rawModule({}));
    expect(normalized.settings.visibility).toBeUndefined();
    expect(normalized.settings.mobileColumnGap).toBeUndefined();
  });

  it('legacy flat settings shape (pre-Feature-04.5) also preserves visibility/mobileColumnGap when present', () => {
    const legacy = {
      id: 'm2',
      type: 'text',
      order: 0,
      props: { text: 'Hi', align: 'left', fontSize: 16, fontWeight: 400, color: '#333333', lineHeight: 24 },
      settings: {
        paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
        visibility: 'hideDesktop', mobileColumnGap: { value: 8, unit: 'px' },
      },
    } as unknown as EmailModule;
    const normalized = normalizeModule(legacy);
    expect(normalized.settings.visibility).toBe('hideDesktop');
    expect(normalized.settings.mobileColumnGap).toEqual({ value: 8, unit: 'px' });
  });
});

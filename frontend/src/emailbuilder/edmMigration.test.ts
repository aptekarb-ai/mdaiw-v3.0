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

  // Sub-phase 6 — outlookVml regression guard (this exact bug was found
  // live: a button/hero module's VML fallback silently reverted on every
  // Save + Reload because this allowlist never carried the new key).
  it('preserves outlookVml through normalization when true', () => {
    const normalized = normalizeModule(rawModule({ outlookVml: true }));
    expect(normalized.settings.outlookVml).toBe(true);
  });

  it('preserves outlookVml through normalization when explicitly false', () => {
    const normalized = normalizeModule(rawModule({ outlookVml: false }));
    expect(normalized.settings.outlookVml).toBe(false);
  });

  it('a document with no outlookVml key normalizes with it absent — no destructive default injected', () => {
    const normalized = normalizeModule(rawModule({}));
    expect(normalized.settings.outlookVml).toBeUndefined();
  });

  it('a non-boolean outlookVml value is dropped (normalizes to undefined)', () => {
    const normalized = normalizeModule(rawModule({ outlookVml: 'yes' }));
    expect(normalized.settings.outlookVml).toBeUndefined();
  });

  it('legacy flat settings shape also preserves outlookVml when present', () => {
    const legacy = {
      id: 'm3',
      type: 'button',
      order: 0,
      props: { text: 'Hi', href: '', align: 'center', backgroundColor: '#0082AD', textColor: '#FFFFFF', fontSize: 15, borderRadius: 6 },
      settings: {
        paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
        outlookVml: true,
      },
    } as unknown as EmailModule;
    const normalized = normalizeModule(legacy);
    expect(normalized.settings.outlookVml).toBe(true);
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

  // Module-4 Final Gap Closure, Correction 2 (Feature 05) —
  // desktopColumnDirection regression guard. Found live via this
  // sub-phase's own save/reload acceptance test: without wiring this
  // field into the allowlist above, Direction on Desktop silently
  // reverted to Left → Right on every Save + Reload — the exact same
  // failure mode outlookVml hit in Sub-phase 6.
  it('preserves desktopColumnDirection through normalization when "rtl"', () => {
    const normalized = normalizeModule(rawModule({ desktopColumnDirection: 'rtl' }));
    expect(normalized.settings.desktopColumnDirection).toBe('rtl');
  });

  it('preserves desktopColumnDirection through normalization when explicitly "ltr"', () => {
    const normalized = normalizeModule(rawModule({ desktopColumnDirection: 'ltr' }));
    expect(normalized.settings.desktopColumnDirection).toBe('ltr');
  });

  it('a document with no desktopColumnDirection key normalizes with it absent — no destructive default injected', () => {
    const normalized = normalizeModule(rawModule({}));
    expect(normalized.settings.desktopColumnDirection).toBeUndefined();
  });

  it('an invalid desktopColumnDirection value is dropped (normalizes to undefined)', () => {
    const normalized = normalizeModule(rawModule({ desktopColumnDirection: 'sideways' }));
    expect(normalized.settings.desktopColumnDirection).toBeUndefined();
  });

  it('legacy flat settings shape also preserves desktopColumnDirection when present', () => {
    const legacy = {
      id: 'm4',
      type: 'layout-2col-50-50',
      order: 0,
      props: { columnWidths: [50, 50] },
      settings: {
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        desktopColumnDirection: 'rtl',
      },
    } as unknown as EmailModule;
    const normalized = normalizeModule(legacy);
    expect(normalized.settings.desktopColumnDirection).toBe('rtl');
  });
});

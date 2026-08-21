import { describe, expect, it } from 'vitest';
import { isMobileOuterSpacingOverridden, resolveOuterSpacing, type EmailModuleSettings } from './edm';
import { createResponsiveSettings } from './registryCore';

function settingsWith(desktop: { left: number; right: number }, mobile: { left?: number; right?: number } = {}): EmailModuleSettings {
  const base = createResponsiveSettings();
  return {
    ...base,
    outerSpacing: {
      desktop: { left: { value: desktop.left, unit: 'px' }, right: { value: desktop.right, unit: 'px' } },
      mobile: {
        ...(mobile.left !== undefined ? { left: { value: mobile.left, unit: 'px' as const } } : {}),
        ...(mobile.right !== undefined ? { right: { value: mobile.right, unit: 'px' as const } } : {}),
      },
    },
  };
}

describe('resolveOuterSpacing', () => {
  it('desktop resolves to the desktop left/right values', () => {
    const settings = settingsWith({ left: 20, right: 30 }, { left: 10, right: 12 });
    expect(resolveOuterSpacing(settings, 'desktop')).toEqual({
      left: { value: 20, unit: 'px' }, right: { value: 30, unit: 'px' },
    });
  });

  it('mobile resolves to the explicit mobile overrides when both sides are overridden', () => {
    const settings = settingsWith({ left: 20, right: 30 }, { left: 10, right: 12 });
    expect(resolveOuterSpacing(settings, 'mobile')).toEqual({
      left: { value: 10, unit: 'px' }, right: { value: 12, unit: 'px' },
    });
  });

  it('a partial mobile override (left only) inherits the untouched side from desktop', () => {
    const settings = settingsWith({ left: 20, right: 30 }, { left: 8 });
    const resolved = resolveOuterSpacing(settings, 'mobile');
    expect(resolved.left).toEqual({ value: 8, unit: 'px' });
    expect(resolved.right).toEqual({ value: 30, unit: 'px' });
  });

  it('mobile with no overrides at all inherits both desktop values', () => {
    const settings = settingsWith({ left: 20, right: 30 });
    expect(resolveOuterSpacing(settings, 'mobile')).toEqual({
      left: { value: 20, unit: 'px' }, right: { value: 30, unit: 'px' },
    });
  });

  it('supports a percentage side', () => {
    const settings: EmailModuleSettings = {
      ...createResponsiveSettings(),
      outerSpacing: { desktop: { left: { value: 5, unit: '%' }, right: { value: 0, unit: 'px' } }, mobile: {} },
    };
    expect(resolveOuterSpacing(settings, 'desktop').left).toEqual({ value: 5, unit: '%' });
  });

  it('0 spacer resolves to a zero DimensionValue on both viewports', () => {
    const settings = settingsWith({ left: 0, right: 0 });
    expect(resolveOuterSpacing(settings, 'desktop')).toEqual({ left: { value: 0, unit: 'px' }, right: { value: 0, unit: 'px' } });
    expect(resolveOuterSpacing(settings, 'mobile')).toEqual({ left: { value: 0, unit: 'px' }, right: { value: 0, unit: 'px' } });
  });

  it('"Use Desktop value" reset (clearing a mobile override) makes mobile inherit desktop again', () => {
    const overridden = settingsWith({ left: 20, right: 30 }, { left: 8 });
    expect(resolveOuterSpacing(overridden, 'mobile').left).toEqual({ value: 8, unit: 'px' });

    const reset: EmailModuleSettings = {
      ...overridden,
      outerSpacing: { ...overridden.outerSpacing, mobile: {} },
    };
    expect(resolveOuterSpacing(reset, 'mobile')).toEqual(resolveOuterSpacing(reset, 'desktop'));
  });
});

describe('isMobileOuterSpacingOverridden', () => {
  it('is false for a side with no mobile override', () => {
    const settings = settingsWith({ left: 20, right: 30 });
    expect(isMobileOuterSpacingOverridden(settings, 'left')).toBe(false);
    expect(isMobileOuterSpacingOverridden(settings, 'right')).toBe(false);
  });

  it('is true only for the side that has an explicit mobile override', () => {
    const settings = settingsWith({ left: 20, right: 30 }, { left: 8 });
    expect(isMobileOuterSpacingOverridden(settings, 'left')).toBe(true);
    expect(isMobileOuterSpacingOverridden(settings, 'right')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  clampDimension, percent, px, resolveDimension, widthAttr, widthCssValue,
} from './dimensions';

describe('dimensions', () => {
  describe('resolveDimension', () => {
    it('resolves desktop for the desktop viewport', () => {
      const dim = { desktop: px(300), mobile: percent(100) };
      expect(resolveDimension(dim, 'desktop')).toEqual(px(300));
    });

    it('resolves the explicit mobile override when present', () => {
      const dim = { desktop: px(300), mobile: percent(100) };
      expect(resolveDimension(dim, 'mobile')).toEqual(percent(100));
    });

    it('inherits desktop for mobile when no override is set', () => {
      const dim = { desktop: px(300) };
      expect(resolveDimension(dim, 'mobile')).toEqual(px(300));
    });
  });

  describe('clampDimension', () => {
    const bounds = { pxMin: 1, pxMax: 1200 };

    it('clamps a percentage to 0-100', () => {
      expect(clampDimension(percent(150), bounds)).toEqual(percent(100));
      expect(clampDimension(percent(-10), bounds)).toEqual(percent(0));
      expect(clampDimension(percent(50), bounds)).toEqual(percent(50));
    });

    it('clamps px to the property-specific bounds', () => {
      expect(clampDimension(px(5000), bounds)).toEqual(px(1200));
      expect(clampDimension(px(0), bounds)).toEqual(px(1));
      expect(clampDimension(px(300), bounds)).toEqual(px(300));
    });

    it('rejects negative px by clamping to the minimum', () => {
      expect(clampDimension(px(-50), bounds)).toEqual(px(1));
    });

    it('rejects NaN by falling back to a valid bound', () => {
      expect(clampDimension({ value: Number.NaN, unit: 'px' }, bounds)).toEqual(px(1));
      expect(clampDimension({ value: Number.NaN, unit: '%' }, bounds)).toEqual(percent(0));
    });

    it('rejects Infinity by clamping to the nearest bound', () => {
      expect(clampDimension({ value: Number.POSITIVE_INFINITY, unit: 'px' }, bounds)).toEqual(px(1200));
      expect(clampDimension({ value: Number.POSITIVE_INFINITY, unit: '%' }, bounds)).toEqual(percent(100));
    });

    it('uses different bounds for different properties (no universal px range)', () => {
      const paddingBounds = { pxMin: 0, pxMax: 200 };
      expect(clampDimension(px(300), paddingBounds)).toEqual(px(200));
      expect(clampDimension(px(300), bounds)).toEqual(px(300));
    });
  });

  describe('widthAttr / widthCssValue', () => {
    it('renders a bare number string for px', () => {
      expect(widthAttr(px(300))).toBe('300');
      expect(widthCssValue(px(300))).toBe('300px');
    });

    it('renders a percentage string for %', () => {
      expect(widthAttr(percent(50))).toBe('50%');
      expect(widthCssValue(percent(50))).toBe('50%');
    });
  });
});

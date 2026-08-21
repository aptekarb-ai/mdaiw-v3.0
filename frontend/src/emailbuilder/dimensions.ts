// Shared px/% dimension domain type — used anywhere a size (width, outer
// spacer) is user-editable in more than one unit. Never store raw strings
// like "300px"/"50%" — {value, unit} gives validation and renderer safety
// a string can't.

export type DimensionUnit = 'px' | '%';

export interface DimensionValue {
  value: number;
  unit: DimensionUnit;
}

// A size that can differ between the Desktop and Mobile builder views.
// `mobile` absent means "inherit the desktop value" — Feature 07's
// Responsive Editor is where a user gets a full per-property inherit/
// override UI; for now this is the minimal shape that doesn't block it.
export interface ResponsiveDimension {
  desktop: DimensionValue;
  mobile?: DimensionValue;
}

export interface PixelBounds {
  pxMin: number;
  pxMax: number;
}

export function px(value: number): DimensionValue {
  return { value, unit: 'px' };
}

export function percent(value: number): DimensionValue {
  return { value, unit: '%' };
}

export function resolveDimension(dimension: ResponsiveDimension, viewport: 'desktop' | 'mobile'): DimensionValue {
  if (viewport === 'mobile' && dimension.mobile) return dimension.mobile;
  return dimension.desktop;
}

// Clamps per-unit: 0-100 for a percentage (instruction: "typically 0-100"),
// a property-specific px range otherwise (never one universal px range —
// callers pass the bounds that make sense for that property). Rejects
// NaN/Infinity by falling back to the nearest valid bound (NaN and -Infinity
// fall to the minimum, +Infinity to the maximum).
export function clampDimension(dimension: DimensionValue, bounds: PixelBounds): DimensionValue {
  const nearestBoundFor = (value: number, min: number, max: number): number => {
    if (Number.isNaN(value)) return min;
    if (value === Number.POSITIVE_INFINITY) return max;
    if (value === Number.NEGATIVE_INFINITY) return min;
    return value;
  };

  if (dimension.unit === '%') {
    const value = nearestBoundFor(dimension.value, 0, 100);
    return percent(Math.min(100, Math.max(0, value)));
  }
  const value = nearestBoundFor(dimension.value, bounds.pxMin, bounds.pxMax);
  return px(Math.min(bounds.pxMax, Math.max(bounds.pxMin, Math.round(value))));
}

export function isValidDimensionUnit(unit: unknown): unit is DimensionUnit {
  return unit === 'px' || unit === '%';
}

// The HTML `width` attribute value — a bare number string for px
// (email-client convention: `width="300"`, not `width="300px"`), or a
// percentage string for %.
export function widthAttr(dimension: DimensionValue): string {
  return dimension.unit === '%' ? `${dimension.value}%` : String(Math.round(dimension.value));
}

export function widthCssValue(dimension: DimensionValue): string {
  return dimension.unit === '%' ? `${dimension.value}%` : `${dimension.value}px`;
}

// Builder-canvas-only approximation of an outer-spacing dimension as a
// pixel margin, for visual feedback while editing (used for both
// top-level and nested-in-column module previews — see
// EmailCanvas.tsx/LayoutCanvasModule.tsx). The exported email HTML
// computes the real spacer <td> from the same DimensionValue instead —
// see registryCore.ts's wrapWithOuterSpacing, the actual source of
// truth.
// Feature 07 — ONE generic Desktop/Mobile resolver for every new flat
// `mobileX?` scalar override field (typography, button width mode,
// spacer height, ...), matching the exact inheritance rule already used
// by every dedicated {desktop, mobile} resolver in this codebase
// (resolveDimension/resolveSpacing/resolveOuterSpacing/resolveColumnGutter):
// mobile inherits desktop unless an explicit mobile value is present.
// Kept generic (desktop/mobile passed as plain values, not a wrapper
// object) so it drops into the existing flat-field convention (e.g.
// SpacerModuleProps.mobileHeight) without a data-shape migration.
export function resolveResponsiveValue<T>(desktop: T, mobile: T | undefined, viewport: 'desktop' | 'mobile'): T {
  if (viewport === 'mobile' && mobile !== undefined) return mobile;
  return desktop;
}

export function outerSpacingPx(dimension: DimensionValue, referenceWidth: number): number {
  return dimension.unit === '%' ? Math.round((dimension.value / 100) * referenceWidth) : dimension.value;
}

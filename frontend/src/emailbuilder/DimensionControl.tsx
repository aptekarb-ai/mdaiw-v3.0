import type { DimensionUnit, DimensionValue, PixelBounds, ResponsiveDimension } from './dimensions';
import { clampDimension, resolveDimension } from './dimensions';
import type { BuilderViewMode } from './registryCore';

interface DimensionControlProps {
  value: DimensionValue;
  allowedUnits?: DimensionUnit[];
  pxBounds: PixelBounds;
  onChange: (next: DimensionValue) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

// Generic reusable px/% control (instruction: "avoid duplicating separate
// width input logic in every module editor"). A single-unit control
// (allowedUnits=['px']) renders a plain number input with a "px" suffix
// instead of a select — used for outer spacing, which stays px-only for
// now (see OuterSpacingControls).
export function DimensionControl({
  value, allowedUnits = ['px', '%'], pxBounds, onChange, disabled, ariaLabel,
}: DimensionControlProps) {
  // Clamping the LOWER bound on every keystroke corrupts multi-digit
  // typing (an intermediate digit below the minimum gets clamped up,
  // and the next keystroke then lands on the clamped value instead of
  // the digit sequence the user is typing — e.g. typing "20" into a
  // min-of-8 field: "2" clamps to 8, then "0" makes "80"). The upper
  // bound is still enforced while typing (it doesn't have this failure
  // mode, and it keeps a runaway value from growing unbounded before
  // the field loses focus); the lower bound is enforced on blur.
  const handleValueChange = (raw: string) => {
    const numeric = Number(raw === '' ? 0 : raw);
    if (!Number.isFinite(numeric)) return;
    const max = value.unit === '%' ? 100 : pxBounds.pxMax;
    onChange({ value: Math.min(numeric, max), unit: value.unit });
  };

  const handleValueBlur = (raw: string) => {
    const numeric = Number(raw);
    onChange(clampDimension({ value: numeric, unit: value.unit }, pxBounds));
  };

  const handleUnitChange = (nextUnit: DimensionUnit) => {
    onChange(clampDimension({ value: value.value, unit: nextUnit }, pxBounds));
  };

  return (
    <div className="dimension-control">
      <input
        type="number"
        className="dimension-control__value"
        aria-label={ariaLabel}
        value={value.value}
        min={value.unit === '%' ? 0 : pxBounds.pxMin}
        max={value.unit === '%' ? 100 : pxBounds.pxMax}
        disabled={disabled}
        onChange={(event) => handleValueChange(event.target.value)}
        onBlur={(event) => handleValueBlur(event.target.value)}
      />
      {allowedUnits.length > 1 ? (
        <select
          className="dimension-control__unit"
          value={value.unit}
          disabled={disabled}
          aria-label="Unit"
          onChange={(event) => handleUnitChange(event.target.value as DimensionUnit)}
        >
          {allowedUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      ) : (
        <span className="dimension-control__unit dimension-control__unit--fixed">{allowedUnits[0]}</span>
      )}
    </div>
  );
}

interface ResponsiveDimensionFieldProps {
  label: string;
  dimension: ResponsiveDimension;
  viewport: BuilderViewMode;
  pxBounds: PixelBounds;
  allowedUnits?: DimensionUnit[];
  onChange: (next: ResponsiveDimension) => void;
}

// Desktop/Mobile-aware width editing (instruction: "Properties panel
// must clearly indicate which viewport settings they are editing" and
// "users must be able to explicitly override the mobile value; do not
// silently overwrite desktop settings when editing mobile"). Reuses the
// SAME Desktop/Mobile switch already in the builder toolbar (threaded
// down as `viewport`) rather than adding a second toggle here.
export function ResponsiveDimensionField({
  label, dimension, viewport, pxBounds, allowedUnits, onChange,
}: ResponsiveDimensionFieldProps) {
  const isMobile = viewport === 'mobile';
  const overridden = isMobile && Boolean(dimension.mobile);
  const resolved = resolveDimension(dimension, viewport);

  return (
    <div className="properties-panel__field">
      <span>
        {label} ({isMobile ? 'Mobile' : 'Desktop'})
      </span>
      <DimensionControl
        value={resolved}
        pxBounds={pxBounds}
        allowedUnits={allowedUnits}
        ariaLabel={`${label} (${isMobile ? 'Mobile' : 'Desktop'})`}
        onChange={(next) => {
          if (isMobile) {
            onChange({ ...dimension, mobile: next });
          } else {
            onChange({ ...dimension, desktop: next });
          }
        }}
      />
      {isMobile && (
        overridden ? (
          <button
            type="button"
            className="properties-panel__inherit-reset"
            onClick={() => onChange({ desktop: dimension.desktop })}
          >
            Use Desktop value
          </button>
        ) : (
          <span className="properties-panel__inherit-hint">Inheriting Desktop value</span>
        )
      )}
    </div>
  );
}

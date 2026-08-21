// Feature 06 — one shared color control for every color-bearing field
// across every module editor (instruction 48: reuse, don't duplicate).
// Wraps the project's existing `<input type="color">` pattern (already
// used since Feature 04) with two additions used consistently everywhere
// a color is genuinely optional: a visible hex text field (so a value
// can be typed/pasted, not only picked) and, when `allowNone` is set, a
// "No background" reset matching Feature 05's ColumnEditor precedent.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX_COLOR_RE.test(withHash) ? withHash.toUpperCase() : null;
}

interface ColorControlProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
}

export function ColorControl({ label, value, onChange, allowNone, noneLabel = 'No color' }: ColorControlProps) {
  const swatchValue = HEX_COLOR_RE.test(value) ? value : '#FFFFFF';
  return (
    <div className="properties-panel__field">
      <span>{label}</span>
      <div className="color-control">
        <input
          type="color"
          className="color-control__swatch"
          value={swatchValue}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label={`${label} swatch`}
        />
        <input
          type="text"
          className="color-control__hex"
          value={value}
          placeholder="#RRGGBB"
          aria-label={`${label} hex value`}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => {
            const normalized = normalizeHexColor(event.target.value);
            if (normalized !== null) onChange(normalized);
          }}
        />
      </div>
      {allowNone && value && (
        <button type="button" className="properties-panel__inherit-reset" onClick={() => onChange('')}>
          {noneLabel}
        </button>
      )}
    </div>
  );
}

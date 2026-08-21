import { EMAIL_SAFE_FONTS } from './fonts';
import { ColorControl } from './ColorControl';

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 72;
const LINE_HEIGHT_MIN = 10;
const LINE_HEIGHT_MAX = 120;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

interface FieldBinding<T> {
  value: T;
  onChange: (next: T) => void;
}

// Clamping on every keystroke corrupts multi-digit typing (e.g. typing
// "20" hits an intermediate "2" that clamps up to the min, then the "0"
// lands on the clamped value instead of the digit sequence the user
// typed) — breaks the "immediate typing feel" requirement. Instead we
// accept the raw in-progress value while typing and only clamp once the
// user leaves the field.
function NumberField({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (next: number) => void; min: number; max: number;
}) {
  return (
    <label className="properties-panel__field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') return;
          const numeric = Number(raw);
          if (Number.isFinite(numeric)) onChange(numeric);
        }}
        onBlur={(event) => onChange(clamp(Number(event.target.value), min, max))}
      />
    </label>
  );
}

// Feature 06 — one shared typography control set for every module that
// exposes editable text styling (instruction 48: reuse, don't
// duplicate). Every sub-field is optional and independently supplied —
// Text uses all five; a composite module's text block uses only
// fontFamily/fontSize/color; a future module can pick whichever subset
// is meaningful for it without a second implementation.
export interface TypographyControlsProps {
  fontFamily?: FieldBinding<string>;
  fontSize: FieldBinding<number>;
  fontWeight?: FieldBinding<400 | 700>;
  lineHeight?: FieldBinding<number>;
  color?: FieldBinding<string>;
}

export function TypographyControls({ fontFamily, fontSize, fontWeight, lineHeight, color }: TypographyControlsProps) {
  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">Typography</span>
      {fontFamily && (
        <label className="properties-panel__field">
          <span>Font family</span>
          <select value={fontFamily.value} onChange={(event) => fontFamily.onChange(event.target.value)}>
            {EMAIL_SAFE_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
          </select>
        </label>
      )}
      <div className="properties-panel__typography-row">
        <NumberField label="Font size (px)" value={fontSize.value} onChange={fontSize.onChange} min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} />
        {fontWeight && (
          <label className="properties-panel__field">
            <span>Font weight</span>
            <select value={fontWeight.value} onChange={(event) => fontWeight.onChange(Number(event.target.value) as 400 | 700)}>
              <option value={400}>Normal</option>
              <option value={700}>Bold</option>
            </select>
          </label>
        )}
      </div>
      {lineHeight && (
        <NumberField label="Line height (px)" value={lineHeight.value} onChange={lineHeight.onChange} min={LINE_HEIGHT_MIN} max={LINE_HEIGHT_MAX} />
      )}
      {color && <ColorControl label="Text color" value={color.value} onChange={color.onChange} />}
    </div>
  );
}

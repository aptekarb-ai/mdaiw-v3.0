import { MAX_PADDING, MIN_PADDING, type EmailModuleSettings } from './edm';

interface PaddingControlsProps {
  settings: EmailModuleSettings;
  onChange: (patch: Partial<EmailModuleSettings>) => void;
}

const FIELDS: { key: keyof EmailModuleSettings; label: string }[] = [
  { key: 'paddingTop', label: 'Top' },
  { key: 'paddingRight', label: 'Right' },
  { key: 'paddingBottom', label: 'Bottom' },
  { key: 'paddingLeft', label: 'Left' },
];

export function PaddingControls({ settings, onChange }: PaddingControlsProps) {
  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">Padding (px)</span>
      <div className="properties-panel__padding-grid">
        {FIELDS.map(({ key, label }) => (
          <label key={key} className="properties-panel__padding-field">
            <span>{label}</span>
            <input
              type="number"
              min={MIN_PADDING}
              max={MAX_PADDING}
              value={settings[key] as number ?? 0}
              onChange={(event) => {
                const raw = Number(event.target.value);
                const clamped = Number.isFinite(raw)
                  ? Math.min(MAX_PADDING, Math.max(MIN_PADDING, Math.round(raw)))
                  : MIN_PADDING;
                onChange({ [key]: clamped });
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

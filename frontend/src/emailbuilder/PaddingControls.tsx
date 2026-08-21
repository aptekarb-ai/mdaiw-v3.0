import { MAX_PADDING, MIN_PADDING, isMobileOverridden, resolveSpacing, type EmailModuleSettings, type ModuleSpacingValues } from './edm';
import type { BuilderViewMode } from './registryCore';

interface PaddingControlsProps {
  settings: EmailModuleSettings;
  viewport: BuilderViewMode;
  onChange: (patch: Partial<EmailModuleSettings>) => void;
}

const FIELDS: { key: keyof ModuleSpacingValues; label: string }[] = [
  { key: 'paddingTop', label: 'Top' },
  { key: 'paddingRight', label: 'Right' },
  { key: 'paddingBottom', label: 'Bottom' },
  { key: 'paddingLeft', label: 'Left' },
];

function clampPadding(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_PADDING;
  return Math.min(MAX_PADDING, Math.max(MIN_PADDING, Math.round(raw)));
}

// Desktop/Mobile-aware internal padding (instruction: editing while in
// the Mobile builder view edits settings.mobile overrides, not desktop —
// "do not silently overwrite desktop settings when editing mobile").
// Reuses the same Desktop/Mobile switch already in the toolbar.
export function PaddingControls({ settings, viewport, onChange }: PaddingControlsProps) {
  const isMobile = viewport === 'mobile';
  const resolved = resolveSpacing(settings, viewport);

  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">
        Padding (px) — {isMobile ? 'Mobile' : 'Desktop'}
      </span>
      <div className="properties-panel__padding-grid">
        {FIELDS.map(({ key, label }) => {
          const overridden = isMobile && isMobileOverridden(settings, key);
          return (
            <label key={key} className="properties-panel__padding-field">
              <span>
                {label}
                {isMobile && (overridden ? ' (override)' : ' (inherited)')}
              </span>
              <input
                type="number"
                min={MIN_PADDING}
                max={MAX_PADDING}
                value={resolved[key]}
                onChange={(event) => {
                  const clamped = clampPadding(Number(event.target.value));
                  if (isMobile) {
                    onChange({ mobile: { ...settings.mobile, [key]: clamped } });
                  } else {
                    onChange({ desktop: { ...settings.desktop, [key]: clamped } });
                  }
                }}
              />
            </label>
          );
        })}
      </div>
      {isMobile && Object.keys(settings.mobile).length > 0 && (
        <button
          type="button"
          className="properties-panel__inherit-reset"
          onClick={() => onChange({ mobile: {} })}
        >
          Use Desktop values for all
        </button>
      )}
    </div>
  );
}

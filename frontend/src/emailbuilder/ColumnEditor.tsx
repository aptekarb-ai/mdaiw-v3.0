import type {
  ColumnContainerSettings, ColumnVerticalAlign, EmailColumn, EmailModule, EmailModuleSettings, LayoutColumnDirection,
} from './edm';
import { MAX_PADDING, MIN_PADDING, resolveColumnGutter, resolveSpacing } from './edm';
import type { BuilderViewMode } from './registryCore';
import { ResponsiveDimensionField } from './DimensionControl';
import { ColorControl } from './ColorControl';
import {
  COLUMN_GUTTER_PX_BOUNDS, COLUMN_VALIGN_OPTIONS, LOW_COLUMN_WIDTH_WARNING_PERCENT, MIN_COLUMN_WIDTH_PERCENT,
  balanceColumnWidths, hasLowWidthWarning, validateColumnWidths,
} from './layoutModel';

function clampPadding(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_PADDING;
  return Math.min(MAX_PADDING, Math.max(MIN_PADDING, Math.round(raw)));
}

const PADDING_FIELDS: { key: keyof ColumnContainerSettings['desktop']; label: string }[] = [
  { key: 'paddingTop', label: 'Top' },
  { key: 'paddingRight', label: 'Right' },
  { key: 'paddingBottom', label: 'Bottom' },
  { key: 'paddingLeft', label: 'Left' },
];

// Generic column/module padding grid — same visual language as
// PaddingControls.tsx (module-level padding), reused here for
// ColumnContainerSettings (a distinct, smaller {desktop,mobile} shape —
// see edm.ts's resolveSpacing docstring for why both share one resolver).
function ColumnPaddingControls({ settings, viewport, onChange }: {
  settings: ColumnContainerSettings; viewport: BuilderViewMode; onChange: (patch: Partial<ColumnContainerSettings>) => void;
}) {
  const isMobile = viewport === 'mobile';
  const resolved = resolveSpacing(settings, viewport);
  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">
        Column Padding (px) — {isMobile ? 'Mobile' : 'Desktop'}
      </span>
      <div className="properties-panel__padding-grid">
        {PADDING_FIELDS.map(({ key, label }) => (
          <label key={key} className="properties-panel__padding-field">
            <span>{label}</span>
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
        ))}
      </div>
    </div>
  );
}

// --- Content tab: read-only-ish structure overview ----------------------

export function LayoutStructureOverview({ module, onSelectColumn }: {
  module: EmailModule; onSelectColumn: (columnId: string) => void;
}) {
  const widths = (module.props as { columnWidths: number[] }).columnWidths;
  const columns = module.columns ?? [];
  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">Column structure</span>
      <ul className="properties-panel__column-overview">
        {columns.map((column, index) => (
          <li key={column.id}>
            <button type="button" onClick={() => onSelectColumn(column.id)}>
              <span>Column {index + 1} ({widths[index] ?? 0}%)</span>
              <span className="properties-panel__column-overview-count">
                {column.modules.length === 0 ? 'Empty' : `${column.modules.length} module${column.modules.length === 1 ? '' : 's'}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="properties-panel__hint">Select a column above, or click it directly on the canvas, to edit its content.</p>
    </div>
  );
}

// --- Style tab: column widths + gutter -----------------------------------

export function ColumnWidthsEditor({ module, onChangeWidths }: {
  module: EmailModule; onChangeWidths: (widths: number[]) => void;
}) {
  const widths = (module.props as { columnWidths: number[] }).columnWidths;
  const validation = validateColumnWidths(widths);
  const lowWarning = hasLowWidthWarning(widths);

  function setWidth(index: number, value: number) {
    const next = widths.slice();
    next[index] = Number.isFinite(value) ? value : 0;
    onChangeWidths(next);
  }

  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">Column Widths</span>
      <div className="properties-panel__column-widths">
        {widths.map((width, index) => (
          <label key={index} className="properties-panel__field">
            <span>Column {index + 1}</span>
            <div className="properties-panel__column-width-input">
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={width}
                onChange={(event) => setWidth(index, Number(event.target.value))}
              />
              <span>%</span>
            </div>
          </label>
        ))}
      </div>
      <p className={validation.totalError ? 'properties-panel__validation properties-panel__validation--error' : 'properties-panel__validation'}>
        Total: {validation.total}%{validation.totalError ? ' — must equal 100%' : ''}
      </p>
      {validation.belowMinimum.length > 0 && (
        <p className="properties-panel__validation properties-panel__validation--error">
          Column{validation.belowMinimum.length > 1 ? 's' : ''} {validation.belowMinimum.map((i) => i + 1).join(', ')} below the {MIN_COLUMN_WIDTH_PERCENT}% minimum.
        </p>
      )}
      {!validation.totalError && lowWarning && (
        <p className="properties-panel__validation properties-panel__validation--warning">
          Some columns are under {LOW_COLUMN_WIDTH_WARNING_PERCENT}% — content may be very narrow.
        </p>
      )}
      <button type="button" className="properties-panel__inherit-reset" onClick={() => onChangeWidths(balanceColumnWidths(widths.length))}>
        Balance Columns
      </button>
    </div>
  );
}

export function ColumnGutterEditor({ settings, viewport, onChange }: {
  settings: EmailModuleSettings; viewport: BuilderViewMode; onChange: (patch: Partial<EmailModuleSettings>) => void;
}) {
  const current = settings.columnGutter ?? { desktop: resolveColumnGutter(settings, 'desktop') };
  return (
    <ResponsiveDimensionField
      label="Column Gutter"
      dimension={current}
      viewport={viewport}
      pxBounds={COLUMN_GUTTER_PX_BOUNDS}
      allowedUnits={['px']}
      onChange={(next) => onChange({ columnGutter: next })}
    />
  );
}

// --- Settings tab addition: mobile stacking/order -------------------------

export function MobileStackingSettings({ module, onChange }: {
  module: EmailModule; onChange: (patch: Partial<EmailModuleSettings>) => void;
}) {
  const columnCount = module.columns?.length ?? 0;
  const stack = module.settings.mobileStack !== false;
  const order = module.settings.mobileColumnOrder && module.settings.mobileColumnOrder.length === columnCount
    ? module.settings.mobileColumnOrder
    : Array.from({ length: columnCount }, (_, i) => i);

  function move(position: number, direction: -1 | 1) {
    const target = position + direction;
    if (target < 0 || target >= order.length) return;
    const next = order.slice();
    [next[position], next[target]] = [next[target], next[position]];
    onChange({ mobileColumnOrder: next });
  }

  const gap = module.settings.mobileColumnGap?.value ?? 0;

  return (
    <div className="properties-panel__field-group">
      <label className="properties-panel__checkbox-field">
        <input
          type="checkbox"
          checked={stack}
          onChange={(event) => onChange({ mobileStack: event.target.checked })}
        />
        <span>Stack columns on Mobile</span>
      </label>
      {!stack && (
        <p className="properties-panel__hint">
          Columns stay side-by-side on Mobile. On narrow screens ({columnCount >= 3 ? 'especially with 3+ columns' : 'depending on content'}) this can be hard to read — consider turning stacking back on unless this layout is intentional.
        </p>
      )}
      {stack && (
        <>
          <label className="properties-panel__field">
            <span>Mobile column gap (px)</span>
            <input
              type="number"
              min={0}
              max={COLUMN_GUTTER_PX_BOUNDS.pxMax}
              value={gap}
              onChange={(event) => {
                const value = Math.max(0, Math.round(Number(event.target.value) || 0));
                onChange({ mobileColumnGap: { value, unit: 'px' } });
              }}
            />
          </label>
          <div className="properties-panel__mobile-order">
            <span className="properties-panel__field-group-label">Mobile order (preview only)</span>
            <p className="properties-panel__hint">
              Reorders the builder preview only. The exported email keeps columns in Desktop order (Desktop left-to-right becomes Mobile top-to-bottom).
            </p>
            <ol>
              {order.map((columnIndex, position) => (
                <li key={columnIndex}>
                  <span>Column {columnIndex + 1}</span>
                  <div className="properties-panel__mobile-order-controls">
                    <button
                      type="button"
                      aria-label={`Move Column ${columnIndex + 1} up`}
                      disabled={position === 0}
                      onClick={() => move(position, -1)}
                    >
                      <span className="mdaiw-icon mdaiw-icon--chevron-down properties-panel__mobile-order-icon--up" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move Column ${columnIndex + 1} down`}
                      disabled={position === order.length - 1}
                      onClick={() => move(position, 1)}
                    >
                      <span className="mdaiw-icon mdaiw-icon--chevron-down" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

// --- Settings tab addition: Desktop column direction -----------------------
//
// Module-4 Final Gap Closure, Correction 2 (Feature 05) — deliberately a
// SEPARATE component from MobileStackingSettings above, not a field
// nested inside it: this is a Desktop-side setting, distinct from
// Mobile order (mobileColumnOrder), even though the design places both
// controls in the same panel. Column sequence only — never wired to
// alignment, text direction, or locale, and never mutates `columns`.
export function DesktopDirectionSettings({ module, onChange }: {
  module: EmailModule; onChange: (patch: Partial<EmailModuleSettings>) => void;
}) {
  const direction: LayoutColumnDirection = module.settings.desktopColumnDirection === 'rtl' ? 'rtl' : 'ltr';

  return (
    <label className="properties-panel__field">
      <span>Direction on Desktop</span>
      <select
        value={direction}
        onChange={(event) => onChange({ desktopColumnDirection: event.target.value as LayoutColumnDirection })}
      >
        <option value="ltr">Left → Right</option>
        <option value="rtl">Right → Left</option>
      </select>
    </label>
  );
}

// --- Column-selected editor ------------------------------------------------

export function ColumnEditor({
  module, column, columnIndex, viewport, onChangeWidths, onChangeColumnSettings,
}: {
  module: EmailModule;
  column: EmailColumn;
  columnIndex: number;
  viewport: BuilderViewMode;
  onChangeWidths: (widths: number[]) => void;
  onChangeColumnSettings: (patch: Partial<ColumnContainerSettings>) => void;
}) {
  const widths = (module.props as { columnWidths: number[] }).columnWidths;

  return (
    <>
      <div className="properties-panel__field-group">
        <label className="properties-panel__field">
          <span>Width</span>
          <div className="properties-panel__column-width-input">
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={widths[columnIndex] ?? 0}
              onChange={(event) => {
                const next = widths.slice();
                next[columnIndex] = Number(event.target.value);
                onChangeWidths(next);
              }}
            />
            <span>%</span>
          </div>
        </label>
        <ColorControl
          label="Background color"
          value={column.settings.backgroundColor}
          onChange={(backgroundColor) => onChangeColumnSettings({ backgroundColor })}
          allowNone
          noneLabel="No background"
        />
        <label className="properties-panel__field">
          <span>Vertical alignment</span>
          <select
            value={column.settings.verticalAlign}
            onChange={(event) => onChangeColumnSettings({ verticalAlign: event.target.value as ColumnVerticalAlign })}
          >
            {COLUMN_VALIGN_OPTIONS.map((option) => (
              <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>
            ))}
          </select>
        </label>
      </div>
      <ColumnPaddingControls settings={column.settings} viewport={viewport} onChange={onChangeColumnSettings} />
    </>
  );
}

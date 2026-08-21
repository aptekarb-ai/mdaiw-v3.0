import type { ColumnContainerSettings, ColumnVerticalAlign, EmailColumn, EmailModule, EmailModuleSettings } from './edm';
import { MAX_PADDING, MIN_PADDING, resolveColumnGutter, resolveSpacing } from './edm';
import type { BuilderViewMode } from './registryCore';
import { ResponsiveDimensionField } from './DimensionControl';
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
      {stack && (
        <div className="properties-panel__mobile-order">
          <span className="properties-panel__field-group-label">Mobile order</span>
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
      )}
    </div>
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
        <label className="properties-panel__field">
          <span>Background color</span>
          <input
            type="color"
            value={column.settings.backgroundColor || '#ffffff'}
            onChange={(event) => onChangeColumnSettings({ backgroundColor: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="properties-panel__inherit-reset"
          onClick={() => onChangeColumnSettings({ backgroundColor: '' })}
        >
          No background
        </button>
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

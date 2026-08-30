import type {
  ColumnContainerSettings, ColumnVerticalAlign, EmailColumn, EmailModule, EmailModuleSettings, LayoutColumnDirection,
} from './edm';
import { MAX_PADDING, MIN_PADDING, resolveDesktopGutterPx, resolveMobileGutterPx, resolveSpacing } from './edm';
import type { BuilderViewMode } from './registryCore';
import { ColorControl } from './ColorControl';
import {
  COLUMN_GUTTER_PX_BOUNDS, COLUMN_VALIGN_OPTIONS, LOW_COLUMN_WIDTH_WARNING_PERCENT, MIN_COLUMN_WIDTH_PERCENT,
  balanceColumnWidths, hasLowWidthWarning, resolveColumnPixelWidths, validateColumnWidths,
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

// Column Width Display + Responsive Gutter UI Correction — mode-aware.
// Desktop (or Mobile with stacking explicitly OFF, since the exported
// HTML then genuinely stays side-by-side there too — no CSS override
// exists to change it): shows the SAME effective pixel widths
// layoutCatalog.tsx's renderEmailHtml actually emits (via the identical
// resolveColumnPixelWidths call, never a second algorithm), alongside
// the editable source ratio. Mobile WITH stacking: ratios are
// meaningless as rendered widths (every stacked column is a flat 100%
// regardless of ratio — see responsiveStyles.ts), so this shows that
// truthfully instead of a misleading 50/50 readout; the ratios
// themselves are untouched underneath and reappear exactly as before
// when switching back to Desktop.
export function ColumnWidthsEditor({ module, viewport, availableWidthPx, onChangeWidths }: {
  module: EmailModule; viewport: BuilderViewMode; availableWidthPx: number; onChangeWidths: (widths: number[]) => void;
}) {
  const widths = (module.props as { columnWidths: number[] }).columnWidths;
  const validation = validateColumnWidths(widths);
  const lowWarning = hasLowWidthWarning(widths);
  const stacksOnMobile = module.settings.mobileStack !== false;
  const showStackedMobileView = viewport === 'mobile' && stacksOnMobile;

  function setWidth(index: number, value: number) {
    const next = widths.slice();
    next[index] = Number.isFinite(value) ? value : 0;
    onChangeWidths(next);
  }

  if (showStackedMobileView) {
    const mobileGutterPx = resolveMobileGutterPx(module.settings);
    const hideGutterOnMobile = module.settings.hideGutterOnMobile !== false;
    return (
      <div className="properties-panel__field-group">
        <span className="properties-panel__field-group-label">Column Widths</span>
        <p className="properties-panel__hint">
          Columns stack to full width on Mobile. The Desktop ratios below stay stored and are restored exactly when you switch back.
        </p>
        {/* A compact status summary, not a default browser bullet list —
            same font size/line-height/color as the rest of the Properties
            panel (properties-panel__hint), each row a plain label/value
            pair. Dynamically reflects any column count. */}
        <div className="properties-panel__mobile-width-summary">
          {widths.map((_, index) => (
            <div key={index} className="properties-panel__mobile-width-summary-row">
              <span>Column {index + 1}</span>
              <span>100% stacked</span>
            </div>
          ))}
          {widths.length > 1 && (
            <div className="properties-panel__mobile-width-summary-row">
              <span>Vertical spacing</span>
              <span>{hideGutterOnMobile ? 'Hidden' : `${mobileGutterPx}px`}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const gutterPx = resolveDesktopGutterPx(module.settings);
  const { columnPx } = resolveColumnPixelWidths(widths, gutterPx, availableWidthPx);
  const totalGutterPx = gutterPx * Math.max(0, widths.length - 1);
  const effectiveTotalPx = columnPx.reduce((sum, px) => sum + px, 0) + totalGutterPx;

  return (
    <div className="properties-panel__field-group properties-panel__field-group--column-widths">
      <span className="properties-panel__field-group-label">Column Widths</span>
      <div className="properties-panel__column-widths">
        {widths.map((width, index) => (
          <label key={index} className="properties-panel__field">
            <span>Column {index + 1} ({columnPx[index] ?? 0}px)</span>
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
      <p className="properties-panel__hint">
        Effective total: {effectiveTotalPx}px{effectiveTotalPx === availableWidthPx ? ' ✓' : ''}
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

function clampGutterPx(raw: number): number {
  if (!Number.isFinite(raw)) return COLUMN_GUTTER_PX_BOUNDS.pxMin;
  return Math.min(COLUMN_GUTTER_PX_BOUNDS.pxMax, Math.max(COLUMN_GUTTER_PX_BOUNDS.pxMin, Math.round(raw)));
}

// Column Width Display + Responsive Gutter UI Correction — mode-aware:
// only ONE of Desktop/Mobile is ever shown at a time, driven by the
// builder's own Desktop/Mobile viewport toggle (never both fields
// together). Desktop and Mobile remain two genuinely separate stored
// values (columnGutterPx/mobileColumnGutterPx, never derived from each
// other) — switching modes only changes which field is VISIBLE, it never
// reads, writes or clears the other one. The caller (PropertiesPanel.tsx)
// hides this whole control for a 1-column layout, where a gutter is
// meaningless.
export function ColumnGutterEditor({ settings, viewport, onChange }: {
  settings: EmailModuleSettings; viewport: BuilderViewMode; onChange: (patch: Partial<EmailModuleSettings>) => void;
}) {
  const desktopPx = resolveDesktopGutterPx(settings);
  const mobilePx = resolveMobileGutterPx(settings);
  const hideGutterOnMobile = settings.hideGutterOnMobile !== false;
  const isMobile = viewport === 'mobile';

  if (isMobile) {
    return (
      <div className="properties-panel__field-group">
        <span className="properties-panel__field-group-label">Column Spacing</span>
        <label className="properties-panel__field">
          <span>Mobile (px)</span>
          <input
            type="number"
            min={COLUMN_GUTTER_PX_BOUNDS.pxMin}
            max={COLUMN_GUTTER_PX_BOUNDS.pxMax}
            value={mobilePx}
            disabled={hideGutterOnMobile}
            onChange={(event) => onChange({ mobileColumnGutterPx: clampGutterPx(Number(event.target.value)) })}
          />
        </label>
        <label className="properties-panel__checkbox-field">
          <input
            type="checkbox"
            checked={hideGutterOnMobile}
            onChange={(event) => onChange({ hideGutterOnMobile: event.target.checked })}
          />
          <span>Hide gutter on mobile</span>
        </label>
        {/* The stored Mobile value is NEVER cleared when hidden — only
            the input above is visually disabled — so unchecking this
            always restores exactly what was configured before. */}
        <p className="properties-panel__hint">
          {hideGutterOnMobile
            ? `No vertical spacing between stacked columns. Uncheck to restore ${mobilePx}px.`
            : `${mobilePx}px of vertical spacing between stacked columns.`}
        </p>
      </div>
    );
  }

  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">Column Gutter</span>
      <label className="properties-panel__field">
        <span>Desktop (px)</span>
        <input
          type="number"
          min={COLUMN_GUTTER_PX_BOUNDS.pxMin}
          max={COLUMN_GUTTER_PX_BOUNDS.pxMax}
          value={desktopPx}
          onChange={(event) => onChange({ columnGutterPx: clampGutterPx(Number(event.target.value)) })}
        />
      </label>
    </div>
  );
}

// Structural Width Contract correction — background for the parent/
// central layout structure itself (module.settings.backgroundColor/
// backgroundImage), distinct from each child column's own independent
// background (see ColumnEditor's own Background color/image fields
// above, for a SELECTED column). Covers the central parent structure
// including its own internal padding — never the left/right Outer
// Spacer Columns, which are physical siblings handled entirely by
// Outer Spacer Columns settings, not this control.
export function LayoutBackgroundEditor({ settings, onChange }: {
  settings: EmailModuleSettings; onChange: (patch: Partial<EmailModuleSettings>) => void;
}) {
  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">Layout Background</span>
      <ColorControl
        label="Background color"
        value={settings.backgroundColor ?? ''}
        onChange={(backgroundColor) => onChange({ backgroundColor })}
        allowNone
        noneLabel="No background"
      />
      <label className="properties-panel__field">
        <span>Background image URL</span>
        <input
          type="text"
          value={settings.backgroundImage ?? ''}
          onChange={(event) => onChange({ backgroundImage: event.target.value || undefined })}
          placeholder="https://example.com/background.jpg"
        />
      </label>
      <p className="properties-panel__hint">
        Applies to the full layout background, including outer spacer areas, internal padding and column gutters. Each column&apos;s own background (if set) overlays this for that column only.
      </p>
    </div>
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
      {!stack && (
        <p className="properties-panel__hint">
          Columns stay side-by-side on Mobile. On narrow screens ({columnCount >= 3 ? 'especially with 3+ columns' : 'depending on content'}) this can be hard to read — consider turning stacking back on unless this layout is intentional.
        </p>
      )}
      {stack && (
        <>
          {/* Mobile gutter/stacking correction — the vertical spacing
              between stacked columns is now configured in ONE place, the
              Mobile (px) field under Column Gutter/Column Spacing in the
              Style tab (mobileColumnGutterPx + Hide gutter on mobile),
              never a second "Mobile column gap" control here. */}
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
  module, column, columnIndex, viewport, availableWidthPx, onChangeWidths, onChangeColumnSettings,
}: {
  module: EmailModule;
  column: EmailColumn;
  columnIndex: number;
  viewport: BuilderViewMode;
  // Column Width Display + Responsive Gutter UI Correction — the layout's
  // real available pixel width (registryCore.tsx's
  // computeLayoutAvailableWidthPx), used ONLY to display the effective
  // rendered width beside the editable ratio — never to compute a
  // second, independent width value.
  availableWidthPx: number;
  onChangeWidths: (widths: number[]) => void;
  onChangeColumnSettings: (patch: Partial<ColumnContainerSettings>) => void;
}) {
  const widths = (module.props as { columnWidths: number[] }).columnWidths;
  const stacksOnMobile = module.settings.mobileStack !== false;
  const showStackedMobileView = viewport === 'mobile' && stacksOnMobile;
  const gutterPx = resolveDesktopGutterPx(module.settings);
  const { columnPx } = resolveColumnPixelWidths(widths, gutterPx, availableWidthPx);
  const effectivePx = columnPx[columnIndex] ?? 0;
  const ratio = widths[columnIndex] ?? 0;

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
              value={ratio}
              onChange={(event) => {
                const next = widths.slice();
                next[columnIndex] = Number(event.target.value);
                onChangeWidths(next);
              }}
            />
            <span>%</span>
          </div>
        </label>
        {/* Column Width Display + Responsive Gutter UI Correction — the
            persisted value stays the ratio (the input above); this is a
            READ-ONLY derived readout of what the renderer actually
            produces, from the exact same resolveColumnPixelWidths call
            layoutCatalog.tsx uses — never a second calculation, and the
            ratio itself is never converted to px as the stored value. */}
        {showStackedMobileView ? (
          <p className="properties-panel__hint">100% stacked on Mobile — the {ratio}% Desktop ratio is preserved.</p>
        ) : (
          <p className="properties-panel__column-effective-width">
            {effectivePx}px <span className="properties-panel__hint">({ratio}% layout ratio)</span>
          </p>
        )}
        <ColorControl
          label="Background color"
          value={column.settings.backgroundColor}
          onChange={(backgroundColor) => onChangeColumnSettings({ backgroundColor })}
          allowNone
          noneLabel="No background"
        />
        {/* E5 — generic per-column background image, shared by every
            registered layout/ratio through the same ColumnContainerSettings
            shape every other column control here already uses. Background
            color above always stays the fallback rendered behind it. */}
        <label className="properties-panel__field">
          <span>Background image URL</span>
          <input
            type="text"
            value={column.settings.backgroundImage ?? ''}
            onChange={(event) => onChangeColumnSettings({ backgroundImage: event.target.value || undefined })}
            placeholder="https://example.com/background.jpg"
          />
        </label>
        <p className="properties-panel__hint">Optional. Renders behind this column's content, with the background color above as the fallback if it fails to load.</p>
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

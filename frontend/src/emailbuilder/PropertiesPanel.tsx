import { useState, type ReactNode } from 'react';
import type {
  ButtonModuleProps, ButtonWidthMode, ColumnContainerSettings, CompositeModuleProps, EmailColumn, EmailModule,
  EmailModuleSettings, HorizontalAlign, ImageModuleProps, ModuleVisibility, TextModuleProps,
} from './edm';
import { getModuleDefinition } from './moduleRegistry';
import { IMAGE_WIDTH_PX_BOUNDS, getPath, setPath, type BuilderViewMode } from './registryCore';
import { PaddingControls } from './PaddingControls';
import { OuterSpacingControls } from './OuterSpacingControls';
import { ResponsiveDimensionField } from './DimensionControl';
import {
  ColumnEditor, ColumnGutterEditor, ColumnWidthsEditor, DesktopDirectionSettings, LayoutStructureOverview,
  MobileStackingSettings,
} from './ColumnEditor';
import { ColorControl } from './ColorControl';
import { TypographyControls } from './TypographyControls';
import { RepeatableItemEditor } from './RepeatableItemEditor';
import { DEFAULT_FONT_ID, EMAIL_SAFE_FONTS } from './fonts';
import { AssetManagerDialog, type AssetSelection } from './AssetManagerDialog';
import './PropertiesPanel.css';

type PropertiesTab = 'content' | 'style' | 'settings';

// Feature 05 — resolved from useEmailBuilderState's `selectedColumn` (ids
// only) by the workspace page into the actual EmailColumn + its index, so
// this file never needs its own tree-lookup logic.
export interface SelectedColumnContext {
  layoutId: string;
  column: EmailColumn;
  columnIndex: number;
}

interface PropertiesPanelProps {
  module: EmailModule | null;
  selectedColumn: SelectedColumnContext | null;
  breadcrumb: string[];
  // The owning layout's id for whatever selection produced `breadcrumb`
  // (present whenever breadcrumb.length > 1) — lets the breadcrumb's
  // first segment jump back to "layout selected, no column drilled in"
  // regardless of whether the CURRENT selection is a column or a nested
  // module several levels different from the layout itself.
  breadcrumbLayoutId: string | null;
  viewport: BuilderViewMode;
  onUpdateProps: (id: string, patch: Record<string, unknown>) => void;
  onUpdateSettings: (id: string, patch: Partial<EmailModuleSettings>) => void;
  onUpdateColumnWidths: (layoutId: string, widths: number[]) => void;
  onUpdateColumnSettings: (layoutId: string, columnId: string, patch: Partial<ColumnContainerSettings>) => void;
  onSelectColumn: (layoutId: string, columnId: string) => void;
  // Feature 05 — lets the breadcrumb's first segment ("2 Columns 40/60")
  // reselect just the layout (clearing any drilled-into column), since
  // clicking a column on the canvas has no other way back up once a
  // nested module or column is selected — every click there intentionally
  // stopPropagation()s past the layout's own outer selection handler.
  onSelectModule: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function PropertySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="properties-panel__section">
      <h3 className="properties-panel__section-title">{title}</h3>
      <div className="properties-panel__section-body">{children}</div>
    </div>
  );
}

export function AlignField({ value, onChange }: { value: HorizontalAlign; onChange: (value: HorizontalAlign) => void }) {
  return (
    <label className="properties-panel__field">
      <span>Alignment</span>
      <select value={value} onChange={(event) => onChange(event.target.value as HorizontalAlign)}>
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
    </label>
  );
}

// Feature 07 — per-module responsive visibility (instruction 10/30/31).
// A single Desktop/Mobile-aware select rather than two independent
// checkboxes — 'all'/'hideMobile'/'hideDesktop' is a mutually exclusive
// choice, not two independently-toggleable flags, so a select avoids the
// invalid "hide on both" state entirely instead of needing to guard
// against it.
function VisibilitySettings({ module, viewport, onChange }: {
  module: EmailModule; viewport: BuilderViewMode; onChange: (patch: Partial<EmailModuleSettings>) => void;
}) {
  const visibility = module.settings.visibility ?? 'all';
  return (
    <>
      <label className="properties-panel__field">
        <span>Show this module on</span>
        <select value={visibility} onChange={(event) => onChange({ visibility: event.target.value as ModuleVisibility })}>
          <option value="all">All devices</option>
          <option value="hideMobile">Hide on Mobile</option>
          <option value="hideDesktop">Hide on Desktop</option>
        </select>
      </label>
      {visibility !== 'all' && (
        <p className="properties-panel__hint">
          {visibility === 'hideMobile'
            ? 'Hidden at the Mobile breakpoint in the exported email. Still visible on Desktop and in Desktop preview.'
            : 'Hidden by default (Desktop is the structural fallback) and revealed again at the Mobile breakpoint.'}
          {' '}The module stays in this email — it is never deleted.
        </p>
      )}
      {viewport === 'mobile' && visibility === 'hideMobile' && (
        <p className="properties-panel__hint">Canvas: hidden in this Mobile preview.</p>
      )}
      {viewport === 'desktop' && visibility === 'hideDesktop' && (
        <p className="properties-panel__hint">Canvas: hidden in this Desktop preview.</p>
      )}
    </>
  );
}

// Feature 07 — instruction 32: one module-level action clearing every
// Mobile override back to inheritance (never touches Desktop). Only
// shown in Mobile view, and only when the module actually has something
// to reset. A lightweight inline confirm (click-to-arm, second click to
// confirm) rather than a modal — consistent with this panel's existing
// reset buttons, but this one can clear several fields at once so it
// gets the extra confirmation step the others don't need.
const MOBILE_PROP_OVERRIDE_KEYS = ['mobileFontSize', 'mobileLineHeight', 'mobileAlign', 'mobileWidthMode', 'mobileHeight'] as const;

function countMobileOverrides(module: EmailModule): number {
  let count = Object.keys(module.settings.mobile).length + Object.keys(module.settings.outerSpacing.mobile).length;
  const props = module.props as Record<string, unknown>;
  for (const key of MOBILE_PROP_OVERRIDE_KEYS) {
    if (props[key] !== undefined) count += 1;
  }
  const width = props.width as { mobile?: unknown } | undefined;
  if (width?.mobile !== undefined) count += 1;
  return count;
}

function ResetMobileOverridesSection({ module, viewport, onUpdateSettings, onUpdateProps }: {
  module: EmailModule; viewport: BuilderViewMode;
  onUpdateSettings: (patch: Partial<EmailModuleSettings>) => void;
  onUpdateProps: (patch: Record<string, unknown>) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const overrideCount = countMobileOverrides(module);
  if (viewport !== 'mobile' || overrideCount === 0) return null;

  function reset() {
    onUpdateSettings({ mobile: {}, outerSpacing: { ...module.settings.outerSpacing, mobile: {} } });
    const propPatch: Record<string, unknown> = {};
    for (const key of MOBILE_PROP_OVERRIDE_KEYS) propPatch[key] = undefined;
    const width = (module.props as { width?: { desktop: unknown; mobile?: unknown } }).width;
    if (width?.mobile !== undefined) propPatch.width = { desktop: width.desktop };
    onUpdateProps(propPatch);
    setConfirming(false);
  }

  return (
    <PropertySection title="Reset">
      {confirming ? (
        <div className="properties-panel__typography-row">
          <button type="button" className="properties-panel__inherit-reset" onClick={reset}>
            Confirm reset ({overrideCount} override{overrideCount === 1 ? '' : 's'})
          </button>
          <button type="button" className="properties-panel__inherit-reset" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="properties-panel__inherit-reset" onClick={() => setConfirming(true)}>
          Reset Mobile Overrides
        </button>
      )}
    </PropertySection>
  );
}

export function PropertiesPanel({
  module, selectedColumn, breadcrumb, breadcrumbLayoutId, viewport, onUpdateProps, onUpdateSettings,
  onUpdateColumnWidths, onUpdateColumnSettings, onSelectColumn, onSelectModule, collapsed, onToggleCollapsed,
}: PropertiesPanelProps) {
  const [tab, setTab] = useState<PropertiesTab>('content');
  const isLayout = Boolean(module?.columns);
  const showColumnEditor = Boolean(module && selectedColumn && selectedColumn.layoutId === module.id);

  if (collapsed) {
    return (
      <aside className="properties-panel properties-panel--collapsed" aria-label="Module properties">
        <button
          type="button"
          className="properties-panel__expand"
          onClick={onToggleCollapsed}
          title="Expand Properties panel"
          aria-label="Expand Properties panel"
        >
          <span className="mdaiw-icon mdaiw-icon--arrow-left" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="properties-panel" aria-label="Module properties">
      <div className="properties-panel__header">
        <h2>Properties</h2>
        <button
          type="button"
          className="properties-panel__collapse"
          onClick={onToggleCollapsed}
          title="Collapse Properties panel"
          aria-label="Collapse Properties panel"
        >
          <span className="mdaiw-icon mdaiw-icon--arrow-right" aria-hidden="true" />
        </button>
      </div>

      {!module ? (
        <div className="properties-panel__empty">
          <span className="mdaiw-icon mdaiw-icon--edit" aria-hidden="true" />
          <p className="properties-panel__empty-title">Select a module</p>
          <p className="properties-panel__empty-hint">
            Choose an email module on the canvas to edit its content, style and settings.
          </p>
        </div>
      ) : (
        <>
          {breadcrumb.length > 0 && (
            <p className="properties-panel__breadcrumb" aria-live="polite">
              {breadcrumb.length > 1 && breadcrumbLayoutId ? (
                <button type="button" className="properties-panel__breadcrumb-link" onClick={() => onSelectModule(breadcrumbLayoutId)}>
                  {breadcrumb[0]}
                </button>
              ) : breadcrumb[0]}
              {breadcrumb.slice(1).map((segment) => ` › ${segment}`).join('')}
            </p>
          )}
          <div className="properties-panel__tabs" role="tablist" aria-label="Property tabs">
            {(['content', 'style', 'settings'] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                role="tab"
                id={`properties-tab-${tabKey}`}
                aria-selected={tab === tabKey}
                aria-controls="properties-tabpanel"
                className={
                  tab === tabKey
                    ? 'properties-panel__tab properties-panel__tab--active'
                    : 'properties-panel__tab'
                }
                onClick={() => setTab(tabKey)}
              >
                {tabKey === 'content' ? 'Content' : tabKey === 'style' ? 'Style' : 'Settings'}
              </button>
            ))}
          </div>

          <div
            id="properties-tabpanel"
            role="tabpanel"
            aria-labelledby={`properties-tab-${tab}`}
            className="properties-panel__body"
          >
            {showColumnEditor && selectedColumn ? (
              <PropertySection title={`Column ${selectedColumn.columnIndex + 1}`}>
                <ColumnEditor
                  module={module}
                  column={selectedColumn.column}
                  columnIndex={selectedColumn.columnIndex}
                  viewport={viewport}
                  onChangeWidths={(widths) => onUpdateColumnWidths(module.id, widths)}
                  onChangeColumnSettings={(patch) => onUpdateColumnSettings(module.id, selectedColumn.column.id, patch)}
                />
              </PropertySection>
            ) : tab === 'settings' ? (
              <>
                <PropertySection title="Visibility">
                  <VisibilitySettings
                    module={module}
                    viewport={viewport}
                    onChange={(patch) => onUpdateSettings(module.id, patch)}
                  />
                </PropertySection>
                <PropertySection title="Outer Spacer Columns">
                  <OuterSpacingControls
                    key={module.id}
                    settings={module.settings}
                    viewport={viewport}
                    onChange={(patch) => onUpdateSettings(module.id, patch)}
                  />
                </PropertySection>
                <PropertySection title="Internal Padding">
                  <PaddingControls
                    settings={module.settings}
                    viewport={viewport}
                    onChange={(patch) => onUpdateSettings(module.id, patch)}
                  />
                </PropertySection>
                {module.type === 'text' && (
                  <TextWidthSettings
                    module={module as unknown as EmailModule<TextModuleProps>}
                    viewport={viewport}
                    update={(patch) => onUpdateProps(module.id, patch)}
                  />
                )}
                {isLayout && (
                  <PropertySection title="Responsive / Mobile Stacking">
                    <MobileStackingSettings module={module} onChange={(patch) => onUpdateSettings(module.id, patch)} />
                  </PropertySection>
                )}
                {isLayout && (
                  <PropertySection title="Column Direction">
                    <DesktopDirectionSettings module={module} onChange={(patch) => onUpdateSettings(module.id, patch)} />
                  </PropertySection>
                )}
                <ResetMobileOverridesSection
                  module={module}
                  viewport={viewport}
                  onUpdateSettings={(patch) => onUpdateSettings(module.id, patch)}
                  onUpdateProps={(patch) => onUpdateProps(module.id, patch)}
                />
              </>
            ) : isLayout ? (
              tab === 'content' ? (
                <LayoutStructureOverview module={module} onSelectColumn={(columnId) => onSelectColumn(module.id, columnId)} />
              ) : (
                <>
                  <ColumnWidthsEditor module={module} onChangeWidths={(widths) => onUpdateColumnWidths(module.id, widths)} />
                  <ColumnGutterEditor settings={module.settings} viewport={viewport} onChange={(patch) => onUpdateSettings(module.id, patch)} />
                </>
              )
            ) : (
              <ModuleEditor module={module} tab={tab} viewport={viewport} onUpdateProps={onUpdateProps} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

interface ModuleEditorProps {
  module: EmailModule;
  tab: 'content' | 'style';
  viewport: BuilderViewMode;
  onUpdateProps: (id: string, patch: Record<string, unknown>) => void;
}

function ModuleEditor({ module, tab, viewport, onUpdateProps }: ModuleEditorProps) {
  const definition = getModuleDefinition(module.type);
  const update = (patch: Record<string, unknown>) => onUpdateProps(module.id, patch);

  switch (definition.propertyEditor) {
    case 'text':
      return <TextEditor module={module as unknown as EmailModule<TextModuleProps>} tab={tab} viewport={viewport} update={update} />;
    case 'image':
      return <ImageEditor module={module as unknown as EmailModule<ImageModuleProps>} tab={tab} viewport={viewport} update={update} />;
    case 'button':
      return <ButtonEditor module={module as unknown as EmailModule<ButtonModuleProps>} tab={tab} viewport={viewport} update={update} />;
    case 'composite':
      return <CompositeEditor module={module as unknown as EmailModule<CompositeModuleProps>} tab={tab} viewport={viewport} update={update} />;
    case 'schema':
      return <SchemaEditor module={module} tab={tab} update={update} />;
    case 'basic':
      if (module.type === 'divider') return <DividerEditor module={module} tab={tab} viewport={viewport} update={update} />;
      if (module.type === 'spacer') return <SpacerEditor module={module} tab={tab} viewport={viewport} update={update} />;
      return <p className="properties-panel__hint">Detailed editing for this module arrives in a future update.</p>;
    default:
      return <p className="properties-panel__hint">Detailed editing for this module arrives in a future update.</p>;
  }
}

// Feature 04/06 — generic content/style editor for catalog modules that
// declare `editableFields` (registryCore.ts's SchemaField[]) instead of a
// bespoke React editor, plus (Feature 06) a declarative `repeatableField`
// (nav links, social platform links, product cards, ...) rendered
// through the one shared RepeatableItemEditor. Scalar leaf fields cover
// text/textarea/url/color/number/select/align/toggle/font — a module
// only needs a bespoke React editor when it has genuinely specialized UX
// (Text/Image/Button/Composite below), not merely "more than one field".
function SchemaEditor({ module, tab, update }: {
  module: EmailModule; tab: 'content' | 'style'; update: (patch: Record<string, unknown>) => void;
}) {
  const definition = getModuleDefinition(module.type);
  const fields = (definition.editableFields ?? []).filter((field) => field.group === tab);
  const repeatable = definition.repeatableField && definition.repeatableField.group === tab
    ? definition.repeatableField
    : null;

  if (fields.length === 0 && !repeatable) {
    return (
      <p className="properties-panel__hint">
        Detailed editing for this module arrives in a future update.
      </p>
    );
  }

  return (
    <>
      {fields.map((field) => {
        const rawValue = getPath(module.props, field.key);
        const onChange = (nextValue: string | number | boolean) => {
          update(setPath(module.props as Record<string, unknown>, field.key, nextValue));
        };

        if (field.kind === 'textarea') {
          return (
            <label key={field.key} className="properties-panel__field">
              <span>{field.label}</span>
              <textarea rows={3} value={String(rawValue ?? '')} onChange={(e) => onChange(e.target.value)} />
            </label>
          );
        }
        if (field.kind === 'color') {
          return (
            <ColorControl
              key={field.key}
              label={field.label}
              value={String(rawValue ?? '')}
              onChange={onChange}
              allowNone
            />
          );
        }
        if (field.kind === 'number') {
          return (
            <label key={field.key} className="properties-panel__field">
              <span>{field.label}</span>
              <input type="number" value={Number(rawValue ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
            </label>
          );
        }
        if (field.kind === 'select') {
          return (
            <label key={field.key} className="properties-panel__field">
              <span>{field.label}</span>
              <select value={String(rawValue ?? field.options?.[0]?.value ?? '')} onChange={(e) => onChange(e.target.value)}>
                {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          );
        }
        if (field.kind === 'align') {
          return (
            <AlignField
              key={field.key}
              value={(rawValue as HorizontalAlign) ?? 'left'}
              onChange={(align) => onChange(align)}
            />
          );
        }
        if (field.kind === 'toggle') {
          return (
            <label key={field.key} className="properties-panel__checkbox-field">
              <input type="checkbox" checked={Boolean(rawValue)} onChange={(e) => onChange(e.target.checked)} />
              <span>{field.label}</span>
            </label>
          );
        }
        if (field.kind === 'font') {
          return (
            <label key={field.key} className="properties-panel__field">
              <span>{field.label}</span>
              <select value={String(rawValue ?? DEFAULT_FONT_ID)} onChange={(e) => onChange(e.target.value)}>
                {EMAIL_SAFE_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label key={field.key} className="properties-panel__field">
            <span>{field.label}</span>
            <input
              type="text"
              value={String(rawValue ?? '')}
              placeholder={field.kind === 'url' ? 'https://' : undefined}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        );
      })}
      {repeatable && (
        <div className="properties-panel__field-group">
          <span className="properties-panel__field-group-label">{repeatable.label}</span>
          <RepeatableItemEditor
            items={(getPath(module.props, repeatable.path) as unknown[]) ?? []}
            onChange={(items) => update(setPath(module.props as Record<string, unknown>, repeatable.path, items))}
            createItem={repeatable.createItem}
            itemLabel={repeatable.itemLabel}
            renderItemEditor={repeatable.renderItemFields}
            minItems={repeatable.minItems}
            maxItems={repeatable.maxItems}
            addLabel={repeatable.addLabel}
          />
        </div>
      )}
    </>
  );
}

function TextEditor({ module, tab, viewport, update }: {
  module: EmailModule<TextModuleProps>; tab: 'content' | 'style'; viewport: BuilderViewMode;
  update: (patch: Record<string, unknown>) => void;
}) {
  const { props } = module;
  if (tab === 'content') {
    return (
      <label className="properties-panel__field">
        <span>Text</span>
        <textarea
          rows={4}
          value={props.text}
          onChange={(event) => update({ text: event.target.value })}
        />
      </label>
    );
  }
  const isMobile = viewport === 'mobile';
  // Feature 07 — selected responsive typography overrides (instruction
  // 18: font size, line height, text alignment). fontFamily/fontWeight/
  // color intentionally stay Desktop-only — "do not automatically make
  // every typography field responsive" (instruction 18) and colors are
  // explicitly excluded from responsive support (instruction 9).
  const fontSizeOverridden = props.mobileFontSize !== undefined;
  const lineHeightOverridden = props.mobileLineHeight !== undefined;
  const alignOverridden = props.mobileAlign !== undefined;
  const anyMobileTypographyOverride = fontSizeOverridden || lineHeightOverridden || alignOverridden;
  return (
    <>
      <PropertySection title="Typography">
        <TypographyControls
          fontFamily={{ value: props.fontFamily ?? DEFAULT_FONT_ID, onChange: (fontFamily) => update({ fontFamily }) }}
          fontSize={{
            value: isMobile ? props.mobileFontSize ?? props.fontSize : props.fontSize,
            onChange: (fontSize) => update(isMobile ? { mobileFontSize: fontSize } : { fontSize }),
            label: isMobile ? `Font size (px) — Mobile ${fontSizeOverridden ? '(override)' : '(inherited)'}` : undefined,
          }}
          fontWeight={{ value: props.fontWeight, onChange: (fontWeight) => update({ fontWeight }) }}
          lineHeight={{
            value: isMobile ? props.mobileLineHeight ?? props.lineHeight : props.lineHeight,
            onChange: (lineHeight) => update(isMobile ? { mobileLineHeight: lineHeight } : { lineHeight }),
            label: isMobile ? `Line height (px) — Mobile ${lineHeightOverridden ? '(override)' : '(inherited)'}` : undefined,
          }}
          color={{ value: props.color, onChange: (color) => update({ color }) }}
        />
        {isMobile && anyMobileTypographyOverride && (
          <button
            type="button"
            className="properties-panel__inherit-reset"
            onClick={() => update({ mobileFontSize: undefined, mobileLineHeight: undefined })}
          >
            Use Desktop typography
          </button>
        )}
      </PropertySection>
      <PropertySection title="Alignment & Background">
        <label className="properties-panel__field">
          <span>
            Alignment{isMobile ? ` — Mobile ${alignOverridden ? '(override)' : '(inherited)'}` : ''}
          </span>
          <select
            value={isMobile ? props.mobileAlign ?? props.align : props.align}
            onChange={(event) => update(isMobile
              ? { mobileAlign: event.target.value as HorizontalAlign }
              : { align: event.target.value as HorizontalAlign })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        {isMobile && alignOverridden && (
          <button type="button" className="properties-panel__inherit-reset" onClick={() => update({ mobileAlign: undefined })}>
            Use Desktop value
          </button>
        )}
        <ColorControl label="Background color" value={props.backgroundColor ?? ''} onChange={(backgroundColor) => update({ backgroundColor })} allowNone />
      </PropertySection>
    </>
  );
}

// Text's width control lives in the Settings tab (instruction 4:
// "Settings: Width where relevant"), unlike Image's (Style tab, instruction
// 11) — the Settings tab is rendered directly by PropertiesPanel rather
// than through ModuleEditor, so this is called from there for `text`
// modules only, right alongside Internal Padding/Outer Spacer Columns.
function TextWidthSettings({ module, viewport, update }: {
  module: EmailModule<TextModuleProps>; viewport: BuilderViewMode; update: (patch: Record<string, unknown>) => void;
}) {
  return (
    <PropertySection title="Width">
      <ResponsiveDimensionField
        label="Width"
        dimension={module.props.width ?? { desktop: { value: 100, unit: '%' } }}
        viewport={viewport}
        pxBounds={IMAGE_WIDTH_PX_BOUNDS}
        onChange={(width) => update({ width })}
      />
      <p className="properties-panel__hint">Leave at 100% to fill the available content width.</p>
    </PropertySection>
  );
}

// Feature 08 — a plain URL input plus a "Browse" button that opens the
// Asset Manager; `onAssetSelected` receives the whole {url, alt_text}
// selection so callers can patch src+alt together in one `update()` call
// (one undo/redo step) instead of two separate patches.
function ImageSourceField({ label, value, onChangeValue, onAssetSelected }: {
  label: string; value: string; onChangeValue: (value: string) => void;
  onAssetSelected: (selection: AssetSelection) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <label className="properties-panel__field">
        <span>{label}</span>
        <div className="properties-panel__image-source-row">
          <input type="text" value={value} onChange={(event) => onChangeValue(event.target.value)} />
          <button
            type="button"
            className="properties-panel__browse-button"
            onClick={() => setDialogOpen(true)}
          >
            Browse
          </button>
        </div>
      </label>
      {dialogOpen && (
        <AssetManagerDialog onSelect={onAssetSelected} onClose={() => setDialogOpen(false)} />
      )}
    </>
  );
}

function ImageEditor({ module, tab, viewport, update }: {
  module: EmailModule<ImageModuleProps>; tab: 'content' | 'style'; viewport: BuilderViewMode;
  update: (patch: Record<string, unknown>) => void;
}) {
  const { props } = module;
  if (tab === 'content') {
    return (
      <>
        <ImageSourceField
          label="Image URL"
          value={props.src}
          onChangeValue={(src) => update({ src })}
          onAssetSelected={(selection) => update({ src: selection.url, alt: props.alt || selection.alt_text })}
        />
        <label className="properties-panel__field">
          <span>Alt text</span>
          <input type="text" value={props.alt} onChange={(e) => update({ alt: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Link URL</span>
          <input type="text" value={props.href} onChange={(e) => update({ href: e.target.value })} placeholder="https://" />
        </label>
      </>
    );
  }
  return (
    <>
      <ResponsiveDimensionField
        label="Width"
        dimension={props.width}
        viewport={viewport}
        pxBounds={IMAGE_WIDTH_PX_BOUNDS}
        onChange={(width) => update({ width })}
      />
      <AlignField value={props.align} onChange={(align) => update({ align })} />
      <ColorControl label="Background color" value={props.backgroundColor ?? ''} onChange={(backgroundColor) => update({ backgroundColor })} allowNone />
    </>
  );
}

const BUTTON_WIDTH_MODE_LABELS: Record<ButtonWidthMode, string> = { auto: 'Auto', fixed: 'Fixed', full: 'Full Width' };

function ButtonEditor({ module, tab, viewport, update }: {
  module: EmailModule<ButtonModuleProps>; tab: 'content' | 'style'; viewport: BuilderViewMode;
  update: (patch: Record<string, unknown>) => void;
}) {
  const { props } = module;
  const widthMode: ButtonWidthMode = props.widthMode ?? 'auto';
  const isMobile = viewport === 'mobile';
  const mobileWidthModeOverridden = props.mobileWidthMode !== undefined;
  if (tab === 'content') {
    return (
      <>
        <label className="properties-panel__field">
          <span>Button text</span>
          <input type="text" value={props.text} onChange={(e) => update({ text: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Link URL</span>
          <input type="text" value={props.href} onChange={(e) => update({ href: e.target.value })} placeholder="https://" />
        </label>
      </>
    );
  }
  return (
    <>
      <PropertySection title="Layout">
        <AlignField value={props.align} onChange={(align) => update({ align })} />
        <label className="properties-panel__field">
          <span>Width</span>
          <select value={widthMode} onChange={(e) => update({ widthMode: e.target.value as ButtonWidthMode })}>
            {(Object.keys(BUTTON_WIDTH_MODE_LABELS) as ButtonWidthMode[]).map((mode) => (
              <option key={mode} value={mode}>{BUTTON_WIDTH_MODE_LABELS[mode]}</option>
            ))}
          </select>
        </label>
        {widthMode === 'fixed' && (
          <label className="properties-panel__field">
            <span>Fixed width (px)</span>
            <input type="number" min={40} max={600} value={props.fixedWidth ?? 200} onChange={(e) => update({ fixedWidth: Number(e.target.value) })} />
          </label>
        )}
        {isMobile && (
          <label className="properties-panel__field">
            <span>Width — Mobile {mobileWidthModeOverridden ? '(override)' : '(inherited)'}</span>
            <select
              value={props.mobileWidthMode ?? widthMode}
              onChange={(e) => update({ mobileWidthMode: e.target.value as ButtonWidthMode })}
            >
              {(Object.keys(BUTTON_WIDTH_MODE_LABELS) as ButtonWidthMode[]).map((mode) => (
                <option key={mode} value={mode}>{BUTTON_WIDTH_MODE_LABELS[mode]}</option>
              ))}
            </select>
          </label>
        )}
        {isMobile && mobileWidthModeOverridden && (
          <button type="button" className="properties-panel__inherit-reset" onClick={() => update({ mobileWidthMode: undefined })}>
            Use Desktop value
          </button>
        )}
        <label className="properties-panel__field">
          <span>Font size (px)</span>
          <input type="number" min={10} max={32} value={props.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
        </label>
      </PropertySection>
      <PropertySection title="Padding">
        <div className="properties-panel__typography-row">
          <label className="properties-panel__field">
            <span>Horizontal (px)</span>
            <input type="number" min={0} max={80} value={props.paddingHorizontal ?? 24} onChange={(e) => update({ paddingHorizontal: Number(e.target.value) })} />
          </label>
          <label className="properties-panel__field">
            <span>Vertical (px)</span>
            <input type="number" min={0} max={40} value={props.paddingVertical ?? 12} onChange={(e) => update({ paddingVertical: Number(e.target.value) })} />
          </label>
        </div>
      </PropertySection>
      <PropertySection title="Border">
        <div className="properties-panel__typography-row">
          <label className="properties-panel__field">
            <span>Width (px)</span>
            <input type="number" min={0} max={10} value={props.borderWidth ?? 0} onChange={(e) => update({ borderWidth: Number(e.target.value) })} />
          </label>
          <label className="properties-panel__field">
            <span>Radius (px)</span>
            <input type="number" min={0} max={40} value={props.borderRadius} onChange={(e) => update({ borderRadius: Number(e.target.value) })} />
          </label>
        </div>
        <ColorControl label="Border color" value={props.borderColor ?? ''} onChange={(borderColor) => update({ borderColor })} allowNone />
        {props.borderRadius > 0 && (
          <p className="properties-panel__hint">Rounded corners may not render in Outlook Classic — the button remains fully functional either way.</p>
        )}
      </PropertySection>
      <PropertySection title="Color">
        <ColorControl label="Background color" value={props.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} />
        <ColorControl label="Text color" value={props.textColor} onChange={(textColor) => update({ textColor })} />
      </PropertySection>
    </>
  );
}

function CompositeEditor({ module, tab, viewport, update }: {
  module: EmailModule<CompositeModuleProps>; tab: 'content' | 'style'; viewport: BuilderViewMode;
  update: (patch: Record<string, unknown>) => void;
}) {
  const { props } = module;
  if (tab === 'content') {
    return (
      <>
        <ImageSourceField
          label="Image URL"
          value={props.image.src}
          onChangeValue={(src) => update({ image: { ...props.image, src } })}
          onAssetSelected={(selection) => update({
            image: { ...props.image, src: selection.url, alt: props.image.alt || selection.alt_text },
          })}
        />
        <label className="properties-panel__field">
          <span>Alt text</span>
          <input
            type="text"
            value={props.image.alt}
            onChange={(e) => update({ image: { ...props.image, alt: e.target.value } })}
          />
        </label>
        <label className="properties-panel__field">
          <span>Text</span>
          <textarea
            rows={3}
            value={props.text.text}
            onChange={(e) => update({ text: { ...props.text, text: e.target.value } })}
          />
        </label>
        <PropertySection title="Call to action (optional)">
          <label className="properties-panel__field">
            <span>Button text</span>
            <input
              type="text"
              value={props.text.ctaText ?? ''}
              placeholder="Leave blank for no button"
              onChange={(e) => update({ text: { ...props.text, ctaText: e.target.value } })}
            />
          </label>
          <label className="properties-panel__field">
            <span>Button link</span>
            <input
              type="text"
              value={props.text.ctaHref ?? ''}
              placeholder="https://"
              onChange={(e) => update({ text: { ...props.text, ctaHref: e.target.value } })}
            />
          </label>
        </PropertySection>
      </>
    );
  }
  return (
    <>
      <ResponsiveDimensionField
        label="Image width"
        dimension={props.image.width}
        viewport={viewport}
        pxBounds={IMAGE_WIDTH_PX_BOUNDS}
        onChange={(width) => update({ image: { ...props.image, width } })}
      />
      <PropertySection title="Text typography">
        <TypographyControls
          fontFamily={{ value: props.text.fontFamily ?? DEFAULT_FONT_ID, onChange: (fontFamily) => update({ text: { ...props.text, fontFamily } }) }}
          fontSize={{ value: props.text.fontSize ?? 15, onChange: (fontSize) => update({ text: { ...props.text, fontSize } }) }}
          color={{ value: props.text.color ?? '#333333', onChange: (color) => update({ text: { ...props.text, color } }) }}
        />
        <AlignField value={props.text.align} onChange={(align) => update({ text: { ...props.text, align } })} />
      </PropertySection>
    </>
  );
}

function DividerEditor({ module, tab, viewport, update }: {
  module: EmailModule; tab: 'content' | 'style'; viewport: BuilderViewMode; update: (patch: Record<string, unknown>) => void;
}) {
  const props = module.props as { color: string; thickness: number; width?: { desktop: { value: number; unit: 'px' | '%' } }; align?: HorizontalAlign };
  if (tab === 'content') {
    return <p className="properties-panel__hint">A horizontal divider line.</p>;
  }
  return (
    <>
      <ColorControl label="Color" value={props.color} onChange={(color) => update({ color })} />
      <label className="properties-panel__field">
        <span>Thickness (px)</span>
        <input type="number" min={1} max={12} value={props.thickness} onChange={(e) => update({ thickness: Number(e.target.value) })} />
      </label>
      <ResponsiveDimensionField
        label="Width"
        dimension={props.width ?? { desktop: { value: 100, unit: '%' } }}
        viewport={viewport}
        pxBounds={IMAGE_WIDTH_PX_BOUNDS}
        onChange={(width) => update({ width })}
      />
      <AlignField value={props.align ?? 'center'} onChange={(align) => update({ align })} />
    </>
  );
}

function SpacerEditor({ module, tab, viewport, update }: {
  module: EmailModule; tab: 'content' | 'style'; viewport: BuilderViewMode; update: (patch: Record<string, unknown>) => void;
}) {
  const props = module.props as { height: number; mobileHeight?: number };
  if (tab !== 'content') {
    return <p className="properties-panel__hint">Vertical blank space.</p>;
  }
  const isMobile = viewport === 'mobile';
  const overridden = isMobile && props.mobileHeight !== undefined;
  const resolvedHeight = isMobile && props.mobileHeight !== undefined ? props.mobileHeight : props.height;
  return (
    <>
      <label className="properties-panel__field">
        <span>Height (px) — {isMobile ? `Mobile (${overridden ? 'override' : 'inherited'})` : 'Desktop'}</span>
        <input
          type="number"
          min={4}
          max={400}
          value={resolvedHeight}
          onChange={(e) => {
            const next = Number(e.target.value);
            update(isMobile ? { mobileHeight: next } : { height: next });
          }}
        />
      </label>
      {isMobile && (
        overridden ? (
          <button type="button" className="properties-panel__inherit-reset" onClick={() => update({ mobileHeight: undefined })}>
            Use Desktop value
          </button>
        ) : (
          <span className="properties-panel__inherit-hint">Inheriting Desktop value</span>
        )
      )}
    </>
  );
}

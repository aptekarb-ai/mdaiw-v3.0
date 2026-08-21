import { useState, type ReactNode } from 'react';
import type {
  ButtonModuleProps, CompositeModuleProps, EmailModule, EmailModuleSettings, HorizontalAlign,
  ImageModuleProps, TextModuleProps,
} from './edm';
import { getModuleDefinition } from './moduleRegistry';
import { IMAGE_WIDTH_PX_BOUNDS, getPath, setPath, type BuilderViewMode } from './registryCore';
import { PaddingControls } from './PaddingControls';
import { OuterSpacingControls } from './OuterSpacingControls';
import { ResponsiveDimensionField } from './DimensionControl';
import './PropertiesPanel.css';

type PropertiesTab = 'content' | 'style' | 'settings';

interface PropertiesPanelProps {
  module: EmailModule | null;
  viewport: BuilderViewMode;
  onUpdateProps: (id: string, patch: Record<string, unknown>) => void;
  onUpdateSettings: (id: string, patch: Partial<EmailModuleSettings>) => void;
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

function AlignField({ value, onChange }: { value: HorizontalAlign; onChange: (value: HorizontalAlign) => void }) {
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

export function PropertiesPanel({
  module, viewport, onUpdateProps, onUpdateSettings, collapsed, onToggleCollapsed,
}: PropertiesPanelProps) {
  const [tab, setTab] = useState<PropertiesTab>('content');

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
            {tab === 'settings' ? (
              <>
                <PropertySection title="Outer Spacer Columns">
                  <OuterSpacingControls
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
              </>
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
      return <TextEditor module={module as unknown as EmailModule<TextModuleProps>} tab={tab} update={update} />;
    case 'image':
      return <ImageEditor module={module as unknown as EmailModule<ImageModuleProps>} tab={tab} viewport={viewport} update={update} />;
    case 'button':
      return <ButtonEditor module={module as unknown as EmailModule<ButtonModuleProps>} tab={tab} update={update} />;
    case 'composite':
      return <CompositeEditor module={module as unknown as EmailModule<CompositeModuleProps>} tab={tab} viewport={viewport} update={update} />;
    case 'schema':
      return <SchemaEditor module={module} tab={tab} update={update} />;
    default:
      return <BasicEditor module={module} tab={tab} update={update} />;
  }
}

// Feature 04 — generic content/style editor for catalog modules that
// declare `editableFields` (registryCore.ts's SchemaField[]) instead of a
// bespoke React editor. Only scalar leaf fields are editable this way —
// repeating list fields (nav links, product items, ...) are Feature 06
// (Module Element Editor) scope; see registryCore.ts's SchemaField docstring.
function SchemaEditor({ module, tab, update }: {
  module: EmailModule; tab: 'content' | 'style'; update: (patch: Record<string, unknown>) => void;
}) {
  const definition = getModuleDefinition(module.type);
  const fields = (definition.editableFields ?? []).filter((field) => field.group === tab);

  if (fields.length === 0) {
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
        const onChange = (nextValue: string | number) => {
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
            <label key={field.key} className="properties-panel__field">
              <span>{field.label}</span>
              <input type="color" value={String(rawValue ?? '#000000')} onChange={(e) => onChange(e.target.value)} />
            </label>
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
    </>
  );
}

function TextEditor({ module, tab, update }: {
  module: EmailModule<TextModuleProps>; tab: 'content' | 'style'; update: (patch: Record<string, unknown>) => void;
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
  return (
    <>
      <PropertySection title="Typography">
        <label className="properties-panel__field">
          <span>Font size (px)</span>
          <input type="number" min={8} max={72} value={props.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
        </label>
        <label className="properties-panel__field">
          <span>Font weight</span>
          <select value={props.fontWeight} onChange={(e) => update({ fontWeight: Number(e.target.value) })}>
            <option value={400}>Normal</option>
            <option value={700}>Bold</option>
          </select>
        </label>
        <label className="properties-panel__field">
          <span>Line height (px)</span>
          <input type="number" min={10} max={120} value={props.lineHeight} onChange={(e) => update({ lineHeight: Number(e.target.value) })} />
        </label>
      </PropertySection>
      <PropertySection title="Alignment & Color">
        <AlignField value={props.align} onChange={(align) => update({ align })} />
        <label className="properties-panel__field">
          <span>Text color</span>
          <input type="color" value={props.color} onChange={(e) => update({ color: e.target.value })} />
        </label>
      </PropertySection>
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
        <label className="properties-panel__field">
          <span>Image URL</span>
          <input type="text" value={props.src} onChange={(e) => update({ src: e.target.value })} />
        </label>
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
    </>
  );
}

function ButtonEditor({ module, tab, update }: {
  module: EmailModule<ButtonModuleProps>; tab: 'content' | 'style'; update: (patch: Record<string, unknown>) => void;
}) {
  const { props } = module;
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
          <span>Font size (px)</span>
          <input type="number" min={10} max={32} value={props.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
        </label>
        <label className="properties-panel__field">
          <span>Border radius (px)</span>
          <input type="number" min={0} max={40} value={props.borderRadius} onChange={(e) => update({ borderRadius: Number(e.target.value) })} />
        </label>
      </PropertySection>
      <PropertySection title="Color">
        <label className="properties-panel__field">
          <span>Background color</span>
          <input type="color" value={props.backgroundColor} onChange={(e) => update({ backgroundColor: e.target.value })} />
        </label>
        <label className="properties-panel__field">
          <span>Text color</span>
          <input type="color" value={props.textColor} onChange={(e) => update({ textColor: e.target.value })} />
        </label>
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
        <label className="properties-panel__field">
          <span>Image URL</span>
          <input
            type="text"
            value={props.image.src}
            onChange={(e) => update({ image: { ...props.image, src: e.target.value } })}
          />
        </label>
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
      <AlignField value={props.text.align} onChange={(align) => update({ text: { ...props.text, align } })} />
    </>
  );
}

function BasicEditor({ module, tab, update }: {
  module: EmailModule; tab: 'content' | 'style'; update: (patch: Record<string, unknown>) => void;
}) {
  if (module.type === 'divider') {
    const props = module.props as { color: string; thickness: number };
    if (tab === 'style') {
      return (
        <>
          <label className="properties-panel__field">
            <span>Color</span>
            <input type="color" value={props.color} onChange={(e) => update({ color: e.target.value })} />
          </label>
          <label className="properties-panel__field">
            <span>Thickness (px)</span>
            <input type="number" min={1} max={12} value={props.thickness} onChange={(e) => update({ thickness: Number(e.target.value) })} />
          </label>
        </>
      );
    }
    return <p className="properties-panel__hint">A horizontal divider line.</p>;
  }

  if (module.type === 'spacer') {
    const props = module.props as { height: number };
    if (tab === 'content') {
      return (
        <label className="properties-panel__field">
          <span>Height (px)</span>
          <input type="number" min={4} max={400} value={props.height} onChange={(e) => update({ height: Number(e.target.value) })} />
        </label>
      );
    }
    return <p className="properties-panel__hint">Vertical blank space.</p>;
  }

  // Layout modules — Feature 03 keeps these structural/visual only; a
  // nested per-column content editor is Feature 05 (Layout Builder).
  return (
    <p className="properties-panel__hint">
      Layout structure is fixed for this block. Column content editing arrives in a future update.
    </p>
  );
}

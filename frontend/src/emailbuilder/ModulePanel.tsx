import { useMemo, useState } from 'react';
import type { EmailModuleType, LayoutModuleProps } from './edm';
import { MODULE_CATEGORIES } from './moduleCategories';
import { MODULE_PANEL_ORDER, getModuleDefinition, type AnyModuleDefinition } from './moduleRegistry';
import { NEW_MODULE_DRAG_MIME } from './dragTypes';
import './ModulePanel.css';

interface ModulePanelProps {
  onAddModule: (type: EmailModuleType) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function LayoutPreview({ columnWidths }: { columnWidths: number[] }) {
  return (
    <span className="module-panel__layout-preview" aria-hidden="true">
      {columnWidths.map((width, index) => (
        <span
          key={`${index}-${width}`}
          className="module-panel__layout-bar"
          style={{ flexGrow: width }}
        />
      ))}
    </span>
  );
}

function ModuleCardPreview({ definition }: { definition: AnyModuleDefinition }) {
  if (definition.category === 'layout') {
    const { columnWidths } = definition.createDefaultProps() as LayoutModuleProps;
    return <LayoutPreview columnWidths={columnWidths} />;
  }
  return <span className={`mdaiw-icon mdaiw-icon--${definition.icon}`} aria-hidden="true" />;
}

function CategorySection({
  label, definitions, onAddModule, forceExpanded,
}: {
  label: string;
  definitions: AnyModuleDefinition[];
  onAddModule: (type: EmailModuleType) => void;
  forceExpanded: boolean;
}) {
  const [manuallyExpanded, setManuallyExpanded] = useState(definitions.length > 0);
  const expanded = forceExpanded || manuallyExpanded;

  return (
    <section className="module-panel__category">
      <button
        type="button"
        className="module-panel__category-toggle"
        aria-expanded={expanded}
        onClick={() => setManuallyExpanded((current) => !current)}
      >
        <span
          className={expanded ? 'mdaiw-icon mdaiw-icon--chevron-down' : 'mdaiw-icon mdaiw-icon--chevron-right'}
          aria-hidden="true"
        />
        {label}
        {definitions.length > 0 && <span className="module-panel__category-count">{definitions.length}</span>}
      </button>
      {expanded && (
        definitions.length === 0 ? (
          <p className="module-panel__category-empty">Coming soon</p>
        ) : (
          <ul className="module-panel__grid">
            {definitions.map((definition) => (
              <li key={definition.type}>
                <button
                  type="button"
                  className="module-panel__item"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(NEW_MODULE_DRAG_MIME, definition.type);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAddModule(definition.type)}
                  title={`Add ${definition.label}`}
                  aria-label={`Add ${definition.label}`}
                >
                  <span className="module-panel__item-preview">
                    <ModuleCardPreview definition={definition} />
                  </span>
                  <span className="module-panel__item-label">{definition.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}

export function ModulePanel({ onAddModule, collapsed, onToggleCollapsed }: ModulePanelProps) {
  const [search, setSearch] = useState('');

  const definitions = useMemo(
    () => MODULE_PANEL_ORDER.map((type) => getModuleDefinition(type)),
    [],
  );

  const query = search.trim().toLowerCase();
  const filtered = query
    ? definitions.filter((definition) => definition.label.toLowerCase().includes(query))
    : definitions;

  if (collapsed) {
    return (
      <aside className="module-panel module-panel--collapsed" aria-label="Modules">
        <button
          type="button"
          className="module-panel__expand"
          onClick={onToggleCollapsed}
          title="Expand Modules panel"
          aria-label="Expand Modules panel"
        >
          <span className="mdaiw-icon mdaiw-icon--arrow-right" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="module-panel" aria-label="Modules">
      <div className="module-panel__header">
        <h2>Modules</h2>
        <button
          type="button"
          className="module-panel__collapse"
          onClick={onToggleCollapsed}
          title="Collapse Modules panel"
          aria-label="Collapse Modules panel"
        >
          <span className="mdaiw-icon mdaiw-icon--arrow-left" aria-hidden="true" />
        </button>
      </div>

      <div className="module-panel__search">
        <input
          type="search"
          placeholder="Search modules..."
          aria-label="Search modules"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="module-panel__categories">
        {MODULE_CATEGORIES.map((category) => {
          const items = filtered.filter((definition) => definition.category === category.key);
          if (query && items.length === 0) return null;

          return (
            <CategorySection
              key={category.key}
              label={category.label}
              definitions={items}
              onAddModule={onAddModule}
              forceExpanded={Boolean(query)}
            />
          );
        })}

        <CategorySection
          label="Saved Modules"
          definitions={[]}
          onAddModule={onAddModule}
          forceExpanded={false}
        />
      </div>
    </aside>
  );
}

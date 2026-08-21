import { useMemo, useState } from 'react';
import type { EmailModuleType, LayoutModuleProps, ModuleCategory } from './edm';
import { MODULE_CATEGORIES } from './moduleCategories';
import { MODULE_PANEL_ORDER, getModuleDefinition, type AnyModuleDefinition } from './moduleRegistry';
import { NEW_MODULE_DRAG_MIME, SAVED_MODULE_DRAG_MIME } from './dragTypes';
import { matchesQuery } from './moduleLibrary';
import { ModuleLibraryModal } from './ModuleLibraryModal';
import type { SavedEmailModule } from './types';
import './ModulePanel.css';

// Compact-panel search stays a quick-scan list, not a second full
// catalog browser — "View all N results" hands the rest off to the
// Browse All Modules modal, which is where deep browsing belongs.
const SEARCH_RESULT_LIMIT = 16;

interface ModulePanelProps {
  onAddModule: (type: EmailModuleType) => void;
  savedModules: SavedEmailModule[];
  onAddSavedModule: (saved: SavedEmailModule) => void;
  onDeleteSavedModule: (id: number) => void;
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

function ModuleCardButton({
  definition, onAddModule,
}: {
  definition: AnyModuleDefinition;
  onAddModule: (type: EmailModuleType) => void;
}) {
  return (
    <button
      type="button"
      className="module-panel__item"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(NEW_MODULE_DRAG_MIME, definition.type);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAddModule(definition.type)}
      title={definition.description}
      aria-label={`Add ${definition.label}`}
    >
      <span className="module-panel__item-preview">
        <ModuleCardPreview definition={definition} />
      </span>
      <span className="module-panel__item-label">{definition.label}</span>
    </button>
  );
}

function SavedModuleCardButton({
  saved, definition, onAddSavedModule, onDeleteSavedModule,
}: {
  saved: SavedEmailModule;
  definition: AnyModuleDefinition;
  onAddSavedModule: (saved: SavedEmailModule) => void;
  onDeleteSavedModule: (id: number) => void;
}) {
  return (
    <li className="module-panel__saved-item-wrapper">
      <button
        type="button"
        className="module-panel__item"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(SAVED_MODULE_DRAG_MIME, String(saved.id));
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => onAddSavedModule(saved)}
        title={saved.name}
        aria-label={`Add saved module ${saved.name}`}
      >
        <span className="module-panel__item-preview">
          <span className={`mdaiw-icon mdaiw-icon--${definition.icon}`} aria-hidden="true" />
        </span>
        <span className="module-panel__item-label">{saved.name}</span>
      </button>
      <button
        type="button"
        className="module-panel__saved-item-delete"
        onClick={() => onDeleteSavedModule(saved.id)}
        title={`Delete ${saved.name}`}
        aria-label={`Delete saved module ${saved.name}`}
      >
        <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
      </button>
    </li>
  );
}

// True accordion — controlled by the parent so only ONE built-in
// category is ever expanded at once (instruction: must not render the
// full 53-module catalog expanded simultaneously; this is what keeps
// the panel's DOM size bounded no matter how large MODULE_REGISTRY
// eventually grows).
function CategorySection({
  categoryKey, label, definitions, expanded, onToggle, onAddModule,
}: {
  categoryKey: ModuleCategory;
  label: string;
  definitions: AnyModuleDefinition[];
  expanded: boolean;
  onToggle: (key: ModuleCategory) => void;
  onAddModule: (type: EmailModuleType) => void;
}) {
  return (
    <section className="module-panel__category">
      <button
        type="button"
        className="module-panel__category-toggle"
        aria-expanded={expanded}
        onClick={() => onToggle(categoryKey)}
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
                <ModuleCardButton definition={definition} onAddModule={onAddModule} />
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}

// Independent of the built-in accordion group and pinned first, so
// reaching Saved Modules never requires opening/closing every built-in
// category first. Always defaults open — an empty state here carries an
// actionable hint the user should see, and population changes over the
// session (save/delete), not just once at mount.
function SavedModulesSection({
  savedModules, expanded, onToggle, onAddSavedModule, onDeleteSavedModule,
}: {
  savedModules: SavedEmailModule[];
  expanded: boolean;
  onToggle: () => void;
  onAddSavedModule: (saved: SavedEmailModule) => void;
  onDeleteSavedModule: (id: number) => void;
}) {
  return (
    <section className="module-panel__category">
      <button
        type="button"
        className="module-panel__category-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={expanded ? 'mdaiw-icon mdaiw-icon--chevron-down' : 'mdaiw-icon mdaiw-icon--chevron-right'}
          aria-hidden="true"
        />
        Saved Modules
        {savedModules.length > 0 && <span className="module-panel__category-count">{savedModules.length}</span>}
      </button>
      {expanded && (
        savedModules.length === 0 ? (
          <p className="module-panel__category-empty">
            Select a module on the canvas and choose &ldquo;Save as reusable module&rdquo; to build your library.
          </p>
        ) : (
          <ul className="module-panel__grid">
            {savedModules.map((saved) => {
              const definition = getModuleDefinition(saved.module_type);
              if (!definition) return null;
              return (
                <SavedModuleCardButton
                  key={saved.id}
                  saved={saved}
                  definition={definition}
                  onAddSavedModule={onAddSavedModule}
                  onDeleteSavedModule={onDeleteSavedModule}
                />
              );
            })}
          </ul>
        )
      )}
    </section>
  );
}

type SearchResultItem =
  | { kind: 'saved'; saved: SavedEmailModule; definition: AnyModuleDefinition }
  | { kind: 'builtin'; definition: AnyModuleDefinition };

// Search mode replaces the accordion entirely with a flat, capped list —
// instruction: never force opening categories to find a match, and never
// dump hundreds of cards into the compact panel.
function SearchResults({
  results, totalCount, query, onAddModule, onAddSavedModule, onDeleteSavedModule, onViewAll,
}: {
  results: SearchResultItem[];
  totalCount: number;
  query: string;
  onAddModule: (type: EmailModuleType) => void;
  onAddSavedModule: (saved: SavedEmailModule) => void;
  onDeleteSavedModule: (id: number) => void;
  onViewAll: () => void;
}) {
  if (totalCount === 0) {
    return (
      <div className="module-panel__search-empty">
        <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
        <p>No modules match &ldquo;{query}&rdquo;.</p>
      </div>
    );
  }

  return (
    <div className="module-panel__search-results">
      <p className="module-panel__search-result-count">{totalCount} module{totalCount === 1 ? '' : 's'}</p>
      <ul className="module-panel__grid">
        {results.map((item) => (
          item.kind === 'saved' ? (
            <SavedModuleCardButton
              key={`saved-${item.saved.id}`}
              saved={item.saved}
              definition={item.definition}
              onAddSavedModule={onAddSavedModule}
              onDeleteSavedModule={onDeleteSavedModule}
            />
          ) : (
            <li key={item.definition.type}>
              <ModuleCardButton definition={item.definition} onAddModule={onAddModule} />
            </li>
          )
        ))}
      </ul>
      {totalCount > results.length && (
        <button type="button" className="module-panel__view-all" onClick={onViewAll}>
          View all {totalCount} results
        </button>
      )}
    </div>
  );
}

export function ModulePanel({
  onAddModule, savedModules, onAddSavedModule, onDeleteSavedModule, collapsed, onToggleCollapsed,
}: ModulePanelProps) {
  const [search, setSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Single-open accordion (instruction: only one normal category
  // expanded at a time) — Layout open by default, preserved locally for
  // the rest of the builder session as the user switches categories.
  const [expandedCategory, setExpandedCategory] = useState<ModuleCategory | null>('layout');
  const [savedExpanded, setSavedExpanded] = useState(true);

  const definitions = useMemo(
    () => MODULE_PANEL_ORDER.map((type) => getModuleDefinition(type)),
    [],
  );

  const query = search.trim();
  const isSearching = query.length > 0;

  const searchResults = useMemo<{ items: SearchResultItem[]; total: number }>(() => {
    if (!isSearching) return { items: [], total: 0 };
    const matchingSaved = savedModules
      .filter((saved) => saved.name.toLowerCase().includes(query.toLowerCase()))
      .map((saved): SearchResultItem | null => {
        const definition = getModuleDefinition(saved.module_type);
        return definition ? { kind: 'saved', saved, definition } : null;
      })
      .filter((item): item is SearchResultItem => item !== null);
    const matchingBuiltins: SearchResultItem[] = definitions
      .filter((definition) => matchesQuery(definition, query))
      .map((definition) => ({ kind: 'builtin', definition }));
    const all = [...matchingSaved, ...matchingBuiltins];
    return { items: all.slice(0, SEARCH_RESULT_LIMIT), total: all.length };
  }, [isSearching, query, savedModules, definitions]);

  function toggleCategory(key: ModuleCategory) {
    setExpandedCategory((current) => (current === key ? null : key));
  }

  function openLibrary() {
    setLibraryOpen(true);
  }

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
        {isSearching ? (
          <SearchResults
            results={searchResults.items}
            totalCount={searchResults.total}
            query={query}
            onAddModule={onAddModule}
            onAddSavedModule={onAddSavedModule}
            onDeleteSavedModule={onDeleteSavedModule}
            onViewAll={openLibrary}
          />
        ) : (
          <>
            <SavedModulesSection
              savedModules={savedModules}
              expanded={savedExpanded}
              onToggle={() => setSavedExpanded((current) => !current)}
              onAddSavedModule={onAddSavedModule}
              onDeleteSavedModule={onDeleteSavedModule}
            />
            {MODULE_CATEGORIES.map((category) => {
              const items = definitions.filter((definition) => definition.category === category.key);
              return (
                <CategorySection
                  key={category.key}
                  categoryKey={category.key}
                  label={category.label}
                  definitions={items}
                  expanded={expandedCategory === category.key}
                  onToggle={toggleCategory}
                  onAddModule={onAddModule}
                />
              );
            })}
          </>
        )}
      </div>

      <div className="module-panel__footer">
        <button type="button" className="module-panel__browse-all" onClick={openLibrary}>
          Browse all modules
        </button>
      </div>

      {libraryOpen && (
        <ModuleLibraryModal
          savedModules={savedModules}
          onAddModule={onAddModule}
          onAddSavedModule={onAddSavedModule}
          onDeleteSavedModule={onDeleteSavedModule}
          onClose={() => setLibraryOpen(false)}
          initialQuery={query}
        />
      )}
    </aside>
  );
}

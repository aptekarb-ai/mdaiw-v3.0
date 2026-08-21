import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmailModuleType, LayoutModuleProps, ModuleCategory } from './edm';
import { MODULE_CATEGORIES } from './moduleCategories';
import { getAllModuleDefinitions, getModuleDefinition, type AnyModuleDefinition } from './moduleRegistry';
import { NEW_MODULE_DRAG_MIME, SAVED_MODULE_DRAG_MIME } from './dragTypes';
import {
  COLUMN_FILTER_OPTIONS, DEFAULT_LIBRARY_FILTERS, IMAGE_POSITION_FILTER_OPTIONS, filterDefinitions,
  hasActiveFilters, useRevealBatch, type ModuleLibraryFilters,
} from './moduleLibrary';
import type { SavedEmailModule } from './types';
import './ModuleLibraryModal.css';

type CategoryFilter = ModuleCategory | 'all' | 'saved';

interface ModuleLibraryModalProps {
  savedModules: SavedEmailModule[];
  onAddModule: (type: EmailModuleType) => void;
  onAddSavedModule: (saved: SavedEmailModule) => void;
  onDeleteSavedModule: (id: number) => void;
  onClose: () => void;
  // Pre-fills the search box — used when the compact panel's "View all
  // N results" hands off a query already in progress there.
  initialQuery?: string;
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function LibraryCardPreview({ definition }: { definition: AnyModuleDefinition }) {
  if (definition.category === 'layout') {
    const { columnWidths } = definition.createDefaultProps() as LayoutModuleProps;
    return (
      <span className="module-library__card-layout" aria-hidden="true">
        {columnWidths.map((width, index) => (
          <span key={`${index}-${width}`} className="module-library__card-layout-bar" style={{ flexGrow: width }} />
        ))}
      </span>
    );
  }
  return <span className={`mdaiw-icon mdaiw-icon--${definition.icon} module-library__card-icon`} aria-hidden="true" />;
}

export function ModuleLibraryModal({
  savedModules, onAddModule, onAddSavedModule, onDeleteSavedModule, onClose, initialQuery = '',
}: ModuleLibraryModalProps) {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [filters, setFilters] = useState<ModuleLibraryFilters>({ ...DEFAULT_LIBRARY_FILTERS, query: initialQuery });
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const allDefinitions = useMemo(() => getAllModuleDefinitions(), []);
  const definitionCategory: ModuleCategory | 'all' = category === 'saved' ? 'all' : category;
  const results = useMemo(
    () => (category === 'saved' ? [] : filterDefinitions(allDefinitions, definitionCategory, filters)),
    [allDefinitions, definitionCategory, category, filters],
  );
  const savedResults = useMemo(() => {
    if (category !== 'saved' && category !== 'all') return [];
    const query = filters.query.trim().toLowerCase();
    if (!query) return savedModules;
    return savedModules.filter((saved) => saved.name.toLowerCase().includes(query));
  }, [savedModules, filters.query, category]);

  const resetKey = JSON.stringify({ category, query: filters.query, columns: filters.columns, imagePosition: filters.imagePosition });
  const { visible, hasMore, revealMore, totalCount } = useRevealBatch(results, 24, resetKey);

  const anyFiltersActive = hasActiveFilters(filters, definitionCategory) || category === 'saved';
  const resultCount = totalCount + savedResults.length;

  function clearFilters() {
    setFilters(DEFAULT_LIBRARY_FILTERS);
    setCategory('all');
  }

  return (
    <div className="module-library__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="module-library"
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-library-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="module-library__header">
          <h2 id="module-library-heading">Browse All Modules</h2>
          <button type="button" className="module-library__close" onClick={onClose} aria-label="Close module library">
            <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
          </button>
        </div>

        <div className="module-library__search">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search modules..."
            aria-label="Search all modules"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          />
        </div>

        <div className="module-library__category-tabs" role="tablist" aria-label="Module categories">
          <button
            type="button"
            role="tab"
            aria-selected={category === 'all'}
            className={category === 'all' ? 'module-library__tab module-library__tab--active' : 'module-library__tab'}
            onClick={() => setCategory('all')}
          >
            All
          </button>
          {MODULE_CATEGORIES.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={category === item.key}
              className={category === item.key ? 'module-library__tab module-library__tab--active' : 'module-library__tab'}
              onClick={() => setCategory(item.key)}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={category === 'saved'}
            className={category === 'saved' ? 'module-library__tab module-library__tab--active' : 'module-library__tab'}
            onClick={() => setCategory('saved')}
          >
            Saved Modules
          </button>
        </div>

        <div className="module-library__filters">
          <label className="module-library__filter">
            <span>Columns</span>
            <select
              aria-label="Filter by column count"
              value={String(filters.columns)}
              onChange={(event) => setFilters((current) => ({
                ...current, columns: event.target.value === 'all' ? 'all' : Number(event.target.value),
              }))}
            >
              {COLUMN_FILTER_OPTIONS.map((option) => (
                <option key={String(option)} value={String(option)}>{option === 'all' ? 'All' : option}</option>
              ))}
            </select>
          </label>

          <label className="module-library__filter">
            <span>Image position</span>
            <select
              aria-label="Filter by image position"
              value={filters.imagePosition}
              onChange={(event) => setFilters((current) => ({
                ...current, imagePosition: event.target.value as ModuleLibraryFilters['imagePosition'],
              }))}
            >
              {IMAGE_POSITION_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="module-library__result-count">{resultCount} module{resultCount === 1 ? '' : 's'}</div>

          {anyFiltersActive && (
            <button type="button" className="module-library__clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        <div className="module-library__body">
          {resultCount === 0 ? (
            <div className="module-library__empty">
              <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
              <p>No modules match your search or filters.</p>
              {anyFiltersActive && (
                <button type="button" className="module-library__clear" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {savedResults.length > 0 && (
                <ul className="module-library__grid">
                  {savedResults.map((saved) => {
                    const definition = getModuleDefinition(saved.module_type);
                    if (!definition) return null;
                    return (
                      <li key={`saved-${saved.id}`} className="module-library__card-wrapper">
                        <button
                          type="button"
                          className="module-library__card"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(SAVED_MODULE_DRAG_MIME, String(saved.id));
                            event.dataTransfer.effectAllowed = 'copy';
                          }}
                          onClick={() => { onAddSavedModule(saved); onClose(); }}
                          aria-label={`Add saved module ${saved.name}`}
                        >
                          <span className={`mdaiw-icon mdaiw-icon--${definition.icon} module-library__card-icon`} aria-hidden="true" />
                          <span className="module-library__card-label">{saved.name}</span>
                          <span className="module-library__card-description">Saved module</span>
                        </button>
                        <button
                          type="button"
                          className="module-library__card-delete"
                          onClick={() => onDeleteSavedModule(saved.id)}
                          aria-label={`Delete saved module ${saved.name}`}
                          title="Delete"
                        >
                          <span className="mdaiw-icon mdaiw-icon--delete" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {visible.length > 0 && (
                <ul className="module-library__grid">
                  {visible.map((definition) => (
                    <li key={definition.type}>
                      <button
                        type="button"
                        className="module-library__card"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(NEW_MODULE_DRAG_MIME, definition.type);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => { onAddModule(definition.type); onClose(); }}
                        aria-label={`Add ${definition.label}`}
                      >
                        <LibraryCardPreview definition={definition} />
                        <span className="module-library__card-label">{definition.label}</span>
                        <span className="module-library__card-description">{definition.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {hasMore && (
                <button type="button" className="module-library__load-more" onClick={revealMore}>
                  Show more ({totalCount - visible.length} remaining)
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

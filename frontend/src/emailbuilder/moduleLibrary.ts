import { useEffect, useState } from 'react';
import type { ModuleCategory } from './edm';
import type { AnyModuleDefinition, ModuleImagePosition } from './registryCore';

// Feature 04 — search/filter engine for the Module Library. Pure
// functions over static registry metadata (no API calls — the built-in
// catalog is bundled data), shared by the compact left panel and the
// expanded "Browse all modules" library modal.

// `category` is deliberately not part of this filters object — the
// Module Library modal tracks it as its own state (its category set
// includes the "Saved Modules" pseudo-category, which has no meaning for
// registry-definition filtering) and passes it to filterDefinitions()
// separately.
export interface ModuleLibraryFilters {
  query: string;
  columns: number | 'all';
  imagePosition: ModuleImagePosition | 'all';
}

export const DEFAULT_LIBRARY_FILTERS: ModuleLibraryFilters = {
  query: '',
  columns: 'all',
  imagePosition: 'all',
};

export function hasActiveFilters(filters: ModuleLibraryFilters, category: ModuleCategory | 'all' = 'all'): boolean {
  return Boolean(filters.query) || category !== 'all' || filters.columns !== 'all' || filters.imagePosition !== 'all';
}

export function matchesQuery(definition: AnyModuleDefinition, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    definition.label.toLowerCase().includes(trimmed)
    || definition.description.toLowerCase().includes(trimmed)
    || definition.category.toLowerCase().includes(trimmed)
    || definition.tags.some((tag) => tag.toLowerCase().includes(trimmed))
    || definition.keywords.some((keyword) => keyword.toLowerCase().includes(trimmed))
  );
}

export function filterDefinitions(
  definitions: AnyModuleDefinition[], category: ModuleCategory | 'all', filters: ModuleLibraryFilters,
): AnyModuleDefinition[] {
  return definitions.filter((definition) => {
    if (category !== 'all' && definition.category !== category) return false;
    if (filters.columns !== 'all' && definition.columnCount !== filters.columns) return false;
    if (filters.imagePosition !== 'all' && definition.imagePosition !== filters.imagePosition) return false;
    return matchesQuery(definition, filters.query);
  });
}

export const COLUMN_FILTER_OPTIONS: (number | 'all')[] = ['all', 1, 2, 3, 4, 5, 6];

export const IMAGE_POSITION_FILTER_OPTIONS: { value: ModuleImagePosition | 'all'; label: string }[] = [
  { value: 'all', label: 'Any' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'background', label: 'Background' },
];

// --- Scale strategy: incremental reveal ---------------------------------
// The library must not depend on rendering every card at once as the
// catalog grows toward 1000-2000+ definitions. Rather than a virtualized
// grid (a new dependency for ~53 items today), the expanded library
// renders in small batches and reveals more on demand — the simplest
// robust approach that still caps DOM node count regardless of catalog
// size. `resetKey` should change whenever the filtered result set
// changes shape (e.g. a serialized filters object) so the batch count
// restarts at the top of a new result set.
export function useRevealBatch<T>(items: T[], batchSize: number, resetKey: string) {
  const [count, setCount] = useState(batchSize);

  useEffect(() => {
    setCount(batchSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey is the intentional dependency; batchSize is a caller constant
  }, [resetKey]);

  const visible = items.slice(0, count);
  const hasMore = count < items.length;
  const revealMore = () => setCount((current) => Math.min(items.length, current + batchSize));

  return { visible, hasMore, revealMore, totalCount: items.length };
}

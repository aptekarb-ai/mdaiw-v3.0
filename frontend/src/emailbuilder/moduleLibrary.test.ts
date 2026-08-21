import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARY_FILTERS, filterDefinitions, hasActiveFilters, matchesQuery,
} from './moduleLibrary';
import { getAllModuleDefinitions } from './moduleRegistry';

const ALL = getAllModuleDefinitions();

describe('moduleLibrary search/filter engine', () => {
  it('matchesQuery finds a definition by exact title', () => {
    const divider = ALL.find((d) => d.type === 'divider')!;
    expect(matchesQuery(divider, 'Divider')).toBe(true);
    expect(matchesQuery(divider, 'divider')).toBe(true);
  });

  it('matchesQuery finds a definition by tag/keyword ("2 column")', () => {
    const results = ALL.filter((d) => matchesQuery(d, '2 column'));
    expect(results.some((d) => d.type === 'layout-2col-50-50')).toBe(true);
  });

  it('matchesQuery finds "hero" modules', () => {
    const results = ALL.filter((d) => matchesQuery(d, 'hero'));
    expect(results.length).toBeGreaterThanOrEqual(6);
    expect(results.every((d) => d.category === 'hero' || d.tags.includes('hero'))).toBe(true);
  });

  it('matchesQuery finds "image left" modules', () => {
    const results = ALL.filter((d) => matchesQuery(d, 'image left'));
    expect(results.some((d) => d.type === 'content-image-left')).toBe(true);
    expect(results.some((d) => d.type === 'hero-image-left')).toBe(true);
  });

  it('matchesQuery finds "product" modules', () => {
    const results = ALL.filter((d) => matchesQuery(d, 'product'));
    expect(results.length).toBeGreaterThanOrEqual(5);
  });

  it('matchesQuery finds "footer" modules', () => {
    const results = ALL.filter((d) => matchesQuery(d, 'footer'));
    expect(results.length).toBeGreaterThanOrEqual(4);
  });

  it('matchesQuery finds "button" modules', () => {
    const results = ALL.filter((d) => matchesQuery(d, 'button'));
    expect(results.some((d) => d.type === 'button')).toBe(true);
  });

  it('empty query matches everything', () => {
    expect(ALL.every((d) => matchesQuery(d, ''))).toBe(true);
    expect(ALL.every((d) => matchesQuery(d, '   '))).toBe(true);
  });

  it('filterDefinitions narrows by category', () => {
    const results = filterDefinitions(ALL, 'footer', DEFAULT_LIBRARY_FILTERS);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((d) => d.category === 'footer')).toBe(true);
  });

  it('filterDefinitions narrows by column count', () => {
    const results = filterDefinitions(ALL, 'all', { ...DEFAULT_LIBRARY_FILTERS, columns: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((d) => d.columnCount === 3)).toBe(true);
  });

  it('filterDefinitions narrows by image position', () => {
    const results = filterDefinitions(ALL, 'all', { ...DEFAULT_LIBRARY_FILTERS, imagePosition: 'background' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((d) => d.imagePosition === 'background')).toBe(true);
  });

  it('filterDefinitions composes category + columns + query', () => {
    const results = filterDefinitions(ALL, 'layout', { ...DEFAULT_LIBRARY_FILTERS, columns: 2, query: 'even split' });
    expect(results.every((d) => d.category === 'layout' && d.columnCount === 2)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('an over-constrained filter set produces zero results', () => {
    const results = filterDefinitions(ALL, 'footer', { ...DEFAULT_LIBRARY_FILTERS, columns: 6 });
    expect(results).toHaveLength(0);
  });

  it('hasActiveFilters is false only for the untouched default state', () => {
    expect(hasActiveFilters(DEFAULT_LIBRARY_FILTERS, 'all')).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_LIBRARY_FILTERS, query: 'hero' }, 'all')).toBe(true);
    expect(hasActiveFilters(DEFAULT_LIBRARY_FILTERS, 'hero')).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_LIBRARY_FILTERS, columns: 2 }, 'all')).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_LIBRARY_FILTERS, imagePosition: 'left' }, 'all')).toBe(true);
  });
});

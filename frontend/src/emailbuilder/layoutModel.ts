// Feature 05 — Layout Builder pure logic: column creation, width
// balancing/validation, and immutable nested-tree operations (insert/
// remove/reorder/move/duplicate a module inside a layout's column).
//
// Deliberately depends on nothing but edm.ts types, dimensions.ts and the
// dependency-free idGenerator.ts — NOT moduleFactory.ts, registryCore.tsx
// or moduleRegistry.tsx. That keeps this file usable from moduleFactory.ts
// (which clones/creates modules and therefore DOES need column ids) and
// from catalog/layoutCatalog.tsx (which needs createEmptyColumns for a
// brand-new layout module's default columns) without ever forming a
// circular import — see moduleRegistry.tsx's own docstring for why that
// boundary matters.
import type {
  ColumnContainerSettings, ColumnVerticalAlign, EmailColumn, EmailModule, EmailModuleType,
} from './edm';
import { ZERO_SPACING } from './edm';
import type { PixelBounds } from './dimensions';
import { generateId } from './idGenerator';

// Every layout-family type and how many columns it has. Mirrors
// catalog/layoutCatalog.tsx's LAYOUT_DEFINITIONS exactly (kept here too,
// duplicated as a small static map rather than imported, specifically to
// avoid layoutModel.ts -> layoutCatalog.tsx -> moduleRegistry.tsx forming
// the cycle described above).
export const LAYOUT_COLUMN_COUNTS: Record<string, number> = {
  'layout-1col': 1,
  'layout-2col-50-50': 2,
  'layout-2col-40-60': 2,
  'layout-2col-60-40': 2,
  'layout-2col-30-70': 2,
  'layout-2col-70-30': 2,
  'layout-3col': 3,
  'layout-4col': 4,
  'layout-5col': 5,
  'layout-6col': 6,
};

export function isLayoutModuleType(type: EmailModuleType): boolean {
  return type in LAYOUT_COLUMN_COUNTS;
}

// A layout module is "loaded"/interactive once it carries a columns[]
// array (built at creation time or backfilled by edmMigration.ts's
// normalizeModule for older documents) — this is the one runtime check
// the canvas/properties panel use to tell a layout module apart from
// every other module type, instead of re-checking the type string.
export function hasColumns(module: EmailModule): module is EmailModule & { columns: EmailColumn[] } {
  return Array.isArray(module.columns);
}

// Minimum usable column width. Below this a column becomes impractical in
// almost every real client (text wraps to one word per line, images
// can't render meaningfully) — chosen as a hard floor rather than a soft
// warning because an unusably thin column is never a legitimate design
// intent, unlike 5/6-column layouts themselves (which ARE allowed, just
// warned about — see LOW_COLUMN_WIDTH_WARNING_PERCENT below).
export const MIN_COLUMN_WIDTH_PERCENT = 10;

// Below this (but still >= MIN_COLUMN_WIDTH_PERCENT), a column is valid
// but likely impractical — the builder shows a dismissible warning
// instead of blocking the layout (Feature-05 brief section 41: "allow
// them... but provide a subtle builder warning").
export const LOW_COLUMN_WIDTH_WARNING_PERCENT = 12;

export const COLUMN_WIDTH_TOTAL_TOLERANCE = 0.05;

export const COLUMN_GUTTER_PX_BOUNDS: PixelBounds = { pxMin: 0, pxMax: 100 };

export function createColumnSettings(): ColumnContainerSettings {
  return { desktop: { ...ZERO_SPACING }, mobile: {}, backgroundColor: '', verticalAlign: 'top' };
}

export function createColumn(): EmailColumn {
  return { id: generateId(), modules: [], settings: createColumnSettings() };
}

export function createEmptyColumns(count: number): EmailColumn[] {
  return Array.from({ length: count }, () => createColumn());
}

// Deep-clones a column tree with entirely fresh column + nested-module
// ids (instruction: "every cloned identifier must be fresh" — duplicate
// layout, and Saved Module insertion, both need this). `cloneModule` is
// injected by the caller (moduleFactory.ts's cloneModuleWithNewId) so
// this file never has to import moduleFactory.ts itself.
export function cloneColumnsWithNewIds(
  columns: EmailColumn[], cloneModule: (module: EmailModule, order: number) => EmailModule,
): EmailColumn[] {
  return columns.map((column) => ({
    id: generateId(),
    settings: { ...column.settings, desktop: { ...column.settings.desktop }, mobile: { ...column.settings.mobile } },
    modules: column.modules.map((module, index) => cloneModule(module, index)),
  }));
}

// Equal distribution across `count` columns, two-decimal precision, with
// the LAST column absorbing the rounding remainder — matches the brief's
// examples exactly (3 columns -> 33.33/33.33/33.34, not 33.33/33.34/33.33).
export function balanceColumnWidths(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((100 / count) * 100) / 100;
  const widths = Array<number>(count).fill(base);
  const usedByOthers = base * (count - 1);
  widths[count - 1] = Math.round((100 - usedByOthers) * 100) / 100;
  return widths;
}

export interface ColumnPixelResolution {
  columnPx: number[];
  gutterPx: number;
}

// Column Width + Gutter Rendering Correction — the ONE deterministic
// pixel resolver every desktop multi-column renderer path uses (see
// catalog/layoutCatalog.tsx). Percent-only column widths ("width=40%")
// plus a separate fixed-px gutter <td> in the SAME row sum to MORE than
// the parent (100% + gutter), overflowing the structure — the defect
// this closes. Gutter space is subtracted from the parent BEFORE ratio
// allocation, so every column + gutter cell's declared pixel width
// always sums to EXACTLY parentWidthPx, never approximately and never
// over. Columns 0..N-2 round independently; the FINAL column receives
// whatever pixels remain, so the sum is exact regardless of individual
// rounding (matches the brief's worked examples: 700/[70,30]/gutter30 ->
// 469+30+201; 700/[33,33,34]/gutter20 -> 218+20+218+20+224).
export function resolveColumnPixelWidths(
  ratios: number[], gutterPx: number, parentWidthPx: number,
): ColumnPixelResolution {
  const count = ratios.length;
  if (count === 0) return { columnPx: [], gutterPx: 0 };
  const safeGutterPx = Math.max(0, Math.round(gutterPx));
  const totalGutterPx = safeGutterPx * (count - 1);
  const availableColumnPx = Math.max(0, Math.round(parentWidthPx) - totalGutterPx);
  const ratioSum = ratios.reduce((sum, r) => sum + r, 0) || 1;

  const columnPx: number[] = [];
  let allocated = 0;
  for (let i = 0; i < count - 1; i += 1) {
    const px = Math.round((availableColumnPx * ratios[i]) / ratioSum);
    columnPx.push(px);
    allocated += px;
  }
  columnPx.push(Math.max(0, availableColumnPx - allocated));

  return { columnPx, gutterPx: safeGutterPx };
}

export interface ColumnWidthValidation {
  valid: boolean;
  total: number;
  belowMinimum: number[];
  totalError: boolean;
}

// Frontend-side validation used by the Properties panel to show inline
// errors and to block persistence of a structurally invalid layout
// (instruction 5: "do not allow invalid persistence/export if the layout
// would be structurally invalid").
export function validateColumnWidths(widths: number[]): ColumnWidthValidation {
  const total = Math.round(widths.reduce((sum, w) => sum + w, 0) * 100) / 100;
  const belowMinimum = widths
    .map((w, index) => (w < MIN_COLUMN_WIDTH_PERCENT ? index : -1))
    .filter((index) => index >= 0);
  const totalError = Math.abs(total - 100) > COLUMN_WIDTH_TOTAL_TOLERANCE;
  return { valid: !totalError && belowMinimum.length === 0, total, belowMinimum, totalError };
}

export function hasLowWidthWarning(widths: number[]): boolean {
  return widths.some((w) => w < LOW_COLUMN_WIDTH_WARNING_PERCENT);
}

// --- Selection / path lookup --------------------------------------------

export interface ModulePath {
  module: EmailModule;
  layout?: EmailModule;
  column?: EmailColumn;
}

// Ids are globally unique across the whole document (top-level + nested —
// instruction 34), so a flat top-level scan plus one level of column
// nesting is always sufficient; no arbitrary-depth recursion needed.
export function findModulePath(modules: EmailModule[], id: string): ModulePath | null {
  for (const module of modules) {
    if (module.id === id) return { module };
    if (module.columns) {
      for (const column of module.columns) {
        const nested = column.modules.find((m) => m.id === id);
        if (nested) return { module: nested, layout: module, column };
      }
    }
  }
  return null;
}

export function findModuleById(modules: EmailModule[], id: string): EmailModule | null {
  return findModulePath(modules, id)?.module ?? null;
}

// --- Immutable nested-tree operations -----------------------------------

function reindexNested(list: EmailModule[]): EmailModule[] {
  return list.map((module, index) => ({ ...module, order: index }));
}

function mapLayout(modules: EmailModule[], layoutId: string, updater: (layout: EmailModule) => EmailModule): EmailModule[] {
  return modules.map((module) => (module.id === layoutId ? updater(module) : module));
}

function mapColumn(layout: EmailModule, columnId: string, updater: (column: EmailColumn) => EmailColumn): EmailModule {
  return { ...layout, columns: (layout.columns ?? []).map((column) => (column.id === columnId ? updater(column) : column)) };
}

export function insertNestedModule(
  modules: EmailModule[], layoutId: string, columnId: string, newModule: EmailModule, index?: number,
): EmailModule[] {
  return mapLayout(modules, layoutId, (layout) => mapColumn(layout, columnId, (column) => {
    const next = [...column.modules];
    const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
    next.splice(at, 0, newModule);
    return { ...column, modules: reindexNested(next) };
  }));
}

export function removeNestedModule(modules: EmailModule[], layoutId: string, columnId: string, moduleId: string): EmailModule[] {
  return mapLayout(modules, layoutId, (layout) => mapColumn(layout, columnId, (column) => ({
    ...column, modules: reindexNested(column.modules.filter((module) => module.id !== moduleId)),
  })));
}

export function reorderNestedModule(
  modules: EmailModule[], layoutId: string, columnId: string, fromIndex: number, toIndex: number,
): EmailModule[] {
  return mapLayout(modules, layoutId, (layout) => mapColumn(layout, columnId, (column) => {
    if (fromIndex < 0 || fromIndex >= column.modules.length) return column;
    const next = [...column.modules];
    const [moved] = next.splice(fromIndex, 1);
    const clamped = Math.max(0, Math.min(toIndex, next.length));
    next.splice(clamped, 0, moved);
    return { ...column, modules: reindexNested(next) };
  }));
}

export function updateNestedModuleProps(
  modules: EmailModule[], layoutId: string, columnId: string, moduleId: string, patch: Record<string, unknown>,
): EmailModule[] {
  return mapLayout(modules, layoutId, (layout) => mapColumn(layout, columnId, (column) => ({
    ...column,
    modules: column.modules.map((module) => (
      module.id === moduleId ? { ...module, props: { ...module.props, ...patch } } : module
    )),
  })));
}

export function updateNestedModuleSettings(
  modules: EmailModule[], layoutId: string, columnId: string, moduleId: string, patch: Record<string, unknown>,
): EmailModule[] {
  return mapLayout(modules, layoutId, (layout) => mapColumn(layout, columnId, (column) => ({
    ...column,
    modules: column.modules.map((module) => (
      module.id === moduleId ? { ...module, settings: { ...module.settings, ...patch } } : module
    )),
  })));
}

// `cloneModule` injected for the same reason as cloneColumnsWithNewIds —
// avoids importing moduleFactory.ts from this file.
export function duplicateNestedModule(
  modules: EmailModule[], layoutId: string, columnId: string, moduleId: string,
  cloneModule: (module: EmailModule, order: number) => EmailModule,
): { modules: EmailModule[]; newId: string | null } {
  let newId: string | null = null;
  const next = mapLayout(modules, layoutId, (layout) => mapColumn(layout, columnId, (column) => {
    const index = column.modules.findIndex((module) => module.id === moduleId);
    if (index < 0) return column;
    const clone = cloneModule(column.modules[index], index + 1);
    newId = clone.id;
    const list = [...column.modules];
    list.splice(index + 1, 0, clone);
    return { ...column, modules: reindexNested(list) };
  }));
  return { modules: next, newId };
}

// Moves an existing nested module from one column to another (same or
// different layout), preserving its id (instruction 15: "Preserve its
// module ID when MOVING. Do not create a duplicate."). No-ops (returns
// the input unchanged) if the module can't be found at the given source.
export function moveModuleBetweenColumns(
  modules: EmailModule[],
  fromLayoutId: string, fromColumnId: string, moduleId: string,
  toLayoutId: string, toColumnId: string, toIndex?: number,
): EmailModule[] {
  const fromLayout = modules.find((module) => module.id === fromLayoutId);
  const fromColumn = fromLayout?.columns?.find((column) => column.id === fromColumnId);
  const moving = fromColumn?.modules.find((module) => module.id === moduleId);
  if (!moving) return modules;

  const withoutMoved = removeNestedModule(modules, fromLayoutId, fromColumnId, moduleId);
  return insertNestedModule(withoutMoved, toLayoutId, toColumnId, moving, toIndex);
}

export function updateColumnSettings(
  modules: EmailModule[], layoutId: string, columnId: string, patch: Partial<ColumnContainerSettings>,
): EmailModule[] {
  return mapLayout(modules, layoutId, (layout) => mapColumn(layout, columnId, (column) => ({
    ...column, settings: { ...column.settings, ...patch },
  })));
}

export function updateColumnWidths(modules: EmailModule[], layoutId: string, widths: number[]): EmailModule[] {
  return mapLayout(modules, layoutId, (layout) => ({ ...layout, props: { ...layout.props, columnWidths: widths } }));
}

export const COLUMN_VALIGN_OPTIONS: ColumnVerticalAlign[] = ['top', 'middle', 'bottom'];

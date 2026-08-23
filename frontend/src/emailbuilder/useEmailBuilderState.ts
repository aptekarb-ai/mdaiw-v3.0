import { useCallback, useRef, useState } from 'react';
import type { ColumnContainerSettings, EmailModule, EmailModuleSettings, EmailModuleType } from './edm';
import { cloneModuleWithNewId, createModule, createModuleFromSaved } from './moduleFactory';
import {
  duplicateNestedModule as duplicateNestedModuleInTree,
  findModuleById,
  insertNestedModule as insertNestedModuleInTree,
  moveModuleBetweenColumns as moveModuleBetweenColumnsInTree,
  removeNestedModule as removeNestedModuleInTree,
  reorderNestedModule as reorderNestedModuleInTree,
  updateColumnSettings as updateColumnSettingsInTree,
  updateColumnWidths as updateColumnWidthsInTree,
  updateNestedModuleProps as updateNestedModulePropsInTree,
  updateNestedModuleSettings as updateNestedModuleSettingsInTree,
} from './layoutModel';
import type { NestedModuleDragPayload } from './dragTypes';
import type { SavedEmailModule } from './types';

const HISTORY_LIMIT = 50;
// Property-panel edits (typing in a text/color/number field) fire one
// update per keystroke — coalescing consecutive edits to the SAME module
// within this window into a single history entry keeps undo/redo at a
// useful granularity ("undo my last edit", not "undo my last keystroke")
// without needing a real debounce timer.
const COALESCE_WINDOW_MS = 800;

interface HistoryRef {
  stack: EmailModule[][];
  index: number;
}

interface SelectedColumnRef {
  layoutId: string;
  columnId: string;
}

function reindex(modules: EmailModule[]): EmailModule[] {
  return modules.map((module, index) => ({ ...module, order: index }));
}

export interface UseEmailBuilderState {
  modules: EmailModule[];
  selectedModuleId: string | null;
  selectedModule: EmailModule | null;
  // Feature 05 — set when a column's drop zone/background itself is the
  // selection target (not a nested module inside it, not the layout's
  // own outer chrome). See useEmailBuilderState.ts's selectColumn.
  selectedColumn: SelectedColumnRef | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  loadModules: (modules: EmailModule[]) => void;
  addModule: (type: EmailModuleType) => void;
  insertModuleAt: (type: EmailModuleType, index: number) => void;
  // Feature 14 — AI Engineer. Same top-level append as addModule, but the
  // new module's props are seeded from an already-validated patch (see
  // ai_command.py's `_validate_patch`) in the SAME history commit, so
  // "add a green button" is one undo step, not two.
  addModuleWithProps: (type: EmailModuleType, patch: Record<string, unknown>) => string;
  addModulesWithProps: (entries: { type: EmailModuleType; patch: Record<string, unknown> }[]) => string[];
  // Feature 14 — GLOBAL_STYLE action: applies one prop patch to every
  // module of `moduleType` anywhere in the tree (top-level AND nested
  // inside layout columns — "every button in the email", not just the
  // top-level ones), as a single history commit.
  applyGlobalStyle: (moduleType: EmailModuleType, patch: Record<string, unknown>) => void;
  addSavedModule: (saved: SavedEmailModule) => void;
  insertSavedModuleAt: (saved: SavedEmailModule, index: number) => void;
  selectModule: (id: string | null) => void;
  selectColumn: (layoutId: string, columnId: string) => void;
  deleteModule: (id: string) => void;
  duplicateModule: (id: string) => void;
  reorderModules: (fromIndex: number, toIndex: number) => void;
  updateModuleProps: (id: string, patch: Record<string, unknown>) => void;
  updateModuleSettings: (id: string, patch: Partial<EmailModuleSettings>) => void;
  // Feature 05 — nested (column) operations. All commit through the same
  // whole-tree history snapshot as every top-level mutator above, so
  // undo/redo covers nested operations for free (see the `commit`
  // docstring below).
  insertNestedModule: (layoutId: string, columnId: string, type: EmailModuleType, index?: number) => void;
  insertNestedSavedModule: (layoutId: string, columnId: string, saved: SavedEmailModule, index?: number) => void;
  deleteNestedModule: (layoutId: string, columnId: string, moduleId: string) => void;
  duplicateNestedModule: (layoutId: string, columnId: string, moduleId: string) => void;
  reorderNestedModule: (layoutId: string, columnId: string, fromIndex: number, toIndex: number) => void;
  moveNestedModule: (from: NestedModuleDragPayload, toLayoutId: string, toColumnId: string, toIndex: number) => void;
  updateNestedModuleProps: (layoutId: string, columnId: string, moduleId: string, patch: Record<string, unknown>) => void;
  updateNestedModuleSettings: (layoutId: string, columnId: string, moduleId: string, patch: Record<string, unknown>) => void;
  updateColumnWidths: (layoutId: string, widths: number[]) => void;
  updateColumnSettings: (layoutId: string, columnId: string, patch: Partial<ColumnContainerSettings>) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

export function useEmailBuilderState(): UseEmailBuilderState {
  const [modules, setModules] = useState<EmailModule[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<SelectedColumnRef | null>(null);
  const [dirty, setDirty] = useState(false);
  const historyRef = useRef<HistoryRef>({ stack: [[]], index: 0 });
  const coalesceRef = useRef<{ moduleId: string | null; timestamp: number }>({ moduleId: null, timestamp: 0 });
  // Synchronously-authoritative mirror of `modules`, updated by every
  // mutator the instant it computes a new array — never via a functional
  // setState updater. Two reasons: (1) React 18 StrictMode intentionally
  // double-invokes updater functions in dev to catch impurity, and
  // generating a fresh module id inside one would create two different
  // modules per call; (2) several mutators can legitimately run back to
  // back inside one event handler/tick, and closing over the `modules`
  // state variable there would read the same stale snapshot each time.
  // Reading modulesRef.current instead sidesteps both.
  const modulesRef = useRef<EmailModule[]>([]);

  // The history stack snapshots the WHOLE top-level `modules` tree on
  // every commit — including any nested columns/modules inside layout
  // modules. Because of that, every nested (Feature 05) mutator below
  // needs zero special-case undo/redo plumbing: it just computes a new
  // top-level array (via layoutModel.ts's immutable tree helpers) and
  // calls this same `commit`, exactly like a top-level mutator would.
  const commit = useCallback((next: EmailModule[], coalesceModuleId?: string) => {
    const history = historyRef.current;
    const now = Date.now();
    const atTip = history.index === history.stack.length - 1;
    const canCoalesce = Boolean(
      coalesceModuleId
      && atTip
      && coalesceRef.current.moduleId === coalesceModuleId
      && now - coalesceRef.current.timestamp < COALESCE_WINDOW_MS,
    );

    if (canCoalesce) {
      history.stack[history.index] = next;
    } else {
      const truncated = history.stack.slice(0, history.index + 1);
      truncated.push(next);
      while (truncated.length > HISTORY_LIMIT) truncated.shift();
      history.stack = truncated;
      history.index = history.stack.length - 1;
    }
    coalesceRef.current = { moduleId: coalesceModuleId ?? null, timestamp: now };
    modulesRef.current = next;
    setModules(next);
    setDirty(true);
  }, []);

  const loadModules = useCallback((initial: EmailModule[]) => {
    historyRef.current = { stack: [initial], index: 0 };
    coalesceRef.current = { moduleId: null, timestamp: 0 };
    modulesRef.current = initial;
    setModules(initial);
    setSelectedModuleId(null);
    setSelectedColumn(null);
    setDirty(false);
  }, []);

  const addModule = useCallback((type: EmailModuleType) => {
    const current = modulesRef.current;
    const newModule = createModule(type, current.length);
    commit([...current, newModule]);
    setSelectedModuleId(newModule.id);
    setSelectedColumn(null);
  }, [commit]);

  const insertModuleAt = useCallback((type: EmailModuleType, index: number) => {
    const current = modulesRef.current;
    const newModule = createModule(type, index);
    const positioned = [...current];
    positioned.splice(index, 0, newModule);
    commit(reindex(positioned));
    setSelectedModuleId(newModule.id);
    setSelectedColumn(null);
  }, [commit]);

  const addModuleWithProps = useCallback((type: EmailModuleType, patch: Record<string, unknown>) => {
    const current = modulesRef.current;
    const created = createModule(type, current.length);
    const withProps = Object.keys(patch).length ? { ...created, props: { ...created.props, ...patch } } : created;
    commit([...current, withProps]);
    setSelectedModuleId(withProps.id);
    setSelectedColumn(null);
    return withProps.id;
  }, [commit]);

  const addModulesWithProps = useCallback((entries: { type: EmailModuleType; patch: Record<string, unknown> }[]) => {
    const current = modulesRef.current;
    const appended: EmailModule[] = [];
    let runningLength = current.length;
    for (const entry of entries) {
      const created = createModule(entry.type, runningLength);
      const withProps = Object.keys(entry.patch).length
        ? { ...created, props: { ...created.props, ...entry.patch } }
        : created;
      appended.push(withProps);
      runningLength += 1;
    }
    commit(reindex([...current, ...appended]));
    const ids = appended.map((module) => module.id);
    setSelectedModuleId(ids[ids.length - 1] ?? null);
    setSelectedColumn(null);
    return ids;
  }, [commit]);

  const applyGlobalStyle = useCallback((moduleType: EmailModuleType, patch: Record<string, unknown>) => {
    const current = modulesRef.current;
    const applyToList = (list: EmailModule[]): EmailModule[] => list.map((module) => {
      let updated = module;
      if (updated.type === moduleType) {
        updated = { ...updated, props: { ...updated.props, ...patch } };
      }
      if (updated.columns) {
        updated = {
          ...updated,
          columns: updated.columns.map((column) => ({ ...column, modules: applyToList(column.modules) })),
        };
      }
      return updated;
    });
    commit(applyToList(current));
  }, [commit]);

  const addSavedModule = useCallback((saved: SavedEmailModule) => {
    const current = modulesRef.current;
    const newModule = createModuleFromSaved(saved, current.length);
    commit([...current, newModule]);
    setSelectedModuleId(newModule.id);
    setSelectedColumn(null);
  }, [commit]);

  const insertSavedModuleAt = useCallback((saved: SavedEmailModule, index: number) => {
    const current = modulesRef.current;
    const newModule = createModuleFromSaved(saved, index);
    const positioned = [...current];
    positioned.splice(index, 0, newModule);
    commit(reindex(positioned));
    setSelectedModuleId(newModule.id);
    setSelectedColumn(null);
  }, [commit]);

  const selectModule = useCallback((id: string | null) => {
    setSelectedModuleId(id);
    setSelectedColumn(null);
  }, []);

  // Selecting a column keeps its OWNING layout module selected too (so
  // the layout's own outer toolbar/border stays visible — instruction
  // 17's "Layout selected > Column selected" hierarchy), while
  // `selectedColumn` additionally drills into the column itself for the
  // Properties panel and for instruction 12's "insert into the active
  // column" routing.
  const selectColumn = useCallback((layoutId: string, columnId: string) => {
    setSelectedModuleId(layoutId);
    setSelectedColumn({ layoutId, columnId });
  }, []);

  const deleteModule = useCallback((id: string) => {
    const current = modulesRef.current;
    commit(reindex(current.filter((module) => module.id !== id)));
    setSelectedModuleId((selected) => (selected === id ? null : selected));
    setSelectedColumn((selected) => (selected?.layoutId === id ? null : selected));
  }, [commit]);

  const duplicateModule = useCallback((id: string) => {
    const current = modulesRef.current;
    const index = current.findIndex((module) => module.id === id);
    if (index < 0) return;
    const clone = cloneModuleWithNewId(current[index], index + 1);
    const positioned = [...current];
    positioned.splice(index + 1, 0, clone);
    commit(reindex(positioned));
    setSelectedModuleId(clone.id);
    setSelectedColumn(null);
  }, [commit]);

  const reorderModules = useCallback((fromIndex: number, toIndex: number) => {
    const current = modulesRef.current;
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= current.length) return;
    const positioned = [...current];
    const [moved] = positioned.splice(fromIndex, 1);
    const clampedTarget = Math.max(0, Math.min(toIndex, positioned.length));
    positioned.splice(clampedTarget, 0, moved);
    commit(reindex(positioned));
  }, [commit]);

  const updateModuleProps = useCallback((id: string, patch: Record<string, unknown>) => {
    const current = modulesRef.current;
    commit(
      current.map((module) => (module.id === id ? { ...module, props: { ...module.props, ...patch } } : module)),
      id,
    );
  }, [commit]);

  const updateModuleSettings = useCallback((id: string, patch: Partial<EmailModuleSettings>) => {
    const current = modulesRef.current;
    commit(
      current.map((module) => (
        module.id === id ? { ...module, settings: { ...module.settings, ...patch } } : module
      )),
      id,
    );
  }, [commit]);

  // --- Feature 05 — nested (column) operations ---------------------------

  const insertNestedModule = useCallback((layoutId: string, columnId: string, type: EmailModuleType, index?: number) => {
    const current = modulesRef.current;
    const newModule = createModule(type, index ?? 0);
    commit(insertNestedModuleInTree(current, layoutId, columnId, newModule, index));
    setSelectedModuleId(newModule.id);
    setSelectedColumn(null);
  }, [commit]);

  const insertNestedSavedModule = useCallback((layoutId: string, columnId: string, saved: SavedEmailModule, index?: number) => {
    const current = modulesRef.current;
    const newModule = createModuleFromSaved(saved, index ?? 0);
    commit(insertNestedModuleInTree(current, layoutId, columnId, newModule, index));
    setSelectedModuleId(newModule.id);
    setSelectedColumn(null);
  }, [commit]);

  const deleteNestedModule = useCallback((layoutId: string, columnId: string, moduleId: string) => {
    const current = modulesRef.current;
    commit(removeNestedModuleInTree(current, layoutId, columnId, moduleId));
    setSelectedModuleId((selected) => (selected === moduleId ? layoutId : selected));
  }, [commit]);

  const duplicateNestedModule = useCallback((layoutId: string, columnId: string, moduleId: string) => {
    const current = modulesRef.current;
    const { modules: next, newId } = duplicateNestedModuleInTree(current, layoutId, columnId, moduleId, cloneModuleWithNewId);
    commit(next);
    if (newId) setSelectedModuleId(newId);
  }, [commit]);

  const reorderNestedModule = useCallback((layoutId: string, columnId: string, fromIndex: number, toIndex: number) => {
    const current = modulesRef.current;
    commit(reorderNestedModuleInTree(current, layoutId, columnId, fromIndex, toIndex));
  }, [commit]);

  const moveNestedModule = useCallback((
    from: NestedModuleDragPayload, toLayoutId: string, toColumnId: string, toIndex: number,
  ) => {
    const current = modulesRef.current;
    commit(moveModuleBetweenColumnsInTree(
      current, from.layoutId, from.columnId, from.moduleId, toLayoutId, toColumnId, toIndex,
    ));
    setSelectedModuleId(from.moduleId);
    setSelectedColumn(null);
  }, [commit]);

  const updateNestedModuleProps = useCallback((layoutId: string, columnId: string, moduleId: string, patch: Record<string, unknown>) => {
    const current = modulesRef.current;
    commit(updateNestedModulePropsInTree(current, layoutId, columnId, moduleId, patch), moduleId);
  }, [commit]);

  const updateNestedModuleSettings = useCallback((layoutId: string, columnId: string, moduleId: string, patch: Record<string, unknown>) => {
    const current = modulesRef.current;
    commit(updateNestedModuleSettingsInTree(current, layoutId, columnId, moduleId, patch), moduleId);
  }, [commit]);

  const updateColumnWidths = useCallback((layoutId: string, widths: number[]) => {
    const current = modulesRef.current;
    commit(updateColumnWidthsInTree(current, layoutId, widths), `${layoutId}-widths`);
  }, [commit]);

  const updateColumnSettings = useCallback((layoutId: string, columnId: string, patch: Partial<ColumnContainerSettings>) => {
    const current = modulesRef.current;
    commit(updateColumnSettingsInTree(current, layoutId, columnId, patch), columnId);
  }, [commit]);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.index <= 0) return;
    history.index -= 1;
    modulesRef.current = history.stack[history.index];
    setModules(modulesRef.current);
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.index >= history.stack.length - 1) return;
    history.index += 1;
    modulesRef.current = history.stack[history.index];
    setModules(modulesRef.current);
    setDirty(true);
  }, []);

  const markSaved = useCallback(() => setDirty(false), []);

  // Nested-aware — a selected module can be a top-level module OR one
  // living inside a layout's column (ids are globally unique, so a
  // single lookup covers both — see layoutModel.ts's findModuleById).
  const selectedModule = selectedModuleId ? findModuleById(modules, selectedModuleId) : null;
  const history = historyRef.current;

  return {
    modules,
    selectedModuleId,
    selectedModule,
    selectedColumn,
    dirty,
    canUndo: history.index > 0,
    canRedo: history.index < history.stack.length - 1,
    loadModules,
    addModule,
    insertModuleAt,
    addModuleWithProps,
    addModulesWithProps,
    applyGlobalStyle,
    addSavedModule,
    insertSavedModuleAt,
    selectModule,
    selectColumn,
    deleteModule,
    duplicateModule,
    reorderModules,
    updateModuleProps,
    updateModuleSettings,
    insertNestedModule,
    insertNestedSavedModule,
    deleteNestedModule,
    duplicateNestedModule,
    reorderNestedModule,
    moveNestedModule,
    updateNestedModuleProps,
    updateNestedModuleSettings,
    updateColumnWidths,
    updateColumnSettings,
    undo,
    redo,
    markSaved,
  };
}

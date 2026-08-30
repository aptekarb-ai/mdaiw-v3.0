import { useCallback, useRef, useState } from 'react';
import type { ColumnContainerSettings, EmailModule, EmailModuleSettings, EmailModuleType } from './edm';
import { buildComposedModule, cloneModuleWithNewId, createModule, createModuleFromSaved } from './moduleFactory';
import type { ComposedModuleEntry } from './moduleFactory';
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

// Email Document Standards Sub-phase 2 (closure) — document-level email
// settings (title/subject/favicon/Reset CSS/Custom CSS) join the SAME
// undo/redo history as the module tree, rather than a second, competing
// history system. Every history entry snapshots BOTH halves together —
// see HistoryEntry below — so a sequence like "edit module A -> edit CSS
// -> edit module B" undoes/redoes each step individually and in the
// correct order, exactly like three module edits would.
export interface EmailDocumentSettingsSnapshot {
  email_title: string;
  email_subject: string;
  favicon_url: string;
  reset_css_enabled: boolean;
  custom_css_enabled: boolean;
  custom_css: string;
  // Module-4 E4 — document-level default for the existing per-module
  // settings.outlookVml opt-in (see edm.ts's EmailModuleSettings
  // docstring and htmlRenderer.ts's RenderableEmail.outlookVml). Same
  // "join the existing undo/redo history, PATCH on Save" contract as
  // every other document setting above — never a second settings system.
  outlook_vml_enabled: boolean;
}

export const EMPTY_DOCUMENT_SETTINGS: EmailDocumentSettingsSnapshot = {
  email_title: '',
  email_subject: '',
  favicon_url: '',
  reset_css_enabled: true,
  custom_css_enabled: false,
  custom_css: '',
  outlook_vml_enabled: false,
};

interface HistoryEntry {
  modules: EmailModule[];
  documentSettings: EmailDocumentSettingsSnapshot;
}

interface HistoryRef {
  stack: HistoryEntry[];
  index: number;
}

export interface SelectedColumnRef {
  layoutId: string;
  columnId: string;
}

// Sub-phase 7 — one node in a composition plan, structurally identical
// (camelCase) to aiCommand.ts's AIComposeItem — kept as its OWN local
// type rather than importing AIComposeItem here, so this state hook
// never depends on the AI-specific wire-format module; the adapter that
// maps snake_case action.items -> this shape lives in
// EmailBuilderWorkspacePage.tsx's handleApplyAiAction (COMPOSE_EMAIL
// case), the SAME "backend/AI concern stays out of the state hook"
// boundary applyGlobalStyle/addModulesWithProps already keep.
export type { ComposedModuleEntry } from './moduleFactory';

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
  // Email Document Standards Sub-phase 2 (closure) — the LIVE, editable,
  // undo/redo-participating document settings. `EmailDocument.email_title`
  // etc. (the last-fetched-from-server record) is stale until Save; this
  // is the value Preview/Code/Export/DocumentSettingsDialog/AI Engineer
  // must all read, exactly the same "live builder state, not the stale
  // fetched record" relationship `modules` already has with
  // `EmailDocument.content`.
  documentSettings: EmailDocumentSettingsSnapshot;
  dirty: boolean;
  // Module-4 Final Gap Closure, Correction 3 (Feature 03 autosave) — a
  // monotonically increasing counter, bumped on every commit/undo/redo
  // (i.e. exactly when `dirty` becomes true). `revision` is REACTIVE state
  // so a page-level effect can depend on it to (re)arm a save debounce;
  // `getRevision`/`getModules`/`getDocumentSettings` are stable functions
  // reading the SAME synchronously-updated refs `modules`/`documentSettings`
  // already use internally, so an async save-completion handler can always
  // ask "has the document changed since I started saving?" without a stale
  // closure — the save orchestration itself lives in
  // EmailBuilderWorkspacePage.tsx, not here; this hook only exposes the
  // primitive it's built from.
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  getRevision: () => number;
  getModules: () => EmailModule[];
  getDocumentSettings: () => EmailDocumentSettingsSnapshot;
  loadModules: (modules: EmailModule[], documentSettings?: EmailDocumentSettingsSnapshot) => void;
  // One history commit per call (never coalesced — item 1's "CSS A ->
  // Save CSS B -> Undo = A -> Redo = B" requires each Apply to be its own
  // undo step). Used by DocumentSettingsDialog's Apply and by the AI
  // Engineer's document-level (Reset/Custom CSS) proposals — the SAME
  // function, so there is exactly one code path that ever changes these
  // fields, matching every other builder mutator's "one function, every
  // caller" shape.
  updateDocumentSettings: (patch: Partial<EmailDocumentSettingsSnapshot>) => void;
  // Sub-phase 4, item 4 — the Repair Engine's "Apply" for a (possibly
  // multi-issue) proposal: every module prop patch AND the document
  // patch land in ONE history commit, so a batch of several repaired
  // issues undoes/redoes as a single step, exactly like any other single
  // Apply — never one history entry per issue.
  applyRepairPatch: (
    modulePatches: { moduleId: string; propPatch: Record<string, unknown> }[],
    documentPatch: Partial<EmailDocumentSettingsSnapshot> | null,
    settingsPatches?: { moduleId: string; settingsPatch: Record<string, unknown> }[],
  ) => void;
  addModule: (type: EmailModuleType) => void;
  insertModuleAt: (type: EmailModuleType, index: number) => void;
  // Feature 14 — AI Engineer. Same top-level append as addModule, but the
  // new module's props are seeded from an already-validated patch (see
  // ai_command.py's `_validate_patch`) in the SAME history commit, so
  // "add a green button" is one undo step, not two.
  addModuleWithProps: (type: EmailModuleType, patch: Record<string, unknown>) => string;
  addModulesWithProps: (entries: { type: EmailModuleType; patch: Record<string, unknown> }[]) => string[];
  // Sub-phase 7 — the AI Engineer's COMPOSE_EMAIL action: an ordered list
  // of top-level modules, each possibly a layout module with nested
  // per-column children and/or a module with seeded repeatable-field
  // items, appended in ONE history commit — so Applying an entire
  // composition is one undo/redo step, never one per module.
  addComposedModules: (entries: ComposedModuleEntry[]) => string[];
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
  // Sub-phase 6 — the AI Engineer's INSERT_NESTED_MODULE action seeds the
  // new module's props from an already-validated patch in the SAME
  // history commit as the insert, exactly like addModuleWithProps already
  // does for top-level AI inserts.
  insertNestedModuleWithProps: (
    layoutId: string, columnId: string, type: EmailModuleType, patch: Record<string, unknown>, index?: number,
  ) => string;
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
  const [documentSettings, setDocumentSettings] = useState<EmailDocumentSettingsSnapshot>(EMPTY_DOCUMENT_SETTINGS);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<SelectedColumnRef | null>(null);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const historyRef = useRef<HistoryRef>({ stack: [{ modules: [], documentSettings: EMPTY_DOCUMENT_SETTINGS }], index: 0 });
  const coalesceRef = useRef<{ key: string | null; timestamp: number }>({ key: null, timestamp: 0 });
  // Synchronously-authoritative mirrors of `modules`/`documentSettings`,
  // updated by every mutator the instant it computes a new value — never
  // via a functional setState updater. Two reasons: (1) React 18
  // StrictMode intentionally double-invokes updater functions in dev to
  // catch impurity, and generating a fresh module id inside one would
  // create two different modules per call; (2) several mutators can
  // legitimately run back to back inside one event handler/tick, and
  // closing over the state variable there would read the same stale
  // snapshot each time. Reading these refs instead sidesteps both.
  const modulesRef = useRef<EmailModule[]>([]);
  const documentSettingsRef = useRef<EmailDocumentSettingsSnapshot>(EMPTY_DOCUMENT_SETTINGS);

  // Module-4 Final Gap Closure, Correction 3 — the ONE place `revision`
  // ever advances, called everywhere `setDirty(true)` already is (commit,
  // undo, redo). Synchronous ref bump first (readable immediately by
  // getRevision) then the reactive state bump (so effects depending on
  // `revision` re-run).
  const bumpRevision = useCallback(() => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  }, []);

  // The ONE history commit function — every mutator below (module tree
  // AND document settings) funnels through this. Each entry snapshots
  // BOTH halves together, so a module edit carries the current document
  // settings forward unchanged, and a document-settings edit carries the
  // current module tree forward unchanged — undo/redo always restores a
  // complete, consistent document state, never one half stale.
  const commitEntry = useCallback((next: HistoryEntry, coalesceKey?: string) => {
    const history = historyRef.current;
    const now = Date.now();
    const atTip = history.index === history.stack.length - 1;
    const canCoalesce = Boolean(
      coalesceKey
      && atTip
      && coalesceRef.current.key === coalesceKey
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
    coalesceRef.current = { key: coalesceKey ?? null, timestamp: now };
    modulesRef.current = next.modules;
    documentSettingsRef.current = next.documentSettings;
    setModules(next.modules);
    setDocumentSettings(next.documentSettings);
    setDirty(true);
    bumpRevision();
  }, [bumpRevision]);

  // The history stack snapshots the WHOLE top-level `modules` tree on
  // every commit — including any nested columns/modules inside layout
  // modules. Because of that, every nested (Feature 05) mutator below
  // needs zero special-case undo/redo plumbing: it just computes a new
  // top-level array (via layoutModel.ts's immutable tree helpers) and
  // calls this same `commit`, exactly like a top-level mutator would.
  const commit = useCallback((next: EmailModule[], coalesceModuleId?: string) => {
    commitEntry({ modules: next, documentSettings: documentSettingsRef.current }, coalesceModuleId);
  }, [commitEntry]);

  // Item 1 — the SAME history commit function document settings share
  // with module edits. Never coalesced (undefined coalesce key): each
  // Apply/AI-proposal-Apply is always its own undo step, regardless of
  // how quickly two saves happen back to back.
  const updateDocumentSettings = useCallback((patch: Partial<EmailDocumentSettingsSnapshot>) => {
    commitEntry({ modules: modulesRef.current, documentSettings: { ...documentSettingsRef.current, ...patch } });
  }, [commitEntry]);

  // Sub-phase 4, item 4 — same recursive one-level-of-column-nesting walk
  // applyGlobalStyle already uses, so a repair targeting a module nested
  // inside a layout column is patched correctly without any special-case
  // path lookup.
  const applyRepairPatch = useCallback((
    modulePatches: { moduleId: string; propPatch: Record<string, unknown> }[],
    documentPatch: Partial<EmailDocumentSettingsSnapshot> | null,
    settingsPatches: { moduleId: string; settingsPatch: Record<string, unknown> }[] = [],
  ) => {
    let nextModules = modulesRef.current;
    if (modulePatches.length > 0 || settingsPatches.length > 0) {
      const propPatchByModuleId = new Map(modulePatches.map((entry) => [entry.moduleId, entry.propPatch]));
      const settingsPatchByModuleId = new Map(settingsPatches.map((entry) => [entry.moduleId, entry.settingsPatch]));
      const applyToList = (list: EmailModule[]): EmailModule[] => list.map((module) => {
        let updated = module;
        const propPatch = propPatchByModuleId.get(module.id);
        if (propPatch) {
          updated = { ...updated, props: { ...updated.props, ...propPatch } };
        }
        const settingsPatch = settingsPatchByModuleId.get(module.id);
        if (settingsPatch) {
          updated = { ...updated, settings: { ...updated.settings, ...settingsPatch } };
        }
        if (updated.columns) {
          updated = {
            ...updated,
            columns: updated.columns.map((column) => ({ ...column, modules: applyToList(column.modules) })),
          };
        }
        return updated;
      });
      nextModules = applyToList(nextModules);
    }
    const nextDocumentSettings = documentPatch
      ? { ...documentSettingsRef.current, ...documentPatch }
      : documentSettingsRef.current;
    commitEntry({ modules: nextModules, documentSettings: nextDocumentSettings });
  }, [commitEntry]);

  const loadModules = useCallback((initialModules: EmailModule[], initialSettings: EmailDocumentSettingsSnapshot = EMPTY_DOCUMENT_SETTINGS) => {
    historyRef.current = { stack: [{ modules: initialModules, documentSettings: initialSettings }], index: 0 };
    coalesceRef.current = { key: null, timestamp: 0 };
    modulesRef.current = initialModules;
    documentSettingsRef.current = initialSettings;
    setModules(initialModules);
    setDocumentSettings(initialSettings);
    setSelectedModuleId(null);
    setSelectedColumn(null);
    setDirty(false);
    revisionRef.current = 0;
    setRevision(0);
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

  // Phase D — buildComposedModule itself now lives in moduleFactory.ts
  // (extracted, pure, no hook dependency) so the pre-document AI Generate
  // Email flow can build modules from an AI composition without a
  // mounted builder instance. This hook still owns the ONLY thing that
  // genuinely needs live state: appending the built modules to the
  // current tree and committing one history entry.
  const addComposedModules = useCallback((entries: ComposedModuleEntry[]) => {
    const current = modulesRef.current;
    const built: EmailModule[] = [];
    let runningLength = current.length;
    for (const entry of entries) {
      built.push(buildComposedModule(entry, runningLength));
      runningLength += 1;
    }
    commit(reindex([...current, ...built]));
    const ids = built.map((module) => module.id);
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

  const insertNestedModuleWithProps = useCallback((
    layoutId: string, columnId: string, type: EmailModuleType, patch: Record<string, unknown>, index?: number,
  ) => {
    const current = modulesRef.current;
    const created = createModule(type, index ?? 0);
    const newModule = Object.keys(patch).length ? { ...created, props: { ...created.props, ...patch } } : created;
    commit(insertNestedModuleInTree(current, layoutId, columnId, newModule, index));
    setSelectedModuleId(newModule.id);
    setSelectedColumn(null);
    return newModule.id;
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
    const entry = history.stack[history.index];
    modulesRef.current = entry.modules;
    documentSettingsRef.current = entry.documentSettings;
    setModules(entry.modules);
    setDocumentSettings(entry.documentSettings);
    setDirty(true);
    bumpRevision();
  }, [bumpRevision]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.index >= history.stack.length - 1) return;
    history.index += 1;
    const entry = history.stack[history.index];
    modulesRef.current = entry.modules;
    documentSettingsRef.current = entry.documentSettings;
    setModules(entry.modules);
    setDocumentSettings(entry.documentSettings);
    setDirty(true);
    bumpRevision();
  }, [bumpRevision]);

  const markSaved = useCallback(() => setDirty(false), []);
  const getRevision = useCallback(() => revisionRef.current, []);
  const getModules = useCallback(() => modulesRef.current, []);
  const getDocumentSettings = useCallback(() => documentSettingsRef.current, []);

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
    documentSettings,
    dirty,
    revision,
    canUndo: history.index > 0,
    canRedo: history.index < history.stack.length - 1,
    getRevision,
    getModules,
    getDocumentSettings,
    loadModules,
    updateDocumentSettings,
    applyRepairPatch,
    addModule,
    insertModuleAt,
    addModuleWithProps,
    addModulesWithProps,
    addComposedModules,
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
    insertNestedModuleWithProps,
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

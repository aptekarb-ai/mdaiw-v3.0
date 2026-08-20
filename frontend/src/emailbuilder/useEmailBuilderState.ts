import { useCallback, useRef, useState } from 'react';
import type { EmailModule, EmailModuleSettings, EmailModuleType } from './edm';
import { cloneModuleWithNewId, createModule } from './moduleFactory';

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

function reindex(modules: EmailModule[]): EmailModule[] {
  return modules.map((module, index) => ({ ...module, order: index }));
}

export interface UseEmailBuilderState {
  modules: EmailModule[];
  selectedModuleId: string | null;
  selectedModule: EmailModule | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  loadModules: (modules: EmailModule[]) => void;
  addModule: (type: EmailModuleType) => void;
  insertModuleAt: (type: EmailModuleType, index: number) => void;
  selectModule: (id: string | null) => void;
  deleteModule: (id: string) => void;
  duplicateModule: (id: string) => void;
  reorderModules: (fromIndex: number, toIndex: number) => void;
  updateModuleProps: (id: string, patch: Record<string, unknown>) => void;
  updateModuleSettings: (id: string, patch: Partial<EmailModuleSettings>) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

export function useEmailBuilderState(): UseEmailBuilderState {
  const [modules, setModules] = useState<EmailModule[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
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
    setDirty(false);
  }, []);

  const addModule = useCallback((type: EmailModuleType) => {
    const current = modulesRef.current;
    const newModule = createModule(type, current.length);
    commit([...current, newModule]);
    setSelectedModuleId(newModule.id);
  }, [commit]);

  const insertModuleAt = useCallback((type: EmailModuleType, index: number) => {
    const current = modulesRef.current;
    const newModule = createModule(type, index);
    const positioned = [...current];
    positioned.splice(index, 0, newModule);
    commit(reindex(positioned));
    setSelectedModuleId(newModule.id);
  }, [commit]);

  const selectModule = useCallback((id: string | null) => {
    setSelectedModuleId(id);
  }, []);

  const deleteModule = useCallback((id: string) => {
    const current = modulesRef.current;
    commit(reindex(current.filter((module) => module.id !== id)));
    setSelectedModuleId((selected) => (selected === id ? null : selected));
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

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;
  const history = historyRef.current;

  return {
    modules,
    selectedModuleId,
    selectedModule,
    dirty,
    canUndo: history.index > 0,
    canRedo: history.index < history.stack.length - 1,
    loadModules,
    addModule,
    insertModuleAt,
    selectModule,
    deleteModule,
    duplicateModule,
    reorderModules,
    updateModuleProps,
    updateModuleSettings,
    undo,
    redo,
    markSaved,
  };
}

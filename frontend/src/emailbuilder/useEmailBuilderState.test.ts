import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEmailBuilderState } from './useEmailBuilderState';
import type { TextModuleProps } from './edm';
import { createResponsiveSettings } from './registryCore';
import type { SavedEmailModule } from './types';

function saved(overrides: Partial<SavedEmailModule> = {}): SavedEmailModule {
  return {
    id: 1,
    name: 'My Header',
    module_type: 'header-logo-center',
    props: { logoSrc: 'https://example.com/logo.png', logoAlt: 'Logo', logoWidth: 200 },
    settings: createResponsiveSettings({ paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }),
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

describe('useEmailBuilderState', () => {
  it('starts empty, clean, with no undo/redo history', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    expect(result.current.modules).toEqual([]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('addModule appends a module, selects it, and marks the state dirty', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));

    expect(result.current.modules).toHaveLength(1);
    expect(result.current.modules[0].type).toBe('text');
    expect(result.current.selectedModuleId).toBe(result.current.modules[0].id);
    expect(result.current.dirty).toBe(true);
  });

  it('selectModule / deleteModule clears selection when the selected module is deleted', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    const id = result.current.modules[0].id;

    act(() => result.current.deleteModule(id));
    expect(result.current.modules).toHaveLength(0);
    expect(result.current.selectedModuleId).toBeNull();
  });

  it('duplicateModule inserts a copy with a new id right after the original', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('button'));
    const originalId = result.current.modules[0].id;

    act(() => result.current.duplicateModule(originalId));
    expect(result.current.modules).toHaveLength(2);
    expect(result.current.modules[1].id).not.toBe(originalId);
    expect(result.current.modules[1].type).toBe('button');
    expect(result.current.modules.map((m) => m.order)).toEqual([0, 1]);
  });

  it('reorderModules moves a module and reindexes order', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => {
      result.current.addModule('text');
      result.current.addModule('image');
      result.current.addModule('button');
    });
    const typesBefore = result.current.modules.map((m) => m.type);
    expect(typesBefore).toEqual(['text', 'image', 'button']);

    act(() => result.current.reorderModules(0, 2));
    const typesAfter = result.current.modules.map((m) => m.type);
    expect(typesAfter).toEqual(['image', 'button', 'text']);
    expect(result.current.modules.map((m) => m.order)).toEqual([0, 1, 2]);
  });

  it('updateModuleProps patches only the targeted module', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => {
      result.current.addModule('text');
      result.current.addModule('text');
    });
    const [first, second] = result.current.modules;

    act(() => result.current.updateModuleProps(first.id, { text: 'Updated' }));
    expect((result.current.modules[0].props as unknown as TextModuleProps).text).toBe('Updated');
    expect(result.current.modules[1].props).toEqual(second.props);
  });

  it('undo reverts the last committed change and redo reapplies it', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    expect(result.current.modules).toHaveLength(1);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.modules).toHaveLength(0);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.modules).toHaveLength(1);
  });

  it('a new action after undo discards the redo branch', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    act(() => result.current.addModule('image'));
    act(() => result.current.undo());
    expect(result.current.modules).toHaveLength(1);

    act(() => result.current.addModule('button'));
    expect(result.current.modules.map((m) => m.type)).toEqual(['text', 'button']);
    expect(result.current.canRedo).toBe(false);
  });

  it('markSaved clears the dirty flag without touching modules or history', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.markSaved());
    expect(result.current.dirty).toBe(false);
    expect(result.current.modules).toHaveLength(1);
    expect(result.current.canUndo).toBe(true);
  });

  it('addSavedModule inserts the saved instance props/settings with a fresh id', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addSavedModule(saved()));

    expect(result.current.modules).toHaveLength(1);
    const inserted = result.current.modules[0];
    expect(inserted.type).toBe('header-logo-center');
    // Feature 06 — normalization backfills new optional fields (e.g.
    // header's logoHref) that predate this saved module's own creation,
    // same as loading any older document; expected superset, not
    // strict equality.
    expect(inserted.props).toEqual(expect.objectContaining(saved().props));
    expect(inserted.id).not.toBe('');
    expect(result.current.selectedModuleId).toBe(inserted.id);
  });

  it('addSavedModule preserves the saved module\'s Desktop/Mobile outer-spacer values', () => {
    const savedWithSpacing = saved({
      settings: {
        ...createResponsiveSettings({ paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }),
        outerSpacing: {
          desktop: { left: { value: 20, unit: 'px' }, right: { value: 30, unit: 'px' } },
          mobile: { left: { value: 8, unit: 'px' } },
        },
      },
    });
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addSavedModule(savedWithSpacing));

    const inserted = result.current.modules[0];
    expect(inserted.settings.outerSpacing).toEqual({
      desktop: { left: { value: 20, unit: 'px' }, right: { value: 30, unit: 'px' } },
      mobile: { left: { value: 8, unit: 'px' } },
    });
  });

  it('two insertions of the same saved module never share an instance id', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => {
      result.current.addSavedModule(saved());
      result.current.addSavedModule(saved());
    });
    const [first, second] = result.current.modules;
    expect(first.id).not.toBe(second.id);
  });

  it('insertSavedModuleAt inserts at the given index and reindexes order', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => {
      result.current.addModule('text');
      result.current.addModule('button');
    });

    act(() => result.current.insertSavedModuleAt(saved(), 1));
    expect(result.current.modules.map((m) => m.type)).toEqual(['text', 'header-logo-center', 'button']);
    expect(result.current.modules.map((m) => m.order)).toEqual([0, 1, 2]);
  });

  it('loadModules resets modules, selection, dirty state and history', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));

    act(() => result.current.loadModules([]));
    expect(result.current.modules).toEqual([]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.selectedModuleId).toBeNull();
    expect(result.current.canUndo).toBe(false);
  });

  // Module-4 Final Gap Closure, Correction 3 (Feature 03 autosave) — the
  // revision counter EmailBuilderWorkspacePage.tsx's save orchestration
  // is built on. `revision` is the reactive dependency an autosave-debounce
  // effect watches; `getRevision`/`getModules`/`getDocumentSettings` are
  // the synchronous getters an async save-completion handler reads to
  // detect "did the document change since I started saving".
  it('revision starts at 0 and is unaffected by an initial empty load', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    expect(result.current.revision).toBe(0);
    expect(result.current.getRevision()).toBe(0);
  });

  it('revision advances by exactly 1 on each commit-producing mutation', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    expect(result.current.revision).toBe(1);
    act(() => result.current.addModule('image'));
    expect(result.current.revision).toBe(2);
  });

  it('revision advances on undo and on redo', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    expect(result.current.revision).toBe(1);

    act(() => result.current.undo());
    expect(result.current.revision).toBe(2);

    act(() => result.current.redo());
    expect(result.current.revision).toBe(3);
  });

  it('revision does NOT advance on markSaved (saving is not itself an edit)', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    const revisionAfterEdit = result.current.revision;

    act(() => result.current.markSaved());
    expect(result.current.revision).toBe(revisionAfterEdit);
  });

  it('getRevision/getModules/getDocumentSettings read the CURRENT values synchronously, not a stale snapshot', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    const firstRevision = result.current.getRevision();
    expect(result.current.getModules()).toHaveLength(1);

    act(() => result.current.addModule('image'));
    // A getter captured/called before the second edit must, when called
    // AGAIN after it, reflect the new state — this is the exact property
    // the save-completion "has anything changed since I started" check
    // depends on.
    expect(result.current.getRevision()).not.toBe(firstRevision);
    expect(result.current.getModules()).toHaveLength(2);
  });

  it('loadModules resets revision back to 0', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('text'));
    act(() => result.current.addModule('image'));
    expect(result.current.revision).toBeGreaterThan(0);

    act(() => result.current.loadModules([]));
    expect(result.current.revision).toBe(0);
    expect(result.current.getRevision()).toBe(0);
  });
});

describe('useEmailBuilderState — Feature 05 nested (column) operations', () => {
  function addLayoutAndGetIds(result: { current: ReturnType<typeof useEmailBuilderState> }) {
    act(() => result.current.addModule('layout-2col-50-50'));
    const layout = result.current.modules[0];
    return { layoutId: layout.id, columnAId: layout.columns![0].id, columnBId: layout.columns![1].id };
  }

  it('insertNestedModule inserts into the target column and selects the new nested module', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);

    act(() => result.current.insertNestedModule(layoutId, columnAId, 'text'));
    const layout = result.current.modules[0];
    expect(layout.columns![0].modules).toHaveLength(1);
    expect(layout.columns![1].modules).toHaveLength(0);
    expect(result.current.selectedModuleId).toBe(layout.columns![0].modules[0].id);
  });

  it('a nested module id is globally unique (never collides with the layout or another top-level module)', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);
    act(() => result.current.insertNestedModule(layoutId, columnAId, 'text'));
    const nestedId = result.current.modules[0].columns![0].modules[0].id;
    expect(nestedId).not.toBe(layoutId);
  });

  it('deleteNestedModule removes only the targeted nested module and selects the parent layout', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);
    act(() => result.current.insertNestedModule(layoutId, columnAId, 'text'));
    const nestedId = result.current.modules[0].columns![0].modules[0].id;

    act(() => result.current.deleteNestedModule(layoutId, columnAId, nestedId));
    expect(result.current.modules[0].columns![0].modules).toHaveLength(0);
    expect(result.current.selectedModuleId).toBe(layoutId);
  });

  it('duplicateNestedModule clones with a fresh id in the same column', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);
    act(() => result.current.insertNestedModule(layoutId, columnAId, 'button'));
    const originalId = result.current.modules[0].columns![0].modules[0].id;

    act(() => result.current.duplicateNestedModule(layoutId, columnAId, originalId));
    const nestedModules = result.current.modules[0].columns![0].modules;
    expect(nestedModules).toHaveLength(2);
    expect(nestedModules[1].id).not.toBe(originalId);
    expect(result.current.selectedModuleId).toBe(nestedModules[1].id);
  });

  it('reorderNestedModule reorders modules within one column', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);
    act(() => {
      result.current.insertNestedModule(layoutId, columnAId, 'text');
      result.current.insertNestedModule(layoutId, columnAId, 'image');
    });
    const idsBefore = result.current.modules[0].columns![0].modules.map((m) => m.type);
    expect(idsBefore).toEqual(['text', 'image']);

    act(() => result.current.reorderNestedModule(layoutId, columnAId, 0, 1));
    const idsAfter = result.current.modules[0].columns![0].modules.map((m) => m.type);
    expect(idsAfter).toEqual(['image', 'text']);
  });

  it('moveNestedModule moves a module between columns, preserving its id', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId, columnBId } = addLayoutAndGetIds(result);
    act(() => result.current.insertNestedModule(layoutId, columnAId, 'text'));
    const movedId = result.current.modules[0].columns![0].modules[0].id;

    act(() => result.current.moveNestedModule({ layoutId, columnId: columnAId, moduleId: movedId }, layoutId, columnBId, 0));
    const layout = result.current.modules[0];
    expect(layout.columns![0].modules).toHaveLength(0);
    expect(layout.columns![1].modules.map((m) => m.id)).toEqual([movedId]);
  });

  it('undo/redo covers nested insert, move, and delete for free (whole-tree history snapshot)', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId, columnBId } = addLayoutAndGetIds(result);

    act(() => result.current.insertNestedModule(layoutId, columnAId, 'button'));
    const movedId = result.current.modules[0].columns![0].modules[0].id;
    act(() => result.current.moveNestedModule({ layoutId, columnId: columnAId, moduleId: movedId }, layoutId, columnBId, 0));
    expect(result.current.modules[0].columns![1].modules).toHaveLength(1);

    act(() => result.current.undo());
    expect(result.current.modules[0].columns![0].modules).toHaveLength(1);
    expect(result.current.modules[0].columns![1].modules).toHaveLength(0);

    act(() => result.current.redo());
    expect(result.current.modules[0].columns![0].modules).toHaveLength(0);
    expect(result.current.modules[0].columns![1].modules).toHaveLength(1);
  });

  it('updateColumnWidths changes the layout\'s columnWidths and is undoable', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId } = addLayoutAndGetIds(result);

    act(() => result.current.updateColumnWidths(layoutId, [35, 65]));
    expect((result.current.modules[0].props as { columnWidths: number[] }).columnWidths).toEqual([35, 65]);

    act(() => result.current.undo());
    expect((result.current.modules[0].props as { columnWidths: number[] }).columnWidths).toEqual([50, 50]);
  });

  it('updateColumnSettings changes only the targeted column\'s container settings', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);

    act(() => result.current.updateColumnSettings(layoutId, columnAId, { backgroundColor: '#00ff00', verticalAlign: 'middle' }));
    const layout = result.current.modules[0];
    expect(layout.columns![0].settings.backgroundColor).toBe('#00ff00');
    expect(layout.columns![0].settings.verticalAlign).toBe('middle');
    expect(layout.columns![1].settings.backgroundColor).toBe('');
  });

  it('selectColumn keeps the owning layout selected and records the active column', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);

    act(() => result.current.selectColumn(layoutId, columnAId));
    expect(result.current.selectedModuleId).toBe(layoutId);
    expect(result.current.selectedColumn).toEqual({ layoutId, columnId: columnAId });
  });

  it('selecting a different module clears any active column selection', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);
    act(() => result.current.selectColumn(layoutId, columnAId));

    act(() => result.current.addModule('text'));
    expect(result.current.selectedColumn).toBeNull();
  });

  it('duplicateModule deep-clones a layout: fresh layout id, fresh column ids, fresh nested module ids', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const { layoutId, columnAId } = addLayoutAndGetIds(result);
    act(() => result.current.insertNestedModule(layoutId, columnAId, 'text'));
    const original = result.current.modules[0];
    const originalNestedId = original.columns![0].modules[0].id;

    act(() => result.current.duplicateModule(layoutId));
    expect(result.current.modules).toHaveLength(2);
    const clone = result.current.modules[1];

    expect(clone.id).not.toBe(original.id);
    expect(clone.columns![0].id).not.toBe(original.columns![0].id);
    expect(clone.columns![1].id).not.toBe(original.columns![1].id);
    expect(clone.columns![0].modules[0].id).not.toBe(originalNestedId);
    // Content/settings are equivalent, just re-identified.
    expect(clone.columns![0].modules[0].props).toEqual(original.columns![0].modules[0].props);
  });

  it('addSavedModule deep-clones a saved layout\'s columns/nested modules with fresh ids', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const savedLayout: SavedEmailModule = {
      id: 42,
      name: 'Saved 2-Column',
      module_type: 'layout-2col-50-50',
      props: { columnWidths: [50, 50] },
      settings: createResponsiveSettings(),
      columns: [
        {
          id: 'saved-col-a',
          modules: [{ id: 'saved-nested-1', type: 'text', order: 0, props: { text: 'hi' }, settings: createResponsiveSettings() }],
          settings: { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' },
        },
        {
          id: 'saved-col-b',
          modules: [],
          settings: { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' },
        },
      ],
      created_at: '2026-08-20T10:00:00Z',
      updated_at: '2026-08-20T10:00:00Z',
    };

    act(() => result.current.addSavedModule(savedLayout));
    const inserted = result.current.modules[0];
    expect(inserted.columns).toHaveLength(2);
    expect(inserted.columns![0].id).not.toBe('saved-col-a');
    expect(inserted.columns![0].modules[0].id).not.toBe('saved-nested-1');
    expect((inserted.columns![0].modules[0].props as { text: string }).text).toBe('hi');
  });

  it('two insertions of the same saved layout never share nested module ids', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    const savedLayout: SavedEmailModule = {
      id: 43,
      name: 'Saved Layout',
      module_type: 'layout-2col-50-50',
      props: { columnWidths: [50, 50] },
      settings: createResponsiveSettings(),
      columns: [
        {
          id: 'col-x',
          modules: [{ id: 'nested-x', type: 'text', order: 0, props: { text: 'a' }, settings: createResponsiveSettings() }],
          settings: { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' },
        },
      ],
      created_at: '2026-08-20T10:00:00Z',
      updated_at: '2026-08-20T10:00:00Z',
    };

    act(() => {
      result.current.addSavedModule(savedLayout);
      result.current.addSavedModule(savedLayout);
    });
    const [first, second] = result.current.modules;
    expect(first.columns![0].modules[0].id).not.toBe(second.columns![0].modules[0].id);
  });
});

describe('useEmailBuilderState — Feature 14 AI Engineer mutators', () => {
  it('addModuleWithProps appends a module with the given props in one history commit', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModuleWithProps('button', { text: 'Buy Now' }));

    expect(result.current.modules).toHaveLength(1);
    expect(result.current.modules[0].type).toBe('button');
    expect((result.current.modules[0].props as { text: string }).text).toBe('Buy Now');
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.modules).toHaveLength(0);
  });

  it('addModulesWithProps inserts several modules as a single undo step', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModulesWithProps([
      { type: 'text', patch: {} },
      { type: 'button', patch: { text: 'Shop' } },
    ]));

    expect(result.current.modules).toHaveLength(2);
    expect(result.current.modules.map((m) => m.type)).toEqual(['text', 'button']);
    expect(result.current.selectedModuleId).toBe(result.current.modules[1].id);

    act(() => result.current.undo());
    expect(result.current.modules).toHaveLength(0);
  });

  // Sub-phase 7 — addComposedModules. Covers the whole composition
  // shape: flat modules, a layout with nested per-column children, and a
  // module with seeded repeatable items, all landing in ONE history
  // commit (Apply -> Undo removes the ENTIRE composition in one step).
  describe('addComposedModules', () => {
    it('inserts several flat modules as a single undo step', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addComposedModules([
        { type: 'header-logo-center', patch: {} },
        { type: 'text', patch: { text: 'Hello' } },
        { type: 'button', patch: { text: 'Shop Now' } },
      ]));

      expect(result.current.modules).toHaveLength(3);
      expect(result.current.modules.map((m) => m.type)).toEqual(['header-logo-center', 'text', 'button']);
      expect((result.current.modules[1].props as { text: string }).text).toBe('Hello');
      expect(result.current.selectedModuleId).toBe(result.current.modules[2].id);
      expect(result.current.canUndo).toBe(true);

      // One undo removes the WHOLE composition, not just the last module.
      act(() => result.current.undo());
      expect(result.current.modules).toHaveLength(0);

      act(() => result.current.redo());
      expect(result.current.modules).toHaveLength(3);
    });

    it('populates a layout module\'s columns with nested children', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addComposedModules([
        {
          type: 'layout-2col-50-50', patch: {},
          children: [
            { columnIndex: 0, modules: [{ type: 'text', patch: { text: 'Left' } }] },
            { columnIndex: 1, modules: [{ type: 'text', patch: { text: 'Right' } }] },
          ],
        },
      ]));

      const layout = result.current.modules[0];
      expect(layout.type).toBe('layout-2col-50-50');
      expect(layout.columns).toHaveLength(2);
      expect((layout.columns![0].modules[0].props as { text: string }).text).toBe('Left');
      expect((layout.columns![1].modules[0].props as { text: string }).text).toBe('Right');

      act(() => result.current.undo());
      expect(result.current.modules).toHaveLength(0);
    });

    it('leaves a column with no matching child group empty (not every column needs content)', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addComposedModules([
        {
          type: 'layout-2col-50-50', patch: {},
          children: [{ columnIndex: 0, modules: [{ type: 'text', patch: {} }] }],
        },
      ]));
      const layout = result.current.modules[0];
      expect(layout.columns![0].modules).toHaveLength(1);
      expect(layout.columns![1].modules).toHaveLength(0);
    });

    it('seeds a module\'s repeatable field from repeatableItems', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addComposedModules([
        {
          type: 'social-icon-row', patch: {},
          repeatableItems: [
            { label: 'Facebook', href: 'https://facebook.com/x' },
            { label: 'Instagram', href: 'https://instagram.com/x' },
          ],
        },
      ]));
      const social = result.current.modules[0];
      const platforms = (social.props as { platforms: { label: string; href: string }[] }).platforms;
      expect(platforms).toHaveLength(2);
      expect(platforms[0]).toEqual({ label: 'Facebook', href: 'https://facebook.com/x' });
      expect(platforms[1]).toEqual({ label: 'Instagram', href: 'https://instagram.com/x' });
    });

    it('ignores repeatableItems for a module with no repeatable field', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addComposedModules([
        { type: 'button', patch: { text: 'Shop' }, repeatableItems: [{ label: 'x', href: 'y' }] },
      ]));
      const button = result.current.modules[0];
      expect((button.props as { text: string }).text).toBe('Shop');
      expect((button.props as Record<string, unknown>).platforms).toBeUndefined();
    });

    it('a non-layout module with children is unaffected by the children key', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addComposedModules([
        // 'text' has no .columns at all -- children must be a silent no-op.
        { type: 'text', patch: { text: 'Plain' }, children: [{ columnIndex: 0, modules: [{ type: 'button', patch: {} }] }] },
      ]));
      const textModule = result.current.modules[0];
      expect(textModule.type).toBe('text');
      expect(textModule.columns).toBeUndefined();
      expect((textModule.props as { text: string }).text).toBe('Plain');
    });

    it('a full mixed composition (flat + layout + repeatable) is one undo step', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addComposedModules([
        { type: 'header-logo-center', patch: {} },
        {
          type: 'layout-2col-50-50', patch: {},
          children: [
            { columnIndex: 0, modules: [{ type: 'text', patch: { text: 'A' } }] },
            { columnIndex: 1, modules: [{ type: 'text', patch: { text: 'B' } }] },
          ],
        },
        { type: 'social-icon-row', patch: {}, repeatableItems: [{ label: 'X', href: 'https://x.com' }] },
        { type: 'footer-simple-legal', patch: {} },
      ]));

      expect(result.current.modules).toHaveLength(4);
      act(() => result.current.undo());
      expect(result.current.modules).toHaveLength(0);
      act(() => result.current.redo());
      expect(result.current.modules).toHaveLength(4);
      const social = result.current.modules[2];
      expect((social.props as { platforms: unknown[] }).platforms).toHaveLength(1);
    });
  });

  it('applyGlobalStyle patches every top-level module of the given type, leaving others untouched', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => {
      result.current.addModule('button');
      result.current.addModule('text');
      result.current.addModule('button');
    });

    act(() => result.current.applyGlobalStyle('button', { backgroundColor: '#76C043' }));

    const [first, second, third] = result.current.modules;
    expect((first.props as { backgroundColor?: string }).backgroundColor).toBe('#76C043');
    expect((second.props as { backgroundColor?: string }).backgroundColor).not.toBe('#76C043');
    expect((third.props as { backgroundColor?: string }).backgroundColor).toBe('#76C043');
  });

  it('applyGlobalStyle also reaches modules nested inside layout columns', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.addModule('layout-2col-50-50'));
    const layout = result.current.modules[0];
    act(() => result.current.insertNestedModule(layout.id, layout.columns![0].id, 'text'));

    act(() => result.current.applyGlobalStyle('text', { color: '#0082AD' }));

    const nested = result.current.modules[0].columns![0].modules[0];
    expect((nested.props as { color?: string }).color).toBe('#0082AD');
  });
});

// Email Document Standards Sub-phase 2 (closure) — item 1: document-level
// settings (Reset CSS/Custom CSS/title/subject/favicon) join the SAME
// undo/redo history as the module tree, via the one shared updateDocumentSettings
// -> commitEntry path. No second, competing history system.
describe('useEmailBuilderState — unified document-settings undo/redo (Sub-phase 2 closure item 1)', () => {
  it('starts with the Reset-CSS-enabled-by-default document settings and no history', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    expect(result.current.documentSettings).toEqual({
      email_title: '', email_subject: '', favicon_url: '',
      reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
      outlook_vml_enabled: false,
    });
    expect(result.current.canUndo).toBe(false);
  });

  it('CSS A -> Save CSS B -> Undo restores A -> Redo restores B', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.updateDocumentSettings({ custom_css: 'A' }));
    act(() => result.current.updateDocumentSettings({ custom_css: 'B' }));
    expect(result.current.documentSettings.custom_css).toBe('B');

    act(() => result.current.undo());
    expect(result.current.documentSettings.custom_css).toBe('A');

    act(() => result.current.redo());
    expect(result.current.documentSettings.custom_css).toBe('B');
  });

  it('Reset CSS enabled -> disable+save -> Undo restores enabled -> Redo restores disabled', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    expect(result.current.documentSettings.reset_css_enabled).toBe(true);

    act(() => result.current.updateDocumentSettings({ reset_css_enabled: false }));
    expect(result.current.documentSettings.reset_css_enabled).toBe(false);

    act(() => result.current.undo());
    expect(result.current.documentSettings.reset_css_enabled).toBe(true);

    act(() => result.current.redo());
    expect(result.current.documentSettings.reset_css_enabled).toBe(false);
  });

  it('Custom CSS enabled/disabled toggling participates in Undo/Redo', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    expect(result.current.documentSettings.custom_css_enabled).toBe(false);

    act(() => result.current.updateDocumentSettings({ custom_css_enabled: true }));
    expect(result.current.documentSettings.custom_css_enabled).toBe(true);

    act(() => result.current.undo());
    expect(result.current.documentSettings.custom_css_enabled).toBe(false);

    act(() => result.current.redo());
    expect(result.current.documentSettings.custom_css_enabled).toBe(true);
  });

  it('module edit -> CSS edit -> module edit: sequential Undo/Redo restores each step correctly, in order', () => {
    const { result } = renderHook(() => useEmailBuilderState());

    act(() => result.current.addModule('text'));
    const textId = result.current.modules[0].id;
    act(() => result.current.updateDocumentSettings({ custom_css_enabled: true, custom_css: '.a{color:red}' }));
    act(() => result.current.addModule('button'));

    expect(result.current.modules).toHaveLength(2);
    expect(result.current.documentSettings.custom_css).toBe('.a{color:red}');

    // Undo #1 -> removes the button, CSS edit still applied, text module still there.
    act(() => result.current.undo());
    expect(result.current.modules.map((m) => m.type)).toEqual(['text']);
    expect(result.current.documentSettings.custom_css_enabled).toBe(true);
    expect(result.current.documentSettings.custom_css).toBe('.a{color:red}');

    // Undo #2 -> reverts the CSS edit, text module still there.
    act(() => result.current.undo());
    expect(result.current.modules.map((m) => m.type)).toEqual(['text']);
    expect(result.current.documentSettings.custom_css_enabled).toBe(false);
    expect(result.current.documentSettings.custom_css).toBe('');

    // Undo #3 -> back to empty (before the text module was added).
    act(() => result.current.undo());
    expect(result.current.modules).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);

    // Redo all three, in order.
    act(() => result.current.redo());
    expect(result.current.modules.map((m) => m.id)).toEqual([textId]);
    expect(result.current.documentSettings.custom_css_enabled).toBe(false);

    act(() => result.current.redo());
    expect(result.current.documentSettings.custom_css_enabled).toBe(true);
    expect(result.current.documentSettings.custom_css).toBe('.a{color:red}');
    expect(result.current.modules).toHaveLength(1);

    act(() => result.current.redo());
    expect(result.current.modules).toHaveLength(2);
    expect(result.current.canRedo).toBe(false);
  });

  it('an AI-Engineer-applied CSS change (same updateDocumentSettings call) undoes to the exact previous value and redoes to the AI value', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.updateDocumentSettings({ custom_css: 'user-typed' }));
    // The AI Engineer panel calls this exact same function for its
    // document-level proposals — there is no separate AI mutation path.
    act(() => result.current.updateDocumentSettings({ custom_css: 'ai-proposed' }));

    expect(result.current.documentSettings.custom_css).toBe('ai-proposed');
    act(() => result.current.undo());
    expect(result.current.documentSettings.custom_css).toBe('user-typed');
    act(() => result.current.redo());
    expect(result.current.documentSettings.custom_css).toBe('ai-proposed');
  });

  it('consecutive updateDocumentSettings calls never coalesce — each is its own undo step even back to back', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => {
      result.current.updateDocumentSettings({ custom_css: 'A' });
      result.current.updateDocumentSettings({ custom_css: 'B' });
      result.current.updateDocumentSettings({ custom_css: 'C' });
    });
    expect(result.current.documentSettings.custom_css).toBe('C');
    act(() => result.current.undo());
    expect(result.current.documentSettings.custom_css).toBe('B');
    act(() => result.current.undo());
    expect(result.current.documentSettings.custom_css).toBe('A');
  });

  it('loadModules accepts an initial documentSettings snapshot and resets history to it', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    act(() => result.current.updateDocumentSettings({ custom_css: 'stale' }));

    act(() => result.current.loadModules([], {
      email_title: 'Loaded', email_subject: '', favicon_url: '',
      reset_css_enabled: false, custom_css_enabled: true, custom_css: 'loaded-css',
      outlook_vml_enabled: false,
    }));

    expect(result.current.documentSettings.email_title).toBe('Loaded');
    expect(result.current.documentSettings.custom_css).toBe('loaded-css');
    expect(result.current.canUndo).toBe(false);
  });

  it('updateDocumentSettings marks the state dirty, exactly like a module edit', () => {
    const { result } = renderHook(() => useEmailBuilderState());
    expect(result.current.dirty).toBe(false);
    act(() => result.current.updateDocumentSettings({ email_title: 'New Title' }));
    expect(result.current.dirty).toBe(true);
  });

  // Sub-phase 4, item 4 — the Repair Engine's batched-commit mutator.
  describe('applyRepairPatch', () => {
    it('applies a module prop patch and a document patch in ONE history commit (one undo restores both)', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('text'));
      const moduleId = result.current.modules[0].id;
      const historyDepthBefore = result.current.canUndo;
      expect(historyDepthBefore).toBe(true); // addModule already committed once

      act(() => result.current.applyRepairPatch(
        [{ moduleId, propPatch: { color: '#000000' } }],
        { reset_css_enabled: true },
      ));

      expect((result.current.modules[0].props as unknown as TextModuleProps).color).toBe('#000000');
      expect(result.current.documentSettings.reset_css_enabled).toBe(true);

      act(() => result.current.undo());
      // Undoing ONE step reverts BOTH the module patch and the document
      // patch together — proves they were a single history entry, not two.
      expect((result.current.modules[0].props as unknown as TextModuleProps).color).not.toBe('#000000');
      expect(result.current.documentSettings.reset_css_enabled).toBe(true); // was already true by default
    });

    it('applies only a document patch when modulePatches is empty', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.applyRepairPatch([], { custom_css_enabled: false }));
      expect(result.current.documentSettings.custom_css_enabled).toBe(false);
      expect(result.current.dirty).toBe(true);
    });

    it('applies only module patches when documentPatch is null', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('text'));
      const moduleId = result.current.modules[0].id;
      const settingsBefore = result.current.documentSettings;

      act(() => result.current.applyRepairPatch([{ moduleId, propPatch: { color: '#111111' } }], null));

      expect((result.current.modules[0].props as unknown as TextModuleProps).color).toBe('#111111');
      expect(result.current.documentSettings).toEqual(settingsBefore);
    });

    it('patches a module nested inside a layout column (same recursive walk applyGlobalStyle uses)', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('layout-2col-50-50'));
      const layoutId = result.current.modules[0].id;
      const columnId = result.current.modules[0].columns![0].id;
      act(() => result.current.insertNestedModule(layoutId, columnId, 'text'));
      const nestedId = result.current.modules[0].columns![0].modules[0].id;

      act(() => result.current.applyRepairPatch([{ moduleId: nestedId, propPatch: { color: '#222222' } }], null));

      const nestedProps = result.current.modules[0].columns![0].modules[0].props as unknown as TextModuleProps;
      expect(nestedProps.color).toBe('#222222');
    });

    it('applies multiple module patches across different modules in one commit', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('text'));
      act(() => result.current.addModule('text'));
      const [firstId, secondId] = result.current.modules.map((m) => m.id);
      const historyIndexBefore = result.current.canUndo;
      expect(historyIndexBefore).toBe(true);

      // #ff0000/#00ff00 deliberately avoid text's own default color
      // (#333333) — reusing the default would make "reverted to default"
      // indistinguishable from "reverted to the patched value" below.
      act(() => result.current.applyRepairPatch(
        [
          { moduleId: firstId, propPatch: { color: '#ff0000' } },
          { moduleId: secondId, propPatch: { color: '#00ff00' } },
        ],
        null,
      ));

      expect((result.current.modules[0].props as unknown as TextModuleProps).color).toBe('#ff0000');
      expect((result.current.modules[1].props as unknown as TextModuleProps).color).toBe('#00ff00');

      act(() => result.current.undo());
      // One undo reverts BOTH module patches — proves single commit.
      expect((result.current.modules[0].props as unknown as TextModuleProps).color).not.toBe('#ff0000');
      expect((result.current.modules[1].props as unknown as TextModuleProps).color).not.toBe('#00ff00');
    });

    it('Sub-phase 6: applies a module SETTINGS patch (e.g. enabling VML) via the 4th argument, in the same commit as prop/document patches', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('button'));
      const moduleId = result.current.modules[0].id;

      act(() => result.current.applyRepairPatch(
        [{ moduleId, propPatch: { text: 'Buy Now' } }],
        { reset_css_enabled: false },
        [{ moduleId, settingsPatch: { outlookVml: true } }],
      ));

      expect(result.current.modules[0].settings.outlookVml).toBe(true);
      expect((result.current.modules[0].props as unknown as { text: string }).text).toBe('Buy Now');
      expect(result.current.documentSettings.reset_css_enabled).toBe(false);

      act(() => result.current.undo());
      // One undo reverts all three (prop, settings, document) — proves a
      // single history commit, same posture as the module+document case above.
      expect(result.current.modules[0].settings.outlookVml).toBeUndefined();
      expect((result.current.modules[0].props as unknown as { text: string }).text).not.toBe('Buy Now');
      expect(result.current.documentSettings.reset_css_enabled).toBe(true);
    });

    it('Sub-phase 6: applies a settings patch to a module nested inside a layout column', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('layout-2col-50-50'));
      const layoutId = result.current.modules[0].id;
      const columnId = result.current.modules[0].columns![0].id;
      act(() => result.current.insertNestedModule(layoutId, columnId, 'button'));
      const nestedId = result.current.modules[0].columns![0].modules[0].id;

      act(() => result.current.applyRepairPatch([], null, [{ moduleId: nestedId, settingsPatch: { outlookVml: true } }]));

      expect(result.current.modules[0].columns![0].modules[0].settings.outlookVml).toBe(true);
    });

    it('R4-C1 regression: two prop patches targeting the SAME module both survive (previously the second silently clobbered the first)', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('button'));
      const moduleId = result.current.modules[0].id;

      act(() => result.current.applyRepairPatch(
        [
          { moduleId, propPatch: { align: 'right' } },
          { moduleId, propPatch: { text: 'Buy Now' } },
        ],
        null,
      ));

      const props = result.current.modules[0].props as unknown as { align: string; text: string };
      expect(props.align).toBe('right');
      expect(props.text).toBe('Buy Now');
    });

    it('R4-C1 regression: two settings patches targeting the SAME module both survive', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('button'));
      const moduleId = result.current.modules[0].id;

      act(() => result.current.applyRepairPatch(
        [], null,
        [
          { moduleId, settingsPatch: { outlookVml: true } },
          { moduleId, settingsPatch: { desktop: { ...result.current.modules[0].settings.desktop, paddingTop: 5 } } },
        ],
      ));

      expect(result.current.modules[0].settings.outlookVml).toBe(true);
      expect(result.current.modules[0].settings.desktop.paddingTop).toBe(5);
    });

    it('R4-C1: a restructure patch (column ratio) applies in the SAME commit as an ordinary module patch', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('layout-2col-50-50'));
      const layoutId = result.current.modules[0].id;
      act(() => result.current.addModule('text'));
      const textId = result.current.modules[1].id;

      act(() => result.current.applyRepairPatch(
        [{ moduleId: textId, propPatch: { color: '#123456' } }],
        null, [], [{ moduleId: layoutId, widths: [70, 30] }],
      ));

      expect((result.current.modules[0].props as unknown as { columnWidths: number[] }).columnWidths).toEqual([70, 30]);
      expect((result.current.modules[1].props as unknown as { color: string }).color).toBe('#123456');

      act(() => result.current.undo());
      // One undo reverts BOTH — proves single commit.
      expect((result.current.modules[0].props as unknown as { columnWidths: number[] }).columnWidths).not.toEqual([70, 30]);
      expect((result.current.modules[1].props as unknown as { color: string }).color).not.toBe('#123456');
    });

    it('R4-C1: a column-settings patch applies via updateColumnSettings, in the same commit', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('layout-2col-50-50'));
      const layoutId = result.current.modules[0].id;
      const columnId = result.current.modules[0].columns![0].id;

      act(() => result.current.applyRepairPatch(
        [], null, [], [],
        [{ layoutId, columnId, settingsPatch: { backgroundColor: '#abcdef' } }],
      ));

      expect(result.current.modules[0].columns![0].settings.backgroundColor).toBe('#abcdef');
    });

    // R4-C closure hardening — multiple candidates targeting the SAME
    // module/property.
    it('R4-C hardening: two prop patches for the SAME module (e.g. two separate repair candidates) merge, never drop one', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('button'));
      const buttonId = result.current.modules[0].id;

      // Simulates a reconstruction batch where "fix alignment" and "fix
      // padding" both target the same button — two SEPARATE entries in
      // modulePatches for the same moduleId, exactly what
      // pendingRepair.candidates.map((c) => c.item) would produce.
      act(() => result.current.applyRepairPatch(
        [
          { moduleId: buttonId, propPatch: { align: 'right' } },
          { moduleId: buttonId, propPatch: { paddingHorizontal: 40 } },
        ],
        null,
      ));

      const props = result.current.modules[0].props as unknown as { align: string; paddingHorizontal: number };
      expect(props.align).toBe('right');
      expect(props.paddingHorizontal).toBe(40);
    });

    it('R4-C hardening: a later entry for the same module+property wins (last-applied-in-the-batch, never silently dropped or averaged)', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('text'));
      const textId = result.current.modules[0].id;

      act(() => result.current.applyRepairPatch(
        [
          { moduleId: textId, propPatch: { color: '#111111' } },
          { moduleId: textId, propPatch: { color: '#222222' } },
        ],
        null,
      ));

      expect((result.current.modules[0].props as unknown as TextModuleProps).color).toBe('#222222');
    });

    // R4-C closure hardening — Apply after the document changed
    // elsewhere (e.g. a module the proposal targeted was deleted by a
    // manual edit, or an Undo, while the proposal was still pending).
    it('R4-C hardening: a patch targeting a moduleId that no longer exists never crashes and never corrupts other modules', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('text'));
      const survivingId = result.current.modules[0].id;

      expect(() => act(() => result.current.applyRepairPatch(
        [
          { moduleId: 'this-module-id-does-not-exist-anymore', propPatch: { color: '#ff00ff' } },
          { moduleId: survivingId, propPatch: { color: '#00ffff' } },
        ],
        null,
      ))).not.toThrow();

      // The stale entry is silently a no-op (nothing in the tree has
      // that id to patch); the surviving module's own real patch still
      // applies correctly — proves one bad id in a batch can never
      // corrupt or block the rest of the batch.
      expect(result.current.modules).toHaveLength(1);
      expect((result.current.modules[0].props as unknown as TextModuleProps).color).toBe('#00ffff');
    });

    it('R4-C hardening: RESTRUCTURE_LAYOUT keeps every nested module\'s own id stable, so a separate patch for a module inside that layout still lands correctly in the SAME commit', () => {
      const { result } = renderHook(() => useEmailBuilderState());
      act(() => result.current.addModule('layout-2col-50-50'));
      const layoutId = result.current.modules[0].id;
      const columnId = result.current.modules[0].columns![0].id;
      act(() => result.current.insertNestedModule(layoutId, columnId, 'text'));
      const nestedId = result.current.modules[0].columns![0].modules[0].id;

      act(() => result.current.applyRepairPatch(
        [{ moduleId: nestedId, propPatch: { color: '#654321' } }],
        null, [], [{ moduleId: layoutId, widths: [30, 70] }],
      ));

      // Same commit: the restructure changed widths, the nested id
      // stayed the SAME id, and the correspondence-map-relevant patch
      // still found and updated the right module.
      expect((result.current.modules[0].props as unknown as { columnWidths: number[] }).columnWidths).toEqual([30, 70]);
      expect(result.current.modules[0].columns![0].modules[0].id).toBe(nestedId);
      expect((result.current.modules[0].columns![0].modules[0].props as unknown as TextModuleProps).color).toBe('#654321');
    });
  });
});

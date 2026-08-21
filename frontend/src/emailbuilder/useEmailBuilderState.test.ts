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

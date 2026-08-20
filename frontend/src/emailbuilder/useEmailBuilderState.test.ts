import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEmailBuilderState } from './useEmailBuilderState';
import type { TextModuleProps } from './edm';

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

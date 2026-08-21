import { describe, expect, it } from 'vitest';
import {
  balanceColumnWidths, cloneColumnsWithNewIds, createColumn, createEmptyColumns, duplicateNestedModule,
  findModuleById, findModulePath, insertNestedModule, isLayoutModuleType, moveModuleBetweenColumns,
  removeNestedModule, reorderNestedModule, updateColumnSettings, updateColumnWidths, updateNestedModuleProps,
  validateColumnWidths,
} from './layoutModel';
import { createResponsiveSettings } from './registryCore';
import type { EmailModule } from './edm';

function textModule(id: string, order = 0): EmailModule {
  return { id, type: 'text', order, props: { text: id }, settings: createResponsiveSettings() };
}

function layoutWith(columnsModules: EmailModule[][]): EmailModule {
  return {
    id: 'layout-1',
    type: columnsModules.length === 2 ? 'layout-2col-50-50' : 'layout-3col',
    order: 0,
    props: { columnWidths: columnsModules.length === 2 ? [50, 50] : [33, 33, 34] },
    settings: createResponsiveSettings(),
    columns: columnsModules.map((modules, index) => ({
      id: `col-${index}`, modules, settings: {
        desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
        mobile: {}, backgroundColor: '', verticalAlign: 'top',
      },
    })),
  };
}

describe('layoutModel — column width balancing/validation', () => {
  it('balances 2/3/4/6 columns matching the brief\'s examples', () => {
    expect(balanceColumnWidths(2)).toEqual([50, 50]);
    expect(balanceColumnWidths(3)).toEqual([33.33, 33.33, 33.34]);
    expect(balanceColumnWidths(4)).toEqual([25, 25, 25, 25]);
    expect(balanceColumnWidths(6).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it('validates a valid width set', () => {
    const result = validateColumnWidths([40, 60]);
    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
    expect(result.belowMinimum).toEqual([]);
  });

  it('flags a total that does not equal 100', () => {
    const result = validateColumnWidths([50, 40]);
    expect(result.valid).toBe(false);
    expect(result.totalError).toBe(true);
  });

  it('flags a column below the minimum usable width', () => {
    const result = validateColumnWidths([5, 95]);
    expect(result.valid).toBe(false);
    expect(result.belowMinimum).toEqual([0]);
  });

  it('isLayoutModuleType recognizes every layout type and rejects others', () => {
    expect(isLayoutModuleType('layout-3col')).toBe(true);
    expect(isLayoutModuleType('text')).toBe(false);
  });
});

describe('layoutModel — column creation and cloning', () => {
  it('createEmptyColumns produces one empty column per count, with fresh unique ids', () => {
    const columns = createEmptyColumns(3);
    expect(columns).toHaveLength(3);
    expect(columns.every((c) => c.modules.length === 0)).toBe(true);
    expect(new Set(columns.map((c) => c.id)).size).toBe(3);
  });

  it('cloneColumnsWithNewIds produces entirely fresh column and nested-module ids', () => {
    const original = [createColumn(), createColumn()];
    original[0].modules.push(textModule('nested-a'));
    const clone = cloneColumnsWithNewIds(original, (module, order) => ({ ...module, id: `${module.id}-clone`, order }));

    expect(clone[0].id).not.toBe(original[0].id);
    expect(clone[1].id).not.toBe(original[1].id);
    expect(clone[0].modules[0].id).toBe('nested-a-clone');
    // Original untouched (immutable clone).
    expect(original[0].modules[0].id).toBe('nested-a');
  });
});

describe('layoutModel — nested tree operations', () => {
  it('insertNestedModule adds a module into the target column only', () => {
    const modules = [layoutWith([[], []])];
    const next = insertNestedModule(modules, 'layout-1', 'col-0', textModule('t1'));
    expect(next[0].columns?.[0].modules).toHaveLength(1);
    expect(next[0].columns?.[1].modules).toHaveLength(0);
    // Immutability — original untouched.
    expect(modules[0].columns?.[0].modules).toHaveLength(0);
  });

  it('insertNestedModule at a specific index inserts in place and reindexes order', () => {
    const modules = [layoutWith([[textModule('a', 0), textModule('b', 1)], []])];
    const next = insertNestedModule(modules, 'layout-1', 'col-0', textModule('mid'), 1);
    const ids = next[0].columns?.[0].modules.map((m) => m.id);
    expect(ids).toEqual(['a', 'mid', 'b']);
    expect(next[0].columns?.[0].modules.map((m) => m.order)).toEqual([0, 1, 2]);
  });

  it('removeNestedModule removes only the targeted module and reindexes remaining ones', () => {
    const modules = [layoutWith([[textModule('a', 0), textModule('b', 1), textModule('c', 2)], []])];
    const next = removeNestedModule(modules, 'layout-1', 'col-0', 'b');
    const remaining = next[0].columns?.[0].modules;
    expect(remaining?.map((m) => m.id)).toEqual(['a', 'c']);
    expect(remaining?.map((m) => m.order)).toEqual([0, 1]);
  });

  it('reorderNestedModule moves a module within the same column', () => {
    const modules = [layoutWith([[textModule('a', 0), textModule('b', 1), textModule('c', 2)], []])];
    const next = reorderNestedModule(modules, 'layout-1', 'col-0', 0, 2);
    expect(next[0].columns?.[0].modules.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('updateNestedModuleProps patches only the targeted nested module', () => {
    const modules = [layoutWith([[textModule('a')], []])];
    const next = updateNestedModuleProps(modules, 'layout-1', 'col-0', 'a', { text: 'changed' });
    expect((next[0].columns![0].modules[0].props as { text: string }).text).toBe('changed');
  });

  it('duplicateNestedModule clones with a fresh id, placed right after the original', () => {
    const modules = [layoutWith([[textModule('a', 0)], []])];
    const { modules: next, newId } = duplicateNestedModule(
      modules, 'layout-1', 'col-0', 'a', (module, order) => ({ ...module, id: `${module.id}-copy`, order }),
    );
    expect(newId).toBe('a-copy');
    expect(next[0].columns?.[0].modules.map((m) => m.id)).toEqual(['a', 'a-copy']);
  });

  it('moveModuleBetweenColumns preserves the module id and removes it from the source column', () => {
    const modules = [layoutWith([[textModule('a', 0)], []])];
    const next = moveModuleBetweenColumns(modules, 'layout-1', 'col-0', 'a', 'layout-1', 'col-1');
    expect(next[0].columns?.[0].modules).toHaveLength(0);
    expect(next[0].columns?.[1].modules.map((m) => m.id)).toEqual(['a']);
  });

  it('moveModuleBetweenColumns is a no-op when the source module cannot be found', () => {
    const modules = [layoutWith([[], []])];
    const next = moveModuleBetweenColumns(modules, 'layout-1', 'col-0', 'missing', 'layout-1', 'col-1');
    expect(next).toEqual(modules);
  });

  it('updateColumnWidths only touches the layout\'s own props.columnWidths', () => {
    const modules = [layoutWith([[], []])];
    const next = updateColumnWidths(modules, 'layout-1', [35, 65]);
    expect((next[0].props as { columnWidths: number[] }).columnWidths).toEqual([35, 65]);
  });

  it('updateColumnSettings patches only the targeted column\'s settings', () => {
    const modules = [layoutWith([[], []])];
    const next = updateColumnSettings(modules, 'layout-1', 'col-0', { backgroundColor: '#ff0000' });
    expect(next[0].columns?.[0].settings.backgroundColor).toBe('#ff0000');
    expect(next[0].columns?.[1].settings.backgroundColor).toBe('');
  });
});

describe('layoutModel — selection lookup', () => {
  it('findModulePath resolves a top-level module with no layout/column context', () => {
    const modules = [textModule('m1')];
    const path = findModulePath(modules, 'm1');
    expect(path?.module.id).toBe('m1');
    expect(path?.layout).toBeUndefined();
  });

  it('findModulePath resolves a nested module with its owning layout and column', () => {
    const modules = [layoutWith([[textModule('nested-1')], []])];
    const path = findModulePath(modules, 'nested-1');
    expect(path?.module.id).toBe('nested-1');
    expect(path?.layout?.id).toBe('layout-1');
    expect(path?.column?.id).toBe('col-0');
  });

  it('findModuleById works for both top-level and nested ids', () => {
    const modules = [textModule('top-1'), layoutWith([[textModule('nested-1')], []])];
    expect(findModuleById(modules, 'top-1')?.id).toBe('top-1');
    expect(findModuleById(modules, 'nested-1')?.id).toBe('nested-1');
    expect(findModuleById(modules, 'missing')).toBeNull();
  });
});

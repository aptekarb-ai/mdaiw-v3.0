import { describe, expect, it } from 'vitest';
import { buildComposedModule, createModule } from './moduleFactory';
import type { ComposedModuleEntry } from './moduleFactory';

// Phase D (AI Generate Email) — buildComposedModule was extracted from
// useEmailBuilderState.ts's former private closure into this plain, pure
// function so it's callable without a mounted builder instance. These
// tests exercise it directly; useEmailBuilderState.test.ts's existing
// addComposedModules tests continue to prove the in-builder call site is
// unaffected (same function, imported instead of locally defined).
describe('buildComposedModule', () => {
  it('builds a module from registry defaults when the patch is empty', () => {
    const entry: ComposedModuleEntry = { type: 'text', patch: {} };
    const built = buildComposedModule(entry, 0);
    const fresh = createModule('text', 0);
    expect(built.props).toEqual(fresh.props);
    expect(built.type).toBe('text');
    expect(built.order).toBe(0);
  });

  it('merges the patch onto the registry defaults', () => {
    const entry: ComposedModuleEntry = { type: 'text', patch: { text: 'Hello from AI' } };
    const built = buildComposedModule(entry, 2);
    expect((built.props as { text: string }).text).toBe('Hello from AI');
    expect(built.order).toBe(2);
  });

  it('assigns a fresh id on every call, even for identical entries', () => {
    const entry: ComposedModuleEntry = { type: 'text', patch: {} };
    const a = buildComposedModule(entry, 0);
    const b = buildComposedModule(entry, 0);
    expect(a.id).not.toBe(b.id);
  });

  it('builds nested column children for a layout module type', () => {
    const entry: ComposedModuleEntry = {
      type: 'layout-2col-50-50',
      patch: {},
      children: [
        { columnIndex: 0, modules: [{ type: 'text', patch: { text: 'Left' } }] },
        { columnIndex: 1, modules: [{ type: 'image', patch: {} }] },
      ],
    };
    const built = buildComposedModule(entry, 0);
    expect(built.columns).toHaveLength(2);
    expect(built.columns![0].modules[0].type).toBe('text');
    expect((built.columns![0].modules[0].props as { text: string }).text).toBe('Left');
    expect(built.columns![1].modules[0].type).toBe('image');
  });

  it('ignores children for a non-layout module type (no columns to seed)', () => {
    const entry: ComposedModuleEntry = {
      type: 'text', patch: {},
      children: [{ columnIndex: 0, modules: [{ type: 'text', patch: {} }] }],
    };
    const built = buildComposedModule(entry, 0);
    expect(built.columns).toBeUndefined();
  });

  it('seeds repeatableItems on a module type that has a repeatable field', () => {
    const entry: ComposedModuleEntry = {
      type: 'social-icon-row', patch: {},
      repeatableItems: [{ platform: 'twitter', href: 'https://x.com/example' }],
    };
    const built = buildComposedModule(entry, 0);
    // The exact prop key/shape is registry-defined; just confirm the
    // props changed from the bare default (some repeatable-field path was
    // populated) rather than asserting an internal registry key name.
    const fresh = createModule('social-icon-row', 0);
    expect(built.props).not.toEqual(fresh.props);
  });

  it('silently ignores repeatableItems on a module type with no repeatable field', () => {
    const entry: ComposedModuleEntry = { type: 'text', patch: {}, repeatableItems: [{ x: 1 }] };
    const built = buildComposedModule(entry, 0);
    const fresh = createModule('text', 0);
    expect(built.props).toEqual(fresh.props);
  });
});

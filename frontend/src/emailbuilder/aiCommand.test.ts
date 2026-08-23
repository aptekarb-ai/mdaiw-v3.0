import { describe, expect, it } from 'vitest';
import { describeAction } from './aiCommand';

// Feature 14 V3 Sub-phase 6 -- describeAction() coverage for the six
// previously-reserved action types plus UPDATE_REPEATABLE_FIELD. Each
// human-readable description is what AIEngineerPanel shows on the
// proposal card, so it must name the real module type/field, never a
// generic placeholder.
describe('describeAction — Sub-phase 6 action types', () => {
  it('UPDATE_MODULE_SETTINGS names the module type and the changed keys', () => {
    const description = describeAction({
      type: 'UPDATE_MODULE_SETTINGS', target: 'selected', module_type: 'button', patch: { outlookVml: true },
    });
    expect(description).toContain('button');
    expect(description).toContain('outlookVml');
  });

  it('APPLY_VML_PATTERN names the button module', () => {
    const description = describeAction({ type: 'APPLY_VML_PATTERN', target: 'selected', module_type: 'button' });
    expect(description).toContain('button');
    expect(description).toContain('VML');
  });

  it('APPLY_OUTLOOK_WRAPPER names the background-capable module', () => {
    const description = describeAction({
      type: 'APPLY_OUTLOOK_WRAPPER', target: 'selected', module_type: 'hero-background-image',
    });
    expect(description).toContain('hero-background-image');
    expect(description).toContain('VML');
  });

  it('RESTRUCTURE_LAYOUT lists the proposed widths', () => {
    const description = describeAction({
      type: 'RESTRUCTURE_LAYOUT', target: 'selected', module_type: 'layout-2col-50-50', widths: [70, 30],
    });
    expect(description).toContain('70%');
    expect(description).toContain('30%');
  });

  it('INSERT_NESTED_MODULE names the module type being inserted', () => {
    const description = describeAction({
      type: 'INSERT_NESTED_MODULE', target: 'selected_column', module_type: 'text', patch: {},
    });
    expect(description).toContain('text');
    expect(description).toContain('column');
  });

  it('REPLACE_UNSUPPORTED_PROPERTY names the module type and patched keys', () => {
    const description = describeAction({
      type: 'REPLACE_UNSUPPORTED_PROPERTY', target: 'selected', module_type: 'button', patch: { widthMode: 'fixed' },
    });
    expect(description).toContain('button');
    expect(description).toContain('widthMode');
  });

  it('UPDATE_REPEATABLE_FIELD describes each op distinctly', () => {
    const add = describeAction({
      type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'add',
      item: { label: 'x', href: 'https://example.com' },
    });
    expect(add).toContain('Add');

    const update = describeAction({
      type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'update', index: 1,
      item: { label: 'y' },
    });
    expect(update).toContain('Update item 2');

    const remove = describeAction({
      type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'remove', index: 0,
    });
    expect(remove).toContain('Remove item 1');

    const reorder = describeAction({
      type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'reorder',
      fromIndex: 0, toIndex: 2,
    });
    expect(reorder).toContain('Reorder');
  });
});

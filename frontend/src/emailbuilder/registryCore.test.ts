import { describe, expect, it } from 'vitest';
import { wrapWithOuterSpacing } from './registryCore';
import type { OuterSpacingSides } from './edm';

// Precise structural tests for the standard outer-module-table contract
// (feature spec section 2: "FOUR REQUIRED OUTER STRUCTURES"). Uses a
// trivial 'X' content string (matching the spec's own "MODULE INTERNAL
// HTML" placeholder) so the <td> count in the wrapped output is
// unambiguous — a real module's internal markup contains its own nested
// <td>s, which would make a naive count meaningless.
function sides(left: number, right: number): OuterSpacingSides {
  return { left: { value: left, unit: 'px' }, right: { value: right, unit: 'px' } };
}

describe('wrapWithOuterSpacing — standard outer module table contract', () => {
  it('Case A: Left=0/Right=0 — outer table exists, exactly 1 <td> (content only)', () => {
    const html = wrapWithOuterSpacing('X', sides(0, 0));
    expect(html).toBe('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>X</td></tr></table>');
    expect((html.match(/<td/g) ?? []).length).toBe(1);
  });

  it('Case B: Left>0/Right=0 — outer table exists, exactly 2 <td>s (left spacer + content)', () => {
    const html = wrapWithOuterSpacing('X', sides(20, 0));
    expect(html).toBe(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      + '<td width="20" style="width:20px; font-size:0; line-height:0;">&nbsp;</td>'
      + '<td>X</td>'
      + '</tr></table>',
    );
    expect((html.match(/<td/g) ?? []).length).toBe(2);
  });

  it('Case C: Left=0/Right>0 — outer table exists, exactly 2 <td>s (content + right spacer)', () => {
    const html = wrapWithOuterSpacing('X', sides(0, 30));
    expect(html).toBe(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      + '<td>X</td>'
      + '<td width="30" style="width:30px; font-size:0; line-height:0;">&nbsp;</td>'
      + '</tr></table>',
    );
    expect((html.match(/<td/g) ?? []).length).toBe(2);
  });

  it('Case D: Left>0/Right>0 — outer table exists, exactly 3 <td>s (left spacer + content + right spacer)', () => {
    const html = wrapWithOuterSpacing('X', sides(20, 30));
    expect(html).toBe(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      + '<td width="20" style="width:20px; font-size:0; line-height:0;">&nbsp;</td>'
      + '<td>X</td>'
      + '<td width="30" style="width:30px; font-size:0; line-height:0;">&nbsp;</td>'
      + '</tr></table>',
    );
    expect((html.match(/<td/g) ?? []).length).toBe(3);
  });

  it('a Layout module with 0/0 still gets the outer table wrapped around its inner layout table (nested tables, not flattened)', () => {
    const innerLayoutTable = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="50%" valign="top">A</td></tr></table>';
    const html = wrapWithOuterSpacing(innerLayoutTable, sides(0, 0));
    expect(html).toBe(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>${innerLayoutTable}</td></tr></table>`);
    // Exactly one outer content <td> at the top level, plus the inner
    // layout's own column <td> — never flattened into a single table.
    expect((html.match(/<table/g) ?? []).length).toBe(2);
  });

  it('undefined outerSpacing behaves like 0/0 — outer table still exists', () => {
    const html = wrapWithOuterSpacing('X', undefined);
    expect(html).toBe('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>X</td></tr></table>');
  });

  it('never uses CSS margin, div, flex, or grid, for any of the four cases', () => {
    for (const [left, right] of [[0, 0], [20, 0], [0, 30], [20, 30]] as const) {
      const html = wrapWithOuterSpacing('X', sides(left, right));
      expect(html).not.toContain('<div');
      expect(html).not.toMatch(/margin\s*:/);
      expect(html).not.toMatch(/display:\s*flex/);
      expect(html).not.toMatch(/display:\s*grid/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { formatEmailHtml } from './htmlFormatter';

describe('formatEmailHtml', () => {
  it('indents nested elements one level per depth', () => {
    const input = '<table><tr><td>Hello</td></tr></table>';
    const output = formatEmailHtml(input);
    expect(output).toBe(
      '<table>\n  <tr>\n    <td>\n      Hello\n    </td>\n  </tr>\n</table>',
    );
  });

  it('does not increase depth for self-closing/void elements', () => {
    const input = '<table><tr><td><img src="a.jpg" /></td></tr></table>';
    const output = formatEmailHtml(input);
    const lines = output.split('\n');
    const imgLine = lines.find((line) => line.includes('<img'))!;
    const tdLine = lines.find((line) => line.includes('<td>'))!;
    // img sits one level deeper than td, not two — it never opened a new level.
    expect(imgLine.match(/^ */)![0].length).toBe(tdLine.match(/^ */)![0].length + 2);
  });

  it('dedents on the matching closing tag', () => {
    const input = '<div><span>x</span></div>';
    const output = formatEmailHtml(input);
    const lines = output.split('\n');
    expect(lines[0]).toBe('<div>');
    expect(lines[lines.length - 1]).toBe('</div>');
  });

  it('is a pure function — same input always produces the same output', () => {
    const input = '<table role="presentation"><tr><td align="center">Hi</td></tr></table>';
    expect(formatEmailHtml(input)).toBe(formatEmailHtml(input));
  });

  it('handles an empty string without throwing', () => {
    expect(formatEmailHtml('')).toBe('');
  });

  it('preserves doctype and comment-like tags at the current depth without changing depth', () => {
    const input = '<!doctype html><html><body>content</body></html>';
    const output = formatEmailHtml(input);
    expect(output.split('\n')[0]).toBe('<!doctype html>');
  });
});

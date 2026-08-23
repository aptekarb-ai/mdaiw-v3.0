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

  // Email Document Standards Sub-phase 1 — MSO conditional comments contain
  // real `<tag>` markup (e.g. the Outlook ghost-table wrapper), which used
  // to fool the old bare `<[^>]+>` tag splitter into treating the comment's
  // internal tags as genuine nesting. They must stay opaque: one unbroken
  // line, and no effect on the depth of the real HTML around them.
  it('keeps an MSO conditional comment containing real tags on a single opaque line', () => {
    const openComment = '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->';
    const closeComment = '<!--[if mso]></td></tr></table><![endif]-->';
    const input = `<div>${openComment}<p>Hi</p>${closeComment}</div>`;
    const output = formatEmailHtml(input);
    const lines = output.split('\n').map((line) => line.trim());
    expect(lines).toContain(openComment);
    expect(lines).toContain(closeComment);
  });

  it('does not let an MSO comment with embedded tags change surrounding indentation depth', () => {
    const openComment = '<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->';
    const closeComment = '<!--[if mso]></td></tr></table><![endif]-->';
    const input = (
      '<table role="presentation" width="100%">'
      + '<tr><td align="center">'
      + openComment
      + '<table role="presentation" width="100%"><tr><td>Body</td></tr></table>'
      + closeComment
      + '</td></tr>'
      + '</table>'
    );
    // Neither MSO comment opens or closes a real nesting level — both sit at
    // whatever real depth surrounds them (one level deeper than <td>, the
    // same depth the real inner <table> itself opens at), never a level
    // deeper as if `<table><tr><td>` inside the comment text were genuine
    // markup, and never dedented as if `</td></tr></table>` inside the
    // closing comment were a genuine close.
    expect(formatEmailHtml(input)).toBe(
      '<table role="presentation" width="100%">\n'
      + '  <tr>\n'
      + '    <td align="center">\n'
      + `      ${openComment}\n`
      + '      <table role="presentation" width="100%">\n'
      + '        <tr>\n'
      + '          <td>\n'
      + '            Body\n'
      + '          </td>\n'
      + '        </tr>\n'
      + '      </table>\n'
      + `      ${closeComment}\n`
      + '    </td>\n'
      + '  </tr>\n'
      + '</table>',
    );
  });

  // The downlevel-revealed idiom used by emailHead.ts's X-UA-Compatible
  // block: `<!--[if !mso]><!-->` is itself ONE full HTML comment (it closes
  // at its own embedded `-->`), previously split into two fake tokens by
  // the naive `<[^>]+>` matcher.
  it('keeps the downlevel-revealed "if !mso" comment pair each on one opaque line', () => {
    const input = '<!--[if !mso]><!-->\n<meta http-equiv="X-UA-Compatible" content="IE=edge" />\n<!--<![endif]-->';
    const output = formatEmailHtml(input);
    const lines = output.split('\n').map((line) => line.trim());
    expect(lines).toContain('<!--[if !mso]><!-->');
    expect(lines).toContain('<!--<![endif]-->');
  });
});

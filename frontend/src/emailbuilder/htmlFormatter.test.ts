import { describe, expect, it } from 'vitest';
import { formatEmailHtml } from './htmlFormatter';
import { renderEmailDocument } from './htmlRenderer';
import { renderResetCssBlock, renderCustomCssBlock } from './emailCss';
import { createModule } from './moduleFactory';
import { getModuleDefinition } from './moduleRegistry';

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

  // Email Document Standards Sub-phase 2 — Reset/Custom CSS <style>
  // blocks must survive formatting unchanged: not duplicated, not moved
  // outside <head>, not reinterpreted as HTML (a CSS attribute selector
  // like `a[href^="mailto:"]` looks tag-like but must never be tag-split).
  it('does not duplicate the Reset CSS <style> block', () => {
    const html = renderEmailDocument({
      width: 700, content: { version: 1, modules: [] }, resetCssEnabled: true,
    });
    const output = formatEmailHtml(html);
    expect((output.match(/EMAIL RESET CSS - START/g) ?? []).length).toBe(1);
    expect((output.match(/<style/g) ?? []).length).toBe(1);
  });

  it('keeps both the Reset CSS and Custom CSS <style> blocks inside <head>, not moved elsewhere', () => {
    const html = renderEmailDocument({
      width: 700, content: { version: 1, modules: [] },
      resetCssEnabled: true, customCssEnabled: true, customCss: '.brand{color:#002D38}',
    });
    const output = formatEmailHtml(html);
    const headStart = output.indexOf('<head>');
    const headEnd = output.indexOf('</head>');
    const resetIndex = output.indexOf('EMAIL RESET CSS - START');
    const customIndex = output.indexOf('CUSTOM CSS - START');
    expect(resetIndex).toBeGreaterThan(headStart);
    expect(resetIndex).toBeLessThan(headEnd);
    expect(customIndex).toBeGreaterThan(headStart);
    expect(customIndex).toBeLessThan(headEnd);
    expect((output.match(/<\/head>/g) ?? []).length).toBe(1);
  });

  it('does not reinterpret a CSS attribute selector inside Custom CSS as an HTML tag', () => {
    const html = renderEmailDocument({
      width: 700, content: { version: 1, modules: [] },
      customCssEnabled: true, customCss: 'a[href^="mailto:"] { color: #0082AD; }',
    });
    const output = formatEmailHtml(html);
    expect(output).toContain('a[href^="mailto:"] { color: #0082AD; }');
  });

  it('Raw -> Formatted -> Raw is lossless for a document with both CSS blocks (Code Editor contract)', () => {
    const rawHtml = renderEmailDocument({
      width: 700, content: { version: 1, modules: [] },
      resetCssEnabled: true, customCssEnabled: true, customCss: '.brand{color:#002D38}',
    });
    const formatted = formatEmailHtml(rawHtml);
    // Re-running the SAME pure function against the SAME rawHtml (exactly
    // what toggling Formatted -> Raw -> Formatted does in CodeEditorPanel,
    // which always recomputes from the untouched rawHtml, never from the
    // previously-formatted text) reproduces byte-identical output.
    expect(formatEmailHtml(rawHtml)).toBe(formatted);
    // And the underlying raw string itself is never mutated by formatting.
    expect(rawHtml).toContain(renderResetCssBlock().trim());
    expect(rawHtml).toContain(renderCustomCssBlock('.brand{color:#002D38}').trim());
  });
});

// Email Document Standards Sub-phase 3, item 11 — the formatter must
// treat MSO/VML/Office XML conditional-comment content as opaque, never
// re-indenting, corrupting, removing, or reinterpreting the nested XML
// as ordinary DOM structure.
describe('formatEmailHtml — MSO/VML/Office conditional comment round-trip (Sub-phase 3, item 11)', () => {
  it('preserves a real generated OfficeDocumentSettings block byte-for-byte (single opaque unit)', () => {
    const html = renderEmailDocument({ width: 700, content: { version: 1, modules: [] } });
    const formatted = formatEmailHtml(html);
    expect(formatted).toContain('<!--[if gte mso 9]>');
    expect(formatted).toContain('<o:OfficeDocumentSettings>');
    expect(formatted).toContain('<o:AllowPNG/>');
    expect(formatted).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    expect(formatted).toContain('</o:OfficeDocumentSettings>');
    expect(formatted).toContain('<![endif]-->');
    // Exactly one occurrence — not duplicated, not split into fragments.
    expect((formatted.match(/<o:OfficeDocumentSettings>/g) ?? []).length).toBe(1);
  });

  it('round-trips [if gte mso 9] without corrupting the nested <xml> tag', () => {
    const input = '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->';
    const output = formatEmailHtml(input);
    const lines = output.split('\n').map((line) => line.trim());
    expect(lines).toContain(input);
  });

  it('round-trips [if gte mso 15] (a conditional this app does not currently emit, but must still format safely)', () => {
    const input = '<div><!--[if gte mso 15]><table><tr><td>legacy fallback</td></tr></table><![endif]--></div>';
    const output = formatEmailHtml(input);
    expect(output).toContain('<!--[if gte mso 15]><table><tr><td>legacy fallback</td></tr></table><![endif]-->');
    // The real <div> around it is still tag-split/indented normally —
    // only the MSO comment's OWN contents are opaque.
    expect(output.split('\n')[0]).toBe('<div>');
  });

  it('round-trips VML namespace markup (xmlns:v/xmlns:o on <html>) without reinterpreting the colonized attribute names', () => {
    const html = renderEmailDocument({ width: 700, content: { version: 1, modules: [] } });
    const formatted = formatEmailHtml(html);
    expect(formatted).toContain(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    );
  });

  it('does not duplicate, move, or drop the Outlook spacer-row <style> block when a Spacer module is present', () => {
    const spacer = createModule('spacer', 0);
    const html = renderEmailDocument({ width: 700, content: { version: 1, modules: [spacer] } });
    const formatted = formatEmailHtml(html);
    expect((formatted.match(/mso-spacer/g) ?? []).length).toBeGreaterThan(0);
    expect((formatted.match(/<!--\[if mso\]>\n\s*<style type="text\/css">\n\s*\.mso-spacer/g) ?? []).length)
      .toBeLessThanOrEqual(1);
    const headStart = formatted.indexOf('<head>');
    const headEnd = formatted.indexOf('</head>');
    expect(formatted.indexOf('.mso-spacer')).toBeGreaterThan(headStart);
    expect(formatted.indexOf('.mso-spacer')).toBeLessThan(headEnd);
  });

  it('does not corrupt module HTML comments — each MODULE-N comment stays a single opaque line', () => {
    const text = createModule('text', 0);
    const html = renderEmailDocument({ width: 700, content: { version: 1, modules: [text] } });
    const formatted = formatEmailHtml(html);
    const lines = formatted.split('\n').map((line) => line.trim());
    const label = getModuleDefinition('text').label.toUpperCase();
    expect(lines).toContain(`<!--===== MODULE-1: ${label} - START =====-->`);
    expect(lines).toContain(`<!--===== MODULE-1: ${label} - ENDS =====-->`);
  });

  it('nested module comments (MODULE-N.1) also stay single opaque lines after formatting', () => {
    const layout = createModule('layout-1col', 0);
    const nested = createModule('button', 0);
    layout.columns![0].modules.push(nested);
    const html = renderEmailDocument({ width: 700, content: { version: 1, modules: [layout] } });
    const formatted = formatEmailHtml(html);
    const lines = formatted.split('\n').map((line) => line.trim());
    const label = getModuleDefinition('button').label.toUpperCase();
    expect(lines).toContain(`<!--===== MODULE-1.1: ${label} - START =====-->`);
  });

  it('Raw -> Formatted -> Raw is lossless for a document with Outlook blocks + module comments', () => {
    const spacer = createModule('spacer', 0);
    const text = createModule('text', 1);
    const rawHtml = renderEmailDocument({ width: 700, content: { version: 1, modules: [spacer, text] } });
    const formatted = formatEmailHtml(rawHtml);
    expect(formatEmailHtml(rawHtml)).toBe(formatted);
    expect(rawHtml).toContain('<o:OfficeDocumentSettings>');
    expect(rawHtml).toContain('mso-spacer');
    expect(rawHtml).toContain('MODULE-1:');
    expect(rawHtml).toContain('MODULE-2:');
  });
});

// E2 — HTML Formatting Correction. Inline content (a/strong/b/em/i/u/s/
// small/sub/sup/span/font/code/mark/abbr/cite/q/time/label, plus the
// `<br>` void element) must stay joined on one line with meaningful
// whitespace preserved — never fragmented tag-by-tag/text-run-by-run the
// way every OTHER (block) element still is. Block elements — table, tr,
// td, div, p, headings, ul, ol, li, and anything not explicitly listed
// as inline — keep the exact one-tag-per-line/depth-tracking behavior
// the tests above already lock in; nothing here changes that.
describe('formatEmailHtml — E2 inline-run correction (does not fragment inline content)', () => {
  it('keeps "Hello <strong>World</strong>" on one line with the space preserved', () => {
    expect(formatEmailHtml('Hello <strong>World</strong>')).toBe('Hello <strong>World</strong>');
  });

  it('never produces "HelloWorld" — the space between text and an inline tag is never lost', () => {
    const output = formatEmailHtml('Hello <strong>World</strong>');
    expect(output).not.toContain('HelloWorld');
    expect(output.replace(/<\/?strong>/g, '')).toBe('Hello World');
  });

  it('keeps "Click <a href=...>here</a> today" on one line, both surrounding spaces intact', () => {
    const input = 'Click <a href="https://example.com">here</a> today';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('keeps "<span>Hello</span> <em>world</em>" on one line, the space between the two tags intact', () => {
    const input = '<span>Hello</span> <em>world</em>';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('keeps nested inline tags together: "<strong>Hello <em>World</em></strong>"', () => {
    const input = '<strong>Hello <em>World</em></strong>';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('keeps "<a><strong>CTA text</strong></a>" — doubly-nested inline — on one line', () => {
    const input = '<a href="https://example.com"><strong>CTA text</strong></a>';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('"<strong>Hello</strong> <em>World</em>" stays one line with the separating space intact', () => {
    const input = '<strong>Hello</strong> <em>World</em>';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('"Text <a>link</a> text" preserves both surrounding spaces', () => {
    const input = 'Text <a href="https://example.com">link</a> text';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('"Text<br>Text" is not corrupted — both words survive, <br> stays a void element', () => {
    const output = formatEmailHtml('Text<br>Text');
    expect(output).toContain('Text');
    expect((output.match(/Text/g) ?? []).length).toBe(2);
    expect(output).toContain('<br>');
  });

  it('only breaks lines at block boundaries: <p>Hello <strong>World</strong> today.</p>', () => {
    const output = formatEmailHtml('<p>Hello <strong>World</strong> today.</p>');
    expect(output).toBe('<p>\n  Hello <strong>World</strong> today.\n</p>');
  });

  it('mixed inline + block content: a <div> containing inline text, then a nested <p>', () => {
    const input = '<div>\n  Hello <span>World</span>\n  <p>Next paragraph</p>\n</div>';
    const output = formatEmailHtml(input);
    expect(output).toBe(
      '<div>\n  Hello <span>World</span>\n  <p>\n    Next paragraph\n  </p>\n</div>',
    );
  });

  it('a table cell whose entire content is an inline-wrapped link is not fragmented into one line per tag (Feature 05 nested-column shape)', () => {
    const input = '<table><tr><td>Click <strong>here</strong> to continue</td></tr></table>';
    const output = formatEmailHtml(input);
    expect(output).toBe(
      '<table>\n  <tr>\n    <td>\n      Click <strong>here</strong> to continue\n    </td>\n  </tr>\n</table>',
    );
  });

  it('still breaks a line for every block element (table, tr, td, div, p, h1, ul, li) — only inline elements are joined', () => {
    const input = '<div><h1>Title</h1><ul><li>One</li><li>Two</li></ul><p>End</p></div>';
    const output = formatEmailHtml(input);
    const lines = output.split('\n').map((line) => line.trim());
    expect(lines).toEqual([
      '<div>', '<h1>', 'Title', '</h1>', '<ul>', '<li>', 'One', '</li>', '<li>', 'Two', '</li>', '</ul>', '<p>', 'End', '</p>', '</div>',
    ]);
  });

  it('preserves a meaningful multi-space run inside an inline context verbatim', () => {
    const input = '<p>Hello   <strong>World</strong></p>';
    expect(formatEmailHtml(input)).toBe('<p>\n  Hello   <strong>World</strong>\n</p>');
  });

  it('does not corrupt HTML entities adjacent to inline tags (&nbsp;, &amp;, &#39;)', () => {
    const input = 'Terms &amp; Conditions&nbsp;<a href="https://example.com">apply</a>&#39;s here';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('does not corrupt an AMPscript block (%%[ ... ]%%) embedded next to inline tags', () => {
    const input = 'Hi <strong>%%[ IF @isVip == true THEN ]%%VIP%%[ ENDIF ]%%</strong> customer';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('does not corrupt a personalization token (%%FirstName%%) embedded next to inline tags', () => {
    const input = 'Hello <strong>%%FirstName%%</strong>, welcome back';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('does not corrupt a style attribute containing semicolons and a URL on an inline or block tag', () => {
    const input = '<span style="color:#0082AD; background-image:url(\'https://cdn.example.com/x.png?a=1;b=2\');">Text</span>';
    expect(formatEmailHtml(input)).toBe(input);
  });

  it('an MSO conditional comment sitting directly beside inline content does not get absorbed into the inline run, and does not break it either', () => {
    const input = 'Hello <strong>World</strong><!--[if mso]>MSO-ONLY<![endif]--> today';
    const output = formatEmailHtml(input);
    const lines = output.split('\n');
    expect(lines).toContain('<!--[if mso]>MSO-ONLY<![endif]-->');
    expect(output).toContain('Hello <strong>World</strong>');
    expect(output).toContain('today');
  });

  it('a module-content-cell-shaped snippet (width-bearing <td> wrapping a text run) with inline formatting inside it does not fragment the inline run', () => {
    // This app's own modules currently escape all user text (no module
    // emits raw inline HTML today — see e.g. the Text module's own
    // escapeHtml call), so this mirrors the general STRUCTURAL shape a
    // module's content cell renders as (a width-bearing <td> wrapping
    // text), populated with inline tags, to prove the formatter itself
    // handles this shape correctly regardless of what currently produces
    // it — the correction is about the formatter's own correctness, not
    // a claim that today's renderer already emits inline tags.
    const input = (
      '<td width="100%" style="padding:20px; text-align:left; font-size:16px;">'
      + 'Hello <strong>World</strong>, click <a href="https://example.com">here</a>.'
      + '</td>'
    );
    const formatted = formatEmailHtml(input);
    expect(formatted).toContain('Hello <strong>World</strong>, click <a href="https://example.com">here</a>.');
  });

  it('Raw -> Formatted -> Raw stays lossless for HTML containing inline-formatted content (the underlying raw string is never mutated, and re-formatting is deterministic)', () => {
    const rawHtml = '<table><tr><td>Hello <strong>World</strong> today.</td></tr></table>';
    const formatted = formatEmailHtml(rawHtml);
    expect(formatEmailHtml(rawHtml)).toBe(formatted);
    expect(rawHtml).toBe('<table><tr><td>Hello <strong>World</strong> today.</td></tr></table>');
    expect(formatted).toContain('Hello <strong>World</strong> today.');
  });

  it('formatting never mutates the input string (pure function contract)', () => {
    const input = 'Hello <strong>World</strong>';
    const snapshot = input;
    formatEmailHtml(input);
    expect(input).toBe(snapshot);
  });

  it('an unrecognized/exotic tag name defaults to block behavior (safe allowlist, not a denylist)', () => {
    const output = formatEmailHtml('<custom-widget>Hello <strong>World</strong></custom-widget>');
    expect(output).toBe('<custom-widget>\n  Hello <strong>World</strong>\n</custom-widget>');
  });
});

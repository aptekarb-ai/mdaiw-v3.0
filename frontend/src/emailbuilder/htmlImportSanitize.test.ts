import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_ALLOWLIST, CONTENT_TAGS, DANGEROUS_TAGS, TRANSPARENT_CONTAINER_TAGS,
  extractStyleDeclarations, fragmentTargetId, isFragmentHref, isSafeAnchorUrl, isSafeResourceUrl,
  readAllowedAttribute, renderSanitizedSourceHtml,
} from './htmlImportSanitize';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('URL scheme matrix — resource attributes (absolute http/https ONLY)', () => {
  it.each([
    ['https://example.com/a.png', true],
    ['http://example.com/a.png', true],
    ['mailto:someone@example.com', false],
    ['tel:+15551234567', false],
    ['javascript:alert(1)', false],
    ['data:image/png;base64,AAAA', false],
    ['vbscript:msgbox(1)', false],
    ['/relative/a.png', false],
    ['a.png', false],
    ['#fragment', false],
    ['', false],
  ])('isSafeResourceUrl(%s) === %s', (value, expected) => {
    expect(isSafeResourceUrl(value)).toBe(expected);
  });
});

describe('URL scheme matrix — anchor href (http/https/mailto/tel)', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['mailto:someone@example.com', true],
    ['tel:+15551234567', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['vbscript:msgbox(1)', false],
    ['/relative/page', false],
  ])('isSafeAnchorUrl(%s) === %s', (value, expected) => {
    expect(isSafeAnchorUrl(value)).toBe(expected);
  });
});

describe('fragment-only href detection', () => {
  it('recognizes a fragment href', () => {
    expect(isFragmentHref('#section-2')).toBe(true);
    expect(fragmentTargetId('#section-2')).toBe('section-2');
  });

  it('does not treat a bare "#" or a non-fragment href as a fragment target', () => {
    expect(isFragmentHref('#')).toBe(false);
    expect(isFragmentHref('https://example.com')).toBe(false);
  });
});

describe('closed tag allowlists', () => {
  it('transparent-container allowlist is exactly the approved closed set', () => {
    expect([...TRANSPARENT_CONTAINER_TAGS].sort()).toEqual(
      ['article', 'figcaption', 'figure', 'footer', 'header', 'main', 'section'].sort(),
    );
  });

  it('dangerous-tag set matches the approved active-element list', () => {
    expect([...DANGEROUS_TAGS].sort()).toEqual(['embed', 'form', 'iframe', 'object', 'script'].sort());
  });

  it('an unknown/custom tag is in neither allowlist', () => {
    expect(TRANSPARENT_CONTAINER_TAGS.has('x-widget')).toBe(false);
    expect(CONTENT_TAGS.has('x-widget')).toBe(false);
    expect(DANGEROUS_TAGS.has('x-widget')).toBe(false);
  });
});

describe('attribute allowlist enforcement', () => {
  it('readAllowedAttribute returns the value for an allowlisted attribute', () => {
    const el = document.createElement('img');
    el.setAttribute('src', 'https://example.com/a.png');
    expect(readAllowedAttribute(el, 'src')).toBe('https://example.com/a.png');
  });

  it('readAllowedAttribute never returns a non-allowlisted attribute, even if present on the element', () => {
    const el = document.createElement('div');
    el.setAttribute('onclick', 'alert(1)');
    el.setAttribute('id', 'should-not-be-read');
    el.setAttribute('class', 'should-not-be-read');
    expect(readAllowedAttribute(el, 'onclick')).toBeNull();
    expect(readAllowedAttribute(el, 'id')).toBeNull();
    expect(readAllowedAttribute(el, 'class')).toBeNull();
  });

  it('the allowlist itself is exactly the approved attribute set', () => {
    expect([...ATTRIBUTE_ALLOWLIST].sort()).toEqual(
      ['align', 'alt', 'background', 'bgcolor', 'colspan', 'height', 'href', 'role', 'rowspan', 'src', 'srcset', 'style', 'title', 'valign', 'width'].sort(),
    );
  });
});

describe('extractStyleDeclarations — inline CSS security + parsing', () => {
  it('parses ordinary safe declarations', () => {
    const declarations = extractStyleDeclarations('color:#ffffff; padding: 10px; text-align:center;');
    expect(declarations.get('color')).toBe('#ffffff');
    expect(declarations.get('padding')).toBe('10px');
    expect(declarations.get('text-align')).toBe('center');
  });

  it('discards the WHOLE declaration block when it fails the reused Custom CSS security check', () => {
    const declarations = extractStyleDeclarations('color:#fff; background:url(javascript:alert(1));');
    expect(declarations.size).toBe(0);
  });

  it('rejects an expression() CSS injection attempt', () => {
    const declarations = extractStyleDeclarations('width:expression(alert(1));');
    expect(declarations.size).toBe(0);
  });

  it('rejects an @import attempt embedded in a style attribute', () => {
    const declarations = extractStyleDeclarations('color:#fff; content: "@import url(evil.css)";');
    expect(declarations.size).toBe(0);
  });

  it('returns an empty map for an empty style string', () => {
    expect(extractStyleDeclarations('').size).toBe(0);
    expect(extractStyleDeclarations('   ').size).toBe(0);
  });
});

// R3 (Import HTML AI Reconstruction) — the "Original" preview pane's
// source string. Not a second sanitizer: reuses this file's own
// DANGEROUS_TAGS removal, applied to a CLONE, never the live document.
describe('renderSanitizedSourceHtml — Original preview source (R3)', () => {
  it('strips a <script> from the body before serializing', () => {
    const html = '<html><body><table><tr><td><script>alert(1)</script><p>Safe</p></td></tr></table></body></html>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('Safe');
  });

  it('strips a <script> that lives in <head> too (never visible to the mapper, but still real markup in the DOM)', () => {
    const html = '<html><head><script>alert(1)</script></head><body><p>Safe</p></body></html>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).not.toContain('<script>');
    expect(out).toContain('Safe');
  });

  it('strips iframe/object/embed/form the same way', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form']) {
      const html = `<html><body><${tag}></${tag}><p>Safe</p></body></html>`;
      const out = renderSanitizedSourceHtml(parse(html));
      expect(out).not.toContain(`<${tag}`);
      expect(out).toContain('Safe');
    }
  });

  it('preserves ordinary safe content byte-for-byte in structure (headings, paragraphs, images, links)', () => {
    const html = '<html><body><h1>Title</h1><p>Body</p><img src="https://example.com/a.png"><a href="https://example.com">Link</a></body></html>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<p>Body</p>');
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('href="https://example.com"');
  });

  it('never mutates the input document — the caller still needs the live tree for mapping/analysis', () => {
    const doc = parse('<html><body><script>alert(1)</script><p>Safe</p></body></html>');
    renderSanitizedSourceHtml(doc);
    expect(doc.querySelector('script')).not.toBeNull();
  });
});

// R3 correction — the Original preview must represent the source AFTER
// mandatory security sanitization, never a deliberately-degraded or
// re-styled version of it. Every check below proves a SPECIFIC safe
// presentation fact survives verbatim (never re-derived/re-formatted),
// and that the fixed set of genuinely dangerous constructs still
// disappears — the same two responsibilities, kept clearly separate.
describe('renderSanitizedSourceHtml — preserved-style matrix (R3 correction)', () => {
  it('inline text color survives', () => {
    const out = renderSanitizedSourceHtml(parse('<table><tr><td><p style="color:#112233;">Text</p></td></tr></table>'));
    expect(out).toContain('color:#112233');
  });

  it('background color (bgcolor attribute AND CSS background-color) survives', () => {
    const html = '<table><tr bgcolor="#002d38" style="background-color:#002d38;"><td>Footer</td></tr></table>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).toContain('bgcolor="#002d38"');
    expect(out).toContain('background-color:#002d38');
  });

  it('safe inline padding survives', () => {
    const out = renderSanitizedSourceHtml(parse('<table><tr><td style="padding:12px 24px 12px 24px;">Padded</td></tr></table>'));
    expect(out).toContain('padding:12px 24px 12px 24px');
  });

  it('table/cell width attributes survive', () => {
    const out = renderSanitizedSourceHtml(parse('<table width="600"><tr><td width="200">A</td><td width="400">B</td></tr></table>'));
    expect(out).toContain('width="600"');
    expect(out).toContain('width="200"');
    expect(out).toContain('width="400"');
  });

  it('image width (attribute) survives', () => {
    const out = renderSanitizedSourceHtml(parse('<table><tr><td><img src="https://example.com/logo.png" width="140"></td></tr></table>'));
    expect(out).toContain('width="140"');
  });

  it('a safe href survives untouched', () => {
    const out = renderSanitizedSourceHtml(parse('<a href="https://example.com/shop">Shop</a>'));
    expect(out).toContain('href="https://example.com/shop"');
  });

  it('a safe image src survives untouched', () => {
    const out = renderSanitizedSourceHtml(parse('<img src="https://example.com/hero.png">'));
    expect(out).toContain('src="https://example.com/hero.png"');
  });

  it('supported <style> block content survives, in <head> or <body>, per the existing validateCustomCss policy', () => {
    const html = '<html><head><style>.brand{color:#0082ad; font-family:Arial,sans-serif;}</style></head><body><p class="brand">Text</p></body></html>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).toContain('.brand{color:#0082ad; font-family:Arial,sans-serif;}');
  });

  it('align/valign/font attributes and border/text-align style declarations all survive', () => {
    const html = '<table><tr><td align="center" valign="middle" style="text-align:center; font-size:18px; font-weight:bold; border:1px solid #B8C8CD;"><font face="Arial">Hi</font></td></tr></table>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).toContain('align="center"');
    expect(out).toContain('valign="middle"');
    expect(out).toContain('text-align:center');
    expect(out).toContain('font-size:18px');
    expect(out).toContain('font-weight:bold');
    expect(out).toContain('border:1px solid #B8C8CD');
  });

  it('a safe background-image URL survives', () => {
    const out = renderSanitizedSourceHtml(parse('<table><tr style="background-image:url(https://example.com/bg.png);"><td>Text</td></tr></table>'));
    expect(out).toContain('background-image:url(https://example.com/bg.png)');
  });
});

describe('renderSanitizedSourceHtml — security regression (R3 correction, scoped hardening)', () => {
  it('scripts still disappear', () => {
    const out = renderSanitizedSourceHtml(parse('<script>alert(1)</script><p>Safe</p>'));
    expect(out).not.toContain('<script');
  });

  it('event-handler attributes (onclick/onerror/onload/...) are stripped from every surviving element', () => {
    const html = '<img src="https://example.com/a.png" onerror="alert(1)"><a href="https://example.com" onclick="alert(2)">Link</a><body onload="alert(3)">';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onload');
    expect(out).toContain('src="https://example.com/a.png"'); // the safe attribute alongside it survives
  });

  it('a javascript: href is removed, but the link text/element survives', () => {
    const out = renderSanitizedSourceHtml(parse('<a href="javascript:alert(1)">Click me</a>'));
    expect(out).not.toContain('javascript:');
    expect(out).toContain('Click me');
  });

  it('an unsafe (relative/data:) image src is removed, the element survives', () => {
    const out = renderSanitizedSourceHtml(parse('<img src="data:image/png;base64,AAAA" alt="Bad">'));
    expect(out).not.toContain('data:image/png');
  });

  it('a <style> block containing an expression()/javascript: injection is dropped entirely, not partially salvaged', () => {
    const html = '<html><head><style>body{width:expression(alert(1));}</style></head><body><p>Safe</p></body></html>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).not.toContain('expression(');
    expect(out).toContain('Safe');
  });

  it('an inline style attribute containing an @import/javascript: injection is dropped entirely, not partially salvaged', () => {
    const html = '<p style="color:#fff; background:url(javascript:alert(1));">Text</p>';
    const out = renderSanitizedSourceHtml(parse(html));
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('color:#fff'); // whole attribute invalidated, matches extractStyleDeclarations's own policy
  });

  it('the source document remains completely immutable across all of the above', () => {
    const html = '<html><body><script>alert(1)</script><img src="https://example.com/a.png" onerror="alert(2)"><a href="javascript:alert(3)">Link</a></body></html>';
    const doc = parse(html);
    renderSanitizedSourceHtml(doc);
    expect(doc.querySelector('script')).not.toBeNull();
    expect(doc.querySelector('img')?.getAttribute('onerror')).toBe('alert(2)');
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('javascript:alert(3)');
  });
});

describe('renderSanitizedSourceHtml — realistic styled marketing-email fixture (R3 correction)', () => {
  const STYLED_FIXTURE = `<html><head><title>Fall Sale</title>
    <style>.brand-heading{color:#002d38; font-family:Arial,sans-serif;}</style>
  </head><body style="background-color:#F4F6F8;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;">
      <tr><td style="padding:20px 24px;"><img src="https://example.com/logo.png" alt="MarketOne" width="140"></td></tr>
      <tr><td style="padding:0 24px;"><h1 class="brand-heading" style="color:#002d38; font-size:32px;">Fall Sale Is Here</h1></td></tr>
      <tr><td style="padding:0 24px 24px;"><a href="https://example.com/shop-now" style="background-color:#76c043; color:#ffffff; padding:12px 24px; border-radius:6px;">Shop Now</a></td></tr>
      <tr style="background-color:#002d38;"><td style="padding:24px;"><a href="https://example.com/unsubscribe" style="color:#ffffff;">Unsubscribe</a></td></tr>
    </table>
  </body></html>`;

  it('preserves the identifying styles that make the Original preview visually resemble the source', () => {
    const out = renderSanitizedSourceHtml(parse(STYLED_FIXTURE));
    expect(out).toContain('background-color:#F4F6F8'); // page background
    expect(out).toContain('width="600"'); // container width
    expect(out).toContain('color:#002d38; font-size:32px'); // heading style
    expect(out).toContain('background-color:#76c043'); // CTA background
    expect(out).toContain('border-radius:6px'); // CTA shape
    expect(out).toContain('background-color:#002d38'); // footer background (row-level)
    expect(out).toContain('.brand-heading{color:#002d38; font-family:Arial,sans-serif;}'); // <head> <style> block
    expect(out).toContain('href="https://example.com/unsubscribe"');
  });

  it('is still fully mappable/analyzable from the SAME (unmutated) source document after the preview is rendered', () => {
    const doc = parse(STYLED_FIXTURE);
    renderSanitizedSourceHtml(doc);
    // The live document is unaffected — mapImportedHtml/analyzeImportedHtml
    // still see the exact same tree they would have without a preview
    // ever being rendered from it.
    expect(doc.querySelector('style')).not.toBeNull();
    expect(doc.querySelector('h1')?.getAttribute('style')).toContain('color:#002d38');
  });
});

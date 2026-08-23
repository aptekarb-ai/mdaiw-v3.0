import { describe, expect, it } from 'vitest';
import { inferFaviconMimeType, renderEmailHead } from './emailHead';
import { createModule } from './moduleFactory';
import type { EmailDocumentContent } from './edm';

const EMPTY_CONTENT: EmailDocumentContent = { version: 1, modules: [] };

describe('inferFaviconMimeType', () => {
  it('infers the correct MIME type per known extension', () => {
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.ico')).toBe('image/x-icon');
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.png')).toBe('image/png');
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.jpg')).toBe('image/jpeg');
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.jpeg')).toBe('image/jpeg');
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.gif')).toBe('image/gif');
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.svg')).toBe('image/svg+xml');
  });

  it('is case-insensitive on the extension', () => {
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.PNG')).toBe('image/png');
  });

  it('handles a query string after the extension', () => {
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.png?v=2')).toBe('image/png');
  });

  it('returns null for an unrecognized or missing extension', () => {
    expect(inferFaviconMimeType('https://cdn.example.com/favicon')).toBeNull();
    expect(inferFaviconMimeType('https://cdn.example.com/favicon.bmp')).toBeNull();
  });
});

describe('renderEmailHead', () => {
  it('emits exactly one charset meta tag', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    const matches = head.match(/<meta charset=/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(head).toContain('<meta charset="utf-8" />');
  });

  it('emits exactly one viewport meta tag with no maximum-scale', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    const matches = head.match(/name="viewport"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(head).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    expect(head).not.toContain('maximum-scale');
  });

  it('wraps the X-UA-Compatible meta tag in the downlevel-revealed "if !mso" comment pair', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    expect(head).toContain('<!--[if !mso]><!-->\n<meta http-equiv="X-UA-Compatible" content="IE=edge" />\n<!--<![endif]-->');
  });

  it('places charset before viewport before title in the canonical order', () => {
    const head = renderEmailHead({ title: 'My Email', faviconUrl: '', content: EMPTY_CONTENT });
    const charsetIndex = head.indexOf('<meta charset=');
    const viewportIndex = head.indexOf('name="viewport"');
    const titleIndex = head.indexOf('<title>');
    expect(charsetIndex).toBeGreaterThanOrEqual(0);
    expect(charsetIndex).toBeLessThan(viewportIndex);
    expect(viewportIndex).toBeLessThan(titleIndex);
  });

  it('escapes a title containing HTML-significant characters', () => {
    const head = renderEmailHead({ title: '</title><script>alert(1)</script>', faviconUrl: '', content: EMPTY_CONTENT });
    expect(head).not.toContain('<script>');
    expect(head).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>');
  });

  it('renders an empty <title> when no title is set', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    expect(head).toContain('<title></title>');
  });

  it('omits the favicon link entirely when no favicon URL is set', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    expect(head).not.toContain('rel="icon"');
  });

  it('renders a favicon link with the correct inferred MIME type', () => {
    const head = renderEmailHead({ title: '', faviconUrl: 'https://cdn.example.com/fav.png', content: EMPTY_CONTENT });
    expect(head).toContain('<link rel="icon" type="image/png" href="https://cdn.example.com/fav.png" />');
  });

  it('renders a favicon link without a type attribute when the MIME type cannot be inferred', () => {
    const head = renderEmailHead({ title: '', faviconUrl: 'https://cdn.example.com/fav', content: EMPTY_CONTENT });
    expect(head).toContain('<link rel="icon" href="https://cdn.example.com/fav" />');
  });

  it('escapes an attacker-controlled favicon URL attribute', () => {
    const head = renderEmailHead({
      title: '', faviconUrl: 'https://cdn.example.com/fav.png?x="><script>alert(1)</script>', content: EMPTY_CONTENT,
    });
    expect(head).not.toContain('<script>');
  });

  it('drops a favicon URL using an unsafe scheme', () => {
    const head = renderEmailHead({ title: '', faviconUrl: 'javascript:alert(1)', content: EMPTY_CONTENT });
    expect(head).not.toContain('rel="icon"');
  });

  it('is a pure function — same input always produces the same output', () => {
    const options = { title: 'My Email', faviconUrl: 'https://cdn.example.com/fav.png', content: EMPTY_CONTENT };
    expect(renderEmailHead(options)).toBe(renderEmailHead(options));
  });

  it('appends the responsive <style> block after the title/favicon when the content needs it', () => {
    const spacer = createModule('spacer', 0);
    const content: EmailDocumentContent = {
      version: 1,
      modules: [{ ...spacer, props: { ...spacer.props, height: 20, mobileHeight: 8 } }],
    };
    const head = renderEmailHead({ title: '', faviconUrl: '', content });
    const titleIndex = head.indexOf('<title>');
    const styleIndex = head.indexOf('<style');
    expect(styleIndex).toBeGreaterThan(titleIndex);
  });

  it('omits the <style> block entirely when no module needs responsive overrides', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    expect(head).not.toContain('<style');
  });
});

describe('renderEmailHead — Sub-phase 3 Outlook compatibility', () => {
  it('always includes the OfficeDocumentSettings block, after Custom CSS in canonical order', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    expect(head).toContain('<o:OfficeDocumentSettings>');
    expect(head).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    const titleIndex = head.indexOf('<title>');
    const officeIndex = head.indexOf('<o:OfficeDocumentSettings>');
    expect(officeIndex).toBeGreaterThan(titleIndex);
  });

  it('omits the Outlook spacer-row CSS block when the document has no Spacer module', () => {
    const head = renderEmailHead({ title: '', faviconUrl: '', content: EMPTY_CONTENT });
    expect(head).not.toContain('mso-spacer');
  });

  it('includes the Outlook spacer-row CSS block when the document has a Spacer module', () => {
    const spacer = createModule('spacer', 0);
    const content: EmailDocumentContent = { version: 1, modules: [spacer] };
    const head = renderEmailHead({ title: '', faviconUrl: '', content });
    expect(head).toContain('mso-spacer');
  });
});

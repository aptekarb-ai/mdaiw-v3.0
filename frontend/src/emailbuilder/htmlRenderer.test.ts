import { describe, expect, it } from 'vitest';
import { renderEmailBody, renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import type { EmailModule, TextModuleProps, ButtonModuleProps, ImageModuleProps } from './edm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper accepts modules narrowed to any specific Props type
function withModules(modules: EmailModule<any>[], width = 700) {
  return { width, content: { version: 1 as const, modules } };
}

describe('renderEmailBody', () => {
  it('produces table-first markup with role="presentation"', () => {
    const textModule = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    const html = renderEmailBody(withModules([textModule]));

    expect(html).toContain('<table');
    expect(html).toContain('<tr');
    expect(html).toContain('<td');
    expect(html).toContain('role="presentation"');
  });

  it('does not use flexbox or grid for structural email layout', () => {
    const modules = [
      createModule('layout-2col-50-50', 0),
      createModule('text', 1),
      createModule('button', 2),
      createModule('image', 3),
    ];
    const html = renderEmailBody(withModules(modules));

    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it('wraps the email content in an outer width table sized to the document width', () => {
    const html = renderEmailBody(withModules([], 750));
    expect(html).toContain('width="750"');
  });

  it('escapes user-entered text content', () => {
    const textModule = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    textModule.props = { ...textModule.props, text: '<script>alert(1)</script>' };
    const html = renderEmailBody(withModules([textModule]));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects javascript: URLs on button links', () => {
    const buttonModule = createModule('button', 0) as unknown as EmailModule<ButtonModuleProps>;
    buttonModule.props = { ...buttonModule.props, href: 'javascript:alert(1)' };
    const html = renderEmailBody(withModules([buttonModule]));

    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('href="#"');
  });

  it('rejects javascript: URLs on image links', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    imageModule.props = { ...imageModule.props, href: 'javascript:alert(1)' };
    const html = renderEmailBody(withModules([imageModule]));

    expect(html).not.toContain('javascript:alert');
  });

  it('renders modules in order regardless of array order', () => {
    const first = createModule('text', 1);
    const second = createModule('button', 0);
    (first.props as unknown as TextModuleProps).text = 'SECOND-VISUALLY';
    (second.props as unknown as ButtonModuleProps).text = 'FIRST-VISUALLY';
    const html = renderEmailBody(withModules([first, second]));

    expect(html.indexOf('FIRST-VISUALLY')).toBeLessThan(html.indexOf('SECOND-VISUALLY'));
  });

  it('renders a text module\'s content', () => {
    const textModule = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    textModule.props = { ...textModule.props, text: 'Hello world' };
    const html = renderEmailBody(withModules([textModule]));
    expect(html).toContain('Hello world');
  });

  it('renders a button module as a table-based link, not a styled div/anchor button', () => {
    const buttonModule = createModule('button', 0) as unknown as EmailModule<ButtonModuleProps>;
    buttonModule.props = { ...buttonModule.props, text: 'Shop Now', href: 'https://example.com' };
    const html = renderEmailBody(withModules([buttonModule]));

    expect(html).toContain('Shop Now');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<table');
  });

  it('renders an image module with defensive attributes', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    const html = renderEmailBody(withModules([imageModule]));

    expect(html).toContain('<img');
    expect(html).toContain('alt=');
    expect(html).toContain('border:0');
  });

  it('renders layout modules as table cells, one per column', () => {
    const layout = createModule('layout-3col', 0);
    const html = renderEmailBody(withModules([layout]));
    const cellCount = (html.match(/<td width="/g) ?? []).length;
    expect(cellCount).toBe(3);
  });
});

describe('renderEmailDocument', () => {
  it('wraps the body in a full HTML document shell', () => {
    const html = renderEmailDocument(withModules([]));
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html');
    expect(html).toContain('<body');
    expect(html).not.toContain('<script');
  });
});

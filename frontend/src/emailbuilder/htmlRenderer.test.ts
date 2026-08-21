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

describe('renderEmailBody — outer left/right spacing', () => {
  it('emits no spacer <td> when both sides are 0 (the default)', () => {
    const textModule = createModule('text', 0);
    const html = renderEmailBody(withModules([textModule]));
    expect(html).not.toMatch(/font-size:0; line-height:0;">&nbsp;<\/td>/);
  });

  it('emits a left-only spacer <td> when only left is set', () => {
    const textModule = createModule('text', 0);
    textModule.settings.outerSpacing = { desktop: { left: { value: 20, unit: 'px' }, right: { value: 0, unit: 'px' } }, mobile: {} };
    const html = renderEmailBody(withModules([textModule]));
    const spacerCells = html.match(/width:20px;[^>]*>&nbsp;<\/td>/g) ?? [];
    expect(spacerCells).toHaveLength(1);
  });

  it('emits a right-only spacer <td> when only right is set', () => {
    const textModule = createModule('text', 0);
    textModule.settings.outerSpacing = { desktop: { left: { value: 0, unit: 'px' }, right: { value: 24, unit: 'px' } }, mobile: {} };
    const html = renderEmailBody(withModules([textModule]));
    const spacerCells = html.match(/width:24px;[^>]*>&nbsp;<\/td>/g) ?? [];
    expect(spacerCells).toHaveLength(1);
  });

  it('emits both spacer <td>s when both sides are set', () => {
    const textModule = createModule('text', 0);
    textModule.settings.outerSpacing = { desktop: { left: { value: 16, unit: 'px' }, right: { value: 16, unit: 'px' } }, mobile: {} };
    const html = renderEmailBody(withModules([textModule]));
    const spacerCells = html.match(/width:16px;[^>]*>&nbsp;<\/td>/g) ?? [];
    expect(spacerCells).toHaveLength(2);
  });

  it('supports a percentage outer spacer', () => {
    const textModule = createModule('text', 0);
    textModule.settings.outerSpacing = { desktop: { left: { value: 10, unit: '%' }, right: { value: 0, unit: 'px' } }, mobile: {} };
    const html = renderEmailBody(withModules([textModule]));
    expect(html).toContain('width="10%"');
  });

  it('the spacer wrapper table stays table-first (no div/flex/grid)', () => {
    const textModule = createModule('text', 0);
    textModule.settings.outerSpacing = { desktop: { left: { value: 20, unit: 'px' }, right: { value: 20, unit: 'px' } }, mobile: {} };
    const html = renderEmailBody(withModules([textModule]));
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });
});

describe('renderEmailBody — image width px/%/desktop-vs-mobile', () => {
  it('renders a 300px image width with a matching width attribute and style', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    imageModule.props = { ...imageModule.props, src: 'https://example.com/a.png', width: { desktop: { value: 300, unit: 'px' } } };
    const html = renderEmailBody(withModules([imageModule]));
    expect(html).toContain('width="300"');
    expect(html).toContain('width:300px;');
  });

  it('renders a 50% image width with a matching width attribute and style', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    imageModule.props = { ...imageModule.props, src: 'https://example.com/a.png', width: { desktop: { value: 50, unit: '%' } } };
    const html = renderEmailBody(withModules([imageModule]));
    expect(html).toContain('width="50%"');
    expect(html).toContain('width:50%;');
  });

  it('defaults a fresh image module to 100% width', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    imageModule.props = { ...imageModule.props, src: 'https://example.com/a.png' };
    const html = renderEmailBody(withModules([imageModule]));
    expect(html).toContain('width="100%"');
  });

  it('the static HTML export uses the DESKTOP width even when a mobile override exists', () => {
    const imageModule = createModule('image', 0) as unknown as EmailModule<ImageModuleProps>;
    imageModule.props = {
      ...imageModule.props,
      src: 'https://example.com/a.png',
      width: { desktop: { value: 300, unit: 'px' }, mobile: { value: 100, unit: '%' } },
    };
    const html = renderEmailBody(withModules([imageModule]));
    const imgTag = html.match(/<img[^>]*>/)?.[0] ?? '';
    expect(imgTag).toContain('width="300"');
    expect(imgTag).not.toContain('width="100%"');
  });
});

describe('full representative email sweep (Header/Hero/Text/Image/2-col/Product/CTA/Social/Footer)', () => {
  const REPRESENTATIVE_TYPES = [
    'header-logo-nav', 'hero-image-cta', 'text', 'image', 'layout-2col-40-60',
    'content-image-left', 'product-three-cards', 'cta-dual', 'social-follow-us', 'footer-social-legal',
  ] as const;

  function buildRepresentativeEmail() {
    const modules = REPRESENTATIVE_TYPES.map((type, index) => createModule(type, index));
    return renderEmailDocument(withModules(modules, 700));
  }

  it('contains the expected table-first structural markers', () => {
    const html = buildRepresentativeEmail();
    expect(html).toContain('<table');
    expect(html).toContain('<tr');
    expect(html).toContain('<td');
    expect(html).toContain('role="presentation"');
  });

  it('contains no structural <div>', () => {
    expect(buildRepresentativeEmail()).not.toContain('<div');
  });

  it('contains no CSS margin declaration anywhere', () => {
    expect(buildRepresentativeEmail()).not.toMatch(/[\s;"]margin/);
  });

  it('contains no display:flex or display:grid', () => {
    const html = buildRepresentativeEmail();
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it('contains no <script> tags', () => {
    expect(buildRepresentativeEmail().toLowerCase()).not.toContain('<script');
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

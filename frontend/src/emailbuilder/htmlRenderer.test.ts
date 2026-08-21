import { describe, expect, it } from 'vitest';
import { renderEmailBody, renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import { getModuleDefinition } from './moduleRegistry';
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
  it('always wraps in the standard outer module table, even at 0/0 — a single content <td>, no spacer <td>s', () => {
    const textModule = createModule('text', 0);
    const html = renderEmailBody(withModules([textModule]));
    // No spacer <td> (0/0 means no spacer columns, not no outer table).
    expect(html).not.toMatch(/font-size:0; line-height:0;">&nbsp;<\/td>/);
    // The outer wrapper table IS present: renderEmailBody's own output
    // must contain exactly one MORE occurrence of the outer-table-open
    // literal than the module's raw (unwrapped) renderEmailHtml does —
    // i.e. the outer wrapper was prepended, not skipped.
    const OUTER_TABLE_OPEN = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>';
    const countOf = (haystack: string) => haystack.split(OUTER_TABLE_OPEN).length - 1;
    const rawHtml = getModuleDefinition('text').renderEmailHtml(textModule);
    expect(countOf(html)).toBe(countOf(rawHtml) + 1);
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

describe('Feature 05 — nested layout rendering', () => {
  const LAYOUT_TYPES = [
    ['layout-1col', 1], ['layout-2col-40-60', 2], ['layout-3col', 3],
    ['layout-4col', 4], ['layout-5col', 5], ['layout-6col', 6],
  ] as const;

  it.each(LAYOUT_TYPES)('%s renders %d column <td>s, table-first, with a nested Text module', (type, count) => {
    const layout = createModule(type, 0);
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    text.props = { ...text.props, text: 'Nested text content' };
    layout.columns![0].modules.push(text as unknown as EmailModule);

    const html = renderEmailBody(withModules([layout]));
    // Scoped to layout column cells specifically (they carry `valign`,
    // unlike a nested module's own width-bearing <td>, e.g. Text's
    // Feature-06 width control) — a nested module contributing its own
    // width="...%" cell must not inflate this count.
    const columnCells = html.match(/<td width="\d+(\.\d+)?%" valign=/g) ?? [];
    expect(columnCells).toHaveLength(count);
    expect(html).toContain('Nested text content');
    expect(html).toContain('<table');
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain('<div class');
    expect(html).not.toMatch(/margin\s*:/);
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it('emits an empty-column &nbsp; cell (table-first, no placeholder markup) for a column with no nested modules', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const html = renderEmailBody(withModules([layout]));
    expect(html).toContain('&nbsp;');
  });

  it('renders a fixed-px gutter <td> between columns when columnGutter > 0', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } } };
    const html = renderEmailBody(withModules([layout]));
    expect(html).toContain('<td width="20" style="width:20px; font-size:0; line-height:0;">&nbsp;</td>');
  });

  it('omits the gutter <td> entirely when columnGutter is 0 (or unset)', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const html = renderEmailBody(withModules([layout]));
    expect(html).not.toContain('font-size:0; line-height:0;');
    // Exactly 2 column <td>s, no third gutter cell.
    expect((html.match(/<td width="\d+%"/g) ?? [])).toHaveLength(2);
  });

  it('does not add a gutter <td> after the LAST column, even with a gutter set', () => {
    const layout = createModule('layout-3col', 0);
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 10, unit: 'px' } } };
    const html = renderEmailBody(withModules([layout]));
    const gutterCells = (html.match(/font-size:0; line-height:0;/g) ?? []).length;
    // 3 columns -> 2 gutters (between 1-2 and 2-3), never 3.
    expect(gutterCells).toBe(2);
  });

  it('nested modules use their own definition\'s table-first renderEmailHtml (no div-wrapping special case)', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const button = createModule('button', 0) as unknown as EmailModule<ButtonModuleProps>;
    button.props = { ...button.props, text: 'Click me', href: 'https://example.com' };
    layout.columns![1].modules.push(button as unknown as EmailModule);

    const html = renderEmailBody(withModules([layout]));
    expect(html).toContain('Click me');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('<div class');
  });

  it('the whole layout module still gets outer-spacer wrapping like any other top-level module', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = {
      ...layout.settings,
      outerSpacing: { desktop: { left: { value: 20, unit: 'px' }, right: { value: 20, unit: 'px' } }, mobile: {} },
    };
    const html = renderEmailBody(withModules([layout]));
    expect(html).toContain('width="20"');
  });

  it('a module nested inside a Layout column honors its own outer spacer, independently of the parent Layout\'s outer spacer', () => {
    const layout = createModule('layout-2col-50-50', 0);
    // Parent Layout has NO outer spacing of its own.
    layout.settings = { ...layout.settings, outerSpacing: { desktop: { left: { value: 0, unit: 'px' }, right: { value: 0, unit: 'px' } }, mobile: {} } };
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    text.props = { ...text.props, text: 'Nested with its own spacer' };
    text.settings = { ...text.settings, outerSpacing: { desktop: { left: { value: 10, unit: 'px' }, right: { value: 0, unit: 'px' } }, mobile: {} } };
    layout.columns![0].modules.push(text as unknown as EmailModule);

    const html = renderEmailBody(withModules([layout]));
    // Exactly one 10px spacer cell (the nested Text's left spacer) —
    // nothing from the (unset) parent Layout outer spacer.
    const spacerCells = html.match(/width:10px;[^>]*>&nbsp;<\/td>/g) ?? [];
    expect(spacerCells).toHaveLength(1);
    expect(html).toContain('Nested with its own spacer');
  });

  it('a module nested inside a Layout column supports Left-only, Right-only, and both-sides spacers, same as top-level', () => {
    const leftOnly = createModule('layout-1col', 0);
    const leftText = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    leftText.settings = { ...leftText.settings, outerSpacing: { desktop: { left: { value: 20, unit: 'px' }, right: { value: 0, unit: 'px' } }, mobile: {} } };
    leftOnly.columns![0].modules.push(leftText as unknown as EmailModule);
    const leftHtml = renderEmailBody(withModules([leftOnly]));
    expect(leftHtml.match(/width:20px;[^>]*>&nbsp;<\/td>/g) ?? []).toHaveLength(1);

    const rightOnly = createModule('layout-1col', 0);
    const rightText = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    rightText.settings = { ...rightText.settings, outerSpacing: { desktop: { left: { value: 0, unit: 'px' }, right: { value: 30, unit: 'px' } }, mobile: {} } };
    rightOnly.columns![0].modules.push(rightText as unknown as EmailModule);
    const rightHtml = renderEmailBody(withModules([rightOnly]));
    expect(rightHtml.match(/width:30px;[^>]*>&nbsp;<\/td>/g) ?? []).toHaveLength(1);

    const both = createModule('layout-1col', 0);
    const bothText = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    bothText.settings = { ...bothText.settings, outerSpacing: { desktop: { left: { value: 20, unit: 'px' }, right: { value: 30, unit: 'px' } }, mobile: {} } };
    both.columns![0].modules.push(bothText as unknown as EmailModule);
    const bothHtml = renderEmailBody(withModules([both]));
    expect(bothHtml.match(/width:20px;[^>]*>&nbsp;<\/td>/g) ?? []).toHaveLength(1);
    expect(bothHtml.match(/width:30px;[^>]*>&nbsp;<\/td>/g) ?? []).toHaveLength(1);
  });

  it('a layout module with no columns key at all (unnormalized) still renders without throwing', () => {
    const layout = createModule('layout-2col-50-50', 0);
    delete layout.columns;
    expect(() => renderEmailBody(withModules([layout]))).not.toThrow();
  });

  it('escapes nested module text content the same as a top-level module', () => {
    const layout = createModule('layout-1col', 0);
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    text.props = { ...text.props, text: '<script>alert(1)</script>' };
    layout.columns![0].modules.push(text as unknown as EmailModule);
    const html = renderEmailBody(withModules([layout]));
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

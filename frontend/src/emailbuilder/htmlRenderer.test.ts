import { describe, expect, it } from 'vitest';
import { renderEmailBody, renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import { getModuleDefinition } from './moduleRegistry';
import { computeCompatibilityChecks } from './htmlCompatibilityChecks';
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

  it('the real (non-Outlook) content table is fluid: width=100% with max-width in CSS, not a fixed pixel width', () => {
    const html = renderEmailBody(withModules([], 750));
    // Strip the MSO-only conditional comment first — everything inside it
    // is inert to every non-Outlook client and must not satisfy this
    // assertion on its own.
    const withoutMsoBlock = html.replace(/<!--\[if mso\]>.*?<!\[endif\]-->/gs, '');
    expect(withoutMsoBlock).toContain('width="100%"');
    expect(withoutMsoBlock).toContain('max-width:750px');
    expect(withoutMsoBlock).not.toMatch(/width="750"/);
    expect(withoutMsoBlock).not.toMatch(/style="width:750px/);
  });

  it('gives Outlook its own fixed-width table via an MSO conditional comment, invisible to every other client', () => {
    const html = renderEmailBody(withModules([], 750));
    expect(html).toMatch(/<!--\[if mso\]><table[^>]+width="750"[^>]*>.*?<!\[endif\]-->/s);
  });

  it('a real browser (non-Outlook) sees the MSO block only as an inert HTML comment', () => {
    const html = renderEmailBody(withModules([], 750));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Every 700-fixed-width table from the conditional block was parsed as
    // a comment, not an element — the only <table width="750"> a real
    // browser's DOM would ever contain is none at all (the real content
    // table is width="100%").
    const fixedWidthTables = Array.from(doc.querySelectorAll('table[width="750"]'));
    expect(fixedWidthTables).toHaveLength(0);
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
    // must contain exactly one MORE occurrence of the module outer-wrapper
    // table than the module's raw (unwrapped) renderEmailHtml does — i.e.
    // the outer wrapper was prepended, not skipped. Matches the bare form
    // (no responsive class) or with a `class="m-eb-ID"` attribute — but
    // NOT renderEmailBody's own unrelated outer content table, which
    // shares the same literal prefix but always carries a `style=`
    // attribute instead (see htmlRenderer.ts).
    const OUTER_TABLE_OPEN = /<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"(?: class="[^"]*")?><tr>/g;
    const countOf = (haystack: string) => (haystack.match(OUTER_TABLE_OPEN) ?? []).length;
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

  // Email Document Standards Sub-phase 1.
  it('declares the XHTML, VML, and Office XML namespaces on <html>', () => {
    const html = renderEmailDocument(withModules([]));
    expect(html).toContain('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">');
  });

  it('threads the optional title/faviconUrl through to the <head>', () => {
    const html = renderEmailDocument({ ...withModules([]), title: 'August Newsletter', faviconUrl: 'https://cdn.example.com/fav.png' });
    expect(html).toContain('<title>August Newsletter</title>');
    expect(html).toContain('<link rel="icon" type="image/png" href="https://cdn.example.com/fav.png" />');
  });

  it('omitting title/faviconUrl produces an empty <title> and no favicon link — unchanged from the pre-Sub-phase-1 baseline', () => {
    const html = renderEmailDocument(withModules([]));
    expect(html).toContain('<title></title>');
    expect(html).not.toContain('rel="icon"');
  });

  it('the fluid-width outer table fix still passes every compatibility check (Outlook Safe included)', () => {
    const modules = [
      createModule('layout-2col-50-50', 0),
      createModule('text', 1),
      createModule('button', 2),
      createModule('image', 3),
    ];
    const html = renderEmailDocument(withModules(modules, 700));
    const checks = computeCompatibilityChecks(html);
    for (const check of checks) {
      expect(check.ok, `${check.id}: ${check.detail}`).toBe(true);
    }
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
    expect(html).toContain('width="20"');
    expect(html).toContain('style="width:20px; font-size:0; line-height:0;">&nbsp;</td>');
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

// Email Document Standards Sub-phase 3, items 7/8 — deterministic module
// HTML comments.
describe('renderEmailBody — module HTML comments (Sub-phase 3, item 7)', () => {
  it('wraps a single top-level module in MODULE-1: <REAL REGISTRY LABEL> comments', () => {
    const button = createModule('button', 0);
    const html = renderEmailBody(withModules([button]));
    const label = getModuleDefinition('button').label.toUpperCase();
    expect(html).toContain(`<!--===== MODULE-1: ${label} - START =====-->`);
    expect(html).toContain(`<!--===== MODULE-1: ${label} - ENDS =====-->`);
  });

  it('numbers modules from RENDER order (module.order), not array order and not module type', () => {
    // Array order: button then text. Render (sorted) order: text (order 0)
    // then button (order 1) — MODULE-1 must be the text module.
    const button = createModule('button', 1);
    const text = createModule('text', 0);
    const html = renderEmailBody(withModules([button, text]));
    const textStart = html.indexOf(`MODULE-1: ${getModuleDefinition('text').label.toUpperCase()}`);
    const buttonStart = html.indexOf(`MODULE-2: ${getModuleDefinition('button').label.toUpperCase()}`);
    expect(textStart).toBeGreaterThan(-1);
    expect(buttonStart).toBeGreaterThan(-1);
    expect(textStart).toBeLessThan(buttonStart);
  });

  it('never hard-codes a label independently of the registry — matches getModuleDefinition(type).label exactly', () => {
    const types = ['text', 'button', 'image', 'divider', 'spacer', 'header-logo-nav', 'footer-social-legal'] as const;
    const html = renderEmailBody(withModules(types.map((type, i) => createModule(type, i))));
    types.forEach((type, i) => {
      const label = getModuleDefinition(type).label.toUpperCase();
      expect(html, type).toContain(`MODULE-${i + 1}: ${label}`);
    });
  });

  it('numbering recomputes on every render — never persisted/stale (delete/reorder proof)', () => {
    const a = createModule('text', 0);
    const b = createModule('button', 1);
    const c = createModule('image', 2);
    const initial = renderEmailBody(withModules([a, b, c]));
    expect(initial).toContain(`MODULE-1: ${getModuleDefinition('text').label.toUpperCase()}`);
    expect(initial).toContain(`MODULE-2: ${getModuleDefinition('button').label.toUpperCase()}`);
    expect(initial).toContain(`MODULE-3: ${getModuleDefinition('image').label.toUpperCase()}`);

    // Delete the middle module (b) and re-render — c must renumber to 2.
    const afterDelete = renderEmailBody(withModules([a, { ...c, order: 1 }]));
    expect(afterDelete).toContain(`MODULE-1: ${getModuleDefinition('text').label.toUpperCase()}`);
    expect(afterDelete).toContain(`MODULE-2: ${getModuleDefinition('image').label.toUpperCase()}`);
    expect(afterDelete).not.toContain('MODULE-3:');

    // Reorder (c first, then a) and re-render — numbers follow the new order.
    const reordered = renderEmailBody(withModules([{ ...c, order: 0 }, { ...a, order: 1 }]));
    expect(reordered).toContain(`MODULE-1: ${getModuleDefinition('image').label.toUpperCase()}`);
    expect(reordered).toContain(`MODULE-2: ${getModuleDefinition('text').label.toUpperCase()}`);
  });

  it('a duplicated module gets its own distinct number, not a repeated one', () => {
    const original = createModule('text', 0);
    const duplicate = { ...original, id: `${original.id}-copy`, order: 1 };
    const html = renderEmailBody(withModules([original, duplicate]));
    // 2 each — START and ENDS both carry the number/label.
    expect((html.match(/MODULE-1:/g) ?? []).length).toBe(2);
    expect((html.match(/MODULE-2:/g) ?? []).length).toBe(2);
    expect((html.match(/MODULE-3:/g) ?? []).length).toBe(0);
  });
});

describe('renderEmailBody — nested module HTML comments (Sub-phase 3, item 8)', () => {
  it('a nested module gets MODULE-<parent>.1 — the parent number correctly resolved, never the __PARENT__ placeholder', () => {
    const layout = createModule('layout-2col-50-50', 1); // will be MODULE-2
    const filler = createModule('text', 0); // MODULE-1
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    text.props = { ...text.props, text: 'Nested content' };
    layout.columns![0].modules.push(text as unknown as EmailModule);

    const html = renderEmailBody(withModules([filler, layout]));
    expect(html).toContain(`MODULE-2.1: ${getModuleDefinition('text').label.toUpperCase()}`);
    expect(html).not.toContain('__PARENT__');
  });

  it('multiple nested modules in ONE column are numbered .1, .2 in order', () => {
    const layout = createModule('layout-1col', 0);
    const first = createModule('text', 0);
    const second = createModule('button', 1);
    layout.columns![0].modules.push(first, second);

    const html = renderEmailBody(withModules([layout]));
    expect(html).toContain(`MODULE-1.1: ${getModuleDefinition('text').label.toUpperCase()}`);
    expect(html).toContain(`MODULE-1.2: ${getModuleDefinition('button').label.toUpperCase()}`);
  });

  it('nested numbering runs as ONE continuous counter across columns — column 2 continues, does not restart at .1', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const colOneModule = createModule('text', 0);
    const colTwoModule = createModule('button', 0);
    layout.columns![0].modules.push(colOneModule);
    layout.columns![1].modules.push(colTwoModule);

    const html = renderEmailBody(withModules([layout]));
    expect(html).toContain(`MODULE-1.1: ${getModuleDefinition('text').label.toUpperCase()}`);
    expect(html).toContain(`MODULE-1.2: ${getModuleDefinition('button').label.toUpperCase()}`);
    expect(html).not.toContain('MODULE-1.1: ' + getModuleDefinition('button').label.toUpperCase());
  });

  it('nested comment numbering also recomputes fresh — no persisted/stale nested numbers', () => {
    const layout = createModule('layout-1col', 0);
    const only = createModule('text', 0);
    layout.columns![0].modules.push(only);
    const before = renderEmailBody(withModules([layout]));
    expect(before).toContain('MODULE-1.1:');

    const withExtra = createModule('button', 0);
    layout.columns![0].modules.unshift(withExtra);
    const after = renderEmailBody(withModules([layout]));
    expect(after).toContain(`MODULE-1.1: ${getModuleDefinition('button').label.toUpperCase()}`);
    expect(after).toContain(`MODULE-1.2: ${getModuleDefinition('text').label.toUpperCase()}`);
  });

  it('a layout module with NO nested modules never leaks a __PARENT__ placeholder', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const html = renderEmailBody(withModules([layout]));
    expect(html).not.toContain('__PARENT__');
  });
});

describe('renderEmailBody — one-level-nesting architectural guarantee (Sub-phase 3, item 8)', () => {
  it('a Layout module type cannot itself be inserted as a NESTED module — proves numbering never needs a third level', async () => {
    const { isLayoutModuleType } = await import('./layoutModel');
    // LayoutCanvasModule.tsx gates nested drops with `!isLayoutModuleType(type)`
    // — every layout type must report true here, which is the actual
    // runtime guarantee that prevents a layout from ever being nested
    // inside another layout's column (see layoutModel.ts).
    const layoutTypes = ['layout-1col', 'layout-2col-50-50', 'layout-2col-40-60', 'layout-3col', 'layout-4col', 'layout-5col', 'layout-6col'];
    for (const type of layoutTypes) {
      expect(isLayoutModuleType(type as never), type).toBe(true);
    }
  });

  it('EmailColumn.modules is typed as EmailModule[], never as a column-bearing type recursively — one level only', () => {
    // Structural proof at the data layer: flattenModules-style consumers
    // (emailValidation.ts, this renderer) only ever descend ONE level
    // (module.columns[].modules), never module.columns[].modules[].columns.
    // If a THIRD level existed, a Layout nested inside a Layout would need
    // to render with a `.1.1`-style label — this renderer has no code path
    // for that at all (layoutCatalog.tsx's nested loop calls
    // renderModuleWithOuterStructure, not itself, on each nested module).
    const layout = createModule('layout-1col', 0);
    const innerLayout = createModule('layout-1col', 0);
    layout.columns![0].modules.push(innerLayout);
    const html = renderEmailBody(withModules([layout]));
    // Even if a caller forces this into the tree (bypassing the UI gate),
    // the inner layout still renders as a flat MODULE-1.1 — never .1.1 —
    // proving the renderer itself has no third-level numbering logic.
    expect(html).toContain(`MODULE-1.1: ${getModuleDefinition('layout-1col').label.toUpperCase()}`);
    expect(html).not.toMatch(/MODULE-1\.1\.\d/);
  });
});

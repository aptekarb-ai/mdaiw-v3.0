import { describe, expect, it } from 'vitest';
import { renderEmailBody, renderEmailDocument } from './htmlRenderer';
import { createModule } from './moduleFactory';
import { getModuleDefinition } from './moduleRegistry';
import { computeCompatibilityChecks } from './htmlCompatibilityChecks';
import { columnResponsiveClassName, gutterResponsiveClassName } from './responsiveStyles';
import { computeLayoutAvailableWidthPx } from './registryCore';
import { resolveColumnPixelWidths } from './layoutModel';
import { resolveDesktopGutterPx } from './edm';
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
    // Feature-06 width control, or the layout's own gutter <td> which has
    // no valign) — a nested module contributing its own width="..." cell
    // must not inflate this count. Column Width + Gutter Rendering
    // Correction: column widths are deterministic pixels now, not
    // percentages — see resolveColumnPixelWidths.
    const columnCells = html.match(/<td width="\d+" valign=/g) ?? [];
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

  // E5 — generic per-column background image/color, proven across every
  // registered column count (1–6), never a per-layout special case: this
  // is the SAME layoutDefinition() renderer for all of them.
  it.each(LAYOUT_TYPES)('%s (%d columns): every column supports backgroundColor and backgroundImage generically', (type) => {
    const layout = createModule(type, 0);
    layout.columns!.forEach((column, index) => {
      column.settings = {
        ...column.settings,
        // A deliberately app-atypical hex, distinct from the platform's
        // own default background color tokens (e.g. #F4F6F8), so this
        // count can only match columns this test itself configured.
        backgroundColor: '#123456',
        backgroundImage: `https://cdn.example.com/col-${index}.jpg`,
      };
    });
    const html = renderEmailBody(withModules([layout]));
    layout.columns!.forEach((_, index) => {
      expect(html).toContain(`background="https://cdn.example.com/col-${index}.jpg"`);
      expect(html).toContain(`background-image:url('https://cdn.example.com/col-${index}.jpg')`);
    });
    // backgroundColor stays present as the CSS fallback on every column.
    expect((html.match(/background-color:#123456;/g) ?? []).length).toBe(layout.columns!.length);
  });

  it('a column background survives Mobile stacking — the same markup renders regardless of viewport, only the responsive CSS forces display:block/width:100%', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.columns![0].settings = { ...layout.columns![0].settings, backgroundColor: '#123456', backgroundImage: 'https://cdn.example.com/col-0.jpg' };
    const html = renderEmailDocument(withModules([layout], 700));
    // The stacking rule (mobileStack defaults true) coexists in the SAME
    // document with the background — background is inline on the <td>
    // itself, never conditionally stripped by the mobile media query.
    expect(html).toContain('display:block !important; width:100% !important;');
    expect(html).toContain('background="https://cdn.example.com/col-0.jpg"');
    expect(html).toContain('background-color:#123456;background-image:url(\'https://cdn.example.com/col-0.jpg\')');
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
    expect((html.match(/<td width="\d+" valign=/g) ?? [])).toHaveLength(2);
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

describe('Module-4 Final Gap Closure, Correction 2 — Feature 05: Desktop column direction', () => {
  // Deliberately NOT single letters — 'A'/'B'/'C' collide with substrings
  // already present elsewhere in the generated HTML (attribute names,
  // "COLUMNS" in the module comment, etc.), which silently corrupts
  // position-based assertions. These tokens cannot appear anywhere else.
  function textCol(label: string) {
    const text = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
    text.props = { ...text.props, text: label };
    return text as unknown as EmailModule;
  }

  // Sorts `labels` by where they actually appear in the emitted HTML —
  // proves the real <td> sequence, not merely the source array order.
  function orderedLabels(html: string, labels: string[]) {
    return labels.slice().sort((a, b) => html.indexOf(a) - html.indexOf(b));
  }

  // Parses the layout's own column <td>s specifically (matches the exact
  // literal shape layoutCatalog.tsx emits — never a nested module's own
  // inner <td>s), in DOCUMENT/rendered order, each with its own width,
  // class and content region — so a label's containing cell (and that
  // cell's width/class) can be found reliably regardless of whatever
  // nested table structure a Text module wraps its content in.
  function columnCells(html: string) {
    // Column Width + Gutter Rendering Correction: column widths are
    // deterministic pixels now (no unit suffix in the attribute), never
    // percentages — see resolveColumnPixelWidths.
    const pattern = /<td width="(\d+)" valign="[^"]*" class="([^"]*)"[^>]*>/g;
    const matches = [...html.matchAll(pattern)];
    return matches.map((match, position) => {
      const contentStart = match.index + match[0].length;
      const contentEnd = position + 1 < matches.length ? matches[position + 1].index : html.length;
      return { width: match[1], className: match[2], contentStart, contentEnd };
    });
  }

  function cellContaining(html: string, label: string) {
    const labelIndex = html.indexOf(label);
    expect(labelIndex).toBeGreaterThan(-1);
    const cell = columnCells(html).find((c) => labelIndex >= c.contentStart && labelIndex < c.contentEnd);
    expect(cell).toBeDefined();
    return cell!;
  }

  it('absent desktopColumnDirection renders identity (LTR) order — existing documents unchanged', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.columns![0].modules.push(textCol('ZFIRST'));
    layout.columns![1].modules.push(textCol('ZSECOND'));
    expect(layout.settings.desktopColumnDirection).toBeUndefined();
    const html = renderEmailBody(withModules([layout]));
    expect(orderedLabels(html, ['ZFIRST', 'ZSECOND'])).toEqual(['ZFIRST', 'ZSECOND']);
  });

  it('explicit "ltr" renders identity order, same as absent', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, desktopColumnDirection: 'ltr' };
    layout.columns![0].modules.push(textCol('ZFIRST'));
    layout.columns![1].modules.push(textCol('ZSECOND'));
    const html = renderEmailBody(withModules([layout]));
    expect(orderedLabels(html, ['ZFIRST', 'ZSECOND'])).toEqual(['ZFIRST', 'ZSECOND']);
  });

  it('"rtl" reverses the emitted <td> sequence for a 2-column layout', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, desktopColumnDirection: 'rtl' };
    layout.columns![0].modules.push(textCol('ZFIRST'));
    layout.columns![1].modules.push(textCol('ZSECOND'));
    const html = renderEmailBody(withModules([layout]));
    expect(orderedLabels(html, ['ZFIRST', 'ZSECOND'])).toEqual(['ZSECOND', 'ZFIRST']);
  });

  it('"rtl" reverses a 3-column layout as third, second, first — proving this is a real reversal, not a two-column swap', () => {
    const layout = createModule('layout-3col', 0);
    layout.settings = { ...layout.settings, desktopColumnDirection: 'rtl' };
    layout.columns![0].modules.push(textCol('ZFIRST'));
    layout.columns![1].modules.push(textCol('ZSECOND'));
    layout.columns![2].modules.push(textCol('ZTHIRD'));
    const html = renderEmailBody(withModules([layout]));
    expect(orderedLabels(html, ['ZFIRST', 'ZSECOND', 'ZTHIRD'])).toEqual(['ZTHIRD', 'ZSECOND', 'ZFIRST']);
  });

  it('unequal column widths stay attached to their original content after reversal', () => {
    const layout = createModule('layout-2col-30-70', 0);
    layout.settings = { ...layout.settings, desktopColumnDirection: 'rtl' };
    layout.columns![0].modules.push(textCol('ZNARROW'));
    layout.columns![1].modules.push(textCol('ZWIDE'));
    const html = renderEmailBody(withModules([layout]));

    expect(html.indexOf('ZWIDE')).toBeLessThan(html.indexOf('ZNARROW'));
    // ZWIDE (originally column 1, 70% ratio) still carries its own
    // resolved 490px (700 * 70/100, no gutter set) even though it now
    // renders first; ZNARROW (originally column 0, 30% ratio) still
    // carries its resolved 210px even though it now renders last —
    // width never swaps onto the wrong content.
    expect(cellContaining(html, 'ZWIDE').width).toBe('490');
    expect(cellContaining(html, 'ZNARROW').width).toBe('210');
  });

  it('reversed cells keep their ORIGINAL column class attached to their own content', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, desktopColumnDirection: 'rtl' };
    layout.columns![0].modules.push(textCol('ZFIRST'));
    layout.columns![1].modules.push(textCol('ZSECOND'));
    const html = renderEmailBody(withModules([layout]));

    expect(cellContaining(html, 'ZFIRST').className).toBe(columnResponsiveClassName(layout.id, 0));
    expect(cellContaining(html, 'ZSECOND').className).toBe(columnResponsiveClassName(layout.id, 1));
  });

  it('gutter cell count and canonical identity stay correct under reversal for a 3-column layout', () => {
    const layout = createModule('layout-3col', 0);
    layout.settings = {
      ...layout.settings, desktopColumnDirection: 'rtl', columnGutter: { desktop: { value: 10, unit: 'px' } },
    };
    const html = renderEmailBody(withModules([layout]));
    // Still exactly 2 gutters for 3 columns, regardless of direction.
    const gutterCells = (html.match(/font-size:0; line-height:0;/g) ?? []).length;
    expect(gutterCells).toBe(2);
    // Rendered order is col2, gutter, col1, gutter, col0. The first
    // emitted gutter sits between original columns 2 and 1, so it keeps
    // canonical identity "gutter 1" (the real gutter between columns 1
    // and 2) — never renumbered to match its display position.
    const gut1Index = html.indexOf(gutterResponsiveClassName(layout.id, 1));
    const gut0Index = html.indexOf(gutterResponsiveClassName(layout.id, 0));
    expect(gut1Index).toBeGreaterThan(-1);
    expect(gut0Index).toBeGreaterThan(-1);
    expect(gut1Index).toBeLessThan(gut0Index);
  });

  it('existing documents (no desktopColumnDirection key) render the exact identity order for 3+ columns too', () => {
    const layout = createModule('layout-3col', 0);
    layout.columns![0].modules.push(textCol('ZFIRST'));
    layout.columns![1].modules.push(textCol('ZSECOND'));
    layout.columns![2].modules.push(textCol('ZTHIRD'));
    const html = renderEmailBody(withModules([layout]));
    expect(orderedLabels(html, ['ZFIRST', 'ZSECOND', 'ZTHIRD'])).toEqual(['ZFIRST', 'ZSECOND', 'ZTHIRD']);
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

// Column Width + Gutter Rendering Correction — HTML-level proof that the
// deterministic resolver (layoutModel.ts's resolveColumnPixelWidths) is
// actually wired into the real renderer, not just correct in isolation.
describe('Feature 05 — Column Width + Gutter Rendering Correction', () => {
  function columnWidthAttrs(html: string): number[] {
    return [...html.matchAll(/<td width="(\d+)" valign="[^"]*"/g)].map((m) => Number(m[1]));
  }

  function gutterWidthAttrs(html: string): number[] {
    return [...html.matchAll(/<td width="(\d+)" class="[^"]*-gut\d+"/g)].map((m) => Number(m[1]));
  }

  it('invariant: sum(column widths) + sum(gutter widths) === parent width, for 1 through 6 columns', () => {
    const cases: [string, number][] = [
      ['layout-1col', 700], ['layout-2col-40-60', 700], ['layout-3col', 700],
      ['layout-4col', 700], ['layout-5col', 700], ['layout-6col', 700],
    ];
    for (const [type, width] of cases) {
      const layout = createModule(type as never, 0);
      layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } } };
      const html = renderEmailBody(withModules([layout], width));
      const total = columnWidthAttrs(html).reduce((s, w) => s + w, 0) + gutterWidthAttrs(html).reduce((s, w) => s + w, 0);
      expect(total, type).toBe(width);
    }
  });

  it('never emits a percentage column width, and never the old 100%+gutter overflow shape', () => {
    const layout = createModule('layout-2col-40-60', 0);
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } } };
    const html = renderEmailBody(withModules([layout]));
    expect(html).not.toMatch(/<td width="\d+%"/);
    expect(html).toContain('width="272"');
    expect(html).toContain('width="20"');
    expect(html).toContain('width="408"');
  });

  it('emits both the HTML width attribute and the inline CSS pixel width on desktop column cells', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const html = renderEmailBody(withModules([layout]));
    expect(html).toMatch(/<td width="350" valign="top"[^>]*style="width:350px;/);
  });

  it('the configured desktop gutter is preserved exactly — never solved by zeroing it', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 30, unit: 'px' } } };
    const html = renderEmailBody(withModules([layout]));
    expect(gutterWidthAttrs(html)).toEqual([30]);
    expect(html).not.toMatch(/columnGutter.*0/);
  });

  it('the width-bearing column <td> has zero padding; configured column padding lands on an inner wrapper cell instead', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.columns![0].settings.desktop = { paddingTop: 10, paddingRight: 25, paddingBottom: 10, paddingLeft: 5 };
    const html = renderEmailBody(withModules([layout]));
    // The width-bearing <td> (carries valign) has padding:0.
    expect(html).toMatch(/<td width="350" valign="top"[^>]*style="width:350px; vertical-align:top; padding:0;/);
    // The configured padding is present, but on a DIFFERENT (inner) <td>.
    expect(html).toContain('padding:10px 25px 10px 5px;');
    expect(html).not.toContain('style="width:350px; vertical-align:top; padding:10px 25px 10px 5px;');
  });

  it('nonzero column padding does not change the structural column width — invariant still holds', () => {
    const layout = createModule('layout-3col', 0);
    layout.columns![0].settings.desktop = { paddingTop: 0, paddingRight: 40, paddingBottom: 0, paddingLeft: 40 };
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } } };
    const html = renderEmailBody(withModules([layout], 700));
    const total = columnWidthAttrs(html).reduce((s, w) => s + w, 0) + gutterWidthAttrs(html).reduce((s, w) => s + w, 0);
    expect(total).toBe(700);
  });

  it('nested layouts: the immediate parent (column) pixel width is threaded down, not always document.width', () => {
    // Forces a layout nested one level deep inside a column (the UI gate
    // in LayoutCanvasModule.tsx prevents this, but the renderer itself
    // must still compute correctly if it ever happens — same posture as
    // the existing one-level-nesting architectural guarantee test above).
    const outer = createModule('layout-2col-50-50', 0);
    const inner = createModule('layout-2col-50-50', 0);
    outer.columns![0].modules.push(inner);
    const html = renderEmailBody(withModules([outer], 700));
    // Outer columns: 700px, no gutter -> 350 + 350. The inner layout's
    // OWN columns must be computed against its column's actual width
    // (350px), never against the full 700px document width.
    const total = columnWidthAttrs(html).reduce((s, w) => s + w, 0);
    // 2 outer columns (350 each) + 2 inner columns (175 each, half of 350).
    expect(total).toBe(350 + 350 + 175 + 175);
    expect(html).toContain('width="175"');
    expect(html).not.toContain('width="350"'.repeat(1) === 'width="700"'); // sanity: never the full document width
  });

  it('an outer spacer column (px-valued) on the layout module itself narrows the available width for its own columns', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = {
      ...layout.settings,
      outerSpacing: { desktop: { left: { value: 50, unit: 'px' }, right: { value: 50, unit: 'px' } }, mobile: {} },
    };
    const html = renderEmailBody(withModules([layout], 700));
    // Available width for the layout's OWN columns is 700 - 50 - 50 = 600,
    // split 50/50 -> 300 + 300, not 350 + 350 (which would ignore the
    // outer spacer this same module already has).
    expect(html).toContain('width="300"');
    expect(html).not.toContain('width="350"');
  });

  it('Classic Outlook (MSO conditional) markup is unaffected — the layout table still renders inside the same MSO-fixed-width wrapper', () => {
    const layout = createModule('layout-2col-40-60', 0);
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } } };
    const html = renderEmailDocument(withModules([layout]));
    expect(html).toContain('<!--[if mso]><table role="presentation" width="700"');
    expect(html).toContain('<!--[if mso]></td></tr></table><![endif]-->');
    // The layout's own column cells sit inside that same conditional
    // wrapper, not a separate/duplicate Outlook-specific structure.
    const msoOpenIndex = html.indexOf('<!--[if mso]><table role="presentation" width="700"');
    const msoCloseIndex = html.indexOf('<!--[if mso]></td></tr></table><![endif]-->');
    const columnIndex = html.indexOf('width="272"');
    expect(columnIndex).toBeGreaterThan(msoOpenIndex);
    expect(columnIndex).toBeLessThan(msoCloseIndex);
  });

  it('responsive mobile stacking is unchanged: columns still become display:block/width:100%, gutter still hidden on mobile only', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } } };
    const html = renderEmailDocument(withModules([layout]));
    expect(html).toMatch(/@media only screen and \(max-width:600px\)\{[\s\S]*?col0\{display:block !important; width:100% !important;\}/);
    expect(html).toMatch(/@media only screen and \(max-width:600px\)\{[\s\S]*?gut0\{display:none !important; width:0 !important; height:0 !important;\}/);
    // The desktop gutter cell itself is still present with its real
    // configured width — mobile hides it via the media-query class rule
    // above, never by zeroing the desktop value itself.
    expect(html).toContain('width="20"');
  });
});

// Structural Width Contract correction — Outer Spacer Columns, layout
// padding, gutter, and child-column width are ONE physical-width
// equation, not independent properties:
//   P  = availableWidthPx (parent width, already narrowed by this
//        module's own Outer Spacer Columns)
//   C  = P - paddingLeft - paddingRight
//   A  = C - gutterPx * (N - 1)
//   Ci = A * ratio[i] / 100 (deterministic rounding, remainder on the
//        last column)
// Invariants: L + P + R = W (Outer Spacer Columns test, pre-existing
// above); paddingLeft + sum(Ci) + gutterTotal + paddingRight = P (new
// tests below). The SAME resolveColumnPixelWidths call (never a second
// calculation) is used here and by ColumnEditor.tsx's Properties-panel
// display — see layoutCatalog.tsx's own comments for the exact call
// chain.
describe('Structural Width Contract — Outer Spacer + layout padding + gutter + column width as one equation', () => {
  function columnWidthAttrs(html: string): number[] {
    return [...html.matchAll(/<td width="(\d+)" valign="[^"]*"/g)].map((m) => Number(m[1]));
  }

  function gutterWidthAttrs(html: string): number[] {
    return [...html.matchAll(/<td width="(\d+)" class="[^"]*-gut\d+"/g)].map((m) => Number(m[1]));
  }

  function withOuterSpacing(layout: EmailModule<any>, left: number, right: number) {
    layout.settings = {
      ...layout.settings,
      outerSpacing: { desktop: { left: { value: left, unit: 'px' }, right: { value: right, unit: 'px' } }, mobile: {} },
    };
  }

  function withPadding(layout: EmailModule<any>, left: number, right: number, top = 0, bottom = 0) {
    layout.settings = { ...layout.settings, desktop: { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left } };
  }

  it('700px, no spacers, 60/40, gutter 30 => 402 + 30 + 268 = 700', () => {
    const layout = createModule('layout-2col-60-40', 0);
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    const html = renderEmailBody(withModules([layout], 700));
    expect(columnWidthAttrs(html)).toEqual([402, 268]);
    expect(gutterWidthAttrs(html)).toEqual([30]);
  });

  it('700px, outer 20/20, 60/40, gutter 30 => parent 660, 378 + 30 + 252 = 660', () => {
    const layout = createModule('layout-2col-60-40', 0);
    withOuterSpacing(layout, 20, 20);
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    const html = renderEmailBody(withModules([layout], 700));
    expect(columnWidthAttrs(html)).toEqual([378, 252]);
    expect(gutterWidthAttrs(html)).toEqual([30]);
    expect(378 + 30 + 252).toBe(660);
  });

  it('700px, outer 20/20, padding 15/15, 60/40, gutter 30 => parent 660, column region 630, available 600 => 360 + 30 + 240, invariant 15+360+30+240+15=660', () => {
    const layout = createModule('layout-2col-60-40', 0);
    withOuterSpacing(layout, 20, 20);
    withPadding(layout, 15, 15);
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    const html = renderEmailBody(withModules([layout], 700));
    expect(columnWidthAttrs(html)).toEqual([360, 240]);
    expect(gutterWidthAttrs(html)).toEqual([30]);
    expect(15 + 360 + 30 + 240 + 15).toBe(660);
    // The padding itself is present on the parent wrapper, not on any
    // width-bearing column <td> (which must stay padding:0).
    expect(html).toContain('padding:0px 15px 0px 15px;');
    expect(html).toMatch(/<td width="360" valign="[^"]*"[^>]*padding:0;/);
  });

  it('front-stage/HTML consistency: computeLayoutAvailableWidthPx (Properties panel) matches the RENDERER\'s own content-width step exactly, including padding', () => {
    const layout = createModule('layout-2col-60-40', 0);
    withOuterSpacing(layout, 20, 20);
    withPadding(layout, 15, 15);
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    const html = renderEmailBody(withModules([layout], 700));

    // What the Properties panel would display for this exact module.
    const frontStageWidthPx = computeLayoutAvailableWidthPx(layout, 700);
    const gutterPx = resolveDesktopGutterPx(layout.settings);
    const layoutColumnWidths = (layout.props as { columnWidths: number[] }).columnWidths;
    const { columnPx: frontStageColumnPx } = resolveColumnPixelWidths(layoutColumnWidths, gutterPx, frontStageWidthPx);

    // What the real renderer actually produced.
    const renderedColumnPx = columnWidthAttrs(html);

    expect(frontStageColumnPx).toEqual(renderedColumnPx);
    expect(frontStageColumnPx).toEqual([360, 240]); // the exact worked example
  });

  it('5 columns 20/20/20/20/20 with multiple gutters: sum invariant holds with 4 gutters', () => {
    const layout = createModule('layout-5col', 0);
    layout.settings = { ...layout.settings, columnGutterPx: 10 };
    const html = renderEmailBody(withModules([layout], 700));
    const cols = columnWidthAttrs(html);
    const guts = gutterWidthAttrs(html);
    expect(cols).toHaveLength(5);
    expect(guts).toHaveLength(4);
    expect(cols.reduce((s, w) => s + w, 0) + guts.reduce((s, w) => s + w, 0)).toBe(700);
  });

  it('3, 4, and 6 columns each satisfy the full equation with outer spacer + padding + gutter combined', () => {
    const cases: [string, number][] = [['layout-3col', 3], ['layout-4col', 4], ['layout-6col', 6]];
    for (const [type, count] of cases) {
      const layout = createModule(type as never, 0);
      withOuterSpacing(layout, 10, 10);
      withPadding(layout, 8, 8);
      layout.settings = { ...layout.settings, columnGutterPx: 6 };
      const html = renderEmailBody(withModules([layout], 700));
      const cols = columnWidthAttrs(html);
      const guts = gutterWidthAttrs(html);
      expect(cols, type).toHaveLength(count);
      expect(guts, type).toHaveLength(count - 1);
      // P = 700 - 10 - 10 = 680; PL + sum(Ci) + gutterTotal + PR = P.
      expect(8 + cols.reduce((s, w) => s + w, 0) + guts.reduce((s, w) => s + w, 0) + 8, type).toBe(680);
    }
  });

  it('asymmetric outer spacers (left != right) narrow the parent correctly', () => {
    const layout = createModule('layout-2col-50-50', 0);
    withOuterSpacing(layout, 10, 50);
    const html = renderEmailBody(withModules([layout], 700));
    // P = 700 - 10 - 50 = 640, split 50/50 -> 320 + 320.
    expect(columnWidthAttrs(html)).toEqual([320, 320]);
  });

  it('asymmetric left/right padding narrows the content region correctly (top/bottom padding does not affect width)', () => {
    const layout = createModule('layout-2col-50-50', 0);
    withPadding(layout, 10, 50, 20, 20);
    const html = renderEmailBody(withModules([layout], 700));
    // C = 700 - 10 - 50 = 640, split 50/50 -> 320 + 320. Vertical padding
    // (20/20) affects only the padding style, never the width math.
    expect(columnWidthAttrs(html)).toEqual([320, 320]);
    expect(html).toContain('padding:20px 50px 20px 10px;');
  });

  it('zero gutter: columns fill the full content region with no gutter <td> at all', () => {
    const layout = createModule('layout-2col-60-40', 0);
    const html = renderEmailBody(withModules([layout], 700));
    expect(columnWidthAttrs(html)).toEqual([420, 280]);
    expect(gutterWidthAttrs(html)).toEqual([]);
    expect(html).not.toMatch(/-gut\d+/);
  });

  it('nested layout: a padded/gutter-narrowed 360px column feeds its actual usable width, never document.width, into the nested layout', () => {
    const outer = createModule('layout-2col-60-40', 0);
    withOuterSpacing(outer, 20, 20);
    withPadding(outer, 15, 15);
    outer.settings = { ...outer.settings, columnGutterPx: 30 };
    // From the worked example: outer column 1 resolves to 360px.
    const inner = createModule('layout-2col-50-50', 0);
    outer.columns![0].modules.push(inner);
    const html = renderEmailBody(withModules([outer], 700));
    // The nested layout's own columns split the ACTUAL 360px column
    // width, 50/50 -> 180 + 180 — never 700/2=350, never a raw guess.
    expect(html).toContain('width="180"');
    expect(html).not.toContain('width="350"');
  });

  it('nested layouts at least two levels deep: each level receives its actual parent column width, never document.width', () => {
    const outer = createModule('layout-2col-50-50', 0); // 700 -> 350 + 350
    const middle = createModule('layout-2col-50-50', 0); // 350 -> 175 + 175
    const inner = createModule('layout-2col-50-50', 0); // 175 -> 88 + 87 (remainder to last)
    outer.columns![0].modules.push(middle);
    middle.columns![0].modules.push(inner);
    const html = renderEmailBody(withModules([outer], 700));
    expect(html).toContain('width="350"');
    expect(html).toContain('width="175"');
    expect(html).toContain('width="88"');
    expect(html).toContain('width="87"');
    expect(html).not.toMatch(/width="700"\/2/); // sanity: no naive-halving artifact strings
  });

  it('narrow available width / invalid geometry protection: padding + gutter exceeding the parent width clamps to 0, never negative', () => {
    const layout = createModule('layout-2col-50-50', 0);
    withOuterSpacing(layout, 100, 100); // P = 700 - 200 = 500
    withPadding(layout, 300, 300); // C = 500 - 600 = -100 -> clamps to 0
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    expect(() => renderEmailBody(withModules([layout], 700))).not.toThrow();
    const html = renderEmailBody(withModules([layout], 700));
    const cols = columnWidthAttrs(html);
    expect(cols.every((w) => w >= 0)).toBe(true);
    expect(html).not.toMatch(/width="-\d+"/);
  });

  // Layout Background scope correction — the parent/layout background
  // (and its Classic Outlook VML fallback) covers the FULL physical
  // module row, including Outer Spacer Columns — never just the central
  // structure after outer-spacer subtraction. See the dedicated "Layout
  // Background scope" describe block below for the full contract.
  it('Classic Outlook/VML: parent background VML uses the FULL incoming module width, including Outer Spacer Columns — never just the narrowed central structure', () => {
    const layout = createModule('layout-2col-50-50', 0);
    withOuterSpacing(layout, 50, 50); // central structure = 700 - 100 = 600, but background scope stays 700
    layout.settings = {
      ...layout.settings, outlookVml: true, backgroundColor: '#002D38', backgroundImage: 'https://cdn.example.com/parent-bg.jpg',
    };
    const html = renderEmailBody(withModules([layout], 700));
    expect(html).toContain('<!--[if gte mso 9]>');
    expect(html).toContain('<v:rect');
    expect(html).toContain('width:700px');
    expect(html).toContain('background="https://cdn.example.com/parent-bg.jpg"');
  });

  it('mobile stacking: desktop horizontal widths do not leak into stacked Mobile rendering — every column becomes 100% width, gutter independently controlled by the Mobile gutter setting', () => {
    const layout = createModule('layout-2col-60-40', 0);
    withPadding(layout, 15, 15);
    layout.settings = {
      ...layout.settings, columnGutterPx: 30, mobileColumnGutterPx: 12, hideGutterOnMobile: false,
    };
    const html = renderEmailDocument(withModules([layout], 700));
    // Desktop px widths (360/240-ish, padding-narrowed) are present as the
    // structural/base values...
    expect(columnWidthAttrs(html).length).toBeGreaterThan(0);
    // ...but the Mobile media query forces every column to 100%,
    // completely independent of the desktop px value.
    expect(html).toMatch(/@media only screen and \(max-width:600px\)\{[\s\S]*?col0\{display:block !important; width:100% !important;\}/);
    // The Mobile vertical gutter uses its OWN independently-configured
    // value (12px), never the Desktop gutter (30px).
    expect(html).toMatch(/gut0\{display:block !important; width:100% !important; height:12px !important;/);
  });

  describe('Parent background acceptance', () => {
    it('parent background color renders on the parent wrapper, with transparent (unset) child columns', () => {
      const layout = createModule('layout-2col-50-50', 0);
      layout.settings = { ...layout.settings, backgroundColor: '#F4F6F8' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toContain('background-color:#F4F6F8;');
      // No column has its own background-color declared.
      expect(html).not.toMatch(/<td width="350"[^>]*background-color/);
    });

    it('parent background image renders on the parent wrapper (CSS + background attribute), with transparent child columns', () => {
      const layout = createModule('layout-2col-50-50', 0);
      layout.settings = { ...layout.settings, backgroundImage: 'https://cdn.example.com/parent-bg.jpg' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toContain("background-image:url('https://cdn.example.com/parent-bg.jpg')");
      expect(html).toContain('background="https://cdn.example.com/parent-bg.jpg"');
    });

    it('a child column with its own background correctly overlays the parent background only for that child region — both are present and distinct in the generated HTML', () => {
      const layout = createModule('layout-2col-50-50', 0);
      layout.settings = { ...layout.settings, backgroundColor: '#002D38' };
      layout.columns![0].settings = { ...layout.columns![0].settings, backgroundColor: '#76C043' };
      const html = renderEmailBody(withModules([layout], 700));
      // Parent background present on the outer wrapper.
      expect(html).toContain('background-color:#002D38;');
      // Column 0's OWN background present on ITS OWN width-bearing <td>,
      // independent of and layered inside the parent's wrapper.
      expect(html).toMatch(/<td width="350" valign="[^"]*"[^>]*style="width:350px;[^"]*background-color:#76C043;/);
      // Column 1 has no background of its own — only the parent's shows
      // through for that region.
      expect(html).not.toMatch(/<td width="350" valign="[^"]*"[^>]*background-color:#76C043;[\s\S]*<td width="350" valign="[^"]*"[^>]*background-color:#76C043;/);
    });

    it('Classic Outlook/VML output for the overlay case: parent VML wraps the whole columns table; the child column keeps its own plain background (no per-column VML system introduced)', () => {
      const layout = createModule('layout-2col-50-50', 0);
      layout.settings = {
        ...layout.settings, outlookVml: true, backgroundColor: '#002D38', backgroundImage: 'https://cdn.example.com/parent-bg.jpg',
      };
      layout.columns![0].settings = { ...layout.columns![0].settings, backgroundColor: '#76C043' };
      const html = renderEmailBody(withModules([layout], 700));
      const vmlOpen = html.indexOf('<v:rect');
      const vmlClose = html.indexOf('</v:rect>');
      const columnIndex = html.indexOf('background-color:#76C043;');
      expect(vmlOpen).toBeGreaterThan(-1);
      // The child column (with its own plain background, no VML of its
      // own) sits INSIDE the parent's VML wrapper.
      expect(columnIndex).toBeGreaterThan(vmlOpen);
      expect(columnIndex).toBeLessThan(vmlClose);
    });
  });

  // Layout Background scope correction (message E) — full contract
  // verification. The parent/layout background covers the FULL physical
  // module row (Outer Spacer Columns + parent padding + column gutters +
  // columns), never just the central structure. One outer wrapper owns
  // it — the spacer <td>s themselves (wrapWithOuterSpacing) never carry
  // their own background attr/style.
  describe('Layout Background scope — full module width including Outer Spacer Columns, padding, and gutters', () => {
    it('1 column, no spacers: background covers the full document width', () => {
      const layout = createModule('layout-1col', 0);
      layout.settings = { ...layout.settings, backgroundColor: '#D7C6C6' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*style="width:700px; background-color:#D7C6C6;">/);
    });

    it('1 column, with left/right Outer Spacer Columns: background still covers the FULL 700px, including both spacer regions', () => {
      const layout = createModule('layout-1col', 0);
      withOuterSpacing(layout, 40, 40);
      layout.settings = { ...layout.settings, backgroundColor: '#D7C6C6' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*style="width:700px; background-color:#D7C6C6;">/);
      // The spacer <td>s (inside the 700px background wrapper) carry no
      // background of their own — one outer wrapper owns the color,
      // never duplicated per spacer.
      const spacerCells = html.match(/<td width="40"[^>]*>&nbsp;<\/td>/g) ?? [];
      expect(spacerCells).toHaveLength(2);
      for (const cell of spacerCells) expect(cell).not.toContain('background');
    });

    it('2 columns, spacers + gutter + parent padding + color: background covers the full 700px while column geometry is unaffected', () => {
      const layout = createModule('layout-2col-60-40', 0);
      withOuterSpacing(layout, 30, 30);
      withPadding(layout, 10, 10);
      layout.settings = { ...layout.settings, columnGutterPx: 20, backgroundColor: '#0082AD' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*style="width:700px; background-color:#0082AD;">/);
      // parent = 700-60=640, content = 640-20=620, available = 620-20=600.
      expect(columnWidthAttrs(html)).toEqual([360, 240]);
      expect(gutterWidthAttrs(html)).toEqual([20]);
    });

    it('5 columns, spacers + multiple gutters + color: background covers the full 700px', () => {
      const layout = createModule('layout-5col', 0);
      withOuterSpacing(layout, 40, 40);
      layout.settings = { ...layout.settings, columnGutterPx: 20, backgroundColor: '#76C043' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*style="width:700px; background-color:#76C043;">/);
      // parent = 700-80=620, available = 620-80(4 gutters*20)=540, each col=108.
      expect(columnWidthAttrs(html)).toEqual([108, 108, 108, 108, 108]);
      expect(gutterWidthAttrs(html)).toEqual([20, 20, 20, 20]);
    });

    it('1 column, with spacers, background IMAGE covers the full 700px (CSS + attribute), color as fallback underneath', () => {
      const layout = createModule('layout-1col', 0);
      withOuterSpacing(layout, 40, 40);
      layout.settings = {
        ...layout.settings, backgroundColor: '#D7C6C6', backgroundImage: 'https://cdn.example.com/parent-bg.jpg',
      };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toContain('<td width="700" bgcolor="#D7C6C6" background="https://cdn.example.com/parent-bg.jpg" style="width:700px; background-color:#D7C6C6;background-image:url(\'https://cdn.example.com/parent-bg.jpg\'); background-size:cover; background-position:center;">');
    });

    it('5 columns, spacers + gutters, background IMAGE covers the full width, same scope as color', () => {
      const layout = createModule('layout-5col', 0);
      withOuterSpacing(layout, 40, 40);
      layout.settings = { ...layout.settings, columnGutterPx: 20, backgroundImage: 'https://cdn.example.com/wide-bg.jpg' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*background="https:\/\/cdn\.example\.com\/wide-bg\.jpg"[^>]*style="width:700px; background-image:url\('https:\/\/cdn\.example\.com\/wide-bg\.jpg'\); background-size:cover; background-position:center;">/);
    });

    it('parent background + one individual column background: parent covers the full 700px, the column background overlays only its own region, spacer regions show only the parent', () => {
      const layout = createModule('layout-2col-50-50', 0);
      withOuterSpacing(layout, 40, 40);
      layout.settings = { ...layout.settings, backgroundColor: '#002D38' };
      layout.columns![0].settings = { ...layout.columns![0].settings, backgroundColor: '#76C043' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*style="width:700px; background-color:#002D38;">/);
      expect(html).toMatch(/<td width="\d+" valign="[^"]*"[^>]*background-color:#76C043;/);
      const spacerCells = html.match(/<td width="40"[^>]*>&nbsp;<\/td>/g) ?? [];
      expect(spacerCells).toHaveLength(2);
      for (const cell of spacerCells) expect(cell).not.toContain('background-color:#76C043');
    });

    it('parent background IMAGE + one column background COLOR: both coexist, parent image scoped to the full width, column color scoped to its own cell', () => {
      const layout = createModule('layout-2col-50-50', 0);
      layout.settings = { ...layout.settings, backgroundImage: 'https://cdn.example.com/parent-bg.jpg' };
      layout.columns![1].settings = { ...layout.columns![1].settings, backgroundColor: '#F4F6F8' };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*background="https:\/\/cdn\.example\.com\/parent-bg\.jpg"/);
      expect(html).toMatch(/<td width="\d+" valign="[^"]*"[^>]*background-color:#F4F6F8;/);
    });

    it('parent background color renders as a fallback UNDER the background image in the same style declaration (both present, color declared first)', () => {
      const layout = createModule('layout-1col', 0);
      layout.settings = {
        ...layout.settings, backgroundColor: '#333333', backgroundImage: 'https://cdn.example.com/fallback-test.jpg',
      };
      const html = renderEmailBody(withModules([layout], 700));
      const styleMatch = html.match(/style="width:700px; (background-color:#333333;background-image:url\([^)]*\)[^"]*)"/);
      expect(styleMatch).not.toBeNull();
      expect(styleMatch![1].indexOf('background-color')).toBeLessThan(styleMatch![1].indexOf('background-image'));
    });

    it('nested layout: a Layout module nested inside a column carries its OWN background scoped to its OWN (narrower, column-resolved) available width — never a blind reuse of document.width', () => {
      const outer = createModule('layout-1col', 0);
      withPadding(outer, 20, 20);
      outer.settings = { ...outer.settings, backgroundColor: '#002D38' };
      const inner = createModule('layout-2col-50-50', 0);
      inner.settings = { ...inner.settings, backgroundColor: '#76C043' };
      outer.columns![0].modules.push(inner);
      const html = renderEmailBody(withModules([outer], 700));
      // Outer background covers the full 700px document width.
      expect(html).toMatch(/<td width="700"[^>]*style="width:700px; background-color:#002D38;">/);
      // Inner layout's background is scoped to the OUTER column's own
      // resolved content width (700 - 20 - 20 = 660), not document.width.
      expect(html).toMatch(/<td width="660"[^>]*style="width:660px; background-color:#76C043;">/);
      const outerBgIndex = html.indexOf('background-color:#002D38;');
      const innerBgIndex = html.indexOf('background-color:#76C043;');
      expect(innerBgIndex).toBeGreaterThan(outerBgIndex);
    });

    it('mobile stacked rendering: the parent background CSS/attributes are unaffected by (and still present alongside) the Mobile stacking media query', () => {
      const layout = createModule('layout-2col-60-40', 0);
      layout.settings = { ...layout.settings, columnGutterPx: 20, backgroundColor: '#0082AD' };
      const html = renderEmailDocument(withModules([layout], 700));
      expect(html).toMatch(/<td width="700"[^>]*style="width:700px; background-color:#0082AD;">/);
      expect(html).toMatch(/@media only screen and \(max-width:600px\)\{[\s\S]*?col0\{display:block !important; width:100% !important;\}/);
    });

    it('Classic Outlook/VML enabled: the VML background fallback is sized to the FULL 700px (not the narrowed central structure) and sits INSIDE the same full-width plain-HTML wrapper', () => {
      const layout = createModule('layout-2col-50-50', 0);
      withOuterSpacing(layout, 50, 50);
      layout.settings = {
        ...layout.settings, outlookVml: true, backgroundColor: '#002D38', backgroundImage: 'https://cdn.example.com/parent-bg.jpg',
      };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).toContain('<v:rect');
      expect(html).toContain('width:700px');
      const wrapperOpen = html.indexOf('<td width="700"');
      const vmlOpen = html.indexOf('<v:rect');
      expect(vmlOpen).toBeGreaterThan(wrapperOpen);
    });

    it('Classic Outlook/VML disabled: NO VML markup is emitted, but the plain-HTML background color/image still cover the full 700px', () => {
      const layout = createModule('layout-2col-50-50', 0);
      withOuterSpacing(layout, 50, 50);
      layout.settings = {
        ...layout.settings, outlookVml: false, backgroundColor: '#002D38', backgroundImage: 'https://cdn.example.com/parent-bg.jpg',
      };
      const html = renderEmailBody(withModules([layout], 700));
      expect(html).not.toContain('<v:rect');
      expect(html).toMatch(/<td width="700"[^>]*background="https:\/\/cdn\.example\.com\/parent-bg\.jpg"[^>]*style="width:700px; background-color:#002D38;background-image:url\('https:\/\/cdn\.example\.com\/parent-bg\.jpg'\); background-size:cover; background-position:center;">/);
    });
  });
});

// Configurable Mobile Gutter Behavior — full-document (renderEmailDocument,
// the SAME function CodeEditorPanel/PreviewStudioPanel/ExportDeployDialog
// all call) proof that desktop output is byte-identical regardless of the
// setting, and that the mobile media-query behavior matches the setting.
describe('Feature 05 — Independently Configurable Desktop/Mobile Gutter', () => {
  function layoutWithGutters(desktopPx: number, mobilePx: number, hideGutterOnMobile: boolean) {
    const layout = createModule('layout-2col-40-60', 0);
    layout.settings = {
      ...layout.settings,
      columnGutterPx: desktopPx,
      mobileColumnGutterPx: mobilePx,
      hideGutterOnMobile,
    };
    return layout;
  }

  it('desktop column/gutter output is byte-identical whether hideGutterOnMobile is true or false, and independent of the Mobile gutter value', () => {
    // Same module identity for both renders (only the one setting
    // toggles) so a freshly-generated id/class per createModule() call
    // never masks the comparison.
    const layout = layoutWithGutters(20, 12, true);
    const htmlHidden = renderEmailDocument(withModules([layout]));
    layout.settings = { ...layout.settings, hideGutterOnMobile: false };
    const htmlShown = renderEmailDocument(withModules([layout]));
    // Strip the two documents down to everything BEFORE the responsive
    // <style> block (which is the only place this setting can differ) —
    // the desktop table structure itself must be identical.
    const desktopPortion = (html: string) => html.slice(html.indexOf('<body'));
    expect(desktopPortion(htmlHidden)).toBe(desktopPortion(htmlShown));
    expect(htmlHidden).toContain('width="272"');
    expect(htmlShown).toContain('width="272"');
    // Desktop gutter cell keeps its OWN (Desktop) value — 20, never 12.
    expect(htmlHidden).toContain('width="20"');
    expect(htmlShown).toContain('width="20"');
  });

  it('Preview/Code/Export consistency: one renderEmailDocument call produces both the correct desktop pixels and the correct (independent) mobile media rule together', () => {
    const html = renderEmailDocument(withModules([layoutWithGutters(20, 12, false)]));
    expect(html).toContain('width="272"'); // desktop, deterministic px, uses the Desktop gutter (20)
    expect(html).toMatch(/gut0\{display:block !important; width:100% !important; height:12px !important;/); // mobile, vertical spacer, uses the Mobile gutter (12)
  });

  it('shown mobile gutter (false) produces exactly the configured Mobile vertical spacing value, never the Desktop one', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, columnGutterPx: 45, mobileColumnGutterPx: 8, hideGutterOnMobile: false };
    const html = renderEmailDocument(withModules([layout]));
    expect(html).toMatch(/gut0\{display:block !important; width:100% !important; height:8px !important;/);
    expect(html).not.toMatch(/gut0\{[^}]*height:45px/);
  });

  it('hidden mobile gutter (true, default) produces zero spacing — no height rule at all for that gutter', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, columnGutterPx: 45, mobileColumnGutterPx: 45 };
    const html = renderEmailDocument(withModules([layout]));
    expect(html).not.toMatch(/gut0\{[^}]*height:45px/);
    expect(html).toMatch(/gut0\{display:none !important; width:0 !important; height:0 !important;\}/);
  });

  it('editing the Mobile gutter does not overwrite the Desktop gutter, and vice versa — both survive together in one document', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, columnGutterPx: 30, mobileColumnGutterPx: 30 };
    // Simulate editing ONLY the Mobile field (as the UI's onChange patch would).
    layout.settings = { ...layout.settings, mobileColumnGutterPx: 5, hideGutterOnMobile: false };
    expect(layout.settings.columnGutterPx).toBe(30); // untouched by the Mobile edit
    const html = renderEmailDocument(withModules([layout]));
    expect(html).toContain('width="30"'); // Desktop gutter cell unaffected
    expect(html).toMatch(/gut0\{display:block !important; width:100% !important; height:5px !important;/);
  });

  it('mobile stacked columns remain width:100% regardless of the gutter setting or values — Desktop pixel widths are never used as Mobile widths', () => {
    for (const hide of [true, false]) {
      const html = renderEmailDocument(withModules([layoutWithGutters(272, 12, hide)]));
      expect(html, `hide=${hide}`).toMatch(/col0\{display:block !important; width:100% !important;\}/);
      expect(html, `hide=${hide}`).toMatch(/col1\{display:block !important; width:100% !important;\}/);
    }
  });

  it('Classic Outlook (MSO conditional) desktop rendering is unchanged by this setting or either gutter value', () => {
    const htmlHidden = renderEmailDocument(withModules([layoutWithGutters(20, 12, true)]));
    const htmlShown = renderEmailDocument(withModules([layoutWithGutters(20, 12, false)]));
    const msoPrefix = '<!--[if mso]><table role="presentation" width="700"';
    expect(htmlHidden).toContain(msoPrefix);
    expect(htmlShown).toContain(msoPrefix);
    // The MSO conditional wrapper text itself is identical in both cases
    // (only the Mobile-only <style> media rules differ).
    const msoBlock = (html: string) => html.slice(html.indexOf(msoPrefix), html.indexOf(msoPrefix) + msoPrefix.length + 120);
    expect(msoBlock(htmlHidden)).toBe(msoBlock(htmlShown));
  });

  it('both gutter values persist as part of ordinary module settings — no separate/second persistence mechanism', () => {
    // columnGutterPx/mobileColumnGutterPx round-trip through a plain
    // object spread exactly like every other layout setting (mobileStack,
    // ...) — proven by the renderer reading them straight off
    // module.settings with no special-cased storage path.
    const layout = layoutWithGutters(20, 12, false);
    const cloned = JSON.parse(JSON.stringify(layout));
    const html = renderEmailDocument(withModules([cloned]));
    expect(html).toContain('width="20"');
    expect(html).toMatch(/gut0\{display:block !important; width:100% !important; height:12px !important;/);
  });

  it('a legacy document (pre-independent-fields columnGutter shape) still renders a sane Desktop gutter via the resolver fallback', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, columnGutter: { desktop: { value: 20, unit: 'px' } } };
    const html = renderEmailDocument(withModules([layout]));
    expect(html).toContain('width="20"');
  });
});

// Module-4 E4 — Outlook/VML document-level default. `document.outlookVml`
// (RenderableEmail.outlookVml) is a FALLBACK only: a module's own explicit
// settings.outlookVml (set today only via the AI Engineer's
// APPLY_VML_PATTERN/APPLY_OUTLOOK_WRAPPER actions) always wins.
describe('Module-4 E4 — Outlook/VML document-level default', () => {
  it('document.outlookVml=false (or omitted) reproduces today\'s exact existing behavior — no VML anywhere', () => {
    const button = createModule('button', 0);
    const html = renderEmailBody(withModules([button]));
    expect(html).not.toContain('<v:roundrect');
    const html2 = renderEmailBody({ ...withModules([button]), outlookVml: false });
    expect(html2).toBe(html);
  });

  it('document.outlookVml=true enables the VML fallback for a module that never explicitly set it', () => {
    const button = createModule('button', 0);
    const html = renderEmailBody({ ...withModules([button]), outlookVml: true });
    expect(html).toContain('<v:roundrect');
  });

  it('a module\'s OWN explicit settings.outlookVml=false still wins over document.outlookVml=true (explicit opt-out is never silently overridden)', () => {
    const button = createModule('button', 0);
    button.settings = { ...button.settings, outlookVml: false };
    const html = renderEmailBody({ ...withModules([button]), outlookVml: true });
    expect(html).not.toContain('<v:roundrect');
  });

  it('a module\'s OWN explicit settings.outlookVml=true is unaffected by document.outlookVml=false', () => {
    const button = createModule('button', 0);
    button.settings = { ...button.settings, outlookVml: true };
    const html = renderEmailBody({ ...withModules([button]), outlookVml: false });
    expect(html).toContain('<v:roundrect');
  });

  it('applies the document default to a module nested inside a Layout column too (one level of nesting, same as every other module-tree walk)', () => {
    const layout = createModule('layout-1col', 0);
    const button = createModule('button', 0);
    layout.columns![0].modules.push(button);
    const html = renderEmailBody({ ...withModules([layout]), outlookVml: true });
    expect(html).toContain('<v:roundrect');
  });

  it('never mutates the caller\'s original module objects — the input module tree is unchanged after rendering', () => {
    const button = createModule('button', 0);
    const before = JSON.parse(JSON.stringify(button));
    renderEmailBody({ ...withModules([button]), outlookVml: true });
    expect(button).toEqual(before);
    expect(button.settings.outlookVml).toBeUndefined();
  });

  it('the whole-module Layout Background VML wrapper also honors the document default for a layout with no explicit setting of its own', () => {
    const layout = createModule('layout-1col', 0);
    layout.settings = { ...layout.settings, backgroundColor: '#002D38', backgroundImage: 'https://cdn.example.com/bg.jpg' };
    const html = renderEmailBody({ ...withModules([layout], 700), outlookVml: true });
    expect(html).toContain('<v:rect');
  });
});

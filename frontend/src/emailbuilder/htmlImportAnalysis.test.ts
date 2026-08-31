import { describe, expect, it } from 'vitest';
import { analyzeImportedHtml, MEDIUM_CONFIDENCE } from './htmlImportAnalysis';

describe('analyzeImportedHtml — MEDIUM_CONFIDENCE threshold', () => {
  it('is exported for callers to decide what counts as "should be confirmed"', () => {
    expect(MEDIUM_CONFIDENCE).toBe(0.7);
  });
});
import { mapImportedHtml } from './htmlImportMapper';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('analyzeImportedHtml — basic role classification', () => {
  it('classifies a heading tag as role heading, distinct from a plain paragraph', () => {
    const html = '<table><tr><td><h1>Big Heading</h1><p>Body copy here that is not a preheader because it is not first.</p></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions).toHaveLength(2);
    expect(regions[0].role).toBe('heading');
    expect(regions[0].content.text).toEqual(['Big Heading']);
    expect(regions[1].role).toBe('paragraph');
  });

  it('classifies <hr> as divider with confidence 1 (unambiguous)', () => {
    const { regions } = analyzeImportedHtml(parse('<table><tr><td><hr></td></tr></table>'));
    expect(regions[0].role).toBe('divider');
    expect(regions[0].confidence).toBe(1);
  });

  it('classifies a styled anchor as cta, preserving link/typography/spacing facts', () => {
    const html = '<table><tr><td><a href="https://example.com/go" style="background-color:#76c043; padding:12px 24px 12px 24px; color:#fff;">Shop Now</a></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions[0].role).toBe('cta');
    expect(regions[0].links).toEqual([{ label: 'Shop Now', href: 'https://example.com/go', safe: true }]);
    expect(regions[0].spacing.paddingHorizontal).toBe(24);
    expect(regions[0].spacing.paddingVertical).toBe(12);
  });

  it('a plain (non-button) anchor is not its own region — folds into the surrounding paragraph', () => {
    const html = '<table><tr><td><p>Visit <a href="https://example.com">our site</a> today.</p></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions).toHaveLength(1);
    expect(regions[0].role).toBe('paragraph');
  });
});

describe('analyzeImportedHtml — header/footer reuse the deterministic mapper predicates directly', () => {
  it('a logo+nav row is classified as role header with links preserved', () => {
    const html = '<table><tr>'
      + '<td><img src="https://example.com/logo.png" alt="Acme"></td>'
      + '<td><a href="https://example.com/shop">Shop</a><a href="https://example.com/about">About</a></td>'
      + '</tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions).toHaveLength(1);
    expect(regions[0].role).toBe('header');
    expect(regions[0].images[0].src).toBe('https://example.com/logo.png');
    expect(regions[0].links.map((l) => l.label)).toEqual(['Shop', 'About']);
  });

  it('a footer cell with an unsubscribe link is classified as role footer', () => {
    const html = '<table><tr><td>'
      + '<p>Acme Inc.</p>'
      + '<a href="https://example.com/unsubscribe">Unsubscribe</a>'
      + '</td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions).toHaveLength(1);
    expect(regions[0].role).toBe('footer');
    expect(regions[0].links.some((l) => l.label === 'Unsubscribe' && l.href === 'https://example.com/unsubscribe')).toBe(true);
  });

  it('a row with no logo/unsubscribe signal is never misclassified as header/footer', () => {
    const html = '<table><tr><td><p>Just a regular paragraph.</p></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions.every((r) => r.role !== 'header' && r.role !== 'footer')).toBe(true);
  });
});

describe('analyzeImportedHtml — column ratio matches pickLayoutType exactly (no second derivation)', () => {
  it('reports the REAL detected ratio, matching mapImportedHtml’s own structural-conversion finding value', () => {
    const html = '<table><tr><td width="380">A</td><td width="620">B</td></tr></table>';
    const doc = parse(html);
    const { regions } = analyzeImportedHtml(doc);
    const mapped = mapImportedHtml(parse(html));
    const finding = mapped.findings.find((f) => f.category === 'structural-conversion');
    expect(regions[0].role).toBe('columns');
    expect(regions[0].columnRatio).toEqual([38, 62]);
    expect(finding?.outcome).toContain('38/62');
    expect(regions[0].confidence).toBe(0.85); // not exact -> approximated confidence
  });

  it('an exact preset match gets confidence 1', () => {
    const html = '<table><tr><td width="40">A</td><td width="60">B</td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions[0].columnRatio).toEqual([40, 60]);
    expect(regions[0].confidence).toBe(1);
  });

  it('column children are produced per content cell, each their own region', () => {
    const html = '<table><tr><td width="33%"><p>One</p></td><td width="33%"><p>Two</p></td><td width="34%"><p>Three</p></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions[0].role).toBe('columns');
    expect(regions[0].children).toHaveLength(3);
    expect(regions[0].children.map((c) => c.content.text[0])).toEqual(['One', 'Two', 'Three']);
  });
});

describe('analyzeImportedHtml — spacer/gutter facts match classifyRowCells exactly', () => {
  it('outer spacing and gutter on a multi-column row are surfaced on the region', () => {
    const html = '<table><tr>'
      + '<td width="30">&nbsp;</td>'
      + '<td width="40%">Left</td>'
      + '<td width="20">&nbsp;</td>'
      + '<td width="60%">Right</td>'
      + '<td width="30">&nbsp;</td>'
      + '</tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions[0].spacing.outerSpacingLeftPx).toBe(30);
    expect(regions[0].spacing.outerSpacingRightPx).toBe(30);
    expect(regions[0].spacing.gutterPx).toBe(20);
  });
});

describe('analyzeImportedHtml — background facts reuse readBackground directly', () => {
  it('row background-color is surfaced on the produced region', () => {
    const html = '<table><tr style="background-color:#112233;"><td><p>Text</p></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions[0].background.color).toBe('#112233');
  });
});

describe('analyzeImportedHtml — contextual reclassification (preheader/hero)', () => {
  it('a short, link-free, image-free first text region is reclassified as preheader', () => {
    const html = '<table><tr><td><p>You are receiving this because you subscribed.</p></td></tr>'
      + '<tr><td><p>Second, unrelated line that stays a paragraph.</p></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions[0].role).toBe('preheader');
    expect(regions[0].confidence).toBe(0.6);
    expect(regions[1].role).toBe('paragraph');
  });

  it('a first text region that is NOT short/plain stays a paragraph, not a preheader', () => {
    const longText = 'x'.repeat(250);
    const html = `<table><tr><td><p>${longText}</p></td></tr></table>`;
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions[0].role).toBe('paragraph');
  });

  it('a full-width image within the first three regions is reclassified as hero', () => {
    const html = '<table><tr><td><img src="https://example.com/hero.png" width="700"></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html), 700);
    expect(regions[0].role).toBe('hero');
    expect(regions[0].confidence).toBe(0.7);
  });

  it('a narrow image (not near-full-width) is NOT reclassified as hero — stays image', () => {
    const html = '<table><tr><td><img src="https://example.com/icon.png" width="40"></td></tr></table>';
    const { regions } = analyzeImportedHtml(parse(html), 700);
    expect(regions[0].role).toBe('image');
  });
});

describe('analyzeImportedHtml — MSO conditional detection reuses the mapper’s own detector', () => {
  it('flags hasMsoConditionalContent true when present', () => {
    const html = '<table><tr><td><!--[if mso]><table><tr><td>fallback</td></tr></table><![endif]--><p>Real</p></td></tr></table>';
    const { hasMsoConditionalContent } = analyzeImportedHtml(parse(html));
    expect(hasMsoConditionalContent).toBe(true);
  });

  it('is false when absent', () => {
    const { hasMsoConditionalContent } = analyzeImportedHtml(parse('<table><tr><td><p>No MSO</p></td></tr></table>'));
    expect(hasMsoConditionalContent).toBe(false);
  });
});

describe('analyzeImportedHtml — security: dangerous tags never become a region', () => {
  it('a <script> row produces no region at all', () => {
    // Text is deliberately long enough (>200 chars) to avoid also
    // tripping the unrelated "short first region -> preheader" contextual
    // reclassification — this test is only about the dangerous row.
    const safeText = `Safe paragraph content. ${'x'.repeat(200)}`;
    const html = `<table><tr><td><script>alert(1)</script></td></tr><tr><td><p>${safeText}</p></td></tr></table>`;
    const { regions } = analyzeImportedHtml(parse(html));
    expect(regions).toHaveLength(1);
    expect(regions[0].role).toBe('paragraph');
  });
});

describe('analyzeImportedHtml — realistic multi-section fixture (end-to-end)', () => {
  const REALISTIC_EMAIL_HTML = `<html><head><title>Fall Sale</title></head><body>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0">
      <tr><td><p style="font-size:11px; color:#888888;">You are receiving this because you subscribed to MarketOne updates.</p></td></tr>
      <tr>
        <td width="200"><img src="https://example.com/logo.png" alt="MarketOne" width="140"></td>
        <td width="400" align="right">
          <a href="https://example.com/shop">Shop</a>
          <a href="https://example.com/about">About</a>
          <a href="https://example.com/contact">Contact</a>
        </td>
      </tr>
      <tr><td><img src="https://example.com/hero.png" alt="Fall Sale" width="600"></td></tr>
      <tr><td>
        <h1 style="color:#002d38;">Fall Sale Is Here</h1>
        <p style="font-size:16px;">Save up to 40% on select items this week only.</p>
      </td></tr>
      <tr><td><a href="https://example.com/shop-now" style="background-color:#76c043; color:#ffffff; padding:12px 24px 12px 24px;">Shop Now</a></td></tr>
      <tr><td><h2>More Ways to Save</h2></td></tr>
      <tr>
        <td width="33%"><p>Item One</p></td>
        <td width="33%"><p>Item Two</p></td>
        <td width="34%"><p>Item Three</p></td>
      </tr>
      <tr><td><hr></td></tr>
      <tr style="background-color:#002d38;"><td>
        <p>MarketOne Digital, Inc.</p>
        <p>Copyright 2026 MarketOne Digital. All rights reserved.</p>
        <a href="https://example.com/unsubscribe">Unsubscribe</a>
        <a href="https://example.com/privacy">Privacy Policy</a>
      </td></tr>
    </table>
  </body></html>`;

  it('reconstructs the same semantic section order as the deterministic module list', () => {
    const { regions } = analyzeImportedHtml(parse(REALISTIC_EMAIL_HTML), 600);
    expect(regions.map((r) => r.role)).toEqual([
      'preheader', 'header', 'hero', 'heading', 'paragraph', 'cta', 'heading', 'columns', 'divider', 'footer',
    ]);
  });

  it('every region has a confidence score, and no role has a confidence of exactly 0 or a fabricated non-table value', () => {
    const { regions } = analyzeImportedHtml(parse(REALISTIC_EMAIL_HTML), 600);
    for (const region of regions) {
      expect(region.confidence).toBeGreaterThan(0);
      expect(region.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('the footer region carries the dark background and both unsubscribe/privacy links', () => {
    const { regions } = analyzeImportedHtml(parse(REALISTIC_EMAIL_HTML), 600);
    const footer = regions.find((r) => r.role === 'footer')!;
    expect(footer.background.color).toBe('#002d38');
    expect(footer.links.map((l) => l.label)).toEqual(['Unsubscribe', 'Privacy Policy']);
  });

  it('the columns region reports the exact 33/33/34 ratio with 3 children', () => {
    const { regions } = analyzeImportedHtml(parse(REALISTIC_EMAIL_HTML), 600);
    const columns = regions.find((r) => r.role === 'columns')!;
    expect(columns.columnRatio).toEqual([33, 33, 34]);
    expect(columns.children).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';
import { buildFidelityReport, FIDELITY_CATEGORY_ORDER, type FidelityCategoryId, type FidelityStatus } from './htmlImportFidelity';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { mapImportedHtml } from './htmlImportMapper';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function report(html: string, widthPx = 700) {
  const doc = parse(html);
  const structure = analyzeImportedHtml(doc, widthPx);
  const mapping = mapImportedHtml(doc);
  return buildFidelityReport(doc, structure, mapping);
}

function category(rep: ReturnType<typeof report>, id: FidelityCategoryId) {
  const found = rep.categories.find((c) => c.id === id);
  if (!found) throw new Error(`category ${id} missing from report`);
  return found;
}

describe('buildFidelityReport — category coverage and ordering', () => {
  it('always returns exactly the 8 categories in the documented order', () => {
    const rep = report('<table><tr><td><p>Hello</p></td></tr></table>');
    expect(rep.categories.map((c) => c.id)).toEqual(FIDELITY_CATEGORY_ORDER);
    expect(FIDELITY_CATEGORY_ORDER).toEqual(['structure', 'content', 'typography', 'spacing', 'images', 'links', 'responsive', 'outlook']);
  });

  it('every category status is one of the 5 documented values, never a Good/Warning/Error collapse', () => {
    const rep = report('<table><tr><td><p>Hello</p></td></tr></table>');
    const allowed: FidelityStatus[] = ['preserved', 'normalized', 'approximated', 'removed', 'unsupported'];
    for (const c of rep.categories) expect(allowed).toContain(c.status);
  });
});

describe('buildFidelityReport — exact preservation (never claimed merely because import succeeded)', () => {
  it('an exact preset column ratio is preserved, not merely "imported"', () => {
    const rep = report('<table><tr><td width="40">A</td><td width="60">B</td></tr></table>');
    expect(category(rep, 'structure').status).toBe('preserved');
    expect(category(rep, 'structure').findings).toHaveLength(0);
  });

  it('a safe image with explicit width is preserved', () => {
    const rep = report('<table><tr><td><img src="https://example.com/a.png" width="240"></td></tr></table>');
    expect(category(rep, 'images').status).toBe('preserved');
  });

  it('a safe link with retained href is preserved', () => {
    const html = '<table><tr><td><a href="https://example.com/go" style="background-color:#76c043; padding:12px 24px 12px 24px; color:#fff;">Go</a></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'links').status).toBe('preserved');
  });

  it('a supported background color is preserved', () => {
    const rep = report('<table><tr style="background-color:#112233;"><td><p>Text</p></td></tr></table>');
    expect(category(rep, 'content').status).toBe('preserved');
  });

  it('button alignment/padding retained counts toward preserved spacing', () => {
    const html = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#002d38; padding:12px 24px 12px 24px; color:#fff;">Go</a></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'spacing').status).toBe('preserved');
  });
});

describe('buildFidelityReport — normalization (semantic intent equivalent, HTML shape changed)', () => {
  it('a nested nav table is normalized (stacked content, semantic intent equivalent)', () => {
    const html = '<table><tr><td><table><tr><td><p>Nested A</p></td><td><p>Nested B</p></td></tr></table></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'structure').status).toBe('normalized');
  });

  it('a <ul> list is normalized to plain text lines', () => {
    const html = '<table><tr><td><ul><li>One</li><li>Two</li></ul></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'content').status).toBe('normalized');
  });
});

describe('buildFidelityReport — arbitrary ratio approximation (column-ratio honesty)', () => {
  it('reports BOTH the detected source ratio and the reconstructed preset, and never implies the preset was the source', () => {
    const rep = report('<table><tr><td width="380">A</td><td width="620">B</td></tr></table>');
    const structureCat = category(rep, 'structure');
    expect(structureCat.status).toBe('approximated');
    const finding = structureCat.findings[0];
    expect(finding.outcome).toContain('38/62');
    expect(finding.outcome).toContain('40/60');
    // The finding must state the detected ratio came FROM the source,
    // never present 40/60 as though it were what was detected.
    expect(finding.reason).toContain('do not exactly match');
  });
});

describe('buildFidelityReport — dangerous-content removal (security beats fidelity)', () => {
  it('a stripped <script> is reported as removed, never softened', () => {
    const html = '<table><tr><td><script>alert(1)</script><p>Safe</p></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'content').status).toBe('removed');
    expect(category(rep, 'content').findings[0].category).toBe('security');
  });

  it('iframe/object/embed/form all roll up to removed', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form']) {
      const rep = report(`<table><tr><td><${tag}></${tag}><p>Still here</p></td></tr></table>`);
      expect(category(rep, 'content').status).toBe('removed');
    }
  });
});

describe('buildFidelityReport — unsupported construct', () => {
  it('an unknown/custom tag is unsupported content', () => {
    const rep = report('<table><tr><td><x-widget><p>Should not survive</p></x-widget></td></tr></table>');
    expect(category(rep, 'content').status).toBe('unsupported');
  });

  it('a 7-column row (no supported layout) is unsupported structure', () => {
    const cells = Array.from({ length: 7 }, (_, i) => `<td>${i}</td>`).join('');
    const rep = report(`<table><tr>${cells}</tr></table>`);
    expect(category(rep, 'structure').status).toBe('unsupported');
  });

  it('a data: image is unsupported', () => {
    const rep = report('<table><tr><td><img src="data:image/png;base64,AAAA"></td></tr></table>');
    expect(category(rep, 'images').status).toBe('unsupported');
  });
});

describe('buildFidelityReport — header/nav preservation', () => {
  it('a clean logo+nav header is preserved (structure/content/links all clean)', () => {
    const html = '<table><tr>'
      + '<td><img src="https://example.com/logo.png" alt="Acme"></td>'
      + '<td><a href="https://example.com/shop">Shop</a><a href="https://example.com/about">About</a></td>'
      + '</tr></table>';
    const rep = report(html);
    expect(category(rep, 'links').status).toBe('preserved');
  });

  it('more than 6 nav links approximates the links category (tail dropped)', () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="https://example.com/l${i}">L${i}</a>`).join('');
    const html = `<table><tr><td><img src="https://example.com/logo.png"></td><td>${links}</td></tr></table>`;
    const rep = report(html);
    expect(category(rep, 'links').status).toBe('approximated');
  });
});

describe('buildFidelityReport — footer/unsubscribe preservation', () => {
  it('unsubscribe + privacy links both retained is preserved', () => {
    const html = '<table><tr><td>'
      + '<p>Acme Inc.</p>'
      + '<a href="https://example.com/unsubscribe">Unsubscribe</a>'
      + '<a href="https://example.com/privacy">Privacy Policy</a>'
      + '</td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'links').status).toBe('preserved');
  });

  it('unsubscribe link present but with no safe href is unsupported (compliance-sensitive, never softened)', () => {
    const html = '<table><tr><td>'
      + '<p>Acme Inc.</p>'
      + '<a href="javascript:void(0)">Unsubscribe</a>'
      + '</td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'links').status).toBe('unsupported');
  });
});

describe('buildFidelityReport — background color/image preservation', () => {
  it('a safe background-image URL is preserved', () => {
    const html = '<table><tr style="background-image:url(https://example.com/bg.png);"><td><p>Text</p></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'content').status).toBe('preserved');
  });
});

describe('buildFidelityReport — typography preservation and the partial-bold gap', () => {
  it('a whole-line bold paragraph is preserved (fontWeight faithfully represented)', () => {
    const rep = report('<table><tr><td><p><strong>Important</strong></p></td></tr></table>');
    expect(category(rep, 'typography').status).toBe('preserved');
  });

  it('a partially-bold paragraph is approximated (the Text module cannot represent partial bold)', () => {
    const rep = report('<table><tr><td><p>Some <strong>partial</strong> bold text.</p></td></tr></table>');
    expect(category(rep, 'typography').status).toBe('approximated');
  });

  it('a fully unstyled paragraph with no typography facts is preserved (nothing to lose)', () => {
    const rep = report('<table><tr><td><p>Plain text.</p></td></tr></table>');
    expect(category(rep, 'typography').status).toBe('preserved');
  });
});

describe('buildFidelityReport — the spacing gap (source cell padding never reaches a Text module)', () => {
  it('a paragraph with explicit padding is unsupported for spacing (deterministic, known mapper gap)', () => {
    const html = '<table><tr><td><p style="padding:12px 24px 12px 24px;">Padded</p></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'spacing').status).toBe('unsupported');
  });
});

describe('buildFidelityReport — Outlook/MSO fidelity reporting', () => {
  it('MSO conditional markup is approximated, never claimed preserved', () => {
    const html = '<table><tr><td><!--[if mso]><table><tr><td>fallback</td></tr></table><![endif]--><p>Real</p></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'outlook').status).toBe('approximated');
    expect(category(rep, 'outlook').findings[0].category).toBe('outlook-regeneration');
  });

  it('no MSO markup at all is preserved (nothing was ever at risk)', () => {
    const rep = report('<table><tr><td><p>No MSO here</p></td></tr></table>');
    expect(category(rep, 'outlook').status).toBe('preserved');
  });
});

describe('buildFidelityReport — multiple findings within one category, multiple categories in one document', () => {
  it('two unresolved images in the same document both roll into images, count reflected', () => {
    const html = '<table>'
      + '<tr><td><img src="data:image/png;base64,AAAA"></td></tr>'
      + '<tr><td><img src="cid:x@y"></td></tr>'
      + '</table>';
    const rep = report(html);
    expect(category(rep, 'images').status).toBe('unsupported');
    expect(category(rep, 'images').findings).toHaveLength(2);
  });

  it('a document with a script AND an unsupported image affects content and images independently', () => {
    const html = '<table>'
      + '<tr><td><script>alert(1)</script><p>Safe</p></td></tr>'
      + '<tr><td><img src="data:image/png;base64,AAAA"></td></tr>'
      + '</table>';
    const rep = report(html);
    expect(category(rep, 'content').status).toBe('removed');
    expect(category(rep, 'images').status).toBe('unsupported');
  });
});

describe('buildFidelityReport — region-to-finding source-position correlation', () => {
  it('a category’s regionSourcePositions match the underlying findings’ own location, never fabricated', () => {
    const html = '<table>'
      + '<tr><td><p>Row one.</p></td></tr>'
      + '<tr><td width="380">A</td><td width="620">B</td></tr>'
      + '</table>';
    const rep = report(html);
    const structureCat = category(rep, 'structure');
    expect(structureCat.regionSourcePositions).toEqual(['row 2']);
    expect(structureCat.findings[0].location).toBe('row 2');
  });

  it('a category with no findings has an empty regionSourcePositions array (never invented)', () => {
    const rep = report('<table><tr><td><p>Hello</p></td></tr></table>');
    expect(category(rep, 'outlook').regionSourcePositions).toEqual([]);
  });
});

describe('buildFidelityReport — does not mutate the reconstruction plan while generating the report', () => {
  it('structure and mapping are byte-identical (deep-equal) before and after building the report', () => {
    const doc = parse('<table><tr><td><h1>Heading</h1><p>Paragraph</p></td></tr></table>');
    const structure = analyzeImportedHtml(doc, 700);
    const mapping = mapImportedHtml(doc);
    const structureBefore = JSON.parse(JSON.stringify(structure));
    const mappingBefore = JSON.parse(JSON.stringify(mapping));
    buildFidelityReport(doc, structure, mapping);
    expect(JSON.parse(JSON.stringify(structure))).toEqual(structureBefore);
    expect(JSON.parse(JSON.stringify(mapping))).toEqual(mappingBefore);
  });
});

describe('buildFidelityReport — architecture invariants (no second X)', () => {
  it('never touches the DOM (report building does not append/remove/modify nodes)', () => {
    const doc = parse('<table><tr><td><p>Hello</p></td></tr></table>');
    const before = doc.body.innerHTML;
    const structure = analyzeImportedHtml(doc, 700);
    const mapping = mapImportedHtml(doc);
    buildFidelityReport(doc, structure, mapping);
    expect(doc.body.innerHTML).toBe(before);
  });

  it('produces a plain data object with no module/render/document-model fields — a report only', () => {
    const rep = report('<table><tr><td><p>Hello</p></td></tr></table>');
    expect(Object.keys(rep)).toEqual(['categories']);
    for (const c of rep.categories) {
      expect(Object.keys(c).sort()).toEqual(['findings', 'id', 'label', 'regionSourcePositions', 'status', 'summary'].sort());
    }
  });
});

describe('buildFidelityReport — realistic multi-section fixture (end-to-end)', () => {
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

  it('reports the expected status per category — every category preserved EXCEPT Responsive, which is normalized (builder always introduces its own mobile behavior)', () => {
    const rep = report(REALISTIC_EMAIL_HTML, 600);
    const expected: Record<string, string> = {
      structure: 'preserved', content: 'preserved', typography: 'preserved', spacing: 'preserved',
      images: 'preserved', links: 'preserved', responsive: 'normalized', outlook: 'preserved',
    };
    for (const c of rep.categories) {
      expect(c.status, `category ${c.id} was ${c.status}, expected ${expected[c.id]}`).toBe(expected[c.id]);
      expect(c.findings).toHaveLength(0);
    }
  });

  it('the Responsive summary explicitly names the builder-introduced behavior, never claims source preservation', () => {
    const rep = report(REALISTIC_EMAIL_HTML, 600);
    const responsive = category(rep, 'responsive');
    expect(responsive.summary).toContain('No explicit source responsive behavior was detected');
    expect(responsive.summary).toContain('Builder-standard mobile behavior will be applied');
  });

  it('the Outlook summary explicitly states no source behavior was lost, never implies a builder-added enhancement is source preservation', () => {
    const rep = report(REALISTIC_EMAIL_HTML, 600);
    const outlook = category(rep, 'outlook');
    expect(outlook.summary).toContain('No Outlook/MSO-specific source behavior was detected');
    expect(outlook.summary).toContain('no Outlook-specific source behavior was lost');
  });

  it('images/links carry the tightened summary confirming positive verification, not mere absence of a finding', () => {
    const rep = report(REALISTIC_EMAIL_HTML, 600);
    expect(category(rep, 'images').summary).toContain('confirmed present in the reconstructed modules');
    expect(category(rep, 'links').summary).toContain('confirmed present in the reconstructed modules');
  });
});

describe('buildFidelityReport — Responsive semantics hardening', () => {
  it('no source stylesheet at all defaults to normalized (builder introduces mobile-stacking), never preserved', () => {
    const rep = report('<table><tr><td><p>Plain email, no styles.</p></td></tr></table>');
    const responsive = category(rep, 'responsive');
    expect(responsive.status).toBe('normalized');
    expect(responsive.findings).toHaveLength(0);
  });

  it('an explicit source <style> block that cannot be represented is unsupported, not merely normalized', () => {
    // <style> inside <head> is never visited at all (mapImportedHtml only
    // walks document.body — see htmlImportMapper.ts's entry point), so it
    // produces no finding and the category stays at its 'normalized'
    // default (covered by the "no source stylesheet" test above). A
    // malformed-but-real-world <style> placed directly in <body> DOES
    // reach the generic unknown-tag branch and produce a genuine
    // 'unsupported' finding — that is the case this test exercises.
    const html = '<table><tr><td><style>.foo{color:red}</style><p>Text</p></td></tr></table>';
    const rep = report(html);
    const responsive = category(rep, 'responsive');
    expect(responsive.status).toBe('unsupported');
    expect(responsive.findings).toHaveLength(1);
  });
});

describe('buildFidelityReport — positive preservation evidence (source fact vs reconstructed EDM fact)', () => {
  it('image src comparison is genuinely evidence-based: a synthetic mismatch is caught, not silently passed', () => {
    const doc = parse('<table><tr><td><img src="https://example.com/real.png" width="200"></td></tr></table>');
    const mapping = mapImportedHtml(doc);
    // Hand-construct a DetectedStructure claiming a DIFFERENT image src
    // than what the mapper actually built, to prove imagesFullyVerified
    // is a real comparison and not decorative — see htmlImportFidelity.ts's
    // own "Evidence layer 3" docstring for why this divergence can never
    // occur through the real analyzeImportedHtml pipeline (both read the
    // same source element), so it is constructed directly here instead.
    const mismatchedStructure = {
      documentWidthPx: 700,
      hasMsoConditionalContent: false,
      regions: [{
        role: 'image' as const, confidence: 0.9, sourcePosition: 'row 1', detectedWidthPx: 200, parentWidthPx: 700,
        columnRatio: null, content: { text: [] }, links: [],
        images: [{ src: 'https://example.com/DIFFERENT.png', alt: '', widthPx: 200, safe: true }],
        typography: {}, spacing: {}, background: {}, children: [],
      }],
    };
    const rep = buildFidelityReport(doc, mismatchedStructure, mapping);
    expect(category(rep, 'images').status).toBe('unsupported');
    expect(category(rep, 'images').summary).toContain('could not be confirmed present');
  });

  it('a genuinely matching image src/width is preserved via real comparison', () => {
    const doc = parse('<table><tr><td><img src="https://example.com/real.png" width="200"></td></tr></table>');
    const structure = analyzeImportedHtml(doc, 700);
    const mapping = mapImportedHtml(doc);
    const rep = buildFidelityReport(doc, structure, mapping);
    expect(category(rep, 'images').status).toBe('preserved');
  });

  it('a safe href on a CTA button is verified present in the reconstructed module, not merely assumed', () => {
    const html = '<table><tr><td><a href="https://example.com/go" style="background-color:#76c043; padding:12px 24px 12px 24px; color:#fff;">Go</a></td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'links').status).toBe('preserved');
  });

  it('a background color on a layout row is verified present in the reconstructed module settings', () => {
    const html = '<table><tr style="background-color:#112233;"><td width="50">A</td><td width="50">B</td></tr></table>';
    const rep = report(html);
    expect(category(rep, 'content').status).toBe('preserved');
  });
});

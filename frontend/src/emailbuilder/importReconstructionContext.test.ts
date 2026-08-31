import { describe, expect, it } from 'vitest';
import {
  buildImportReconstructionContext, CONTENT_PREVIEW_MAX_CHARS, MAX_REGIONS_SENT, MAX_SAMPLE_FINDINGS_PER_CATEGORY,
} from './importReconstructionContext';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildFidelityReport } from './htmlImportFidelity';
import { mapImportedHtml } from './htmlImportMapper';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function contextFor(html: string, widthPx = 700) {
  const doc = parse(html);
  const structure = analyzeImportedHtml(doc, widthPx);
  const mapping = mapImportedHtml(doc);
  const fidelity = buildFidelityReport(doc, structure, mapping);
  return buildImportReconstructionContext(structure, fidelity, mapping.modules.length);
}

describe('buildImportReconstructionContext — shape and bounds', () => {
  it('is a pure summarization: never touches the document, structure, or fidelity report inputs', () => {
    const doc = parse('<table><tr><td><p>Hello</p></td></tr></table>');
    const structure = analyzeImportedHtml(doc, 700);
    const mapping = mapImportedHtml(doc);
    const fidelity = buildFidelityReport(doc, structure, mapping);
    const structureBefore = JSON.parse(JSON.stringify(structure));
    const fidelityBefore = JSON.parse(JSON.stringify(fidelity));
    buildImportReconstructionContext(structure, fidelity, mapping.modules.length);
    expect(JSON.parse(JSON.stringify(structure))).toEqual(structureBefore);
    expect(JSON.parse(JSON.stringify(fidelity))).toEqual(fidelityBefore);
  });

  it('carries document width and module count verbatim', () => {
    const context = contextFor('<table><tr><td><p>Hello</p></td></tr></table>', 600);
    expect(context.document_width).toBe(600);
    expect(context.module_count).toBe(1);
  });

  it('always includes exactly the 8 fidelity categories, in FIDELITY_CATEGORY_ORDER', () => {
    const context = contextFor('<table><tr><td><p>Hello</p></td></tr></table>');
    expect(context.fidelity_categories.map((c) => c.id)).toEqual([
      'structure', 'content', 'typography', 'spacing', 'images', 'links', 'responsive', 'outlook',
    ]);
  });

  it('region_count reflects the TRUE total even when regions[] is capped', () => {
    const rows = Array.from({ length: MAX_REGIONS_SENT + 10 }, (_, i) => `<tr><td><p>Line ${i}</p></td></tr>`).join('');
    const context = contextFor(`<table>${rows}</table>`);
    expect(context.region_count).toBeGreaterThan(MAX_REGIONS_SENT);
    expect(context.regions.length).toBe(MAX_REGIONS_SENT);
  });

  it('caps content_preview to CONTENT_PREVIEW_MAX_CHARS, never sending the full source text of a long region', () => {
    const longText = 'x'.repeat(500);
    const context = contextFor(`<table><tr><td><p>${longText}</p></td></tr></table>`);
    const preview = context.regions[0].content_preview ?? '';
    expect(preview.length).toBeLessThanOrEqual(CONTENT_PREVIEW_MAX_CHARS + 1); // +1 for the truncation ellipsis char
  });

  it('caps sample_findings per category, never sending every finding for a category with many', () => {
    const links = Array.from({ length: 10 }, (_, i) => `<a href="https://example.com/l${i}">L${i}</a>`).join('');
    const html = `<table><tr><td><img src="https://example.com/logo.png"></td><td>${links}</td></tr></table>`;
    const context = contextFor(html);
    const linksCategory = context.fidelity_categories.find((c) => c.id === 'links')!;
    expect(linksCategory.sample_findings.length).toBeLessThanOrEqual(MAX_SAMPLE_FINDINGS_PER_CATEGORY);
  });

  it('never sends the raw HTML string anywhere in the context object', () => {
    const html = '<table><tr><td><p>Distinctive marker text ZZZ_RAW_HTML_CHECK</p></td></tr></table>';
    const context = contextFor(html);
    const serialized = JSON.stringify(context);
    // The full source text survives only as a bounded preview, not as a
    // second, untruncated copy of the same content anywhere else.
    expect(serialized.match(/ZZZ_RAW_HTML_CHECK/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe('buildImportReconstructionContext — column ratio honesty carries through', () => {
  it('a 38/62 -> 40/60 approximation is visible in both the region summary and the fidelity finding sample', () => {
    const context = contextFor('<table><tr><td width="380">A</td><td width="620">B</td></tr></table>');
    const columnsRegion = context.regions.find((r) => r.role === 'columns');
    expect(columnsRegion?.column_ratio).toEqual([38, 62]);
    const structureCategory = context.fidelity_categories.find((c) => c.id === 'structure')!;
    expect(structureCategory.status).toBe('approximated');
    expect(structureCategory.sample_findings[0].reason).toContain('do not exactly match');
  });
});

describe('buildImportReconstructionContext — realistic fixture end-to-end', () => {
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

  it('produces a bounded, fully-populated context for a clean multi-section import', () => {
    const context = contextFor(REALISTIC_EMAIL_HTML, 600);
    expect(context.document_width).toBe(600);
    expect(context.module_count).toBe(10);
    expect(context.region_count).toBeLessThanOrEqual(MAX_REGIONS_SENT);
    expect(context.regions.map((r) => r.role)).toContain('header');
    expect(context.regions.map((r) => r.role)).toContain('footer');
    expect(context.fidelity_categories.every((c) => c.status === 'preserved' || c.id === 'responsive')).toBe(true);
    expect(context.has_mso_conditional_content).toBe(false);
  });
});

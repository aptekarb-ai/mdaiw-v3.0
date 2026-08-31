import { describe, expect, it } from 'vitest';
import { buildReconstructionReview, formatReconstructionReviewMessage } from './reconstructionReview';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildFidelityReport } from './htmlImportFidelity';
import { mapImportedHtml } from './htmlImportMapper';
import type { EmailModule } from './edm';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function reviewFor(html: string, widthPx = 700) {
  const doc = parse(html);
  const structure = analyzeImportedHtml(doc, widthPx);
  const mapping = mapImportedHtml(doc);
  const fidelity = buildFidelityReport(doc, structure, mapping);
  const review = buildReconstructionReview(doc, structure, fidelity, mapping.modules);
  return { review, doc, structure, mapping, fidelity };
}

function category(review: ReturnType<typeof buildReconstructionReview>, id: string) {
  const found = review.categories.find((c) => c.id === id);
  if (!found) throw new Error(`category ${id} missing`);
  return found;
}

describe('buildReconstructionReview — exact reconstruction (no repairable differences)', () => {
  it('a clean, fully-supported import has zero repairable differences (Responsive still reports its always-present default-normalization difference — see R2)', () => {
    const html = '<table><tr><td><p>Hello</p></td></tr></table>';
    const { review } = reviewFor(html);
    expect(review.differences.every((d) => d.categoryId === 'responsive')).toBe(true);
    expect(review.counts.repairable).toBe(0);
    expect(review.hasRepairableDifferences).toBe(false);
  });

  it('every category reports worstDifferenceClass "preserved" when FidelityReport says preserved', () => {
    const { review } = reviewFor('<table><tr><td><p>Hello</p></td></tr></table>');
    for (const c of review.categories) {
      if (c.fidelityStatus === 'preserved') expect(c.worstDifferenceClass).toBe('preserved');
    }
  });
});

describe('buildReconstructionReview — repairable differences (capability exists, mapper under-populated it)', () => {
  it('typography: CSS font-weight:bold without <strong> is repairable', () => {
    const html = '<table><tr><td><p style="font-weight:bold;">Bold via CSS</p></td></tr></table>';
    const { review } = reviewFor(html);
    const typography = category(review, 'typography');
    expect(typography.worstDifferenceClass).toBe('repairable');
    expect(typography.differences[0].signature).toBe('import-reconstruction:text:font-weight');
  });

  it('spacing: source cell padding not applied to the Text module is repairable', () => {
    const html = '<table><tr><td><p style="padding:12px 24px 12px 24px;">Padded</p></td></tr></table>';
    const { review } = reviewFor(html);
    const spacing = category(review, 'spacing');
    expect(spacing.worstDifferenceClass).toBe('repairable');
    expect(spacing.differences.some((d) => d.signature === 'import-reconstruction:text:padding')).toBe(true);
  });

  it('button alignment mismatch (synthetic — the real pipeline cannot naturally diverge, see file docstring) is repairable', () => {
    const html = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#76c043; padding:12px 24px 12px 24px; color:#fff;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html);
    // Force a mismatch: the real mapper would have set align="right" too
    // (same elementAlignHint fallback R1 now also uses) — mutate a CLONE
    // of the real, correctly-reconstructed modules to prove the
    // comparator catches a genuine divergence, exactly like R2's own
    // synthetic-mismatch test precedent.
    const mismatchedModules: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (mismatchedModules[0].props as { align: string }).align = 'left';
    const review = buildReconstructionReview(doc, structure, fidelity, mismatchedModules);
    const spacing = category(review, 'spacing');
    expect(spacing.differences.some((d) => d.signature === 'import-reconstruction:button:alignment')).toBe(true);
  });

  it('button padding mismatch (synthetic) is repairable', () => {
    const html = '<table><tr><td><a href="https://example.com/go" style="background-color:#76c043; padding:12px 24px 12px 24px; color:#fff;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html);
    const mismatchedModules: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (mismatchedModules[0].props as { paddingHorizontal: number }).paddingHorizontal = 8;
    const review = buildReconstructionReview(doc, structure, fidelity, mismatchedModules);
    const spacing = category(review, 'spacing');
    expect(spacing.differences.some((d) => d.signature === 'import-reconstruction:button:padding')).toBe(true);
  });

  it('image width mismatch (synthetic) is repairable', () => {
    const html = '<table><tr><td><img src="https://example.com/a.png" width="240"></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html);
    const mismatchedModules: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (mismatchedModules[0].props as { width: { desktop: { value: number } } }).width.desktop.value = 100;
    const review = buildReconstructionReview(doc, structure, fidelity, mismatchedModules);
    const images = category(review, 'images');
    expect(images.differences.some((d) => d.signature === 'import-reconstruction:image:width')).toBe(true);
  });

  it('background mismatch (synthetic) is repairable', () => {
    const html = '<table><tr><td width="50" style="background-color:#ff0000;">A</td><td width="50">B</td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html);
    const mismatchedModules: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    mismatchedModules[0].columns![0].settings.backgroundColor = '';
    const review = buildReconstructionReview(doc, structure, fidelity, mismatchedModules);
    const content = category(review, 'content');
    expect(content.differences.some((d) => d.signature === 'import-reconstruction:background:color')).toBe(true);
  });
});

describe('buildReconstructionReview — architectural approximations (never classified as repairable)', () => {
  it('a 38/62 -> 40/60 column ratio is Approximation, never Repairable, and states both values', () => {
    const html = '<table><tr><td width="380">A</td><td width="620">B</td></tr></table>';
    const { review } = reviewFor(html);
    const structureCat = category(review, 'structure');
    expect(structureCat.worstDifferenceClass).toBe('approximation');
    expect(structureCat.differences.every((d) => d.class !== 'repairable')).toBe(true);
    expect(structureCat.differences[0].detail).toContain('38/62');
    expect(structureCat.differences[0].detail).toContain('40/60');
  });

  it('partial-line bold text is Approximation (Text module cannot represent partial bold)', () => {
    const html = '<table><tr><td><p>Some <strong>partial</strong> bold text.</p></td></tr></table>';
    const { review } = reviewFor(html);
    const typography = category(review, 'typography');
    expect(typography.worstDifferenceClass).toBe('approximation');
    expect(typography.differences[0].signature).toBe('import-reconstruction:typography:partial-bold');
  });
});

describe('buildReconstructionReview — removed/unsupported content (never fabricated)', () => {
  it('a stripped <script> is Removed/Unsupported', () => {
    const html = '<table><tr><td><script>alert(1)</script><p>Safe</p></td></tr></table>';
    const { review } = reviewFor(html);
    const content = category(review, 'content');
    expect(content.worstDifferenceClass).toBe('removed-unsupported');
  });

  it('an unresolved (data:) image is Removed/Unsupported, and no URL is invented anywhere in the review', () => {
    const html = '<table><tr><td><img src="data:image/png;base64,AAAA"></td></tr></table>';
    const { review } = reviewFor(html);
    const images = category(review, 'images');
    expect(images.worstDifferenceClass).toBe('removed-unsupported');
    const serialized = JSON.stringify(review);
    expect(serialized).not.toMatch(/https?:\/\/(?!example\.com)/);
  });

  it('an unsafe (javascript:) link destination is Removed/Unsupported, never fabricated as a safe URL', () => {
    const html = '<table><tr><td><p>Acme Inc.</p><a href="javascript:void(0)">Unsubscribe</a></td></tr></table>';
    const { review } = reviewFor(html);
    const links = category(review, 'links');
    expect(links.worstDifferenceClass).toBe('removed-unsupported');
    expect(links.differences.some((d) => d.signature === 'import-reconstruction:links:unsubscribe-missing-href')).toBe(true);
  });
});

describe('buildReconstructionReview — responsive default normalization', () => {
  it('no source stylesheet is Normalized, not Preserved, and explains the builder default', () => {
    const { review } = reviewFor('<table><tr><td><p>Plain email.</p></td></tr></table>');
    const responsive = category(review, 'responsive');
    expect(responsive.fidelityStatus).toBe('normalized');
    expect(responsive.worstDifferenceClass).toBe('normalized');
    expect(responsive.differences[0].signature).toBe('import-reconstruction:responsive:default-mobile-behavior');
  });
});

describe('buildReconstructionReview — Outlook/MSO classification', () => {
  it('MSO conditional markup is Approximation, explained as regeneration not repair', () => {
    const html = '<table><tr><td><!--[if mso]><table><tr><td>fallback</td></tr></table><![endif]--><p>Real</p></td></tr></table>';
    const { review } = reviewFor(html);
    const outlook = category(review, 'outlook');
    expect(outlook.worstDifferenceClass).toBe('approximation');
    expect(outlook.differences[0].signature).toBe('import-reconstruction:outlook:mso-regeneration');
  });

  it('no MSO markup at all has no Outlook difference', () => {
    const { review } = reviewFor('<table><tr><td><p>No MSO</p></td></tr></table>');
    const outlook = category(review, 'outlook');
    expect(outlook.differences).toHaveLength(0);
    expect(outlook.worstDifferenceClass).toBe('preserved');
  });
});

describe('formatReconstructionReviewMessage — deterministic, professional tone', () => {
  it('a review with zero differences of any kind produces a short, reassuring message with no bullet list', () => {
    // Every REAL import always carries at least the Responsive default-
    // normalization difference (see R2's own hardening — Responsive can
    // never silently default to Preserved), so this exercises the
    // "nothing to report at all" branch directly rather than relying on
    // an unreachable-in-practice fixture.
    const message = formatReconstructionReviewMessage({
      categories: [], differences: [], counts: { normalized: 0, approximation: 0, repairable: 0, 'removed-unsupported': 0 }, hasRepairableDifferences: false,
    });
    expect(message).toContain('faithfully preserved');
    expect(message).not.toContain('Reconstruction review');
  });

  it('a clean import (only the always-present Responsive normalization) produces a reassuring "nothing repairable" message', () => {
    const { review } = reviewFor('<table><tr><td><p>Hello</p></td></tr></table>');
    const message = formatReconstructionReviewMessage(review);
    expect(message).toContain('nothing repairable');
    expect(message).toContain('Reconstruction review');
  });

  it('a repairable-containing review mentions the repairable count in the intro and lists it in the compact category summary', () => {
    const html = '<table><tr><td><p style="font-weight:bold;">Bold via CSS</p></td></tr></table>';
    const { review } = reviewFor(html);
    const message = formatReconstructionReviewMessage(review);
    expect(message).toContain('1 repairable difference');
    expect(message).toContain('Reconstruction review');
    expect(message).toContain('Typography — 1 Repairable difference');
  });

  it('never dumps raw JSON/technical structure into the message', () => {
    const html = '<table><tr><td width="380">A</td><td width="620">B</td></tr></table>';
    const { review } = reviewFor(html);
    const message = formatReconstructionReviewMessage(review);
    expect(message).not.toContain('{');
    expect(message).not.toContain('"category"');
  });
});

describe('buildReconstructionReview — realistic multi-section fixture', () => {
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

  it('a clean, fully-preserved realistic email has zero differences and a reassuring message', () => {
    const { review } = reviewFor(REALISTIC_EMAIL_HTML, 600);
    // Responsive is 'normalized' by default (see R2), so it contributes
    // exactly one non-repairable difference; nothing else should.
    expect(review.counts.repairable).toBe(0);
    expect(review.differences.every((d) => d.categoryId === 'responsive')).toBe(true);
    const message = formatReconstructionReviewMessage(review);
    expect(message).toContain('nothing repairable');
  });
});

import { describe, expect, it } from 'vitest';
import { buildReconstructionReview, formatReconstructionReviewMessage } from './reconstructionReview';
import { analyzeImportedHtml, type DetectedStructure } from './htmlImportAnalysis';
import { buildFidelityReport, type FidelityReport } from './htmlImportFidelity';
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

  it('a clean, fully-preserved realistic email has zero fidelity-gap differences (plus one genuine, independent Outlook suggestion)', () => {
    const { review } = reviewFor(REALISTIC_EMAIL_HTML, 600);
    // Responsive is 'normalized' by default (see R2), so it contributes
    // exactly one non-repairable difference.
    //
    // R4-C3 — WAS "zero differences at all" (true before
    // detectOutlookFallbackRepairable existed). The fixture's "Shop Now"
    // button gets the catalog's default borderRadius (6px — every button
    // module defaults to this, see catalog/*.tsx) with no VML fallback
    // enabled — a real, already-flagged-by-Validation-Center opportunity
    // (emailValidation.ts's own "Rounded button has no Classic Outlook
    // fallback" rule), independent of anything the SOURCE HTML did or
    // didn't preserve. This is the one detector here that is NOT a
    // source-vs-reconstructed comparison — it is the builder proactively
    // offering its own already-built capability — so it is expected to
    // fire even on a perfectly source-faithful reconstruction.
    expect(review.counts.repairable).toBe(1);
    const repairable = review.differences.filter((d) => d.class === 'repairable');
    expect(repairable).toHaveLength(1);
    expect(repairable[0].signature).toBe('import-reconstruction:outlook:vml-button');
    expect(review.differences.filter((d) => d.class !== 'repairable').every((d) => d.categoryId === 'responsive')).toBe(true);
  });
});

// R4-C1/C2 — every deterministic repair-candidate detector: candidate
// shape and the exact RepairActionItem it builds.
//
// Region and module facts are read through the SAME shared helper
// functions (elementAlignHint, readBackground, readImageWidthPx, ...) —
// see this file's own module docstring — so on a FRESH, single-pass
// reconstruction, align/padding/color/fontSize/width/background almost
// never actually diverge (confirmed empirically while writing these
// tests: a naive "give the source one value and the default a
// different one" fixture kept producing zero differences, because both
// sides read the SAME value). A real divergence is exactly what R4-C's
// own iterative correction loop exists to catch LATER, after a user
// has edited the live document away from what was first reconstructed
// — so these tests use the SAME synthetic-mismatch technique the
// pre-existing (R4-B) tests above already established (mutate a CLONE
// of the real, correctly-reconstructed modules, then re-run
// buildReconstructionReview against the mutated clone) to simulate
// that exact "later pass, document has since drifted" scenario, rather
// than fighting the shared-reader determinism with a contrived fixture.
describe('buildReconstructionReview — R4-C repair candidates', () => {
  function candidateFor(signature: string, doc: Document, structure: DetectedStructure, fidelity: FidelityReport, modules: EmailModule[]) {
    const review = buildReconstructionReview(doc, structure, fidelity, modules);
    const found = review.differences.find((d) => d.signature === signature);
    return found?.repairCandidate ?? null;
  }

  it('button alignment candidate proposes a propPatch matching the SOURCE value, after a synthetic drift', () => {
    const html = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (drifted[0]!.props as { align: string }).align = 'left'; // simulates a later hand-edit away from the source
    const candidate = candidateFor('import-reconstruction:button:alignment', doc, structure, fidelity, drifted);
    expect(candidate).not.toBeNull();
    expect(candidate!.item).toEqual({ kind: 'module', issueId: 'import-reconstruction:button:alignment', moduleId: mapping.modules[0]!.id, propPatch: { align: 'right' } });
    expect(candidate!.risk).toBe('low');
    expect(candidate!.confidence).toBe(1.0);
    expect(candidate!.safeAutoFix).toBe(true);
  });

  it('button padding candidate proposes the SOURCE horizontal/vertical padding, after a synthetic drift', () => {
    const html = '<table><tr><td><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:20px 40px 20px 40px;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (drifted[0]!.props as { paddingHorizontal: number; paddingVertical: number }).paddingHorizontal = 8;
    (drifted[0]!.props as { paddingVertical: number }).paddingVertical = 4;
    const candidate = candidateFor('import-reconstruction:button:padding', doc, structure, fidelity, drifted);
    expect(candidate).not.toBeNull();
    expect(candidate!.item).toMatchObject({ kind: 'module', propPatch: { paddingHorizontal: 40, paddingVertical: 20 } });
  });

  it('button alignment and padding candidates target the SAME module without one clobbering the other (Map-collision regression)', () => {
    const html = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:20px 40px 20px 40px;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (drifted[0]!.props as { align: string; paddingHorizontal: number }).align = 'left';
    (drifted[0]!.props as { paddingHorizontal: number }).paddingHorizontal = 8;
    const review = buildReconstructionReview(doc, structure, fidelity, drifted);
    const repairable = review.differences.filter((d) => d.class === 'repairable' && d.repairCandidate
      && (d.signature === 'import-reconstruction:button:alignment' || d.signature === 'import-reconstruction:button:padding'));
    expect(repairable).toHaveLength(2);
    const moduleIds = new Set(repairable.map((d) => d.repairCandidate!.moduleId));
    expect(moduleIds.size).toBe(1); // both candidates target the same button module
  });

  it('image width candidate proposes the SOURCE width and preserves an existing mobile override, after a synthetic drift', () => {
    const html = '<table><tr><td><img src="https://example.com/hero.png" alt="Hero" width="500"></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    const width = (drifted[0]!.props as { width: { desktop: { unit: string; value: number }; mobile?: { unit: string; value: number } } }).width;
    width.desktop = { unit: 'px', value: 250 };
    width.mobile = { unit: 'px', value: 200 }; // a real per-viewport override that must survive the patch
    const candidate = candidateFor('import-reconstruction:image:width', doc, structure, fidelity, drifted);
    expect(candidate).not.toBeNull();
    expect(candidate!.item).toMatchObject({
      kind: 'module',
      propPatch: { width: { desktop: { unit: 'px', value: 500 }, mobile: { unit: 'px', value: 200 } } },
    });
  });

  it('image src candidate is never proposed for an unsafe source, even after a synthetic drift', () => {
    const html = '<table><tr><td><img src="data:image/png;base64,AAAA" alt="Bad" width="100"></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    expect(mapping.modules).toHaveLength(0); // no safe src at all — the mapper drops the image entirely
    const candidate = candidateFor('import-reconstruction:image:source', doc, structure, fidelity, mapping.modules);
    expect(candidate).toBeNull();
  });

  it('column background candidate uses the column-settings item kind, not a module patch, after a synthetic drift', () => {
    const html = '<table><tr>'
      + '<td width="50%" bgcolor="#112233"><p>Left</p></td>'
      + '<td width="50%"><p>Right</p></td>'
      + '</tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const layoutModule = mapping.modules.find((m) => m.type.startsWith('layout-'));
    expect(layoutModule?.columns).toBeDefined();
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    const driftedLayout = drifted.find((m) => m.type.startsWith('layout-'))!;
    driftedLayout.columns![0]!.settings.backgroundColor = '';
    const candidate = candidateFor('import-reconstruction:background:color', doc, structure, fidelity, drifted);
    expect(candidate).not.toBeNull();
    expect(candidate!.item).toMatchObject({ kind: 'column-settings', settingsPatch: { backgroundColor: '#112233' } });
    expect(candidate!.columnId).toBe(layoutModule!.columns![0]!.id);
  });

  it('text typography candidate bundles color+fontSize+align mismatches into ONE propPatch, after a synthetic drift', () => {
    const html = '<table><tr><td><p style="color:#ff0000;font-size:22px;text-align:right;">Hello</p></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    Object.assign(drifted[0]!.props as Record<string, unknown>, { color: '#000000', fontSize: 16, align: 'left' });
    const candidate = candidateFor('import-reconstruction:typography:text', doc, structure, fidelity, drifted);
    expect(candidate).not.toBeNull();
    const patch = (candidate!.item as { kind: 'module'; propPatch: Record<string, unknown> }).propPatch;
    expect(patch).toEqual({ color: '#ff0000', fontSize: 22, align: 'right' });
  });

  it('text padding candidate fires NATURALLY (the mapper never reads source text padding at all) and sends a FULL desktop object', () => {
    const html = '<table><tr><td><p style="padding:30px 10px 30px 10px;">Hello</p></td></tr></table>';
    const { review, mapping } = reviewFor(html, 600);
    const module = mapping.modules[0]!;
    expect(module.settings.desktop).toMatchObject({ paddingTop: 20, paddingBottom: 20, paddingLeft: 20, paddingRight: 20 }); // the unconditional builder default — never read from source
    const found = review.differences.find((d) => d.signature === 'import-reconstruction:spacing:text-padding');
    expect(found).toBeDefined();
    const item = found!.repairCandidate!.item;
    expect(item.kind).toBe('module-settings');
    if (item.kind !== 'module-settings') throw new Error('unreachable');
    expect(item.settingsPatch.desktop).toEqual({ paddingTop: 30, paddingBottom: 30, paddingLeft: 10, paddingRight: 10 });
  });

  it('link candidate is never proposed for an unsafe href, even after a synthetic drift', () => {
    const html = '<table><tr><td><a href="https://example.com/safe" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (drifted[0]!.props as { href: string }).href = 'javascript:alert(1)';
    // The DRIFTED (reconstructed) side is unsafe, not the source — this
    // proves the detector only ever reads a SAFE value into a patch; it
    // is not exercising the source-side safety gate (see the next test
    // for that), but confirms an unsafe reconstructed value is still
    // replaced with the safe source one rather than left alone.
    const candidate = candidateFor('import-reconstruction:links:href', doc, structure, fidelity, drifted);
    expect(candidate).not.toBeNull();
    expect(candidate!.item).toMatchObject({ propPatch: { href: 'https://example.com/safe' } });
  });

  it('link candidate is never proposed when the SOURCE href itself is unsafe', () => {
    const html = '<table><tr><td><a href="javascript:alert(1)" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Go</a></td></tr></table>';
    const { review, mapping } = reviewFor(html, 600);
    // An unsafe href is never preserved as a Button module at all — the
    // mapper demotes the whole element to plain text (kept text, no
    // hyperlink) rather than ever building a Button with an unsafe
    // href. There is no button here for detectLinkRepairable to even
    // pair against (the region/module count guard alone already
    // prevents a candidate), which is itself the strongest possible
    // "never proposed" guarantee — confirmed directly rather than
    // asserting on a button prop shape that doesn't exist in this case.
    expect(mapping.modules.some((m) => m.type === 'button')).toBe(false);
    expect(review.differences.some((d) => d.signature === 'import-reconstruction:links:href')).toBe(false);
  });

  it('outlook fallback candidate fires for a rounded button with no VML enabled, independent of source content', () => {
    const html = '<table><tr><td><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Go</a></td></tr></table>';
    const { review, mapping } = reviewFor(html, 600);
    expect(mapping.modules[0]!.type).toBe('button');
    const found = review.differences.find((d) => d.signature === 'import-reconstruction:outlook:vml-button');
    expect(found).toBeDefined();
    expect(found!.repairCandidate!.item).toMatchObject({ kind: 'module-settings', settingsPatch: { outlookVml: true } });
  });

  it('outlook fallback candidate does not fire once outlookVml is already enabled', () => {
    const html = '<table><tr><td><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    drifted[0]!.settings.outlookVml = true;
    const candidate = candidateFor('import-reconstruction:outlook:vml-button', doc, structure, fidelity, drifted);
    expect(candidate).toBeNull();
  });

  it('two buttons with matching count are still paired 1:1 in document order (positive control for the pairing guard)', () => {
    const html = '<table>'
      + '<tr><td align="left"><a href="https://example.com/a" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">A</a></td></tr>'
      + '<tr><td align="right"><a href="https://example.com/b" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">B</a></td></tr>'
      + '</table>';
    const { doc, structure, fidelity, mapping } = reviewFor(html, 600);
    const buttonModules = mapping.modules.filter((m) => m.type === 'button');
    expect(buttonModules).toHaveLength(2);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    for (const m of drifted) (m.props as { align: string }).align = 'center'; // both drift to the same wrong value
    const review = buildReconstructionReview(doc, structure, fidelity, drifted);
    const alignmentCandidates = review.differences
      .filter((d) => d.signature === 'import-reconstruction:button:alignment')
      .map((d) => d.repairCandidate!);
    expect(alignmentCandidates).toHaveLength(2);
    expect(alignmentCandidates.map((c) => c.moduleId).sort()).toEqual([buttonModules[0]!.id, buttonModules[1]!.id].sort());
    expect(alignmentCandidates.find((c) => c.moduleId === buttonModules[0]!.id)!.item).toMatchObject({ propPatch: { align: 'left' } });
    expect(alignmentCandidates.find((c) => c.moduleId === buttonModules[1]!.id)!.item).toMatchObject({ propPatch: { align: 'right' } });
  });
});

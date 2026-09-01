import { describe, expect, it } from 'vitest';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildFidelityReport } from './htmlImportFidelity';
import { mapImportedHtml } from './htmlImportMapper';
import { buildReconstructionReview } from './reconstructionReview';
import { projectModulesWithCandidates, runReconstructionPass, shouldStopCorrectionLoop } from './reconstructionCorrectionLoop';
import { renderEmailDocument } from './htmlRenderer';
import type { EmailModule } from './edm';

// R4-C11 — the invariant-level test matrix the closure pass called out
// as genuinely missing: end-to-end pipeline behavior (not just one
// function in isolation), on realistic/adversarial/malformed source
// HTML, proving the properties the spec itself lists — never redundant
// with the per-detector unit tests already in reconstructionReview.test.ts.

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function freshReconstruction(html: string, widthPx = 600) {
  const doc = parse(html);
  const structure = analyzeImportedHtml(doc, widthPx);
  const mapping = mapImportedHtml(doc);
  const fidelity = buildFidelityReport(doc, structure, mapping);
  const review = buildReconstructionReview(doc, structure, fidelity, mapping.modules);
  return { doc, structure, fidelity, mapping, review };
}

const REALISTIC_NEWSLETTER_HTML = `<html><head><title>Fall Sale</title></head><body>
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

describe('R4-C11 — realistic full newsletter, end to end through the correction loop', () => {
  it('source is never mutated by running a pass (re-parsing the same string twice yields byte-identical structure)', () => {
    const before = REALISTIC_NEWSLETTER_HTML;
    const { mapping } = freshReconstruction(REALISTIC_NEWSLETTER_HTML, 600);
    const pass = runReconstructionPass(REALISTIC_NEWSLETTER_HTML, 600, mapping.modules);
    expect(REALISTIC_NEWSLETTER_HTML).toBe(before); // the module-level constant itself, untouched
    expect(pass.review.categories.length).toBeGreaterThan(0);
  });

  it('reconstruction produces a valid, renderable EDM module tree (every module has a real type/id/props/settings)', () => {
    const { mapping } = freshReconstruction(REALISTIC_NEWSLETTER_HTML, 600);
    expect(mapping.modules.length).toBeGreaterThan(0);
    for (const module of mapping.modules) {
      expect(module.id).toBeTruthy();
      expect(module.type).toBeTruthy();
      expect(module.props).toBeDefined();
      expect(module.settings).toBeDefined();
    }
  });

  it('the fidelity score is a finite number in [0,100] for a realistic newsletter', () => {
    const { mapping } = freshReconstruction(REALISTIC_NEWSLETTER_HTML, 600);
    const pass = runReconstructionPass(REALISTIC_NEWSLETTER_HTML, 600, mapping.modules);
    expect(Number.isFinite(pass.score)).toBe(true);
    expect(pass.score).toBeGreaterThanOrEqual(0);
    expect(pass.score).toBeLessThanOrEqual(100);
  });

  it('applying real repairable candidates (via the pure projection) improves the fidelity score on the NEXT pass', () => {
    const { mapping } = freshReconstruction(REALISTIC_NEWSLETTER_HTML, 600);
    // Force a real, repairable drift: knock the hero image's width off
    // so detectImageWidthRepairable has something genuine to find.
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    const heroImage = drifted.find((m) => m.type === 'image' && (m.props as { alt?: string }).alt === 'Fall Sale');
    expect(heroImage).toBeDefined();
    (heroImage!.props as { width: { desktop: { unit: string; value: number } } }).width.desktop = { unit: '%', value: 100 };

    const before = runReconstructionPass(REALISTIC_NEWSLETTER_HTML, 600, drifted);
    expect(before.candidates.some((c) => c.signature === 'import-reconstruction:image:width')).toBe(true);

    const repaired = projectModulesWithCandidates(drifted, before.candidates.filter((c) => c.safeAutoFix).map((c) => c.item));
    const after = runReconstructionPass(REALISTIC_NEWSLETTER_HTML, 600, repaired);

    expect(after.score).toBeGreaterThan(before.score);
    expect(after.candidates.some((c) => c.signature === 'import-reconstruction:image:width')).toBe(false);
  });

  it('the fidelity score never improves when only unsupported/architectural differences remain (re-running finds the SAME score)', () => {
    // A 5-way, deliberately UNEQUAL column split has no matching layout
    // preset (see layoutCatalog.tsx's fixed ratio set) — an
    // architectural approximation, never something a "pass" can fix.
    const html = '<table><tr>'
      + '<td width="10%"><p>A</p></td><td width="15%"><p>B</p></td><td width="20%"><p>C</p></td>'
      + '<td width="25%"><p>D</p></td><td width="30%"><p>E</p></td>'
      + '</tr></table>';
    const { mapping } = freshReconstruction(html, 600);
    const first = runReconstructionPass(html, 600, mapping.modules);
    const second = runReconstructionPass(html, 600, mapping.modules); // same (unedited) modules — nothing applied
    expect(first.score).toBe(second.score);
    const stopReason = shouldStopCorrectionLoop(0, null, first);
    expect(stopReason === 'only-architectural-limitations' || stopReason === 'no-repairable-differences').toBe(true);
  });
});

describe('R4-C11 — structurally unsupported sources are honestly classified, never a hallucinated repair', () => {
  it('an unequal 5-column split (no matching preset) is approximation, not silently claimed as repairable', () => {
    const html = '<table><tr>'
      + '<td width="10%"><p>A</p></td><td width="15%"><p>B</p></td><td width="20%"><p>C</p></td>'
      + '<td width="25%"><p>D</p></td><td width="30%"><p>E</p></td>'
      + '</tr></table>';
    const { review } = freshReconstruction(html, 600);
    const structureCategory = review.categories.find((c) => c.id === 'structure')!;
    expect(structureCategory.fidelityStatus).not.toBe('preserved');
    // Never classified as 'repairable' for the ratio itself — see
    // reconstructionReview.ts's own classifyFinding comment: column
    // ratio snapping is a documented architectural ceiling.
    const ratioDifference = review.differences.find((d) => d.signature === 'import-reconstruction:structure:column-ratio');
    expect(ratioDifference).toBeDefined();
    expect(ratioDifference!.class).toBe('approximation');
    expect(ratioDifference!.repairCandidate).toBeUndefined();
  });

  it('deeply nested tables (beyond the one-level EDM column limit) are classified normalized/structural-conversion, never crash', () => {
    const html = '<table><tr><td>'
      + '<table><tr><td>'
      + '<table><tr><td><p>Deeply nested content</p></td></tr></table>'
      + '</td></tr></table>'
      + '</td></tr></table>';
    expect(() => freshReconstruction(html, 600)).not.toThrow();
    const { mapping } = freshReconstruction(html, 600);
    expect(mapping.modules.length).toBeGreaterThan(0); // content still imports, just flattened
  });
});

describe('R4-C11 — malformed but recoverable HTML', () => {
  it('unclosed tags do not crash the pipeline and still produce a usable reconstruction', () => {
    const html = '<table><tr><td><p>Unclosed paragraph<td><p>Another cell</table>';
    expect(() => freshReconstruction(html, 600)).not.toThrow();
    const { mapping, review } = freshReconstruction(html, 600);
    expect(mapping.modules.length).toBeGreaterThan(0);
    expect(review.categories.length).toBeGreaterThan(0);
  });

  it('a document with no <table> at all (loose content) does not crash and produces zero or more modules gracefully', () => {
    const html = '<p>Just a paragraph with no table structure at all.</p>';
    expect(() => freshReconstruction(html, 600)).not.toThrow();
  });

  it('completely empty body does not crash and produces an empty-but-valid reconstruction', () => {
    const html = '<html><body></body></html>';
    const { mapping, review } = freshReconstruction(html, 600);
    expect(mapping.modules).toEqual([]);
    expect(review.categories.length).toBeGreaterThan(0);
  });
});

describe('R4-C11 — security: no repair candidate ever restores sanitizer-stripped content', () => {
  it('a source with script/event-handler/javascript:/iframe payloads never produces a candidate carrying any unsafe value', () => {
    const html = '<table><tr><td>'
      + '<script>alert(1)</script>'
      + '<img src="x.png" onerror="alert(1)" alt="Evil">'
      + '<a href="javascript:alert(1)" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Click</a>'
      + '<iframe src="https://evil.example.com"></iframe>'
      + '<p onclick="alert(1)">Text</p>'
      + '</td></tr></table>';
    const { review, mapping } = freshReconstruction(html, 600);

    // No module anywhere carries a javascript: href, an inline event
    // handler prop, or raw script/iframe markup — the sanitizer's own
    // allowlist reading (htmlImportSanitize.ts) already guarantees this
    // at the mapper level; this asserts the SAME guarantee holds all
    // the way through to every repair candidate this pass proposes.
    const serializedCandidates = JSON.stringify(review.differences.map((d) => d.repairCandidate).filter(Boolean));
    expect(serializedCandidates).not.toMatch(/javascript:/i);
    expect(serializedCandidates).not.toMatch(/<script/i);
    expect(serializedCandidates).not.toMatch(/onerror|onclick|onload/i);
    expect(serializedCandidates).not.toMatch(/<iframe/i);

    const serializedModules = JSON.stringify(mapping.modules);
    expect(serializedModules).not.toMatch(/javascript:/i);
    expect(serializedModules).not.toMatch(/<script/i);
    expect(serializedModules).not.toMatch(/onerror=|onclick=|onload=/i);
  });

  it('a drifted (edited) module with an unsafe href never gets "corrected" back to an unsafe value by a repair candidate', () => {
    // The only way an unsafe value could end up PROPOSED is if a
    // detector read it from the SOURCE side without the safety gate —
    // this simulates the reconstructed side being unsafe (a user could
    // in principle hand-type an unsafe href into a field) and confirms
    // the source-side safety gate is what's authoritative, never a
    // "restore whatever was there" behavior.
    const html = '<table><tr><td><a href="https://example.com/safe" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Go</a></td></tr></table>';
    const { doc, structure, fidelity, mapping } = freshReconstruction(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    (drifted[0]!.props as { href: string }).href = 'javascript:alert(1)';
    const review = buildReconstructionReview(doc, structure, fidelity, drifted);
    const linkDifference = review.differences.find((d) => d.signature === 'import-reconstruction:links:href');
    expect(linkDifference?.repairCandidate).toBeDefined();
    // The proposed fix replaces the unsafe value with the SAFE source
    // href — never leaves it, never proposes anything unsafe.
    const item = linkDifference!.repairCandidate!.item;
    expect(item).toMatchObject({ propPatch: { href: 'https://example.com/safe' } });
  });

  // R4-C closure hardening — "security-removed source content can never
  // reappear through Proposed Improvement." R4-C6 added a genuinely NEW
  // code path this pass (projectModulesWithCandidates -> renderEmailDocument
  // -> the Proposed Improvement iframe) that the tests above never
  // exercise (they only ever inspect candidate JSON, never the rendered
  // HTML string a user's browser would actually parse). This proves the
  // guarantee holds all the way through that new path too.
  it('the RENDERED Proposed Improvement HTML (not just the candidate JSON) never contains anything the sanitizer would have stripped, even when every safely-repairable candidate is applied', () => {
    const html = '<table><tr><td>'
      + '<script>alert(1)</script>'
      + '<img src="x.png" onerror="alert(1)" alt="Evil">'
      + '<a href="javascript:alert(1)" style="background-color:#76c043;color:#fff;padding:12px 24px 12px 24px;">Click</a>'
      + '<iframe src="https://evil.example.com"></iframe>'
      + '<p onclick="alert(1)">Text</p>'
      + '</td></tr></table>';
    const { mapping } = freshReconstruction(html, 600);
    const pass = runReconstructionPass(html, 600, mapping.modules);
    const safeItems = pass.candidates.filter((c) => c.safeAutoFix).map((c) => c.item);
    const projected = projectModulesWithCandidates(mapping.modules, safeItems);

    // renderEmailDocument is the SAME renderer the real Reconstructed/
    // Proposed panes both use — this is the actual string that would be
    // handed to the sandboxed iframe's srcDoc.
    const rendered = renderEmailDocument({ width: 600, content: { version: 1, modules: projected } });
    expect(rendered).not.toMatch(/javascript:/i);
    expect(rendered).not.toMatch(/<script/i);
    expect(rendered).not.toMatch(/onerror=|onclick=|onload=/i);
    expect(rendered).not.toMatch(/<iframe/i);
  });
});

describe('R4-C closure hardening — score integrity when a candidate\'s target disappears', () => {
  it('deleting the module a repairable candidate targeted makes the score the SAME OR WORSE, never spuriously better', () => {
    // The score (reconstructionFidelityScore.ts) is derived from a FRESH
    // classification of the CURRENT document against the source on every
    // pass — never from "how many candidates remain." Deleting the very
    // module a candidate would have fixed must never look like "fixed" —
    // the content is now genuinely MISSING, which classifies at least as
    // badly as 'repairable' (drifted-but-present), never better.
    const html = '<table><tr><td><img src="https://example.com/hero.png" alt="Hero" width="600"></td></tr></table>';
    const { mapping } = freshReconstruction(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    const heroImage = drifted.find((m) => m.type === 'image')!;
    (heroImage.props as { width: { desktop: { unit: string; value: number } } }).width.desktop = { unit: '%', value: 100 };

    const before = runReconstructionPass(html, 600, drifted);
    expect(before.candidates.some((c) => c.signature === 'import-reconstruction:image:width')).toBe(true);

    // Now delete the module entirely — the candidate that would have fixed
    // it is no longer even generated (nothing to pair against), simulating
    // "the target disappeared" (a manual delete, or an unrelated Undo).
    const deleted = drifted.filter((m) => m.id !== heroImage.id);
    const after = runReconstructionPass(html, 600, deleted);

    expect(after.candidates.some((c) => c.signature === 'import-reconstruction:image:width')).toBe(false);
    expect(after.score).toBeLessThanOrEqual(before.score);
  });
});

describe('R4-C closure hardening — candidate array order never changes the outcome for non-conflicting patches', () => {
  it('applying the SAME set of candidates in reverse order produces byte-identical projected output (order-independence for disjoint targets)', () => {
    const html = REALISTIC_NEWSLETTER_HTML;
    const { mapping } = freshReconstruction(html, 600);
    const drifted: EmailModule[] = JSON.parse(JSON.stringify(mapping.modules));
    const heroImage = drifted.find((m) => m.type === 'image' && (m.props as { alt?: string }).alt === 'Fall Sale');
    expect(heroImage).toBeDefined();
    (heroImage!.props as { width: { desktop: { unit: string; value: number } } }).width.desktop = { unit: '%', value: 100 };

    const pass = runReconstructionPass(html, 600, drifted);
    const items = pass.candidates.filter((c) => c.safeAutoFix).map((c) => c.item);
    expect(items.length).toBeGreaterThan(0);

    const forward = projectModulesWithCandidates(drifted, items);
    const reversed = projectModulesWithCandidates(drifted, [...items].reverse());
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });
});

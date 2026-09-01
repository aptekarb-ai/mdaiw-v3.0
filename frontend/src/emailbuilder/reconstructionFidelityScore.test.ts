import { describe, expect, it } from 'vitest';
import { computeFidelityBreakdown, computeFidelityScore } from './reconstructionFidelityScore';
import type { ReconstructionCategoryReview, ReconstructionReview } from './reconstructionReview';
import { FIDELITY_CATEGORY_ORDER } from './htmlImportFidelity';

function reviewWith(overrides: Partial<Record<string, ReconstructionCategoryReview['worstDifferenceClass']>>): ReconstructionReview {
  const categories: ReconstructionCategoryReview[] = FIDELITY_CATEGORY_ORDER.map((id) => ({
    id, label: id, fidelityStatus: 'preserved', differences: [],
    worstDifferenceClass: overrides[id] ?? 'preserved',
  }));
  return { categories, differences: [], counts: { normalized: 0, approximation: 0, repairable: 0, 'removed-unsupported': 0 }, hasRepairableDifferences: false };
}

describe('computeFidelityScore', () => {
  it('a fully preserved review scores 100', () => {
    expect(computeFidelityScore(reviewWith({}))).toBe(100);
  });

  it('a fully removed/unsupported review scores 0', () => {
    const overrides = Object.fromEntries(FIDELITY_CATEGORY_ORDER.map((id) => [id, 'removed-unsupported' as const]));
    expect(computeFidelityScore(reviewWith(overrides))).toBe(0);
  });

  it('one repairable category out of 8 lowers the score by exactly one category worth of weight', () => {
    const clean = computeFidelityScore(reviewWith({}));
    const oneRepairable = computeFidelityScore(reviewWith({ structure: 'repairable' }));
    expect(oneRepairable).toBeLessThan(clean);
    // total drops from 800 to 740 (one category 100 -> 40), /8 = 92.5,
    // Math.round -> 93, so a 7-point drop from the clean 100.
    expect(clean - oneRepairable).toBe(7);
  });

  it('never claims pixel-perfect fidelity once any category is architecturally approximated', () => {
    const score = computeFidelityScore(reviewWith({ structure: 'approximation' }));
    expect(score).toBeLessThan(100);
  });

  it('fixing a repairable category (repairable -> preserved) always increases the score', () => {
    const before = computeFidelityScore(reviewWith({ typography: 'repairable' }));
    const after = computeFidelityScore(reviewWith({}));
    expect(after).toBeGreaterThan(before);
  });

  // R4-C closure hardening — "score never increases from unsupported/
  // removal merely because a candidate disappears." The score is
  // computed ONLY from `category.worstDifferenceClass` (see
  // computeFidelityScore's own implementation) — it never reads whether
  // any `differences[].repairCandidate` exists at all, so a candidate
  // vanishing (e.g. a restructure made the source<->module pairing
  // ambiguous) can NEVER by itself move the score, only a genuine
  // reclassification of the underlying difference can.
  it('the score is identical whether or not a difference happens to carry a repairCandidate, given the SAME worstDifferenceClass', () => {
    const withCandidate: ReconstructionReview = {
      ...reviewWith({ images: 'repairable' }),
      differences: [{
        categoryId: 'images', class: 'repairable', signature: 'import-reconstruction:image:width', sourcePosition: 'row 1',
        summary: 'x', detail: 'x',
        repairCandidate: {
          id: 'x', categoryId: 'images', signature: 'import-reconstruction:image:width', moduleId: 'm', moduleType: 'image',
          problem: 'x', sourceEvidence: 'x', currentValue: 'x', proposedValue: 'x', expectedImprovement: 'x',
          confidence: 1, risk: 'low', safeAutoFix: true, item: { kind: 'module', issueId: 'x', moduleId: 'm', propPatch: {} },
        },
      }],
    };
    const withoutCandidate: ReconstructionReview = {
      ...reviewWith({ images: 'repairable' }),
      differences: [{
        categoryId: 'images', class: 'repairable', signature: 'import-reconstruction:image:width', sourcePosition: 'row 1',
        summary: 'x', detail: 'x',
        // No repairCandidate — e.g. the pairing became ambiguous after a
        // restructure — but the underlying gap is STILL genuinely there.
      }],
    };
    expect(computeFidelityScore(withCandidate)).toBe(computeFidelityScore(withoutCandidate));
  });
});

describe('computeFidelityBreakdown', () => {
  it('counts one vote per category, matching the score\'s own per-category weighting', () => {
    const breakdown = computeFidelityBreakdown(reviewWith({ structure: 'repairable', images: 'approximation', links: 'normalized' }));
    expect(breakdown.repairable).toBe(1);
    expect(breakdown.approximation).toBe(1);
    expect(breakdown.normalized).toBe(1);
    expect(breakdown.preserved).toBe(FIDELITY_CATEGORY_ORDER.length - 3);
  });
});

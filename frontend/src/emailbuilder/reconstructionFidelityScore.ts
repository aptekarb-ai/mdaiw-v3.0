import { FIDELITY_CATEGORY_ORDER } from './htmlImportFidelity';
import type { ReconstructionDifferenceClass, ReconstructionReview } from './reconstructionReview';

// R4-C5 — a useful reconstruction fidelity score derived DIRECTLY from
// the ALREADY-COMPUTED per-category worstDifferenceClass
// (reconstructionReview.ts) — never a second, independent judgement of
// fidelity, and never a cosmetic/arbitrary percentage. Each of the 8
// fixed FidelityReport categories (structure/content/typography/
// spacing/images/links/responsive/outlook) contributes ONE score point
// weighted equally, so the number always answers a concrete question:
// "of the 8 fidelity dimensions, how close to fully preserved is the
// average one" — never claims pixel-perfect fidelity (a category stuck
// at 'approximation'/'removed-unsupported' can never reach 100 no
// matter how many passes run, by construction).
const CLASS_SCORE: Record<ReconstructionDifferenceClass | 'preserved', number> = {
  preserved: 100,
  normalized: 85,
  approximation: 60,
  repairable: 40,
  'removed-unsupported': 0,
};

export function computeFidelityScore(review: ReconstructionReview): number {
  const byId = new Map(review.categories.map((c) => [c.id, c]));
  let total = 0;
  for (const categoryId of FIDELITY_CATEGORY_ORDER) {
    const category = byId.get(categoryId);
    total += category ? CLASS_SCORE[category.worstDifferenceClass] : CLASS_SCORE.preserved;
  }
  return Math.round(total / FIDELITY_CATEGORY_ORDER.length);
}

// R4-C5 — the Preserved/Normalized/Approximated/Repairable/Removed
// breakdown the spec asks to be shown SEPARATELY from the single score
// number. Counts CATEGORIES (max 8, one vote each — matches the score's
// own per-category weighting), not raw difference counts (a category
// with 3 'repairable' differences still contributes exactly one
// 'repairable' vote here, the same way it contributes exactly one
// CLASS_SCORE deduction above) — the two numbers stay consistent with
// each other by construction.
export interface FidelityBreakdown {
  preserved: number;
  normalized: number;
  approximation: number;
  repairable: number;
  'removed-unsupported': number;
}

export function computeFidelityBreakdown(review: ReconstructionReview): FidelityBreakdown {
  const breakdown: FidelityBreakdown = { preserved: 0, normalized: 0, approximation: 0, repairable: 0, 'removed-unsupported': 0 };
  for (const category of review.categories) breakdown[category.worstDifferenceClass] += 1;
  return breakdown;
}

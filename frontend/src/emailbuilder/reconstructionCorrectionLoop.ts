import type { EmailModule } from './edm';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildFidelityReport, type FidelityReport } from './htmlImportFidelity';
import { mapImportedHtml } from './htmlImportMapper';
import { updateColumnSettings, updateColumnWidths } from './layoutModel';
import { buildReconstructionReview, type ReconstructionReview } from './reconstructionReview';
import { computeFidelityScore } from './reconstructionFidelityScore';
import type { ReconstructionRepairCandidate } from './reconstructionRepairCandidate';
import type { RepairActionItem } from './aiCommand';

// R4-C3/C4 — the iterative bounded correction loop's per-pass unit of
// work. "analyze -> compare -> candidate generation" for one pass:
// re-parses the SAME original sanitized source string every time (never
// a mutated derivative — the source itself is never touched, see this
// module's own re-parse below) and re-runs the EXISTING, unchanged
// analyzeImportedHtml/buildFidelityReport/buildReconstructionReview
// pipeline against the CURRENT live document (`currentModules`, which
// may already reflect earlier Applied repairs) — never against the
// original import-time modules. `mapImportedHtml` is called again here
// too, but ONLY for its `findings` (a pure, deterministic, ALWAYS-
// identical-for-this-source list of mapper-time transformation notes —
// never module-instance-specific); its freshly re-mapped `modules` are
// intentionally discarded, never compared against — that would silently
// revert every prior Apply.
export const MAX_RECONSTRUCTION_PASSES = 3;

// A pass that improves the score by less than this many points is
// "negligible" (R4-C4's own stop condition) — small enough that a real,
// single-category class change (e.g. one category moving from
// 'repairable' (40) to 'preserved' (100) on an 8-category equal-weight
// score moves it by 7-8 points) is never mistaken for negligible, but
// large enough that floating noise/rounding never falsely continues a
// loop that has genuinely plateaued.
const NEGLIGIBLE_SCORE_DELTA = 2;

export interface ReconstructionPassResult {
  review: ReconstructionReview;
  candidates: ReconstructionRepairCandidate[];
  score: number;
  // R4-C6 — the SAME FidelityReport this pass already computes
  // internally to build `review` (buildReconstructionReview's own
  // required input), now exposed on the result too instead of being
  // discarded — ImportReviewWorkspace's `fidelity` prop needs this exact
  // shape, and re-deriving a second one anywhere else would risk it
  // ever disagreeing with the one `review`/`candidates` were built from.
  fidelity: FidelityReport;
}

export function runReconstructionPass(sourceHtml: string, documentWidthPx: number, currentModules: EmailModule[]): ReconstructionPassResult {
  const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
  const structure = analyzeImportedHtml(doc, documentWidthPx);
  const mapping = mapImportedHtml(doc);
  // R4-C closure hardening — a REAL bug caught by a new test: passing the
  // freshly re-mapped `mapping` (always derived straight from `sourceHtml`,
  // so ALWAYS "as if nothing had ever been edited") made buildFidelityReport's
  // own category-level status/verification checks (e.g. imagesFullyVerified
  // in htmlImportFidelity.ts) permanently blind to the LIVE document —
  // deleting a module the source had would silently score as if that
  // content were still perfectly present, because the fidelity report
  // never saw the deletion. Only `buildReconstructionReview` below (which
  // already took `currentModules`) reflected live edits — but ITS OWN
  // per-field detectors intentionally produce NO finding when source-region
  // and reconstructed-module counts disagree (the same "ambiguous pairing
  // -> no finding" safety rule that keeps them from guessing), so a whole
  // deleted module fell through BOTH layers and the category defaulted to
  // 'preserved'. Fix: feed buildFidelityReport the SAME live modules
  // buildReconstructionReview already uses (only `.modules` swapped —
  // `.findings`/`.emailTitle` stay the pure, source-derived facts they
  // always were, matching this function's own established convention of
  // re-parsing but never trusting a second mapper run for module identity).
  const fidelity = buildFidelityReport(doc, structure, { ...mapping, modules: currentModules });
  const review = buildReconstructionReview(doc, structure, fidelity, currentModules);
  const candidates = review.differences
    .map((d) => d.repairCandidate)
    .filter((c): c is ReconstructionRepairCandidate => Boolean(c));
  return { review, candidates, score: computeFidelityScore(review), fidelity };
}

// R4-C4's exact five stop conditions, checked in the order the spec
// lists them; `null` means "keep going." `passesUsed` counts passes
// ALREADY completed before this result (so the very first pass is
// passesUsed=0, checked against the budget for the pass ABOUT to run
// next, not the one that just produced `result`).
export type ReconstructionStopReason =
  | 'no-repairable-differences'
  | 'negligible-improvement'
  | 'only-architectural-limitations'
  | 'pass-budget-exhausted'
  | null;

export function shouldStopCorrectionLoop(
  passesUsed: number, previousScore: number | null, result: ReconstructionPassResult,
): ReconstructionStopReason {
  if (result.candidates.length === 0) {
    // Genuinely nothing left to repair — either fully clean (no
    // repairable differences AT ALL, by classification) or every
    // remaining 'repairable'-classified difference has no safe,
    // unambiguous pairing (e.g. the font-weight aggregate case) — the
    // spec's own "only architectural limitations remain" bucket.
    return result.review.hasRepairableDifferences ? 'only-architectural-limitations' : 'no-repairable-differences';
  }
  if (previousScore !== null && result.score - previousScore < NEGLIGIBLE_SCORE_DELTA) return 'negligible-improvement';
  if (passesUsed + 1 >= MAX_RECONSTRUCTION_PASSES) return 'pass-budget-exhausted';
  return null;
}

// R4-C6 — a PURE projection: "what would the document look like if
// these candidates were applied," computed against a throwaway copy,
// NEVER touching the real document/history. Deliberately its own small
// reimplementation of the same merge-by-moduleId discipline
// useEmailBuilderState.ts's applyRepairPatch already uses (never a
// second Map-collision bug — see that file's own R4-C1 comment) rather
// than sharing code with it: this function has no history/undo/dirty-
// flag concerns at all (it is a preview, called on every candidate
// selection change, never once per user Apply), so keeping it a
// separate, pure, read-only function makes "this can never accidentally
// mutate real state" true by the shape of the code, not by convention.
export function projectModulesWithCandidates(modules: EmailModule[], items: RepairActionItem[]): EmailModule[] {
  const propPatchByModuleId = new Map<string, Record<string, unknown>>();
  const settingsPatchByModuleId = new Map<string, Record<string, unknown>>();
  const restructureByModuleId = new Map<string, number[]>();
  const columnSettingsByKey = new Map<string, { layoutId: string; columnId: string; settingsPatch: Record<string, unknown> }>();

  for (const item of items) {
    if (item.kind === 'module') {
      propPatchByModuleId.set(item.moduleId, { ...propPatchByModuleId.get(item.moduleId), ...item.propPatch });
    } else if (item.kind === 'module-settings') {
      settingsPatchByModuleId.set(item.moduleId, { ...settingsPatchByModuleId.get(item.moduleId), ...item.settingsPatch });
    } else if (item.kind === 'restructure') {
      restructureByModuleId.set(item.moduleId, item.widths);
    } else if (item.kind === 'column-settings') {
      const key = `${item.layoutId}:${item.columnId}`;
      const existing = columnSettingsByKey.get(key);
      columnSettingsByKey.set(key, {
        layoutId: item.layoutId, columnId: item.columnId,
        settingsPatch: { ...existing?.settingsPatch, ...item.settingsPatch },
      });
    }
    // 'document' items are document-settings-scoped, not module-tree-
    // scoped — never applicable to a modules[] projection.
  }

  const applyToList = (list: EmailModule[]): EmailModule[] => list.map((module) => {
    let updated = module;
    const propPatch = propPatchByModuleId.get(module.id);
    if (propPatch) updated = { ...updated, props: { ...updated.props, ...propPatch } };
    const settingsPatch = settingsPatchByModuleId.get(module.id);
    if (settingsPatch) updated = { ...updated, settings: { ...updated.settings, ...settingsPatch } };
    if (updated.columns) {
      updated = { ...updated, columns: updated.columns.map((column) => ({ ...column, modules: applyToList(column.modules) })) };
    }
    return updated;
  });

  let next = applyToList(modules);
  for (const [moduleId, widths] of restructureByModuleId) next = updateColumnWidths(next, moduleId, widths);
  for (const { layoutId, columnId, settingsPatch } of columnSettingsByKey.values()) {
    next = updateColumnSettings(next, layoutId, columnId, settingsPatch);
  }
  return next;
}

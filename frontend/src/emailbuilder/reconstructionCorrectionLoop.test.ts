import { describe, expect, it } from 'vitest';
import { createModule } from './moduleFactory';
import {
  MAX_RECONSTRUCTION_PASSES, projectModulesWithCandidates, runReconstructionPass, shouldStopCorrectionLoop,
} from './reconstructionCorrectionLoop';
import type { ReconstructionPassResult } from './reconstructionCorrectionLoop';

const BUTTON_HTML = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:20px 40px 20px 40px;">Go</a></td></tr></table>';

describe('runReconstructionPass', () => {
  it('re-parses the SAME source every call — never mutates it, always the same structural facts', () => {
    const first = runReconstructionPass(BUTTON_HTML, 600, []);
    const second = runReconstructionPass(BUTTON_HTML, 600, []);
    expect(first.review.categories.map((c) => c.worstDifferenceClass)).toEqual(second.review.categories.map((c) => c.worstDifferenceClass));
  });

  it('compares against the LIVE modules passed in, not a fresh re-mapping of the source', () => {
    // Fresh mapping of BUTTON_HTML produces align="right"; pass in a
    // DIFFERENT (already-edited) live module tree instead and confirm
    // the pass reports a gap against THAT live state, not the source's
    // own fresh mapping.
    const liveButton = createModule('button', 0);
    (liveButton.props as { align: string }).align = 'left';
    const result = runReconstructionPass(BUTTON_HTML, 600, [liveButton]);
    const alignmentCandidate = result.candidates.find((c) => c.signature === 'import-reconstruction:button:alignment');
    expect(alignmentCandidate).toBeDefined();
    expect(alignmentCandidate!.moduleId).toBe(liveButton.id);
  });

  it('a fully clean live reconstruction of the fixture produces a score, not a crash, and zero button-alignment/padding candidates', () => {
    // Build the live tree the SAME way the real mapper would for this
    // exact source, so alignment/padding genuinely match.
    const liveButton = createModule('button', 0);
    (liveButton.props as { align: string; paddingHorizontal: number; paddingVertical: number; href: string; text: string })
      .align = 'right';
    Object.assign(liveButton.props as Record<string, unknown>, { paddingHorizontal: 40, paddingVertical: 20, href: 'https://example.com/go', text: 'Go' });
    const result = runReconstructionPass(BUTTON_HTML, 600, [liveButton]);
    expect(typeof result.score).toBe('number');
    expect(result.candidates.some((c) => c.signature === 'import-reconstruction:button:alignment')).toBe(false);
    expect(result.candidates.some((c) => c.signature === 'import-reconstruction:button:padding')).toBe(false);
  });
});

describe('shouldStopCorrectionLoop', () => {
  // R4-C6 — ReconstructionPassResult grew a `fidelity` field (the exact
  // FidelityReport buildReconstructionReview's own input already was,
  // now also returned instead of discarded — see reconstructionCorrectionLoop.
  // ts's own comment). shouldStopCorrectionLoop itself never reads this
  // field, so an empty-but-typed FidelityReport is sufficient here.
  const emptyFidelity = { categories: [] };
  const cleanResult = (score: number): ReconstructionPassResult => ({
    review: { categories: [], differences: [], counts: { normalized: 0, approximation: 0, repairable: 0, 'removed-unsupported': 0 }, hasRepairableDifferences: false },
    candidates: [], score, fidelity: emptyFidelity,
  });
  const repairableResult = (score: number, candidateCount: number): ReconstructionPassResult => ({
    review: { categories: [], differences: [], counts: { normalized: 0, approximation: 0, repairable: candidateCount, 'removed-unsupported': 0 }, hasRepairableDifferences: candidateCount > 0 },
    candidates: candidateCount > 0 ? [{ id: 'x', categoryId: 'structure', signature: 'x', moduleId: 'm', moduleType: 'text', problem: '', sourceEvidence: '', currentValue: '', proposedValue: '', expectedImprovement: '', confidence: 1, risk: 'low', safeAutoFix: true, item: { kind: 'module', issueId: 'x', moduleId: 'm', propPatch: {} } }] : [],
    score, fidelity: emptyFidelity,
  });

  it('stops with no-repairable-differences when candidates is empty and nothing is classified repairable', () => {
    expect(shouldStopCorrectionLoop(0, null, cleanResult(100))).toBe('no-repairable-differences');
  });

  it('stops with only-architectural-limitations when candidates is empty but repairable differences ARE classified (unpairable case)', () => {
    const result: ReconstructionPassResult = {
      review: { categories: [], differences: [], counts: { normalized: 0, approximation: 0, repairable: 1, 'removed-unsupported': 0 }, hasRepairableDifferences: true },
      candidates: [], score: 80, fidelity: emptyFidelity,
    };
    expect(shouldStopCorrectionLoop(0, null, result)).toBe('only-architectural-limitations');
  });

  it('continues (null) on the first pass with real candidates and no prior score to compare against', () => {
    expect(shouldStopCorrectionLoop(0, null, repairableResult(60, 1))).toBeNull();
  });

  it('stops with negligible-improvement when the score barely moved between passes', () => {
    expect(shouldStopCorrectionLoop(1, 90, repairableResult(91, 1))).toBe('negligible-improvement');
  });

  it('continues when the score improved meaningfully', () => {
    expect(shouldStopCorrectionLoop(1, 60, repairableResult(85, 1))).toBeNull();
  });

  it('stops with pass-budget-exhausted once MAX_RECONSTRUCTION_PASSES would be exceeded', () => {
    expect(shouldStopCorrectionLoop(MAX_RECONSTRUCTION_PASSES - 1, 60, repairableResult(85, 1))).toBe('pass-budget-exhausted');
  });

  it('never loops beyond the documented bound (3)', () => {
    expect(MAX_RECONSTRUCTION_PASSES).toBe(3);
  });
});

describe('projectModulesWithCandidates', () => {
  it('never mutates the input modules array or its entries', () => {
    const button = createModule('button', 0);
    const original = JSON.parse(JSON.stringify(button));
    projectModulesWithCandidates([button], [{ kind: 'module', issueId: 'x', moduleId: button.id, propPatch: { align: 'center' } }]);
    expect(JSON.parse(JSON.stringify(button))).toEqual(original);
  });

  it('merges multiple prop-patch items targeting the same module (no Map-collision)', () => {
    const button = createModule('button', 0);
    const projected = projectModulesWithCandidates([button], [
      { kind: 'module', issueId: 'a', moduleId: button.id, propPatch: { align: 'center' } },
      { kind: 'module', issueId: 'b', moduleId: button.id, propPatch: { text: 'Buy Now' } },
    ]);
    const props = projected[0]!.props as unknown as { align: string; text: string };
    expect(props.align).toBe('center');
    expect(props.text).toBe('Buy Now');
  });

  it('applies a restructure item via the real updateColumnWidths geometry authority', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const projected = projectModulesWithCandidates([layout], [{ kind: 'restructure', issueId: 'x', moduleId: layout.id, widths: [70, 30] }]);
    expect((projected[0]!.props as unknown as { columnWidths: number[] }).columnWidths).toEqual([70, 30]);
  });

  it('applies a column-settings item via the real updateColumnSettings mutator', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const columnId = layout.columns![0]!.id;
    const projected = projectModulesWithCandidates([layout], [
      { kind: 'column-settings', issueId: 'x', layoutId: layout.id, columnId, settingsPatch: { backgroundColor: '#123456' } },
    ]);
    expect(projected[0]!.columns![0]!.settings.backgroundColor).toBe('#123456');
  });

  it('ignores document-scoped items (they are not module-tree-scoped)', () => {
    const text = createModule('text', 0);
    const projected = projectModulesWithCandidates([text], [{ kind: 'document', issueId: 'x', documentPatch: { reset_css_enabled: false } }]);
    expect(projected).toEqual([text]);
  });

  // R4-C closure hardening — a candidate can outlive its target: the
  // user deletes the module, Undoes an insert, or an earlier candidate
  // in the same batch restructures the tree out from under a later
  // one's moduleId. Every branch here is a plain `.map((m) => m.id ===
  // id ? updated : m)` (see layoutModel.ts/useEmailBuilderState.ts's own
  // mutators, which this function mirrors) — zero matches is
  // structurally a no-op, never a throw, never a partial/garbled
  // module. Proven explicitly here rather than left as "true by
  // inspection," across every item kind this function accepts.
  it('a moduleId that does not exist in the tree is a guaranteed no-op for every item kind, never a throw', () => {
    const text = createModule('text', 0);
    const before = JSON.parse(JSON.stringify(text));
    const missingId = 'module-that-does-not-exist';

    expect(() => projectModulesWithCandidates([text], [
      { kind: 'module', issueId: 'a', moduleId: missingId, propPatch: { align: 'center' } },
      { kind: 'module-settings', issueId: 'b', moduleId: missingId, settingsPatch: { outlookVml: true } },
      { kind: 'restructure', issueId: 'c', moduleId: missingId, widths: [50, 50] },
      { kind: 'column-settings', issueId: 'd', layoutId: missingId, columnId: 'also-missing', settingsPatch: { backgroundColor: '#123456' } },
    ])).not.toThrow();

    const projected = projectModulesWithCandidates([text], [
      { kind: 'module', issueId: 'a', moduleId: missingId, propPatch: { align: 'center' } },
      { kind: 'module-settings', issueId: 'b', moduleId: missingId, settingsPatch: { outlookVml: true } },
    ]);
    expect(JSON.parse(JSON.stringify(projected[0]))).toEqual(before);
  });

  it('a moduleId that existed when candidates were generated but was deleted before projection leaves the rest of the tree untouched', () => {
    const survivor = createModule('text', 0);
    const deletedTarget = createModule('button', 1);
    const projected = projectModulesWithCandidates([survivor], [
      // deletedTarget is intentionally absent from the tree passed in —
      // simulates "the user deleted it, or Undo removed it, between
      // candidate generation and this projection."
      { kind: 'module', issueId: 'x', moduleId: deletedTarget.id, propPatch: { align: 'center' } },
    ]);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.id).toBe(survivor.id);
    expect(projected[0]!.props).toEqual(survivor.props);
  });
});

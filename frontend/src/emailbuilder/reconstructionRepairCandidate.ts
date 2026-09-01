import type { FidelityCategoryId } from './htmlImportFidelity';
import type { RepairActionItem } from './aiCommand';
import type { RepairCandidate } from './repairEngine';
import type { ValidationCategoryId } from './emailValidation';

// R4-C1 — the reconstruction repair-candidate model. A DIFFERENT
// question from ReconstructionDifference (reconstructionReview.ts):
// that type answers "what kind of gap is this, and how severe" (pure
// classification, review.ts's own long-standing job); this type answers
// "is there a concrete, safe, already-validated builder action that
// would close this specific gap for this specific module" — only ever
// attached to a ReconstructionDifference when BOTH the source region
// and the reconstructed module were paired unambiguously (same
// technique reconstructionReview.ts's own detectButtonRepairable etc.
// already established: ordered, same-role, count-matched pairing; an
// ambiguous pairing produces NO candidate rather than a guess).
//
// Every field required by the R4-C1 spec is present. `item` reuses the
// EXISTING RepairActionItem union (repairEngine.ts's own validation-
// issue repair mechanism) — never a second mutation system. Every
// value this file ever puts in `item.propPatch`/`settingsPatch` comes
// from a TypeScript-typed field read off DetectedRegion (e.g.
// region.typography.color) or off the module's OWN current typed props
// (e.g. props.align) — never a free-form/AI-invented property name, so
// there is no separate runtime capability check the way the AI-command
// path needs one for untrusted provider output (see ai_command.py's
// module docstring on why THAT path needs validate_action(); this path
// is 100% our own compile-time-typed code writing to fields it already
// knows exist on that exact module/column type).
export interface ReconstructionRepairCandidate {
  // Stable across passes as long as the underlying module/column id
  // doesn't change (true for every candidate kind here — all are prop/
  // settings patches, never insert/delete/reorder) — signature + target
  // id, never a running counter.
  id: string;
  categoryId: FidelityCategoryId;
  // Matches reconstructionReview.ts's own ReconstructionDifference.signature
  // convention exactly (`import-reconstruction:<category>:<kind>`) — the
  // SAME stable signature learning.py's SIGNATURE_PATTERN already
  // expects, so a reconstruction repair signal round-trips through the
  // existing learning system with the existing signature convention.
  signature: string;
  sourcePosition?: string;
  // "target builder module/module path" — moduleId always identifies
  // the module being changed; columnPath is present only when the
  // target is a column's own settings (background/padding), never both
  // ambiguously.
  moduleId: string;
  moduleType: string;
  columnId?: string;
  problem: string;
  sourceEvidence: string;
  currentValue: string;
  proposedValue: string;
  expectedImprovement: string;
  // Deterministic candidates are always 1.0 — never a model guess (see
  // module docstring above). A future candidate kind produced with Local
  // AI assistance (R4-C8's "ambiguous semantic mapping" tier) would carry
  // a genuinely lower value; none of the detectors in this closure pass
  // do, so this is always 1.0 today.
  confidence: number;
  // 'low' — a scalar prop/settings value patch, bounded by the exact
  // same type the field already declares (color string, number, safe
  // URL). 'medium' — reserved for structural changes (none of the
  // detectors in this pass emit RESTRUCTURE_LAYOUT-shaped candidates —
  // column ratio stays a correctly-classified architectural
  // approximation, see reconstructionReview.ts's own comment).
  risk: 'low' | 'medium';
  safeAutoFix: boolean;
  item: RepairActionItem;
}

// Purely deterministic — signature + target id, NEVER a counter or
// timestamp. R4-C1 requires a STABLE candidate id: the same underlying
// gap, re-detected on a later pass against the same (unedited) module,
// must produce the exact same id so learning signals and "already
// reviewed this one" bookkeeping stay meaningful across passes.
export function buildCandidateId(signature: string, moduleId: string): string {
  return `${signature}:${moduleId}`;
}

// R4-C4/C9 — adapts a ReconstructionRepairCandidate onto the EXISTING
// RepairCandidate shape (repairEngine.ts) so AIEngineerPanel's ALREADY-
// BUILT pending-repair proposal card, Apply/Cancel handlers, and
// learning-signal recording (both call signatureForIssueId(candidate.
// issueId) unconditionally) all work completely UNCHANGED for a
// reconstruction batch — never a second proposal UI, never a second
// Apply/Cancel/learning code path.
//
// `issueId` is set to the candidate's own `signature` (NEVER `id`,
// which additionally embeds the per-document moduleId) — signature
// alone is already the stable, cross-document, no-per-instance-suffix
// shape signatureForIssueId's own docstring requires of whatever a
// learning signature is derived from. A small, accepted precision loss:
// signatureForIssueId's slice(0,2) keeps only the first two ':'-
// separated segments, so a 3-segment reconstruction signature like
// "import-reconstruction:button:alignment" is recorded as the coarser
// "import-reconstruction:button" — never wrong, just one level less
// granular than the full signature this file itself computes; changing
// signatureForIssueId's own slicing to special-case reconstruction
// signatures was judged riskier (an already-shipped, well-tested
// function used by every other repair kind too) than this acceptable
// granularity trade-off.
const CATEGORY_TO_VALIDATION_CATEGORY: Record<FidelityCategoryId, ValidationCategoryId> = {
  structure: 'html', content: 'html', typography: 'html', spacing: 'html',
  images: 'images', links: 'links', responsive: 'responsive', outlook: 'outlook',
};

export function toRepairCandidate(candidate: ReconstructionRepairCandidate): RepairCandidate {
  return {
    issueId: candidate.signature,
    title: candidate.problem,
    detail: `${candidate.sourceEvidence} ${candidate.expectedImprovement}`.trim(),
    severity: 'warning',
    category: CATEGORY_TO_VALIDATION_CATEGORY[candidate.categoryId],
    affectedClient: candidate.categoryId === 'outlook' ? 'Classic Outlook' : 'All email clients',
    moduleId: candidate.moduleId,
    before: candidate.currentValue,
    after: candidate.proposedValue,
    confidence: candidate.confidence,
    safeAutoFix: true,
    item: candidate.item,
  };
}

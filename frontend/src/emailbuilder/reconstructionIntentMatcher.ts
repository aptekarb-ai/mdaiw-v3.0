import type { FidelityCategoryId } from './htmlImportFidelity';

// R4-C4 — a SMALL, bounded, zero-network local intent matcher for the
// reconstruction-repair conversational commands the spec's own worked
// examples name: "fix everything you safely can" and its close natural
// variants, plus a category-scoped form ("use the original spacing",
// "fix the images"). Deliberately separate from
// aiDocumentIntelligence.ts's own matchDocumentIntent (which already
// has a 'repair-all-safe'/'repair-keyword' pair for ORDINARY
// ValidationReport-derived repairs) rather than extending that shared,
// widely-used resolver: this matcher only ever fires when
// AIEngineerPanel.tsx has an active reconstruction session (see its own
// reconstructionSessionRef check before calling this), so a plain "fix
// this" outside a reconstruction conversation is completely unaffected
// and keeps going through the existing document-intent path exactly as
// before.
//
// "Why doesn't this match?" / "what can't be reproduced?" / "why did
// you change the layout?" — explicitly NOT handled here. Those are
// explain-only questions already served by the EXISTING
// COMPARE_IMPORT_RECONSTRUCTION canonical intent / compute_
// reconstruction_explain_result (backend, R4-B/R4-B4) — reusing that
// path rather than duplicating an explanation engine here.
export type ReconstructionIntentMatch =
  | { kind: 'fix-all-safe' }
  | { kind: 'fix-category'; categoryId: FidelityCategoryId };

const FIX_ALL_RE = /\bfix\s+everything\s+you\s+(can|safely\s+can)\b|\brepair\s+what\s+you\s+can\b|\bfix\s+(this|it|everything)\s+(safely\s+)?you\s+can\b|\bmake\s+this\s+closer\s+to\s+the\s+original\b|\bimprove\s+the\s+reconstruction\b|\bfix\s+all\s+(the\s+)?(safe\s+)?(reconstruction\s+)?(differences|issues|problems)\b/i;

// Order matters — checked top to bottom, first match wins. Keyword
// choices deliberately narrow (never a bare "color" alone, which would
// also match many unrelated sentences) — false negatives here just
// fall through to the normal backend-routed explain/command flow,
// never a wrong local guess.
const CATEGORY_KEYWORDS: { re: RegExp; categoryId: FidelityCategoryId }[] = [
  { re: /\boutlook\b/i, categoryId: 'outlook' },
  { re: /\bimages?\b/i, categoryId: 'images' },
  { re: /\blinks?\b/i, categoryId: 'links' },
  { re: /\b(typograph\w*|font|colou?rs?)\b/i, categoryId: 'typography' },
  { re: /\b(spacing|padding)\b/i, categoryId: 'spacing' },
  { re: /\b(background|structure|layout|columns?)\b/i, categoryId: 'structure' },
];

const FIX_VERB_RE = /\b(fix|repair|correct|use\s+the\s+original|keep\s+the\s+original|match\s+the\s+original)\b/i;

export function matchReconstructionIntent(message: string): ReconstructionIntentMatch | null {
  if (FIX_ALL_RE.test(message)) return { kind: 'fix-all-safe' };
  if (FIX_VERB_RE.test(message)) {
    for (const { re, categoryId } of CATEGORY_KEYWORDS) {
      if (re.test(message)) return { kind: 'fix-category', categoryId };
    }
  }
  return null;
}

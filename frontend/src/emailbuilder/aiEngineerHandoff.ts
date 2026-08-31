import { generateId } from './idGenerator';
import type { ReconstructionReview } from './reconstructionReview';
import type { AICommandImportReconstructionContext } from './aiCommand';

// Validation Center -> AI Engineer handoff. A single explicit, one-shot
// event ("here is one prompt to send, once") rather than "whenever these
// state fields are non-null, send a message" — the latter shape is what
// let React StrictMode's dev-only double-invocation of mount effects (and,
// separately, an AIEngineerPanel remount on tab switch before the seed
// prop had been cleared) send the same handoff twice: two user messages,
// two /ai-command/ requests, two assistant replies from one click.
//
// Idempotent consumption is owned by whichever component never unmounts
// across an AI Engineer tab switch (EmailBuilderWorkspacePage) — see its
// tryConsumeAiEngineerHandoff — never by a ref local to AIEngineerPanel
// alone, since that ref is reset on every remount and would not protect
// against a stale-but-already-consumed handoff surviving into a fresh
// mount. The unique id is what "one-shot" is actually checked against;
// never message text (a user may legitimately send the same text twice).
export interface AIEngineerHandoff {
  id: string;
  source: 'validation' | 'import-reconstruction';
  documentId: number;
  prompt: string;
  issueId?: string;
  createdAt: number;
  // R4-B — only set when source is 'import-reconstruction'. The bounded
  // deterministic classification (never raw source HTML) that lets the
  // handoff-consumption effect seed the first assistant turn directly from
  // formatReconstructionReviewMessage() with NO backend AI call — see §2's
  // "must never be a JSON/technical dump" and §4's "deterministic facts
  // have priority over AI judgement" in the R4-B spec.
  reconstructionReview?: ReconstructionReview;
  // R4-B2 §12 — the SAME R4-A bounded context contract, kept alive for
  // the WHOLE conversation (not just this one-shot first turn) by
  // AIEngineerPanel — see its importReconstructionContextRef. Without
  // this, a follow-up question about the reconstruction has no bounded
  // context to answer from on any turn after the first.
  importReconstructionContext?: AICommandImportReconstructionContext;
}

export function createAIEngineerHandoff(
  documentId: number,
  prompt: string,
  issueId?: string,
): AIEngineerHandoff {
  return {
    id: generateId(),
    source: 'validation',
    documentId,
    prompt,
    issueId,
    createdAt: Date.now(),
  };
}

// R4-B — Import Review's "Review reconstruction with AI Engineer" CTA. The
// prompt field still carries a plain-text user turn (so any code path that
// only reads `.prompt` — history, logging — keeps working), but the
// consuming effect must NOT hand this prompt to handleSend()/the backend:
// the review is already fully classified deterministically, so the AI's
// first turn is formatReconstructionReviewMessage(reconstructionReview),
// injected directly.
export function createImportReconstructionHandoff(
  documentId: number,
  review: ReconstructionReview,
  importReconstructionContext: AICommandImportReconstructionContext,
): AIEngineerHandoff {
  return {
    id: generateId(),
    source: 'import-reconstruction',
    documentId,
    prompt: 'Review the imported email reconstruction.',
    createdAt: Date.now(),
    reconstructionReview: review,
    importReconstructionContext,
  };
}

// One tracker instance must live in a component that does NOT unmount
// across an AI Engineer tab switch (a React ref there survives both
// React StrictMode's synchronous double-invoke of the SAME mount's
// effects — no re-render needed between the two invokes for this to work,
// unlike clearing state — and a later remount of AIEngineerPanel itself).
// A tracker instantiated inside AIEngineerPanel would not survive either
// case; see AIEngineerPanel.tsx's own fallback-only use of one.
export function createConsumedHandoffTracker() {
  const consumed = new Set<string>();
  return {
    // Returns true the FIRST time a given id is seen (and this call is
    // the one that gets to act on it), false every time after — a plain
    // compare-and-swap, not a count or a timer.
    tryConsume(id: string): boolean {
      if (consumed.has(id)) return false;
      consumed.add(id);
      return true;
    },
  };
}

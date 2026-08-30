import { generateId } from './idGenerator';

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
  source: 'validation';
  documentId: number;
  prompt: string;
  issueId?: string;
  createdAt: number;
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

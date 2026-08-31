import type { AIEngineerHandoff } from './aiEngineerHandoff';

// R4-B — carries an import-reconstruction AIEngineerHandoff across the full
// page navigation from ImportHtmlPage (which creates a brand-new document)
// to EmailBuilderWorkspacePage (which mounts fresh for that new document
// id). Unlike the same-page Validation -> AI Engineer handoff, an in-memory
// React ref cannot survive this: it's a real route change, not a state
// update within one still-mounted component tree. sessionStorage is keyed
// per document id so two documents' handoffs can never collide, and the
// entry is read-and-cleared in one step (takePendingImportHandoff) so a
// later reload/back-forward navigation to the same document can never
// resend it — the same one-shot guarantee the in-memory tracker gives the
// Validation case, just implemented with a storage medium that survives a
// navigation instead of a Set<string>.
const STORAGE_KEY_PREFIX = 'mdaiw:ai-engineer-handoff:';

function storageKey(documentId: number): string {
  return `${STORAGE_KEY_PREFIX}${documentId}`;
}

export function storePendingImportHandoff(documentId: number, handoff: AIEngineerHandoff): void {
  try {
    window.sessionStorage.setItem(storageKey(documentId), JSON.stringify(handoff));
  } catch {
    // sessionStorage unavailable (private browsing quota, disabled storage,
    // non-browser test environment) — the AI Engineer tab simply opens
    // without a seeded first turn, same as a plain "click the AI Engineer
    // tab" visit. Never block navigation over this.
  }
}

// Read-and-clear in one call — the entry is removed whether or not a valid
// handoff was found, so a malformed leftover value can never wedge this
// document into a permanently-broken read loop.
export function takePendingImportHandoff(documentId: number): AIEngineerHandoff | null {
  const key = storageKey(documentId);
  try {
    const raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AIEngineerHandoff;
    if (parsed.source !== 'import-reconstruction' || parsed.documentId !== documentId) return null;
    return parsed;
  } catch {
    try { window.sessionStorage.removeItem(key); } catch { /* best-effort cleanup only */ }
    return null;
  }
}

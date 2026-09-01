// R4-C3 — carries the reconstruction session's SOURCE facts across the
// same full-page navigation importHandoffStorage.ts's one-shot handoff
// already crosses (ImportHtmlPage, which parses the source and creates
// a brand-new document, -> EmailBuilderWorkspacePage, which mounts
// fresh for that new document id). UNLIKE that one-shot handoff, this
// entry is read MANY times (once per correction pass, not just once on
// first mount) — never "take"n/cleared on read, only explicitly cleared
// when the user leaves the document (same convention
// aiConversationStorage.ts already uses for the chat history itself).
//
// Stores only the RAW SOURCE HTML string (the exact `documentElement.
// outerHTML` htmlImportParser.ts's own guard already validated once)
// plus the small bookkeeping the correction loop needs — never a second
// document format, never the DetectedStructure/FidelityReport/EDM
// (those are always freely RECOMPUTED from this one string each pass —
// see reconstructionCorrectionLoop.ts's own runReconstructionPass —
// which is also why "source never mutated" holds by construction: every
// pass re-parses this exact same string, never a derivative of it).
const STORAGE_KEY_PREFIX = 'mdaiw:reconstruction-session:';

export interface ReconstructionSessionData {
  documentId: number;
  sourceHtml: string;
  documentWidthPx: number;
  // How many correction passes have already completed for this
  // document — persisted so the bound survives a page reload mid-
  // session rather than silently resetting to 0 (which would let a
  // reload bypass MAX_RECONSTRUCTION_PASSES).
  passesUsed: number;
  lastFidelityScore: number | null;
}

function storageKey(documentId: number): string {
  return `${STORAGE_KEY_PREFIX}${documentId}`;
}

export function storeReconstructionSession(data: ReconstructionSessionData): void {
  try {
    window.sessionStorage.setItem(storageKey(data.documentId), JSON.stringify(data));
  } catch {
    // sessionStorage unavailable — the reconstruction correction loop
    // simply cannot resume across a navigation/reload for this document;
    // it degrades to "no reconstruction session," never blocks anything
    // else (same posture as importHandoffStorage.ts's own best-effort
    // write).
  }
}

export function loadReconstructionSession(documentId: number): ReconstructionSessionData | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(documentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReconstructionSessionData;
    if (parsed.documentId !== documentId || typeof parsed.sourceHtml !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

// Read-modify-write helper — every correction pass updates passesUsed/
// lastFidelityScore in place, keeping the same sourceHtml. No-op
// (silently) when no session exists for this document (e.g. the user
// opened the AI Engineer tab on an ordinary, non-imported document —
// there is nothing to update).
export function updateReconstructionSessionProgress(documentId: number, passesUsed: number, lastFidelityScore: number): void {
  const existing = loadReconstructionSession(documentId);
  if (!existing) return;
  storeReconstructionSession({ ...existing, passesUsed, lastFidelityScore });
}

export function clearReconstructionSession(documentId: number): void {
  try {
    window.sessionStorage.removeItem(storageKey(documentId));
  } catch {
    // best-effort cleanup only
  }
}

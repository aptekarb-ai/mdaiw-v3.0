// Module-4 E10 — per-document AI Engineer conversation persistence.
// LOCAL CLIENT-SIDE ONLY (localStorage), per the approved decision: no
// backend conversation model exists yet, and adding one just to deliver
// this would mean a server migration + a new persistence architecture for
// a single feature — "avoid adding a migration/server persistence system
// merely to deliver E10." Keyed by document id ONLY (a document already
// belongs to exactly one user server-side — see EmailDocument's ownership
// model — and localStorage itself is already per-browser-profile), so
// switching documents never leaks one document's conversation into
// another's. Never stores credentials/secrets — only role/text turns the
// user and the AI Engineer already exchanged in this same UI.
export interface StoredConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

const STORAGE_KEY_PREFIX = 'emailbuilder-ai-conversation:';
// Two independent caps, both enforced on every save — a long history of
// short messages and a short history of long messages are both bounded.
const MAX_STORED_MESSAGES = 20;
const MAX_STORED_CHARS = 8000;

function storageKey(documentId: number): string {
  return `${STORAGE_KEY_PREFIX}${documentId}`;
}

function capMessages(messages: StoredConversationMessage[]): StoredConversationMessage[] {
  let capped = messages.slice(-MAX_STORED_MESSAGES);
  // Drop oldest messages until the serialized size fits, rather than
  // truncating individual message text (a truncated turn mid-sentence is
  // more confusing to re-read than a shorter conversation).
  while (capped.length > 1 && JSON.stringify(capped).length > MAX_STORED_CHARS) {
    capped = capped.slice(1);
  }
  return capped;
}

export function loadConversation(documentId: number): StoredConversationMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(documentId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredConversationMessage => (
        typeof entry === 'object' && entry !== null
        && (entry as StoredConversationMessage).role in { user: 1, assistant: 1 }
        && typeof (entry as StoredConversationMessage).text === 'string'
      ),
    );
  } catch {
    // Malformed/corrupted stored data (e.g. from a future format this
    // version doesn't understand) degrades to an empty conversation,
    // never a crash.
    return [];
  }
}

export function saveConversation(documentId: number, messages: StoredConversationMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(documentId), JSON.stringify(capMessages(messages)));
  } catch {
    // Storage full/unavailable (private browsing, quota) — the
    // conversation simply stays session-only for this tab; never throw
    // out of a chat-send handler over a storage quirk.
  }
}

export function clearConversation(documentId: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(documentId));
  } catch {
    // Ignore — matches saveConversation's posture.
  }
}

// E10 — what actually gets sent to the backend provider per turn: the
// last N turns only (smaller than the full local/display cap above), so
// a long-running conversation never grows the request payload
// unboundedly. Never sends the full stored history verbatim without this
// second, tighter bound.
const MAX_SENT_TURNS = 8;

export function boundedHistoryForRequest(messages: StoredConversationMessage[]): StoredConversationMessage[] {
  return messages.slice(-MAX_SENT_TURNS);
}

// D4-E3K §10/§11/§19 — recognizes a typed CONFIRMATION ("yes, apply it",
// "looks good, do it", "apply both") or REJECTION ("never mind", "forget
// it", "don't make those changes") of a PENDING (not-yet-applied)
// proposal, in English, Hindi, Hinglish, Spanish, and German.
//
// Detection ONLY, mirroring undoIntentMatcher.ts's own established
// convention exactly (same file shape, same explanation-seeking guard,
// same "return a plain classification, let the caller decide" contract)
// — a deliberately SEPARATE, small module rather than folding into
// undoIntentMatcher.ts: that module's own vocabulary means "undo my last
// APPLIED change" (a real document-history operation), while this one's
// REJECTION vocabulary ("never mind", "forget it") only makes sense
// against a still-PENDING, not-yet-applied proposal — a related but
// distinct concept that would blur that module's own tested, frozen
// UNDO-specific phrase list if merged into it. AIEngineerPanel.tsx's own
// pending-proposal branch already reuses undoIntentMatcher.ts's
// cancel/revert/restore vocabulary for pending-proposal rejection too
// (see that branch's own comment) — this module adds the phrases that
// vocabulary never covered (bare "never mind"/"forget it", with no
// undo/cancel/revert verb at all) plus the wholly-new CONFIRMATION side,
// which undoIntentMatcher.ts has no equivalent of at all.
//
// Deterministic substring/regex matching only — no OpenAI, no local LLM.

export type ProposalResponse = 'confirm' | 'reject' | 'none';

type SupportedLanguage = 'en' | 'hi' | 'es' | 'de';

// A message ASKING about the proposal ("why did you choose that?", "what
// will this change?") must never be misread as a confirmation/rejection
// just because it is short — the same question-vs-action distinction
// undoIntentMatcher.ts's own EXPLANATION_SEEKING_RE already establishes.
const EXPLANATION_SEEKING_RE: Record<SupportedLanguage, RegExp> = {
  en: /^\s*(why|what|how|when|will|does)\b|\?\s*$/i,
  hi: /क्यों|क्या|कैसे|\?\s*$/,
  es: /^\s*¿|\bpor\s+qu[ée]\b|\bqu[ée]\b|\?\s*$/i,
  de: /\bwarum\b|\bwieso\b|\bwas\b|\?\s*$/i,
};

const DEVANAGARI_RE = /[ऀ-ॿ]/;
// D4-E3K §19 — romanized Hindi ("Hinglish") carries no Devanagari script
// at all, so a script-only check would silently misclassify "cancel
// karo"/"rehne do" as English (zero ES/DE stopword hits, defaulting to
// 'en') and never reach the Hindi phrase list below. These are common
// Hinglish grammatical markers with no equivalent meaning in English/
// Spanish/German, so their presence is a reliable, cheap signal —
// mirrors the same real gap already found and fixed for
// resolveExclusions()'s own bounded-capture Hindi patterns in D4-E3J.
const HINGLISH_MARKERS = new Set(['karo', 'kardo', 'kar', 'karna', 'kariye', 'haan', 'nahi', 'nahin', 'mat', 'rehne', 'chhodo', 'chodo', 'theek', 'thik']);
const ES_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'para', 'con', 'por', 'como', 'está', 'esta',
  'aplica', 'aplícalo', 'aplicalo', 'hazlo', 'cancela', 'olvídalo', 'olvidalo', 'déjalo', 'dejalo', 'sí',
  'se', 've', 'bien', 'lo', 'hagas',
]);
const DE_STOPWORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'sind', 'mit', 'für', 'auf', 'zu', 'von', 'nicht', 'ja',
  'mach', 'wende', 'an', 'vergiss', 'es', 'abbrechen', 'lass', 'sieht', 'gut', 'aus',
]);

function detectLanguage(text: string): SupportedLanguage {
  if (DEVANAGARI_RE.test(text)) return 'hi';
  const words = text.toLowerCase().match(/[a-zàâäéèêëïîôöùûüçßáíóúñ']+/g) ?? [];
  let esScore = 0;
  let deScore = 0;
  let hinglishScore = 0;
  for (const word of words) {
    if (ES_STOPWORDS.has(word)) esScore += 1;
    if (DE_STOPWORDS.has(word)) deScore += 1;
    if (HINGLISH_MARKERS.has(word)) hinglishScore += 1;
  }
  if (hinglishScore > 0 && hinglishScore >= esScore && hinglishScore >= deScore) return 'hi';
  if (esScore === 0 && deScore === 0) return 'en';
  return deScore > esScore ? 'de' : 'es';
}

// English confirmation: a bare "yes"/"yep"/"sure" agreement word, OR an
// explicit apply/do-it instruction. "Apply both" (Phase 11's own
// example) is covered by the bare "apply" branch — the pending
// proposal's OWN operations are what get applied, never re-derived from
// how many things the user names.
const EN_CONFIRM_RE = /\b(?:yes|yep|yeah|correct|confirmed?|looks?\s+good|sounds?\s+good|go\s+ahead|do\s+it|apply\s+(?:it|that|this|both)|sure,?\s+(?:apply|do\s+it))\b/i;
// English rejection: undoIntentMatcher.ts's own cancel/revert/restore
// vocabulary already covers "cancel that"/"undo that" for the pending-
// proposal case (reused by the caller) — this covers what that
// vocabulary never could: a bare dismissal with no undo-shaped verb.
const EN_REJECT_RE = /\bnever\s*mind\b|\bforget\s+it\b|\bskip\s+(?:it|that|this)\b|\bdon'?t\s+(?:make|do)\s+(?:those|that|these|this)(?:\s+changes?)?\b|\bleave\s+it\b/i;

const NON_EN_CONFIRM_PHRASES: Record<'hi' | 'es' | 'de', string[]> = {
  hi: ['haan', 'हाँ', 'हां', 'theek hai', 'ठीक है', 'kar do', 'कर दो', 'apply kar do', 'apply karo', 'लागू करो', 'लागू कर दो'],
  es: ['sí', 'si, aplícalo', 'aplícalo', 'aplicalo', 'hazlo', 'aplica eso', 'aplica los dos', 'aplica ambos', 'se ve bien'],
  de: ['ja', 'ja, mach das', 'mach das', 'wende es an', 'wende an', 'anwenden', 'sieht gut aus', 'beide anwenden'],
};

const NON_EN_REJECT_PHRASES: Record<'hi' | 'es' | 'de', string[]> = {
  hi: ['rehne do', 'रहने दो', 'chhodo', 'छोड़ो', 'cancel karo', 'कैंसिल करो', 'mat karo', 'मत करो'],
  es: ['olvídalo', 'olvidalo', 'déjalo', 'dejalo', 'cancela eso', 'no hagas esos cambios', 'no lo hagas'],
  de: ['vergiss es', 'lass es', 'abbrechen', 'mach das nicht', 'nicht anwenden'],
};

function foldAccents(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function matchProposalResponse(message: string): ProposalResponse {
  const text = (message ?? '').trim();
  if (!text) return 'none';
  const language = detectLanguage(text);
  if (EXPLANATION_SEEKING_RE[language].test(text)) return 'none';

  if (language === 'en') {
    if (EN_CONFIRM_RE.test(text)) return 'confirm';
    if (EN_REJECT_RE.test(text)) return 'reject';
    return 'none';
  }
  if (language === 'hi') {
    // Devanagari phrases are case-insensitive by nature; the romanized
    // Hinglish phrases in this same list are not — lowercase once here
    // (the Devanagari phrases are unaffected by .toLowerCase()).
    const loweredText = text.toLowerCase();
    if (NON_EN_CONFIRM_PHRASES.hi.some((phrase) => loweredText.includes(phrase.toLowerCase()))) return 'confirm';
    if (NON_EN_REJECT_PHRASES.hi.some((phrase) => loweredText.includes(phrase.toLowerCase()))) return 'reject';
    return 'none';
  }
  const folded = foldAccents(text.toLowerCase());
  if (NON_EN_CONFIRM_PHRASES[language].some((phrase) => folded.includes(foldAccents(phrase.toLowerCase())))) return 'confirm';
  if (NON_EN_REJECT_PHRASES[language].some((phrase) => folded.includes(foldAccents(phrase.toLowerCase())))) return 'reject';
  return 'none';
}

// D4-E3K §3/§6/§9 (bounded) — a message that explicitly marks itself as
// correcting/replacing the CURRENT pending proposal ("actually make it
// blue", "no, I meant the footer CTA", "instead, use 16px") rather than
// starting an unrelated new task. Deliberately narrow: this is NOT a
// general "is this turn a continuation" classifier (Section 9's full
// proposal-revision/narrowing behavior — e.g. "actually only change the
// first one" against a multi-target compound proposal — is out of scope
// for this pass and stays a disclosed limitation, see the D4-E3K report).
// This covers exactly the simple, safe, unambiguous case: an EXPLICIT
// correction marker signals "replace the pending proposal with whatever
// this message resolves to," letting the caller re-run the SAME
// deterministic-first resolution pipeline it already runs for a
// non-pending message — never a second mutation-extraction engine.
const EN_CORRECTION_MARKER_RE = /^\s*(?:actually|instead|no,?\s+i\s+meant|not\s+that\s+one[,.]?|wait,?\s+i\s+meant)\b/i;
const NON_EN_CORRECTION_MARKERS: Record<'hi' | 'es' | 'de', string[]> = {
  hi: ['nahi, maine', 'actually', 'नहीं, मेरा मतलब', 'balki'],
  es: ['en realidad', 'mejor', 'no, quise decir', 'espera, quise decir'],
  de: ['eigentlich', 'stattdessen', 'nein, ich meinte', 'warte, ich meinte'],
};

// D4-E3L §3 — a SAFE combined transition: "cancel that and make the
// footer background black" / "apply that, then change the second CTA to
// red". Splits off a LEADING clause on a plain connector ("and"/"then"/
// a comma) and re-checks THAT CLAUSE ALONE against the exact same
// confirm/reject vocabulary matchProposalResponse() and undo-family
// matching already use for a bare "yes"/"cancel that" — never a new
// confirm/reject vocabulary of its own. The caller (AIEngineerPanel.tsx)
// is responsible for actually invoking the existing Apply/Cancel handler
// for the matched half and then processing the remainder exactly like
// any other ordinary new turn — this function only ever classifies text,
// it never mutates anything itself. Returns null for a message that
// isn't a genuine "resolve-then-continue" combination — including a
// remainder so short/empty it cannot plausibly be a real new instruction
// (avoids treating "cancel that, then" or "apply it and" as combined).
export interface CombinedProposalTransition {
  kind: 'confirm' | 'reject';
  remainder: string;
}

const COMBINED_CONNECTOR_RE = /^\s*(.+?)\s*(?:,?\s+(?:and|then)\s+|,\s+)(.+?)\s*$/i;

// D4-E3L §3 — the leading clause is checked against the SAME reject
// signal AIEngineerPanel.tsx's own pending-block already uses for a
// bare rejection (matchUndoIntent()'s cancel/revert/restore family OR
// matchProposalResponse()'s own 'reject'), passed in by the caller
// rather than imported directly — undoIntentMatcher.ts is a peer module
// with no dependency on this file today, and keeping it that way (via
// this small injected-predicate seam) avoids this module quietly
// growing a second, wider import surface for what is really a one-line
// check the caller already has on hand.
export function matchCombinedProposalTransition(
  message: string,
  isRejectClause: (clause: string) => boolean,
): CombinedProposalTransition | null {
  const text = (message ?? '').trim();
  if (!text) return null;
  const split = text.match(COMBINED_CONNECTOR_RE);
  if (!split) return null;
  const [, leading, remainder] = split;
  if (!leading || !remainder || remainder.trim().length < 3) return null;
  // D4-E3L §3 hardening — a real defect found via testing: "yes, apply
  // it" and "Never mind, cancel that." both contain a bare comma
  // connector, but neither is a genuine two-part instruction — each is
  // ONE confirm/reject utterance that merely happens to restate itself
  // across the comma ("apply it" restates "yes"; "cancel that" restates
  // "never mind"). The distinguishing signal: a genuine combined
  // transition's remainder is an ORDINARY new command, never itself a
  // confirm/reject/undo phrase. Declining here — rather than only
  // checking the LEADING clause — is what correctly tells these apart.
  if (isRejectClause(remainder) || matchProposalResponse(remainder) === 'confirm') return null;
  if (isRejectClause(leading)) return { kind: 'reject', remainder };
  if (matchProposalResponse(leading) === 'confirm') return { kind: 'confirm', remainder };
  return null;
}

export function isProposalCorrection(message: string): boolean {
  const text = (message ?? '').trim();
  if (!text) return false;
  const language = detectLanguage(text);
  if (language === 'en') return EN_CORRECTION_MARKER_RE.test(text);
  if (language === 'hi') {
    const lowered = text.toLowerCase();
    return NON_EN_CORRECTION_MARKERS.hi.some((phrase) => lowered.startsWith(phrase.toLowerCase()) || text.startsWith(phrase));
  }
  const folded = foldAccents(text.toLowerCase());
  return NON_EN_CORRECTION_MARKERS[language].some((phrase) => folded.startsWith(foldAccents(phrase.toLowerCase())));
}

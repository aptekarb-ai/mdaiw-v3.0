// D4-E3K completion pass — the SMALLEST transient representation needed
// to make a short, bounded sequence of turns about ONE active edit task
// coherent: "make both CTAs green" / "actually only the first one" /
// "increase its padding too" / "do the same to the second CTA". This is
// NOT general conversation memory — it holds only a few already-resolved,
// bounded facts about the CURRENT task, is coupled to the SAME lifecycle
// as PendingProposal (see AIEngineerPanel.tsx's own wiring), and expires
// on Apply, Cancel, a classified NEW_TASK turn, or staleness — never
// persists indefinitely, never stores raw chat history, never becomes a
// second source of truth for the document (Apply/Cancel/Undo remain
// entirely owned by the existing history/proposal machinery; this object
// is discarded, never consulted, the moment either of those runs).
//
// Deterministic pattern matching only — no OpenAI, no local LLM. Reuses
// resolveExclusions()'s own matchedPhrase output for exclusion-phrase
// continuity (never a second exclusion parser) and mirrors
// proposalResponseMatcher.ts's per-language convention for the new
// CONTINUATION/NEW_TASK classifier and the new cross-turn "do the same"
// trigger.
//
// D4-E3K hardening pass §1 — ONE detectLanguage() (below) is the single
// canonical multilingual entry point for every matcher in this file
// (classifyTurnRelation, isSameTrigger, tryNarrowPendingOperations,
// extractPreservationPhrase). Each matcher then consults its OWN small,
// closed per-language marker/pattern table — the SAME shape already used
// by proposalResponseMatcher.ts and referenceResolver.ts elsewhere in
// this module — never a second language-detection engine, never a
// per-function private copy of detectLanguage.
//
// D4-E3L §1/§2 — the ordinal/"last" word tables and the Unicode-safe
// `wb()` boundary helper now live in ordinalReference.ts, the ONE shared
// table referenceResolver.ts's own multilingual target resolution also
// draws from — this file no longer keeps a private copy of either.

import {
  LAST_WORD_ALT, ORDINAL_ALT, ordinalIndexFor, wb, WB_AFTER, WB_BEFORE,
} from './ordinalReference';

export interface ActiveEditTaskContext {
  /** Real module ids this task's most recent resolved action targeted. */
  targetIds: string[];
  /** One representative target's module type — used to re-derive labels/capability context on a later turn. */
  moduleType: string;
  /**
   * The bounded field->value pairs actually resolved for THIS task, taken
   * directly from the already-capability-validated action's own patch —
   * never a raw module snapshot, never a field the user did not ask to
   * change (the backend's own deterministic extraction already
   * guarantees this narrowness; this stores exactly what it returned).
   */
  resolvedFields: Record<string, unknown>;
  /** Raw text of an explicit field-preservation clause from this task, if any (e.g. "don't change the copy") — ALWAYS canonicalized to English by extractPreservationPhrase before storage, regardless of the source language, so it can be re-injected into a continuation turn's outgoing text and still be recognized by the backend's own (English-only) preservation parser. Never parsed into a structured concept here — the backend's own existing preservation machinery does that. */
  preservationPhrase: string | null;
  /** Raw text of an explicit module-exclusion clause from this task, if any (e.g. "except the footer CTA"). Re-injected into a continuation turn's outgoing text so resolveExclusions() re-derives the SAME exclusion. */
  exclusionPhrase: string | null;
  /** Real module ids explicitly excluded from this task, resolved once already (kept only so a later turn can still explain/confirm — the RE-INJECTED exclusionPhrase is what actually re-establishes the constraint). */
  excludedTargetIds: string[];
  /** Turns since this task was last established/reused — same bounded staleness pattern as AIEngineerPanel.tsx's own turnsSinceLastReferentRef. */
  turnsSinceEstablished: number;
}

export const ACTIVE_TASK_STALE_TURN_LIMIT = 3;

type SupportedLanguage = 'en' | 'hi' | 'es' | 'de';

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const HINGLISH_MARKERS = new Set(['karo', 'kardo', 'kar', 'karna', 'kariye', 'bhi', 'usko', 'wahi', 'vahi', 'yehi', 'sirf', 'bhala', 'nahi', 'nahin', 'dusre', 'doosre']);
const ES_STOPWORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'para', 'con', 'por', 'como', 'está', 'esta', 'también', 'tambien', 'mismo', 'solo', 'sólo', 'ademas', 'además', 'haz', 'cambies', 'excepto']);
const DE_STOPWORDS = new Set(['der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'sind', 'mit', 'für', 'auf', 'zu', 'von', 'nicht', 'auch', 'gleiche', 'gleichen', 'nur', 'außerdem', 'ausserdem', 'mach', 'ändern', 'lass']);

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

// D4-E3K completion pass §B — CONTINUATION signals: the message
// grammatically refers back to the active task rather than starting a
// new one. Deliberately a CLOSED, conservative list — anything not
// matching here is NEW_TASK (fail closed, per the checkpoint's own
// explicit rule: "when uncertain, do not inherit constraints").
// "actually"/"instead"/"no I meant" are already covered by
// isProposalCorrection() for the STILL-PENDING case; they are repeated
// here (not imported, to keep this module's own single closed vocabulary
// self-contained and independently testable) for the ALREADY-RESOLVED/
// no-longer-pending case this classifier also has to cover.
const EN_CONTINUATION_RE = /\b(also|and\s+(?:increase|decrease|center|align|make|change|set)|too\b|as\s+well|same|do\s+the\s+same|keep|but\s+keep|only|just\s+the|actually|instead|no,?\s+i\s+meant|not\s+that\s+one|the\s+other|leave\s+.*\s+(?:out|alone|unchanged|as[\s-]is)|except)\b/i;
const NON_EN_CONTINUATION_MARKERS: Record<'hi' | 'es' | 'de', string[]> = {
  hi: ['bhi', 'wahi', 'vahi', 'same', 'sirf', 'ke alawa', 'ko chhodo', 'ko mat badlo', 'karo', 'actually'],
  es: ['también', 'tambien', 'lo mismo', 'igual', 'solo', 'sólo', 'excepto', 'en realidad', 'mejor'],
  de: ['auch', 'ebenfalls', 'gleiche', 'genauso', 'nur', 'außer', 'ausser', 'eigentlich', 'stattdessen'],
};

export function classifyTurnRelation(message: string, hasActiveTask: boolean): 'continuation' | 'new_task' {
  if (!hasActiveTask) return 'new_task';
  const text = (message ?? '').trim();
  if (!text) return 'new_task';
  const language = detectLanguage(text);
  if (language === 'en') return EN_CONTINUATION_RE.test(text) ? 'continuation' : 'new_task';
  const lowered = text.toLowerCase();
  const markers = NON_EN_CONTINUATION_MARKERS[language];
  return markers.some((phrase) => lowered.includes(phrase)) ? 'continuation' : 'new_task';
}

// D4-E3K completion pass §G — a CROSS-TURN "do the same" trigger. Reuses
// nothing from ai_command.py's own _SAME_TRIGGER_RE (that one only ever
// runs backend-side, WITHIN one message's own multi-target compound) —
// this is the frontend-side signal that a SEPARATE, later turn wants the
// SAME semantic operation applied to a newly-named target.
//
// D4-E3K hardening pass §1 — extended to Hindi (romanized + Devanagari)/
// Spanish/German via the SAME detectLanguage() every other matcher in
// this file uses; a small closed pattern per language, never a second
// engine. English is checked first/always (a Hinglish sentence can still
// contain a literal English "do the same" loanword phrase).
const SAME_TRIGGER_PATTERNS: Record<SupportedLanguage, RegExp> = {
  en: /\bdo\s+the\s+same\b|\bsame\s+(?:thing\s+)?(?:to|for|with)\b|\bthat\s+too\b|\bsame\s+treatment\b|\bapply\s+that\b/i,
  hi: new RegExp(
    [
      wb('wahi\\s+karo'), wb('vahi\\s+karo'), wb('same\\s+karo'), wb('yehi\\s+karo'),
      wb('वही\\s+करो'), wb('यही\\s+करो'), wb('उसके\\s+लिए\\s+भी\\s+वही'),
      wb('dusre\\s+ke\\s+liye\\s+bhi\\s+wahi'), wb('isके\\s+liye\\s+bhi\\s+same'),
    ].join('|'),
    'iu',
  ),
  es: /\bhaz\s+lo\s+mismo\b|\blo\s+mismo\s+(?:para|con|a)\b|\baplica\s+lo\s+mismo\b|\bigual\s+para\b/i,
  de: /\bmach\s+das\s+gleiche\b|\bdas\s+gleiche\s+für\b|\bwende\s+das\s+gleiche\s+an\b|\bgenauso\s+für\b/i,
};

export function isSameTrigger(message: string): boolean {
  const text = message ?? '';
  if (SAME_TRIGGER_PATTERNS.en.test(text)) return true;
  const language = detectLanguage(text);
  if (language === 'en') return false;
  return SAME_TRIGGER_PATTERNS[language].test(text);
}

// D4-E3K completion pass §E — detects an explicit field-preservation
// clause, so a CANONICAL ENGLISH restatement of it ("don't change the
// copy") can be remembered and re-injected into a later CONTINUATION
// turn's outgoing message. Canonicalizing to English (rather than
// re-injecting the ORIGINAL non-English text) is the deliberate design:
// the backend's own existing preservation parser
// (_NEGATIVE_CONSTRAINT_RE in ai_command.py) is English-only, and this
// checkpoint's own instructions forbid inventing a second, duplicated
// parser for it in three more languages. Re-deriving the SAME concept in
// English and handing it to the EXISTING backend machinery is reuse, not
// duplication — the domain noun itself (copy/text/padding/color/...) is
// captured verbatim from the user's own message, never translated or
// guessed, since these technical terms are overwhelmingly used as
// English loanwords even in a Hindi/Spanish/German sentence in this
// builder's own domain (see referenceResolver.ts's own ARTICLE_FREE_
// TYPED_RE docstring for the same, independently-established
// observation about module-type words).
const PRESERVATION_CLAUSE_RE = /\b(?:but\s+)?(?:don'?t|do\s+not|never)\s+change\s+(?:the\s+|its\s+)?\w+\b|\bkeep\s+(?:the\s+|its\s+)?\w+(?:\s+(?:as\s+(?:it|they)\s+(?:is|are)|unchanged|the\s+same))?\b|\bwithout\s+changing\s+(?:the\s+|its\s+)?\w+\b|\bleave\s+(?:the\s+|its\s+)?\w+\s+(?:alone|as\s+(?:it|they)\s+(?:is|are)|unchanged)\b/i;

// A "word" token that works across Latin, Devanagari and Hinglish alike
// (JS's own `\w` never matches Devanagari code points).
const TOKEN = '[^\\s,.!?]+';
const NON_EN_PRESERVATION_PATTERNS: Record<'hi' | 'es' | 'de', RegExp[]> = {
  hi: [
    new RegExp(`(${TOKEN})\\s+ko\\s+mat\\s+badlo${WB_AFTER}`, 'iu'),
    new RegExp(`${WB_BEFORE}mat\\s+badlo\\s+(${TOKEN})`, 'iu'),
    new RegExp(`(${TOKEN})\\s+को\\s+मत\\s+बदलो${WB_AFTER}`, 'iu'),
    new RegExp(`${WB_BEFORE}मत\\s+बदलो\\s+(${TOKEN})`, 'iu'),
    new RegExp(`(${TOKEN})\\s+वैसा\\s+ही\\s+रहने\\s+दो${WB_AFTER}`, 'iu'),
  ],
  es: [
    new RegExp(`\\bno\\s+cambies?\\s+(?:el\\s+|la\\s+)?(${TOKEN})\\b`, 'iu'),
    new RegExp(`\\bsin\\s+cambiar\\s+(?:el\\s+|la\\s+)?(${TOKEN})\\b`, 'iu'),
    new RegExp(`\\bmant[eé]n\\s+(?:el\\s+|la\\s+)?(${TOKEN})\\s+igual\\b`, 'iu'),
  ],
  de: [
    new RegExp(`(${TOKEN})\\s+nicht\\s+ändern\\b`, 'iu'),
    new RegExp(`\\bohne\\s+(?:den\\s+|die\\s+|das\\s+)?(${TOKEN})\\s+zu\\s+ändern\\b`, 'iu'),
    new RegExp(`(${TOKEN})\\s+gleich\\s+lassen\\b`, 'iu'),
  ],
};
// Common domain-noun loanword aliases across the supported languages —
// bounded, closed, and only ever used to normalize the CAPTURED word
// into the same canonical noun _NEGATIVE_CONSTRAINT_RE already expects;
// an unrecognized captured word is still used as-is (never dropped).
const FIELD_ALIAS_TO_CANONICAL: Record<string, string> = {
  copy: 'copy', text: 'copy', texto: 'copy', kopie: 'copy', copia: 'copy',
  padding: 'padding', abstand: 'padding', relleno: 'padding',
  color: 'color', colour: 'color', farbe: 'color', rang: 'color',
};

export function extractPreservationPhrase(message: string): string | null {
  const text = (message ?? '').trim();
  if (!text) return null;
  const enMatch = text.match(PRESERVATION_CLAUSE_RE);
  if (enMatch) return enMatch[0];
  const language = detectLanguage(text);
  if (language === 'en') return null;
  for (const pattern of NON_EN_PRESERVATION_PATTERNS[language]) {
    const match = text.match(pattern);
    const captured = match?.[1];
    if (captured) {
      const concept = FIELD_ALIAS_TO_CANONICAL[captured.toLowerCase()] ?? captured.toLowerCase();
      return `don't change the ${concept}`;
    }
  }
  return null;
}

// D4-E3K completion pass §D — narrowing a still-PENDING (never yet
// applied) MULTI-target proposal: "actually only change the first one",
// "only the second one", "not the first one, the second", "leave the
// footer one out". Purely SUBTRACTIVE — it only ever REMOVES operations
// from an already-validated proposal by ordinal position or by matching
// a target's own remembered label; it never adds, invents, or re-derives
// a value. Returns null when the message names no recognizable
// narrowing signal at all (the caller falls through to ordinary
// continuation/correction handling instead).
//
// D4-E3K hardening pass §1 — the ordinal-narrowing path ("only the
// first/second one") is extended to Hindi/Spanish/German via the SAME
// detectLanguage() + a small closed per-language ordinal/marker table
// (now shared with referenceResolver.ts via ordinalReference.ts — see
// this file's own top-of-file comment); NOT_FIRST_THEN_RE and
// LEAVE_OUT_RE (the two rarer, more English-grammar-specific phrasings)
// remain English-only — a disclosed, bounded scope limit (see the
// D4-E3L report) rather than a silent gap.
//
// D4-E3L §2 — "keep only the last button"/"remove the last one" now
// narrows too: each language's ordinal alternation is unioned with its
// own LAST_WORD_ALT entry, and the captured word is resolved via
// ordinalIndexFor() (candidateCount-aware — "last" always means the
// REAL last target, never a fixed index) instead of a plain table
// lookup.
const ONLY_MARKER_ALT: Record<SupportedLanguage, string> = {
  en: 'only|just',
  hi: 'sirf|सिर्फ|केवल|kewal|bas',
  es: 'solo|sólo|solamente|únicamente|unicamente',
  de: 'nur|lediglich',
};
const ORDINAL_OR_LAST_ALT: Record<SupportedLanguage, string> = {
  en: `${ORDINAL_ALT.en}|${LAST_WORD_ALT.en}`,
  hi: `${ORDINAL_ALT.hi}|${LAST_WORD_ALT.hi}`,
  es: `${ORDINAL_ALT.es}|${LAST_WORD_ALT.es}`,
  de: `${ORDINAL_ALT.de}|${LAST_WORD_ALT.de}`,
};
// "only change the first one" / "sirf pehla wala rakho" / "keep only the
// last one" — allow a few filler tokens between the "only" marker and
// the ordinal/"last" word itself so this binds across an intervening
// verb, never past the NEAREST match.
const ONLY_ORDINAL_RE_BY_LANG: Record<SupportedLanguage, RegExp> = {
  en: new RegExp(`\\b(?:${ONLY_MARKER_ALT.en})\\s+(?:\\S+\\s+){0,3}?(${ORDINAL_OR_LAST_ALT.en})\\b`, 'i'),
  hi: new RegExp(`${wb(ONLY_MARKER_ALT.hi)}\\s+(?:\\S+\\s+){0,3}?(${WB_BEFORE}(?:${ORDINAL_OR_LAST_ALT.hi})${WB_AFTER})`, 'iu'),
  es: new RegExp(`${wb(ONLY_MARKER_ALT.es)}\\s+(?:\\S+\\s+){0,3}?(${WB_BEFORE}(?:${ORDINAL_OR_LAST_ALT.es})${WB_AFTER})`, 'iu'),
  de: new RegExp(`${wb(ONLY_MARKER_ALT.de)}\\s+(?:\\S+\\s+){0,3}?(${WB_BEFORE}(?:${ORDINAL_OR_LAST_ALT.de})${WB_AFTER})`, 'iu'),
};
const NOT_FIRST_THEN_RE = /\bnot\s+the\s+(first|1st|second|2nd|third|3rd|last)\s+(?:one)?,?\s+(?:the\s+)?(first|1st|second|2nd|third|3rd|last)\b/i;
const LEAVE_OUT_RE = /\bleave\s+(?:the\s+)?([a-z0-9\s]+?)\s+(?:one\s+)?out\b/i;
// D4-E3L §2 — "remove the footer CTA from that change" / "don't change
// the first one" as an EXPLICIT-target-drop phrasing distinct from
// LEAVE_OUT_RE's own "leave X out" grammar — matched against the SAME
// remembered target labels, never a second label-matching engine.
const DROP_NAMED_RE = /\bremove\s+(?:the\s+)?([a-z0-9\s]+?)\s+from\s+(?:that|this|the)\s+change\b|\bdon'?t\s+change\s+the\s+([a-z0-9\s]+?)(?:\s+one)?\b(?!\s+(?:as|unchanged))/i;

export interface NarrowResult {
  keepIndices: number[];
}

export function tryNarrowPendingOperations(message: string, targetLabels: string[]): NarrowResult | null {
  const text = (message ?? '').trim();
  if (!text) return null;

  const notFirstThen = text.match(NOT_FIRST_THEN_RE);
  if (notFirstThen) {
    const keepIndex = ordinalIndexFor(notFirstThen[2], targetLabels.length);
    if (keepIndex !== undefined) return { keepIndices: [keepIndex] };
  }

  const language = detectLanguage(text);
  const onlyMatch = text.match(ONLY_ORDINAL_RE_BY_LANG[language]);
  if (onlyMatch?.[1]) {
    const keepIndex = ordinalIndexFor(onlyMatch[1], targetLabels.length);
    if (keepIndex !== undefined) return { keepIndices: [keepIndex] };
  }

  const leaveOut = text.match(LEAVE_OUT_RE);
  if (leaveOut) {
    const namedWord = leaveOut[1].trim().toLowerCase();
    const matchIndex = targetLabels.findIndex((label) => label.toLowerCase().includes(namedWord));
    if (matchIndex >= 0) {
      return { keepIndices: targetLabels.map((_, i) => i).filter((i) => i !== matchIndex) };
    }
  }

  const dropNamed = text.match(DROP_NAMED_RE);
  if (dropNamed) {
    const namedWord = (dropNamed[1] ?? dropNamed[2] ?? '').trim().toLowerCase();
    if (namedWord) {
      const matchIndex = targetLabels.findIndex((label) => label.toLowerCase().includes(namedWord));
      if (matchIndex >= 0) {
        return { keepIndices: targetLabels.map((_, i) => i).filter((i) => i !== matchIndex) };
      }
    }
  }

  return null;
}

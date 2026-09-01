// R4-D Checkpoint D2 — recognizes a conversational request to undo the
// most recently APPLIED change ("undo", "undo that", "put it back",
// "revert the last change", ...), in English, Hindi, Spanish, and
// French. Detection ONLY: this module never touches document state — it
// returns a plain boolean, and the caller (AIEngineerPanel.tsx's
// handleSend) is the ONE place that decides what to do with a match:
// either cancel a still-pending proposal (if one exists) or call the
// EXISTING builder history's own undo() (see useEmailBuilderState.ts's
// undo/canUndo — the single source of truth this module never
// duplicates, snapshots, or reverse-engineers). Deliberately its own
// small, self-contained matcher rather than extending
// reconstructionIntentMatcher.ts: D1 is committed and frozen for this
// checkpoint, and Undo is a conceptually distinct, always-available
// intent (it has nothing to do with import reconstruction) — sharing a
// module would couple two things that should stay independent.
//
// Deterministic substring/regex matching only — no OpenAI, no local LLM,
// matching every other local intent matcher already in this codebase
// (reconstructionIntentMatcher.ts, aiDocumentIntelligence.ts). A local
// LLM (if configured) may still later localize the ASSISTANT'S REPLY
// text for a non-English user — this module has nothing to do with
// that; it only decides whether the user's message IS an undo request.

type SupportedLanguage = 'en' | 'hi' | 'es' | 'fr';

// A message that is asking ABOUT a past undo/change ("why did you undo
// that?", "what did you just undo?") must never be misread as a NEW
// undo command just because it contains the word "undo" — the same
// question-vs-action collision D1-A hardened for the reconstruction
// intents, checked here independently (see this module's own docstring
// for why it does not import D1's gate instead).
const EXPLANATION_SEEKING_RE: Record<SupportedLanguage, RegExp> = {
  en: /^\s*(why|what|how|when|did)\b|\?\s*$/i,
  hi: /क्यों|क्या|कैसे|\?\s*$/,
  es: /^\s*¿|\bpor\s+qu[ée]\b|\bqu[ée]\b|\?\s*$/i,
  fr: /\bpourquoi\b|\bqu'est-ce\b|\?\s*$/i,
};

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const ES_STOPWORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'para', 'con', 'por', 'como', 'está', 'esta', 'deshaz', 'deshacer', 'restaura', 'anterior', 'cancela']);
// R4-D Checkpoint D2 — 'restaure' (French verb) and unaccented
// 'precedent'/'precedente' are here for the SAME real-tie reason D1's
// own _LANGUAGE_STOPWORDS['fr'] gained 'ceci'/'cela'/'toi'/'peux': a
// bare "la" is shared with ES_STOPWORDS, and without another unambiguous
// French word, "restaure la version precedente" (accent omitted) would
// tie 1-1 and fall to Spanish, where none of its phrases match.
const FR_STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'que', 'pour', 'avec', 'par', 'comme',
  'annule', 'reviens', 'précédent', 'précédente', 'precedent', 'precedente', 'remets', 'restaure',
]);

function detectLanguage(text: string): SupportedLanguage {
  if (DEVANAGARI_RE.test(text)) return 'hi';
  const words = text.toLowerCase().match(/[a-zàâäéèêëïîôöùûüç']+/g) ?? [];
  let esScore = 0;
  let frScore = 0;
  for (const word of words) {
    if (ES_STOPWORDS.has(word)) esScore += 1;
    if (FR_STOPWORDS.has(word)) frScore += 1;
  }
  if (esScore === 0 && frScore === 0) return 'en';
  return frScore > esScore ? 'fr' : 'es';
}

function foldAccents(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function isExplanationSeeking(text: string, language: SupportedLanguage): boolean {
  return EXPLANATION_SEEKING_RE[language].test(text);
}

// Composed, not an ever-growing list of whole-sentence regexes — a
// determiner ("the"/"your"/"my") + a small noun set covers "undo the
// last change" / "revert your last fix" / "undo my last correction" as
// ONE pattern instead of nine literal phrases.
const DETERMINER = '(?:the|your|my)';
const SCOPE = `(?:that|this|it|${DETERMINER}\\s+last\\s+(?:change|correction|fix|edit)|what\\s+you\\s+just\\s+did|the\\s+way\\s+it\\s+was|${DETERMINER}\\s+previous\\s+(?:version|state))`;
// "undo" is the only verb the spec's own phrase list ever gives BARE
// (just "undo", no object) — every "revert"/"reverse"/"restore"/"cancel"
// example always names a scope ("revert THAT", "restore THE PREVIOUS
// VERSION", "cancel THE LAST CHANGE"). Requiring a scope for those four
// keeps the higher-false-positive-risk verbs (especially "restore" and
// "cancel", both plausible in unrelated sentences) from matching bare,
// while still covering every phrase the spec actually lists.
const EN_UNDO_RE = new RegExp(
  `\\bundo\\b(?:\\s+${SCOPE})?`
  + `|\\b(?:revert|reverse|restore|cancel)\\s+${SCOPE}\\b`
  + `|\\bput\\s+it\\s+back\\b(?:\\s+the\\s+way\\s+it\\s+was)?`,
  'i',
);

const NON_EN_UNDO_PHRASES: Record<'hi' | 'es' | 'fr', string[]> = {
  hi: [
    'पूर्ववत करो', 'आखिरी बदलाव वापस लो', 'आखिरी बदलाव पूर्ववत करो', 'पिछला बदलाव वापस लो',
    'इसे वापस पहले जैसा करो', 'इसे पहले जैसा करो', 'पिछली स्थिति बहाल करो', 'पिछला संस्करण बहाल करो',
    'आखिरी सुधार वापस लो',
  ],
  es: [
    'deshaz eso', 'deshaz esto', 'deshacer eso', 'deshaz el último cambio', 'deshaz la última corrección',
    'deshaz lo que acabas de hacer', 'revierte eso', 'revierte el último cambio', 'revierte tu última corrección',
    'vuélvelo a como estaba', 'ponlo como estaba', 'restaura la versión anterior', 'restaura el estado anterior',
    'cancela el último cambio', 'cancela eso',
  ],
  fr: [
    'annule ça', 'annule cela', 'annule ceci', 'annule la dernière modification', 'annule la dernière correction',
    'annule ta dernière correction', 'annule ce que tu viens de faire', 'reviens en arrière', 'remets comme avant',
    'remets-le comme avant', 'restaure la version précédente', 'restaure l\'état précédent', 'annule le dernier changement',
  ],
};

export function matchUndoIntent(message: string): boolean {
  const text = (message ?? '').trim();
  if (!text) return false;
  const language = detectLanguage(text);
  if (isExplanationSeeking(text, language)) return false;

  if (language === 'en') return EN_UNDO_RE.test(text);
  if (language === 'hi') return NON_EN_UNDO_PHRASES.hi.some((phrase) => text.includes(phrase));

  const folded = foldAccents(text.toLowerCase());
  return NON_EN_UNDO_PHRASES[language].some((phrase) => folded.includes(foldAccents(phrase.toLowerCase())));
}

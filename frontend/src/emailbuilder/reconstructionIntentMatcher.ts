import type { FidelityCategoryId } from './htmlImportFidelity';

// R4-C4 / R4-D Checkpoint D1 — a SMALL, bounded, zero-network local
// intent matcher for the reconstruction-repair conversational commands:
// "fix everything you safely can" and its natural variants (D1-D's own
// required exact phrases), plus a category-scoped form ("use the
// original spacing", "fix the images"). Deliberately separate from
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
// D1-C — multilingual (en/hi/es/fr), mirroring the BACKEND's own
// canonical-intent architecture (intent_normalization.py) in STYLE —
// one structured phrase table per language, an explanation-seeking gate
// checked before any action phrase, semantic normalization instead of
// one-off entire-sentence regexes — never a disconnected one-off regex
// per language. This is a SEPARATE implementation from the backend's
// (TypeScript here, Python there, genuinely cannot share code across
// runtimes without a build step this closure pass does not introduce),
// but it is architecturally the SAME shape on purpose, and the backend
// carries an equivalent (IMPROVE_IMPORT_RECONSTRUCTION,
// intent_normalization.py) as a graceful-degradation safety net for
// whatever phrasing/language this bounded local matcher does not catch
// — see that intent's own docstring.
//
// "Why doesn't this match?" / "what can't be reproduced?" / "why did
// you change the layout?" — explicitly NOT handled here. Those are
// explain-only questions already served by the EXISTING
// COMPARE_IMPORT_RECONSTRUCTION canonical intent / compute_
// reconstruction_explain_result (backend, R4-B/R4-B4/R4-D) — reusing
// that path rather than duplicating an explanation engine here. The
// explanation-seeking gate below is what keeps a question from ever
// reaching the fix-all-safe/fix-category matching, mirroring the
// backend's is_explanation_seeking() in spirit (a separate, smaller
// implementation — this matcher's own vocabulary is narrow enough that
// duplicating the full bipartition machinery was judged not worth the
// added surface; the explain-gate here only needs to reject a handful
// of question openers, not disambiguate ten other intents).
export type ReconstructionIntentMatch =
  | { kind: 'fix-all-safe' }
  | { kind: 'fix-category'; categoryId: FidelityCategoryId };

type SupportedLanguage = 'en' | 'hi' | 'es' | 'fr';

// A question must never be treated as a fix request, regardless of
// language — same "Can you [verb]" polite-request carve-out the backend
// uses (D1-A), so "Can you make it closer to the original?" is still
// recognized as a REQUEST despite starting with a question word.
const POLITE_REQUEST_RE: Record<SupportedLanguage, RegExp> = {
  en: /^\s*(can|could|would)\s+you\s+(make|fix|repair|correct|improve|change|set|use|update|give|keep|preserve)\b/i,
  hi: /^\s*(क्या\s+)?(आप|तुम)\s+.{0,12}(ठीक|सुधार|बदल|बना)\s*(सकते|सकती|सकता)?\s*(हो|हैं)?\b/,
  es: /^\s*¿?\s*(puedes|podrías|podrias)\s+(hacer|arreglar|corregir|mejorar|cambiar|usar)\b/i,
  fr: /^\s*(peux|pourrais)[-\s]tu\s+(faire|réparer|corriger|améliorer|changer|utiliser)\b|^\s*peux[-\s]tu\b/i,
};

const EXPLANATION_SEEKING_RE: Record<SupportedLanguage, RegExp> = {
  // 'can'/'could'/'does'/'is'/'are'/'was'/'were' are safe prefix openers
  // here (unlike a bare mid-sentence check) precisely because
  // POLITE_REQUEST_RE above is checked FIRST and already carves out the
  // one real ambiguity ("Can you make/fix/..."). Mirrors the backend's
  // own is_explanation_seeking() exactly (intent_normalization.py).
  en: /^\s*(why|what|how|can|could|does|is|are|was|were)\b|\b(explain|tell\s+me\s+about)\b|\?\s*$/i,
  hi: /क्यों|क्या|कैसे|समझाओ|समझाइए|\?\s*$/,
  es: /^\s*¿|\bpor\s+qué\b|\bqué\b|\bcómo\b|\bexplica\b|\?\s*$/i,
  fr: /\bpourquoi\b|\bqu'est-ce\b|\bcomment\b|\bexplique\b|\?\s*$/i,
};

function isExplanationSeeking(text: string, language: SupportedLanguage): boolean {
  if (POLITE_REQUEST_RE[language].test(text)) return false;
  return EXPLANATION_SEEKING_RE[language].test(text);
}

// Devanagari block check (Hindi) + a tiny curated Spanish/French
// stopword set — same bounded, dependency-free, best-effort technique
// the backend's own detect_language() uses (never a general-purpose
// language-ID claim). Defaults to 'en' whenever nothing else matches,
// same convention as every other language-aware piece of this app.
const DEVANAGARI_RE = /[ऀ-ॿ]/;
const ES_STOPWORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'para', 'con', 'por', 'como', 'más', 'mas', 'haz', 'hazlo', 'arregla', 'todo', 'puedas', 'segura']);
const FR_STOPWORDS = new Set(['le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'que', 'pour', 'avec', 'par', 'comme', 'plus', 'ce', 'cette', 'ces', 'corrige', 'répare', 'ceci', 'cela', 'toi', 'peux', 'tout']);

function detectLanguage(text: string): SupportedLanguage {
  if (DEVANAGARI_RE.test(text)) return 'hi';
  const words = (text.toLowerCase().match(/[a-zàâäéèêëïîôöùûüç']+/g) ?? []);
  let esScore = 0;
  let frScore = 0;
  for (const word of words) {
    if (ES_STOPWORDS.has(word)) esScore += 1;
    if (FR_STOPWORDS.has(word)) frScore += 1;
  }
  if (frScore > esScore && frScore > 0) return 'fr';
  if (esScore > 0) return 'es';
  return 'en';
}

function foldAccents(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// D1-D — a narrow, targeted normalization: strips a generic TARGET NOUN
// standing between "this/it/the" and a similarity concept, so "make
// THIS BUTTON look like the original" and "make this look like the
// original" reach the SAME English pattern below. Never a content word
// ("image"/"link"/"background") that could change which category a
// fix-category request should legitimately match instead — mirrors the
// backend's own _normalize_target_noun (intent_normalization.py)
// exactly in scope and intent.
const TARGET_NOUN_RE = /\b(this|it|the)\s+(section|module|element|button|cta|part|area|region)\b/gi;

// English fix-all-safe: composed from small, REUSED building blocks
// (verb/scope synonyms) rather than one flat, ever-growing sentence
// list — D1-D's own instruction. Covers every D1-required exact phrase:
// "fix everything/whatever you safely can", "fix the remaining safe
// differences", "make the reconstruction closer to the source", "make
// this look like the imported email", "make this button look like the
// original" (via the target-noun strip above), "look like the
// original" (bare).
const FIX_VERB = '(?:fix|repair|correct|improve)';
const SCOPE = '(?:everything|whatever|all(?:\\s+the)?|the\\s+remaining|what)';
const EN_FIX_ALL_RE = new RegExp(
  [
    `\\b${FIX_VERB}\\s+${SCOPE}\\s+you(?:\\s+safely)?\\s+can\\b`, // fix everything/whatever/all/the remaining you (safely) can
    `\\brepair\\s+what\\s+you\\s+can\\b`,
    `\\b${FIX_VERB}\\s+(?:this|it)\\s+you(?:\\s+safely)?\\s+can\\b`,
    `\\b${FIX_VERB}\\s+(?:all|the\\s+remaining)(?:\\s+the)?(?:\\s+safe)?(?:\\s+reconstruction)?\\s+(?:differences|issues|problems)\\b`,
    `\\bmake\\s+(?:this|it)\\s+(?:closer\\s+to|look\\s+like|match|resemble)\\s+the\\s+(?:original|source|imported(?:\\s+email)?)\\b`,
    // "make THE RECONSTRUCTION closer to/look like ..." — a dedicated
    // alternative (never routed through the generic target-noun strip
    // above, which would collide with "improve the reconstruction"
    // needing that exact word to survive).
    `\\bmake\\s+the\\s+reconstruction\\s+(?:closer\\s+to|look\\s+like|match|resemble)\\s+the\\s+(?:original|source|imported(?:\\s+email)?)\\b`,
    `\\bimprove\\s+the\\s+reconstruction\\b`,
    `\\blook\\s+like\\s+the\\s+(?:original|imported)\\b`,
  ].join('|'),
  'i',
);

// hi/es/fr — plain substring phrase tables, same style as the backend's
// own _INTENT_PHRASES (intent_normalization.py). Covers the same
// required set: fix-everything-safely, make-it-closer-to-the-original/
// look-like-the-original.
const NON_EN_FIX_ALL_PHRASES: Record<'hi' | 'es' | 'fr', string[]> = {
  hi: [
    'जो सुरक्षित रूप से ठीक कर सको वो ठीक करो', 'सब कुछ ठीक करो', 'बाकी बची सुरक्षित समस्याएं ठीक करो',
    'इसे मूल जैसा बनाओ', 'इसे इंपोर्ट किए गए जैसा बनाओ', 'पुनर्निर्माण सुधारो',
  ],
  es: [
    'arregla todo lo que puedas de forma segura', 'arregla lo que puedas de forma segura',
    'arregla las diferencias seguras restantes', 'hazlo más parecido al original',
    'hazlo mas parecido al original', 'hazlo más cercano al original', 'hazlo mas cercano al original',
    'hazlo parecido al correo importado', 'mejora la reconstrucción', 'mejora la reconstruccion',
  ],
  fr: [
    'corrige tout ce que tu peux corriger en toute sécurité', 'corrige tout ce que tu peux corriger en toute securite',
    'corrige ce que tu peux corriger en toute sécurité', 'corrige ce que tu peux corriger en toute securite',
    'corrige les différences sûres restantes', 'corrige les differences sures restantes',
    'rapproche ceci de l\'original', 'rapproche ceci de la source',
    'fais en sorte que cela ressemble à l\'e-mail importé', 'fais en sorte que cela ressemble a l\'e-mail importe',
    'améliore la reconstruction', 'ameliore la reconstruction',
  ],
};

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

// D1-D — 'keep'/'preserve' added alongside the pre-existing fix/repair/
// correct/use-the-original/match-the-original verbs, covering "Keep the
// layout but make it Outlook compatible." (CATEGORY_KEYWORDS' own
// \boutlook\b already recognizes "Outlook" in that same sentence).
const FIX_VERB_RE = /\b(fix|repair|correct|improve|keep|preserve|use\s+the\s+original|match\s+the\s+original)\b/i;

export function matchReconstructionIntent(message: string): ReconstructionIntentMatch | null {
  const language = detectLanguage(message);
  if (isExplanationSeeking(message, language)) return null;

  if (language === 'en') {
    const normalized = message.replace(TARGET_NOUN_RE, '$1');
    if (EN_FIX_ALL_RE.test(normalized)) return { kind: 'fix-all-safe' };
  } else {
    const haystack = language === 'hi' ? message : foldAccents(message.toLowerCase());
    for (const phrase of NON_EN_FIX_ALL_PHRASES[language]) {
      const needle = language === 'hi' ? phrase : foldAccents(phrase.toLowerCase());
      if (haystack.includes(needle)) return { kind: 'fix-all-safe' };
    }
  }

  if (FIX_VERB_RE.test(message)) {
    for (const { re, categoryId } of CATEGORY_KEYWORDS) {
      if (re.test(message)) return { kind: 'fix-category', categoryId };
    }
  }
  return null;
}

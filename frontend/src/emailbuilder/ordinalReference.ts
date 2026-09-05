// D4-E3L §1/§2 — the ONE canonical ordinal/positional-reference
// vocabulary for this builder, shared by referenceResolver.ts (target
// resolution: "make the second CTA green") and activeEditTask.ts
// (pending-proposal narrowing: "only the second one"). D4-E3K shipped
// this vocabulary as a private, English-plus-partial-multilingual copy
// inside activeEditTask.ts alone; extending it to a SECOND file without
// consolidating first would create exactly the "second engine" this
// checkpoint's own instructions forbid, so this module is the single
// source of truth going forward — activeEditTask.ts now imports from
// here instead of defining its own copy.
//
// Deliberately NOT merged with proposalResponseMatcher.ts's or
// activeEditTask.ts's own separate `detectLanguage()` implementations:
// each was independently tuned (different stopword lists) for its own
// narrower classification task (confirm/reject wording vs. continuation
// wording) and both are already shipped, tested, and passing. Merging
// them now would risk destabilizing tuned behavior neither this
// checkpoint nor the last one touched — a deliberate, disclosed
// non-consolidation (see the D4-E3L report). This module never needs
// full language detection at all: referenceResolver.ts matches a single
// unioned multilingual alternation directly (its own established
// try-many-patterns style, never a language branch), and
// activeEditTask.ts keeps its own existing detectLanguage-branching
// style unchanged, just fed from this shared word table instead of a
// private one.

export type OrdinalLanguage = 'en' | 'hi' | 'es' | 'de';

// D4-E3K hardening pass §1 — JS's native `\b` is defined purely in terms
// of ASCII `\w`; it is silently unreliable at a Devanagari (or accented-
// Latin) word edge. `wb()` builds a Unicode-aware boundary via
// lookaround instead (requires the 'u' flag on the resulting RegExp).
// \p{M} (combining marks) is included alongside \p{L}/\p{N}: Devanagari
// vowel signs (matras, e.g. the ा in दूसरा) are Unicode category Mc/Mn,
// not L — omitting \p{M} would let this boundary fire in the middle of
// two concatenated words (a matra immediately followed by the next
// word's first consonant, with no space between, would otherwise look
// like a valid boundary). Verified directly: "दूसरादूसरा" (two words with
// no space) must never match "दूसरा" as a bounded word.
export const WB_BEFORE = '(?<![\\p{L}\\p{N}\\p{M}])';
export const WB_AFTER = '(?![\\p{L}\\p{N}\\p{M}])';
export function wb(alternation: string): string {
  return `${WB_BEFORE}(?:${alternation})${WB_AFTER}`;
}

// Concrete numbered ordinals (0-indexed). "last" is deliberately NOT a
// fixed entry here — its resolved index depends on how many real
// candidates exist, so it is handled separately by ordinalIndexFor()
// below, never hard-coded as a number.
// D4-E3L §1 — Hindi ordinal adjectives inflect for the OBLIQUE case
// before a postposition ("दूसरे CTA को" / "doosre CTA ko" — second-CTA-to),
// not just the nominative form ("दूसरा" / "doosra") D4-E3K's own narrowing
// vocabulary already had (narrowing phrases like "only the second one"
// never put a postposition after the ordinal, so the gap was invisible
// there). Both forms are included for every ordinal so target resolution
// ("दूसरे CTA को हरा करो") and narrowing ("सिर्फ दूसरा वाला रखो") both work.
export const ORDINAL_INDEX: Record<string, number> = {
  first: 0, '1st': 0, one: 0, second: 1, '2nd': 1, two: 1, third: 2, '3rd': 2, three: 2,
  pehla: 0, pehli: 0, pehle: 0, pahla: 0, pahle: 0, ek: 0, 'पहला': 0, 'पहली': 0, 'पहले': 0, 'एक': 0,
  doosra: 1, dusra: 1, doosri: 1, dusri: 1, doosre: 1, dusre: 1, do: 1, 'दूसरा': 1, 'दूसरी': 1, 'दूसरे': 1, 'दो': 1,
  teesra: 2, tisra: 2, teesre: 2, tisre: 2, teen: 2, 'तीसरा': 2, 'तीसरी': 2, 'तीसरे': 2, 'तीन': 2,
  primero: 0, primera: 0, uno: 0,
  segundo: 1, segunda: 1, dos: 1,
  tercero: 2, tercera: 2, tres: 2,
  erste: 0, ersten: 0, erster: 0, eins: 0,
  zweite: 1, zweiten: 1, zweiter: 1, zwei: 1,
  dritte: 2, dritten: 2, dritter: 2, drei: 2,
};
export const ORDINAL_ALT: Record<OrdinalLanguage, string> = {
  en: 'first|1st|one|second|2nd|two|third|3rd|three',
  hi: 'pehla|pehli|pehle|pahla|pahle|ek|पहला|पहली|पहले|एक|doosra|dusra|doosri|dusri|doosre|dusre|do|दूसरा|दूसरी|दूसरे|दो|teesra|tisra|teesre|tisre|teen|तीसरा|तीसरी|तीसरे|तीन',
  es: 'primero|primera|uno|segundo|segunda|dos|tercero|tercera|tres',
  de: 'erste|ersten|erster|eins|zweite|zweiten|zweiter|zwei|dritte|dritten|dritter|drei',
};

// D4-E3L §1 — "last" as a TARGET-selection concept ("make the last CTA
// green") is genuinely new: neither referenceResolver.ts nor
// activeEditTask.ts recognized it before this checkpoint (only concrete
// first/second/third existed). Its resolved index is always
// `candidateCount - 1` — computed fresh against the REAL candidate list
// every time, never a cached/fixed number, so it always means "the
// actual last one" even as the document changes across turns.
export const LAST_WORD_ALT: Record<OrdinalLanguage, string> = {
  en: 'last',
  hi: 'aakhri|aakhiri|akhri|akhiri|आख़िरी|आखिरी|antim|अंतिम|last',
  es: 'último|ultimo|última|ultima',
  de: 'letzte|letzten|letzter',
};

// A single alternation unioning every supported language's concrete-
// ordinal words — used by referenceResolver.ts, which (unlike
// activeEditTask.ts) never branches on detected language at all; it
// simply tries one pattern that already recognizes every language's own
// wording for "first"/"second"/"third", exactly like its own existing
// ARTICLE_FREE_TYPED_RE already does for module-type words.
export const ORDINAL_ALT_ANY_LANGUAGE = Object.values(ORDINAL_ALT).join('|');
export const LAST_WORD_ALT_ANY_LANGUAGE = Object.values(LAST_WORD_ALT).join('|');

/**
 * Resolves an already-matched ordinal/"last" word to a real candidate
 * index, or undefined if it names no valid position for this candidate
 * count. Never fabricates a target: an out-of-range concrete ordinal
 * (e.g. "third" against only 2 candidates) or an empty candidate list
 * both correctly return undefined rather than clamping/guessing.
 */
export function ordinalIndexFor(word: string, candidateCount: number): number | undefined {
  if (candidateCount <= 0) return undefined;
  const lowered = word.toLowerCase();
  const concrete = ORDINAL_INDEX[lowered];
  if (concrete !== undefined) return concrete < candidateCount ? concrete : undefined;
  const isLastWord = Object.values(LAST_WORD_ALT).some((alt) => alt.split('|').some((w) => w.toLowerCase() === lowered));
  return isLastWord ? candidateCount - 1 : undefined;
}

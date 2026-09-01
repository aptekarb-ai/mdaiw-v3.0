import { describe, expect, it } from 'vitest';
import { matchReconstructionIntent } from './reconstructionIntentMatcher';

describe('matchReconstructionIntent', () => {
  it.each([
    'fix everything you safely can',
    'fix everything you can',
    'repair what you can',
    'fix this you can',
    'make this closer to the original',
    'improve the reconstruction',
    'fix all the safe differences',
    'fix all issues',
  ])('recognizes "%s" as fix-all-safe', (message) => {
    expect(matchReconstructionIntent(message)).toEqual({ kind: 'fix-all-safe' });
  });

  it.each([
    ['fix the images', 'images'],
    ['use the original spacing', 'spacing'],
    ['keep the original colors', 'typography'],
    ['fix the links', 'links'],
    ['match the original outlook fallback', 'outlook'],
    ['fix the layout', 'structure'],
  ] as const)('recognizes "%s" as fix-category(%s)', (message, categoryId) => {
    expect(matchReconstructionIntent(message)).toEqual({ kind: 'fix-category', categoryId });
  });

  it.each([
    'why doesn\'t this match?',
    'what can\'t be reproduced?',
    'why did you change the layout?',
    'hello',
    'add a button',
  ])('does not match explain-only or unrelated messages: "%s"', (message) => {
    expect(matchReconstructionIntent(message)).toBeNull();
  });
});

// R4-D Checkpoint D1-D — the exact worked-example phrases the closure
// spec required, verbatim (not close variants) — proves the semantic-
// normalization building blocks (verb/scope synonyms, target-noun
// strip) actually close the paraphrase gaps the R4-D audit found live,
// not just the original, narrower phrase set.
describe('matchReconstructionIntent — D1-D exact worked-example phrases', () => {
  it.each([
    'Make this look like the imported email.',
    'Fix whatever you safely can.',
    'Make this button look like the original.',
    'Look like the original.',
    'Fix the remaining safe differences.',
    'Make the reconstruction closer to the source.',
    'Can you make it closer to the original?',
    'Can you make this section closer to the original?',
  ])('recognizes "%s" as fix-all-safe', (message) => {
    expect(matchReconstructionIntent(message)).toEqual({ kind: 'fix-all-safe' });
  });

  it('"Keep the layout but make it Outlook compatible." is understood as an Outlook-scoped fix, not ignored', () => {
    expect(matchReconstructionIntent('Keep the layout but make it Outlook compatible.'))
      .toEqual({ kind: 'fix-category', categoryId: 'outlook' });
  });
});

// R4-D Checkpoint D1-A — a genuine question must never be treated as a
// fix request, even one that happens to share vocabulary with the
// fix-all-safe/fix-category patterns above ("fix", "change", "safe").
// The polite-request carve-out is the other half of this: "Can you
// [verb]..." must NOT be swept up as a question despite starting with
// "Can" — already covered by the exact-phrase tests above.
describe('matchReconstructionIntent — D1-A explanation-seeking gate', () => {
  it.each([
    'Why is this button different?',
    'What changed here?',
    "What can't you reproduce and why?",
    'Can this be reproduced exactly?',
    'Which differences can you fix?',
  ])('does not match a question, even one sharing action vocabulary: "%s"', (message) => {
    expect(matchReconstructionIntent(message)).toBeNull();
  });
});

// R4-D Checkpoint D1-C — English/Hindi/Spanish/French equivalents of
// the SAME request resolve to the SAME semantic operation, entirely
// locally (zero network — this whole module never calls out). Accent-
// omitted Spanish/French variants are tested explicitly since that is
// a real, common way this vocabulary gets typed.
describe('matchReconstructionIntent — D1-C multilingual equivalence (en/hi/es/fr)', () => {
  it('"fix everything you safely can" — all four languages resolve to fix-all-safe', () => {
    const messages = [
      'fix everything you safely can',
      'जो सुरक्षित रूप से ठीक कर सको वो ठीक करो',
      'arregla todo lo que puedas de forma segura',
      'corrige tout ce que tu peux corriger en toute sécurité',
      'corrige tout ce que tu peux corriger en toute securite', // accent-omitted
    ];
    for (const message of messages) {
      expect(matchReconstructionIntent(message)).toEqual({ kind: 'fix-all-safe' });
    }
  });

  it('"make it closer to the original" — all four languages resolve to fix-all-safe', () => {
    const messages = [
      'make it closer to the original',
      'इसे मूल जैसा बनाओ',
      'hazlo más parecido al original',
      'hazlo mas parecido al original', // accent-omitted
      "rapproche ceci de l'original",
    ];
    for (const message of messages) {
      expect(matchReconstructionIntent(message)).toEqual({ kind: 'fix-all-safe' });
    }
  });

  it('a genuine question in any of the four languages is never treated as a fix request', () => {
    const questions = [
      "why doesn't this match?",
      'यह क्यों नहीं मिलता?',
      '¿por qué no coincide esto?',
      'pourquoi cela ne correspond-il pas?',
    ];
    for (const question of questions) {
      expect(matchReconstructionIntent(question)).toBeNull();
    }
  });
});

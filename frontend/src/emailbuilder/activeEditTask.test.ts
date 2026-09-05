import { describe, expect, it } from 'vitest';
import {
  classifyTurnRelation, extractPreservationPhrase, isSameTrigger, tryNarrowPendingOperations,
} from './activeEditTask';

// D4-E3K completion pass — unit coverage for the SMALLEST transient
// active-task representation this pass introduces. Integration coverage
// (the real handleSend wiring, backend propagation, safety gates) lives
// in AIEngineerPanel.test.tsx; this file only proves the deterministic
// pattern matching itself is correct and fails closed exactly as
// required, across the paraphrase/grammar variants the checkpoint
// explicitly demands (never overfit to one literal sentence per concept).
describe('classifyTurnRelation — closed continuation vocabulary, fails closed', () => {
  it('returns new_task when there is no active task at all, regardless of wording', () => {
    expect(classifyTurnRelation('also increase the padding', false)).toBe('new_task');
  });

  it.each([
    'also increase the padding',
    'and center it too',
    'increase the padding too',
    'as well, make it bigger',
    'do the same thing',
    'keep the corners rounded',
    'but keep the text',
    'only the first one',
    'just the second one',
    'actually blue',
    'instead of green',
    'no, I meant the footer one',
    'not that one',
    'the other button',
    'leave the footer one alone',
    'except the footer',
  ])('classifies %j as continuation when a task is active', (message) => {
    expect(classifyTurnRelation(message, true)).toBe('continuation');
  });

  it.each([
    'now make the footer CTA blue',
    'change the hero heading',
    "let's work on the footer",
    'add a divider',
  ])('classifies %j as new_task — a fresh, unrelated instruction', (message) => {
    expect(classifyTurnRelation(message, true)).toBe('new_task');
  });

  it('fails closed on an empty message', () => {
    expect(classifyTurnRelation('', true)).toBe('new_task');
    expect(classifyTurnRelation('   ', true)).toBe('new_task');
  });

  it.each([
    ['bhi karo', 'hi'],
    ['same rakho', 'hi'],
    ['también hazlo', 'es'],
    ['lo mismo para el otro', 'es'],
    ['auch das Padding erhöhen', 'de'],
    ['nur das erste', 'de'],
  ])('recognizes non-English continuation marker %j (%s)', (message) => {
    expect(classifyTurnRelation(message, true)).toBe('continuation');
  });
});

describe('isSameTrigger — cross-turn "do the same" phrasing', () => {
  it.each([
    'do the same to the second CTA',
    'do the same thing for the footer button',
    'same treatment on the next button',
    'apply that to CTA two as well',
    'that too',
  ])('recognizes %j', (message) => {
    expect(isSameTrigger(message)).toBe(true);
  });

  it.each([
    'make the second CTA green',
    'increase the padding',
    'also center it',
  ])('does not misfire on an ordinary instruction: %j', (message) => {
    expect(isSameTrigger(message)).toBe(false);
  });
});

describe('extractPreservationPhrase — raw-text capture for re-injection', () => {
  it('captures a "don\'t change X" clause verbatim', () => {
    expect(extractPreservationPhrase("make this button green but don't change the copy")).toMatch(/don'?t\s+change\s+the\s+copy/i);
  });

  it('captures a "keep X" clause', () => {
    expect(extractPreservationPhrase('keep the text unchanged and make it blue')).toMatch(/keep\s+the\s+text/i);
  });

  it('returns null when no preservation clause is present', () => {
    expect(extractPreservationPhrase('make this button green')).toBeNull();
  });
});

describe('tryNarrowPendingOperations — purely subtractive, never invents or adds', () => {
  const labels = ['the first button module', 'the second button module'];

  it('"actually only change the first one" keeps index 0', () => {
    expect(tryNarrowPendingOperations('actually only change the first one', labels)).toEqual({ keepIndices: [0] });
  });

  it('"only the second one" keeps index 1', () => {
    expect(tryNarrowPendingOperations('only the second one', labels)).toEqual({ keepIndices: [1] });
  });

  it('"just the first one" keeps index 0', () => {
    expect(tryNarrowPendingOperations('just the first one', labels)).toEqual({ keepIndices: [0] });
  });

  it('"not the first one, the second" keeps index 1', () => {
    expect(tryNarrowPendingOperations('not the first one, the second', labels)).toEqual({ keepIndices: [1] });
  });

  it('"leave the footer one out" removes the matching-label target only', () => {
    const withFooter = ['the CTA banner module', 'the footer CTA module'];
    expect(tryNarrowPendingOperations('leave the footer one out', withFooter)).toEqual({ keepIndices: [0] });
  });

  it('an out-of-range ordinal (only a third, with two targets) matches nothing', () => {
    expect(tryNarrowPendingOperations('only the third one', labels)).toBeNull();
  });

  it('a message with no narrowing signal at all returns null', () => {
    expect(tryNarrowPendingOperations('make it bigger', labels)).toBeNull();
  });

  it('an empty message returns null', () => {
    expect(tryNarrowPendingOperations('', labels)).toBeNull();
  });
});

// D4-E3L §2 — "last" as a narrowing concept, and multilingual narrowing
// via the SAME shared ordinal/"last" table referenceResolver.ts now also
// draws from (ordinalReference.ts).
describe('tryNarrowPendingOperations — "last" and multilingual narrowing (D4-E3L)', () => {
  const labels = ['the first button module', 'the second button module'];
  const three = ['the first button module', 'the second button module', 'the third button module'];

  it('"keep only the last button" keeps the actual last index, dynamically', () => {
    expect(tryNarrowPendingOperations('keep only the last button', three)).toEqual({ keepIndices: [2] });
  });

  it.each([
    ['Hindi (Devanagari)', 'सिर्फ आख़िरी वाला रखो'],
    ['Hinglish', 'sirf aakhri wala rakho'],
    ['Spanish', 'solo el último'],
    ['German', 'nur das letzte'],
  ])('%s "only the last one" keeps the actual last index', (_label, message) => {
    expect(tryNarrowPendingOperations(message, three)).toEqual({ keepIndices: [2] });
  });

  it.each([
    ['Hindi (Devanagari)', 'सिर्फ दूसरा वाला रखो'],
    ['Hinglish', 'sirf doosra wala rakho'],
    ['Spanish', 'solo el segundo'],
    ['German', 'nur das zweite'],
  ])('%s "only the second one" keeps index 1', (_label, message) => {
    expect(tryNarrowPendingOperations(message, labels)).toEqual({ keepIndices: [1] });
  });

  it('"remove the footer CTA from that change" drops the matching-label target', () => {
    const withFooter = ['the CTA banner module', 'the footer CTA module'];
    expect(tryNarrowPendingOperations('remove the footer CTA from that change', withFooter)).toEqual({ keepIndices: [0] });
  });

  it('"don\'t change the first one" drops the first target (a genuine multi-target narrowing, not a field-preservation clause)', () => {
    expect(tryNarrowPendingOperations("don't change the first one", labels)).toEqual({ keepIndices: [1] });
  });

  it('"don\'t change the copy" (a field-preservation clause) matches no label and narrows nothing', () => {
    expect(tryNarrowPendingOperations("don't change the copy", labels)).toBeNull();
  });
});

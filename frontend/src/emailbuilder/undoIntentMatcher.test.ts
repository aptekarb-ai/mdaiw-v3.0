import { describe, expect, it } from 'vitest';
import { matchUndoIntent } from './undoIntentMatcher';

describe('matchUndoIntent — D2 exact spec phrases (English)', () => {
  it.each([
    'undo',
    'undo that',
    'undo this',
    'undo the last change',
    'undo the last correction',
    'undo what you just did',
    'revert that',
    'revert the last change',
    'revert your last fix',
    'put it back',
    'put it back the way it was',
    'restore the previous version',
    'restore the previous state',
    'cancel the last change',
    'reverse the last change',
  ])('matches %j', (phrase) => {
    expect(matchUndoIntent(phrase)).toBe(true);
  });

  it('is case-insensitive and tolerates surrounding punctuation/whitespace', () => {
    expect(matchUndoIntent('  Undo That!  ')).toBe(true);
    expect(matchUndoIntent('UNDO')).toBe(true);
  });

  it('matches the contextual "cancel that" / "never mind, cancel that" phrasing from the spec\'s own worked example', () => {
    expect(matchUndoIntent('cancel that')).toBe(true);
    expect(matchUndoIntent('Never mind, cancel that.')).toBe(true);
    expect(matchUndoIntent('Actually undo that.')).toBe(true);
    expect(matchUndoIntent('No, put it back.')).toBe(true);
  });
});

describe('matchUndoIntent — D2-A explanation-seeking gate (a question about a past undo is never a new undo command)', () => {
  it.each([
    'Why did you undo that?',
    'What did you just undo?',
    'Did you undo that?',
    'How does undo work here?',
  ])('does NOT match %j', (phrase) => {
    expect(matchUndoIntent(phrase)).toBe(false);
  });
});

describe('matchUndoIntent — negative cases (ordinary commands must never misfire)', () => {
  it.each([
    'add a button',
    'make this button green',
    'give this section 24px padding',
    'fix the contrast',
    'set the background color to blue',
    '',
    '   ',
  ])('does NOT match %j', (phrase) => {
    expect(matchUndoIntent(phrase)).toBe(false);
  });
});

describe('matchUndoIntent — D2-C multilingual equivalence (hi/es/fr)', () => {
  it.each([
    'पूर्ववत करो',
    'आखिरी बदलाव वापस लो',
    'इसे पहले जैसा करो',
    'पिछली स्थिति बहाल करो',
  ])('Hindi: matches %j', (phrase) => {
    expect(matchUndoIntent(phrase)).toBe(true);
  });

  it.each([
    'deshaz eso',
    'deshaz el último cambio',
    'deshaz el ultimo cambio', // accent-omitted
    'restaura la versión anterior',
    'restaura la version anterior', // accent-omitted
    'cancela el último cambio',
  ])('Spanish: matches %j', (phrase) => {
    expect(matchUndoIntent(phrase)).toBe(true);
  });

  it.each([
    'annule ça',
    'annule la dernière modification',
    'annule la derniere modification', // accent-omitted
    'restaure la version précédente',
    'restaure la version precedente', // accent-omitted
    'reviens en arrière',
  ])('French: matches %j', (phrase) => {
    expect(matchUndoIntent(phrase)).toBe(true);
  });

  it('non-English question phrasing is never treated as an undo command', () => {
    expect(matchUndoIntent('¿Por qué deshiciste eso?')).toBe(false);
    expect(matchUndoIntent('Pourquoi as-tu annulé ça ?')).toBe(false);
    expect(matchUndoIntent('तुमने पूर्ववत क्यों किया?')).toBe(false);
  });
});

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

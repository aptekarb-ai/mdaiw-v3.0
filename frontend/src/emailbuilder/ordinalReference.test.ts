import { describe, expect, it } from 'vitest';
import { ordinalIndexFor, wb } from './ordinalReference';

// D4-E3L §1/§2 — unit coverage for the ONE shared ordinal/"last" table
// referenceResolver.ts (target resolution) and activeEditTask.ts
// (pending-proposal narrowing) both now draw from.
describe('ordinalIndexFor', () => {
  it('resolves concrete ordinals to a fixed 0-based index', () => {
    expect(ordinalIndexFor('first', 3)).toBe(0);
    expect(ordinalIndexFor('second', 3)).toBe(1);
    expect(ordinalIndexFor('third', 3)).toBe(2);
  });

  it('is case-insensitive', () => {
    expect(ordinalIndexFor('Second', 3)).toBe(1);
  });

  it('declines an out-of-range concrete ordinal rather than clamping', () => {
    expect(ordinalIndexFor('third', 2)).toBeUndefined();
  });

  it('resolves "last" to the real last index, dynamically', () => {
    expect(ordinalIndexFor('last', 5)).toBe(4);
    expect(ordinalIndexFor('last', 1)).toBe(0);
  });

  it('resolves multilingual "last" words to the same dynamic index', () => {
    expect(ordinalIndexFor('último', 3)).toBe(2);
    expect(ordinalIndexFor('letzte', 3)).toBe(2);
    expect(ordinalIndexFor('आख़िरी', 3)).toBe(2);
    expect(ordinalIndexFor('aakhri', 3)).toBe(2);
  });

  it('returns undefined for zero candidates, even for "last"', () => {
    expect(ordinalIndexFor('last', 0)).toBeUndefined();
  });

  it('returns undefined for an unrecognized word', () => {
    expect(ordinalIndexFor('fourth', 5)).toBeUndefined();
  });
});

describe('wb() — Unicode-safe word boundary', () => {
  it('matches a Devanagari word bounded by whitespace, where a plain \\b would silently fail', () => {
    const re = new RegExp(wb('दूसरा'), 'u');
    expect(re.test('दूसरा CTA')).toBe(true);
  });

  it('does not match as a substring inside a longer Devanagari word', () => {
    const re = new RegExp(wb('दूसरा'), 'u');
    expect(re.test('दूसरादूसरा')).toBe(false);
  });

  it('still works for plain ASCII words', () => {
    const re = new RegExp(wb('only|just'), 'iu');
    expect(re.test('only the first one')).toBe(true);
    expect(re.test('onlyx the first one')).toBe(false);
  });
});

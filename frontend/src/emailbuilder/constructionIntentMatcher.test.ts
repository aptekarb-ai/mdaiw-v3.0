import { describe, expect, it } from 'vitest';
import { matchConstructionIntent } from './constructionIntentMatcher';

describe('matchConstructionIntent', () => {
  it('matches a clear compose-email request', () => {
    expect(matchConstructionIntent('Create a promotional email for our September sale.')).toBe(true);
  });

  it('matches build/generate/make/compose/draft verbs too', () => {
    expect(matchConstructionIntent('Build an email using these materials.')).toBe(true);
    expect(matchConstructionIntent('Generate an email for the launch.')).toBe(true);
    expect(matchConstructionIntent('Make an email with a hero and footer.')).toBe(true);
    expect(matchConstructionIntent('Compose an email about the event.')).toBe(true);
    expect(matchConstructionIntent('Draft an email for new subscribers.')).toBe(true);
  });

  it('does not match an ordinary editing command', () => {
    expect(matchConstructionIntent('Center this button.')).toBe(false);
    expect(matchConstructionIntent('Change this background to #336699.')).toBe(false);
  });

  it('requires both a compose verb AND the word "email"', () => {
    expect(matchConstructionIntent('Create a button.')).toBe(false);
    expect(matchConstructionIntent('This email looks great.')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchConstructionIntent('CREATE AN EMAIL for the sale.')).toBe(true);
  });

  it('returns false for an empty or whitespace-only message', () => {
    expect(matchConstructionIntent('')).toBe(false);
    expect(matchConstructionIntent('   ')).toBe(false);
  });
});

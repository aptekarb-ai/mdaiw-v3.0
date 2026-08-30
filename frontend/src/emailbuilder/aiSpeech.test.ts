import { describe, expect, it } from 'vitest';
import { speakableSummary } from './aiSpeech';

describe('speakableSummary — Module-4 E11 voice-output safety guard', () => {
  it('returns null for empty/whitespace-only text', () => {
    expect(speakableSummary('')).toBeNull();
    expect(speakableSummary('   ')).toBeNull();
  });

  it('returns short plain-text replies unchanged (trimmed)', () => {
    expect(speakableSummary('I added a button module.')).toBe('I added a button module.');
    expect(speakableSummary('  Applied: Enable Email Reset CSS  ')).toBe('Applied: Enable Email Reset CSS');
  });

  it('never speaks HTML/code content — substitutes a short pointer to the transcript', () => {
    const html = '<table role="presentation"><tr><td>Hello</td></tr></table>';
    expect(speakableSummary(html)).toBe('The reply includes generated HTML — see the transcript to read it.');
  });

  it('truncates a very long reply at a sentence boundary and points to the transcript', () => {
    const long = `${'This is a long explanation. '.repeat(30)}Final sentence.`;
    const spoken = speakableSummary(long);
    expect(spoken).not.toBeNull();
    expect(spoken!.length).toBeLessThan(long.length);
    expect(spoken).toContain('See the transcript for the full reply.');
  });

  it('a reply exactly at the cap is spoken in full, unmodified', () => {
    const exact = 'x'.repeat(400);
    expect(speakableSummary(exact)).toBe(exact);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_ID, EMAIL_SAFE_FONTS, fontStackFor, isMsoSafeFont, isValidFontId, msoFallbackStackFor,
} from './fonts';

describe('EMAIL_SAFE_FONTS — msoSafe audit (Sub-phase 3 item 3)', () => {
  it('every registered font is a genuine Windows-native font, marked msoSafe', () => {
    for (const font of EMAIL_SAFE_FONTS) {
      expect(font.msoSafe, font.id).toBe(true);
    }
  });

  it('Arial, Georgia, Times New Roman, and Verdana are all registered and mso-safe', () => {
    const required = ['arial', 'georgia', 'times', 'verdana'];
    for (const id of required) {
      expect(isValidFontId(id)).toBe(true);
      expect(isMsoSafeFont(id)).toBe(true);
    }
  });
});

describe('isMsoSafeFont', () => {
  it('returns true for every real registered font id', () => {
    for (const font of EMAIL_SAFE_FONTS) {
      expect(isMsoSafeFont(font.id)).toBe(true);
    }
  });

  it('returns false for an unrecognized id (a hypothetical/future web font) — the honest "not confirmed safe" default', () => {
    expect(isMsoSafeFont('a-future-google-font')).toBe(false);
    expect(isMsoSafeFont('not-a-real-font-id')).toBe(false);
  });

  it('returns false for a non-string value', () => {
    expect(isMsoSafeFont(undefined)).toBe(false);
    expect(isMsoSafeFont(42)).toBe(false);
  });
});

describe('msoFallbackStackFor', () => {
  it('returns a generic, universally-Word-renderable sans-serif stack', () => {
    expect(msoFallbackStackFor('any-id')).toBe('Arial, Helvetica, sans-serif');
  });
});

describe('fontStackFor — unaffected by the msoSafe addition (regression)', () => {
  it('still resolves every real font id to its own stack', () => {
    expect(fontStackFor('georgia')).toContain('Georgia');
    expect(fontStackFor('times')).toContain('Times New Roman');
    expect(fontStackFor('verdana')).toContain('Verdana');
  });

  it('still falls back to the default font stack for an unrecognized id', () => {
    expect(fontStackFor('unknown')).toBe(fontStackFor(DEFAULT_FONT_ID));
  });
});

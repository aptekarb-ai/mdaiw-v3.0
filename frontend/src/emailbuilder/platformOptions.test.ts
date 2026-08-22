import { describe, expect, it } from 'vitest';
import { getPlatformLabel, PLATFORM_OPTIONS } from './platformOptions';

describe('getPlatformLabel', () => {
  it('normalizes every known enum value to its display label', () => {
    expect(getPlatformLabel('generic')).toBe('Generic');
    expect(getPlatformLabel('sfmc')).toBe('Salesforce Marketing Cloud');
    expect(getPlatformLabel('marketo')).toBe('Marketo');
    expect(getPlatformLabel('hubspot')).toBe('HubSpot');
    expect(getPlatformLabel('pardot')).toBe('Pardot / Account Engagement');
    expect(getPlatformLabel('other')).toBe('Other');
  });
});

describe('PLATFORM_OPTIONS capability matrix (Feature 10)', () => {
  it('gives every platform a complete, non-empty capability matrix', () => {
    for (const option of PLATFORM_OPTIONS) {
      expect(option.compatibilityMode.length).toBeGreaterThan(0);
      expect(option.htmlStructure.length).toBeGreaterThan(0);
      expect(option.css.length).toBeGreaterThan(0);
      expect(option.scripting.length).toBeGreaterThan(0);
    }
  });

  it('every platform keeps the table-first HTML structure claim', () => {
    for (const option of PLATFORM_OPTIONS) {
      expect(option.htmlStructure).toBe('Table based (Email safe)');
    }
  });

  it('generic has scripting disabled and no merge tags, preserving portability', () => {
    const generic = PLATFORM_OPTIONS.find((option) => option.value === 'generic')!;
    expect(generic.scripting).toBe('Disabled');
    expect(generic.mergeTags).toHaveLength(0);
  });

  it('gives each token-capable platform at least one merge-tag sample', () => {
    for (const value of ['sfmc', 'marketo', 'hubspot', 'pardot'] as const) {
      const option = PLATFORM_OPTIONS.find((o) => o.value === value)!;
      expect(option.mergeTags.length).toBeGreaterThan(0);
      for (const tag of option.mergeTags) {
        expect(tag.token.length).toBeGreaterThan(0);
        expect(tag.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('other has no merge tags (custom/unspecified platform)', () => {
    const other = PLATFORM_OPTIONS.find((option) => option.value === 'other')!;
    expect(other.mergeTags).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { getPlatformLabel } from './platformOptions';

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

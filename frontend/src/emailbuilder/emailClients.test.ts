import { describe, expect, it } from 'vitest';
import { EMAIL_CLIENTS } from './emailClients';

describe('EMAIL_CLIENTS', () => {
  it('has unique client ids', () => {
    const ids = EMAIL_CLIENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every client at least one required compatibility check', () => {
    for (const client of EMAIL_CLIENTS) {
      expect(client.requiredChecks.length).toBeGreaterThan(0);
      expect(client.name.length).toBeGreaterThan(0);
      expect(client.platformLabel.length).toBeGreaterThan(0);
    }
  });

  it('requires the stricter Outlook checks only for the outlook-word engine family', () => {
    const outlookWord = EMAIL_CLIENTS.filter((c) => c.engine === 'outlook-word');
    expect(outlookWord.length).toBeGreaterThan(0);
    for (const client of outlookWord) {
      expect(client.requiredChecks).toContain('outlook-safe');
      expect(client.requiredChecks).toContain('no-div');
    }
    const nonOutlookWord = EMAIL_CLIENTS.filter((c) => c.engine !== 'outlook-word');
    for (const client of nonOutlookWord) {
      expect(client.requiredChecks).not.toContain('outlook-safe');
    }
  });
});

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

// Sub-phase 3, item 5 — Classic vs New Outlook must be distinguished
// throughout validation, and an MSO conditional block must never be
// treated as relevant to New Outlook (its engine is 'outlook-webview', a
// Chromium-based web renderer that never parses MSO conditional comments
// or VML at all — see outlookCompatibility.ts and emailValidation.ts's
// checkNewOutlookCompatibility). These are plain data-shape regression
// tests: if either client's requiredChecks list ever drifts, the
// Classic/New distinction this Sub-phase relies on silently breaks.
// Kept as a SEPARATE describe block from the pre-existing Feature 11
// suite above, not merged into it — different feature, different intent.
describe('EMAIL_CLIENTS — Classic vs New Outlook distinction', () => {
  it('Classic Outlook (outlook-2016, outlook-word engine) requires the outlook-safe check', () => {
    const classic = EMAIL_CLIENTS.find((c) => c.id === 'outlook-2016');
    expect(classic).toBeDefined();
    expect(classic!.engine).toBe('outlook-word');
    expect(classic!.requiredChecks).toContain('outlook-safe');
  });

  it('New Outlook (outlook-new, outlook-webview engine) does NOT require the outlook-safe check — its web engine never evaluates MSO conditional comments or VML', () => {
    const newOutlook = EMAIL_CLIENTS.find((c) => c.id === 'outlook-new');
    expect(newOutlook).toBeDefined();
    expect(newOutlook!.engine).toBe('outlook-webview');
    expect(newOutlook!.requiredChecks).not.toContain('outlook-safe');
  });

  it('Classic and New Outlook are distinct engine families, never collapsed into one "Outlook" bucket', () => {
    const classic = EMAIL_CLIENTS.find((c) => c.id === 'outlook-2016');
    const newOutlook = EMAIL_CLIENTS.find((c) => c.id === 'outlook-new');
    expect(classic!.engine).not.toBe(newOutlook!.engine);
  });

  it('no other client in the matrix accidentally requires outlook-safe (it is a Classic-Outlook-only concern)', () => {
    const otherClients = EMAIL_CLIENTS.filter((c) => c.id !== 'outlook-2016');
    for (const client of otherClients) {
      expect(client.requiredChecks).not.toContain('outlook-safe');
    }
  });
});

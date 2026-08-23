import { describe, expect, it } from 'vitest';
import { buildEmailClientCapabilityManifest } from './emailClientCapabilities';
import generatedManifest from '../../../shared/email-clients.generated.json';

// Feature 14 V2 — Phase A drift check, mirrors moduleCapabilities.test.ts.
describe('emailClientCapabilities — manifest drift check', () => {
  it('the committed generated manifest exactly matches what emailClients.ts produces right now', () => {
    const live = buildEmailClientCapabilityManifest();
    expect(live).toEqual(generatedManifest);
  });

  it('covers all 9 Preview Studio clients', () => {
    const live = buildEmailClientCapabilityManifest();
    expect(live.clientCount).toBe(9);
  });

  it('Outlook Classic (outlook-word) and New Outlook (outlook-webview) are distinct, correctly-tagged clients', () => {
    const live = buildEmailClientCapabilityManifest();
    const classic = live.clients.find((c) => c.id === 'outlook-2016');
    const modern = live.clients.find((c) => c.id === 'outlook-new');
    expect(classic?.engine).toBe('outlook-word');
    expect(classic?.outlookAffinity).toBe('OUTLOOK_CLASSIC');
    expect(modern?.engine).toBe('outlook-webview');
    expect(modern?.outlookAffinity).toBe('NEW_OUTLOOK');
    expect(classic?.outlookAffinity).not.toBe(modern?.outlookAffinity);
  });

  it('every non-Outlook client is tagged OTHER, never OUTLOOK_CLASSIC/NEW_OUTLOOK', () => {
    const live = buildEmailClientCapabilityManifest();
    const nonOutlook = live.clients.filter((c) => c.engine !== 'outlook-word' && c.engine !== 'outlook-webview');
    expect(nonOutlook.length).toBeGreaterThan(0);
    for (const client of nonOutlook) {
      expect(client.outlookAffinity).toBe('OTHER');
    }
  });
});

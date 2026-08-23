// Feature 14 V2 — Phase A. Mirrors moduleCapabilities.ts's
// generate-and-drift-check pattern for email-client/render-engine
// metadata, sourced ENTIRELY from emailClients.ts (Feature 11's existing
// Preview Studio client list — not a new client list). This is what
// preserves Outlook Classic ('outlook-word') and New Outlook
// ('outlook-webview') as genuinely distinct identifiers for the
// knowledge/repair engine, per the approved Phase A objective — never
// collapsed into one generic "Outlook" bucket.
import { EMAIL_CLIENTS, type RenderEngineFamily } from './emailClients';

export const EMAIL_CLIENT_CAPABILITY_MANIFEST_VERSION = 1;

// The affinity grouping KnowledgeRule.affectedClients (Phase A's rule
// CONTRACT — see backend/emailbuilder/knowledge/rules.py) uses. 'BOTH' is
// never assigned to an individual client here (every real client has
// exactly one engine); it exists for a RULE to say it affects both
// Outlook variants, not for a client entry to claim it's both at once —
// never conflate the two.
export type OutlookAffinity = 'OUTLOOK_CLASSIC' | 'NEW_OUTLOOK' | 'BOTH' | 'OTHER';

const ENGINE_TO_AFFINITY: Record<RenderEngineFamily, OutlookAffinity> = {
  'outlook-word': 'OUTLOOK_CLASSIC',
  'outlook-webview': 'NEW_OUTLOOK',
  webkit: 'OTHER',
  blink: 'OTHER',
  gecko: 'OTHER',
};

export interface EmailClientCapability {
  id: string;
  name: string;
  platformLabel: string;
  engine: RenderEngineFamily;
  outlookAffinity: OutlookAffinity;
}

export interface EmailClientCapabilityManifest {
  version: number;
  generatedFrom: string;
  clientCount: number;
  clients: EmailClientCapability[];
}

export function buildEmailClientCapabilityManifest(): EmailClientCapabilityManifest {
  const clients: EmailClientCapability[] = EMAIL_CLIENTS
    .map((client) => ({
      id: client.id,
      name: client.name,
      platformLabel: client.platformLabel,
      engine: client.engine,
      outlookAffinity: ENGINE_TO_AFFINITY[client.engine],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: EMAIL_CLIENT_CAPABILITY_MANIFEST_VERSION,
    generatedFrom: 'frontend/src/emailbuilder/emailClients.ts',
    clientCount: clients.length,
    clients,
  };
}

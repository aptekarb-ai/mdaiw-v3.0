import { computeCompatibilityChecks, type CompatibilityCheck } from './htmlCompatibilityChecks';
import { EMAIL_CLIENTS } from './emailClients';

// Feature 11 — Preview Studio. "Provider adapter abstraction" (operation 6)
// + "future Email on Acid/Litmus-style API integration" (operation 7): this
// is the provider-neutral contract every render source implements, per
// 03_Implementation_Plan/07_Preview_Validation.md's suggested interface
// (submitRender/getRenderStatus/listClientRenders/getRenderImage). Today
// only `localHeuristicProvider` exists — synchronous, deterministic,
// no network call, no fabricated external API — but any future real
// provider (Email on Acid, Litmus) plugs in behind this same interface
// without the UI changing.
export type RenderStatus = 'passed' | 'failed';

export interface ClientRenderResult {
  clientId: string;
  status: RenderStatus;
  failedChecks: CompatibilityCheck['id'][];
  detail: string;
}

export interface RenderJob {
  id: string;
  clientId: string;
  status: RenderStatus;
}

export interface ListClientRendersOptions {
  // Bypasses the cache for this call and overwrites whatever was cached —
  // what "Refresh" (one client) and "Run Full Render Test" (all clients)
  // mean: the user explicitly asked to re-check, regardless of whether the
  // document changed. Every other call path reuses a cached result instead
  // of recomputing.
  forceRefresh?: boolean;
}

export interface PreviewProvider {
  name: string;
  // Whether this provider can produce a real rendered screenshot via
  // getRenderImage — the local heuristic provider cannot (it has no
  // rendering engine of its own), a future Email on Acid/Litmus adapter
  // would report true.
  supportsRenderImage: boolean;
  submitRender(clientId: string, html: string): Promise<RenderJob>;
  getRenderStatus(jobId: string): Promise<RenderJob>;
  listClientRenders(html: string, clientIds: string[], options?: ListClientRendersOptions): Promise<ClientRenderResult[]>;
  getRenderImage(jobId: string): Promise<string | null>;
}

function evaluateClient(clientId: string, checks: CompatibilityCheck[]): ClientRenderResult {
  const client = EMAIL_CLIENTS.find((candidate) => candidate.id === clientId);
  const requiredChecks = client?.requiredChecks ?? [];
  const failedChecks = requiredChecks.filter((checkId) => {
    const check = checks.find((candidate) => candidate.id === checkId);
    return check ? !check.ok : false;
  });
  const status: RenderStatus = failedChecks.length === 0 ? 'passed' : 'failed';
  const detail = status === 'passed'
    ? 'Meets every compatibility rule this client relies on.'
    : `Fails: ${failedChecks.join(', ')}.`;
  return { clientId, status, failedChecks, detail };
}

// Feature 11 operation 8 — "Cache render results". Per the spec (this
// prompt's operation list plus 07_Preview_Validation.md's provider
// interface), this is a session/in-memory cache that avoids recomputing a
// render for content that hasn't changed — not a requirement to persist
// results across reload/navigation (no such requirement appears anywhere in
// the Feature 11 spec, the Preview & Validation plan, or the master
// prompt's "autosave/draft state", which is about the *document*, not
// ephemeral render results). Keyed by the exact rendered HTML string: any
// content change produces a different string, which is never in the cache,
// so a stale result can never survive a relevant document change — the key
// itself is the invalidation mechanism, no separate bookkeeping needed.
// Scoped to one provider instance (not module-level) so switching documents
// or tests never leak state across instances.
export interface CreateLocalHeuristicProviderOptions {
  // Test-only seam: inject a spy to prove the cache actually skips
  // recomputation, without reaching into private state.
  computeChecks?: typeof computeCompatibilityChecks;
}

export function createLocalHeuristicProvider(options: CreateLocalHeuristicProviderOptions = {}): PreviewProvider {
  const computeChecks = options.computeChecks ?? computeCompatibilityChecks;
  // jobResults only exists so getRenderStatus (an interface method a real
  // async provider needs to poll) can answer truthfully instead of
  // hardcoding a status; a real provider would back this with a
  // server-side job record instead of an in-memory Map.
  const jobResults = new Map<string, RenderJob>();
  const renderCache = new Map<string, Map<string, ClientRenderResult>>();

  function getCachedOrCompute(html: string, clientId: string, forceRefresh: boolean): ClientRenderResult {
    let perHtml = renderCache.get(html);
    if (!perHtml) {
      perHtml = new Map();
      renderCache.set(html, perHtml);
    }
    const cached = perHtml.get(clientId);
    if (cached && !forceRefresh) return cached;

    const checks = computeChecks(html);
    const result = evaluateClient(clientId, checks);
    perHtml.set(clientId, result);
    return result;
  }

  return {
    name: 'Local compatibility check',
    supportsRenderImage: false,

    async submitRender(clientId, html) {
      const result = getCachedOrCompute(html, clientId, false);
      const job: RenderJob = { id: `local:${clientId}:${jobResults.size}`, clientId, status: result.status };
      jobResults.set(job.id, job);
      return job;
    },

    async getRenderStatus(jobId) {
      const job = jobResults.get(jobId);
      if (!job) throw new Error(`Unknown render job: ${jobId}`);
      return job;
    },

    async listClientRenders(html, clientIds, listOptions = {}) {
      const forceRefresh = listOptions.forceRefresh ?? false;
      return clientIds.map((clientId) => getCachedOrCompute(html, clientId, forceRefresh));
    },

    async getRenderImage() {
      return null;
    },
  };
}

export const localHeuristicProvider = createLocalHeuristicProvider();

import { describe, expect, it, vi } from 'vitest';
import { createLocalHeuristicProvider } from './previewProviders';
import { computeCompatibilityChecks } from './htmlCompatibilityChecks';
import { EMAIL_CLIENTS } from './emailClients';

const SAFE_HTML = '<!doctype html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head></head>'
  + '<body><table role="presentation"><tr><td>Hello</td></tr></table></body></html>';

const OUTLOOK_UNSAFE_HTML = '<!doctype html>\n<html><head><style>.x{display:flex}</style></head>'
  + '<body><div>Hello</div></body></html>';

describe('createLocalHeuristicProvider', () => {
  it('reports every client as passed for safe, table-first, XHTML-namespaced HTML', async () => {
    const provider = createLocalHeuristicProvider();
    const results = await provider.listClientRenders(SAFE_HTML, EMAIL_CLIENTS.map((c) => c.id));
    expect(results).toHaveLength(EMAIL_CLIENTS.length);
    for (const result of results) {
      expect(result.status).toBe('passed');
      expect(result.failedChecks).toHaveLength(0);
    }
  });

  it('fails Outlook clients (which require outlook-safe/no-div) for div + flex markup', async () => {
    const provider = createLocalHeuristicProvider();
    const results = await provider.listClientRenders(OUTLOOK_UNSAFE_HTML, ['outlook-2016', 'gmail-desktop']);
    const outlook = results.find((r) => r.clientId === 'outlook-2016')!;
    const gmail = results.find((r) => r.clientId === 'gmail-desktop')!;
    expect(outlook.status).toBe('failed');
    expect(outlook.failedChecks).toContain('no-div');
    expect(outlook.failedChecks).toContain('outlook-safe');
    // Gmail only requires html-valid/inline-css, neither of which this markup violates.
    expect(gmail.status).toBe('passed');
  });

  it('submitRender + getRenderStatus round-trip for a real job id', async () => {
    const provider = createLocalHeuristicProvider();
    const job = await provider.submitRender('gmail-desktop', SAFE_HTML);
    expect(job.status).toBe('passed');
    const fetched = await provider.getRenderStatus(job.id);
    expect(fetched).toEqual(job);
  });

  it('getRenderStatus throws for an unknown job id', async () => {
    const provider = createLocalHeuristicProvider();
    await expect(provider.getRenderStatus('not-a-real-job')).rejects.toThrow();
  });

  it('getRenderImage returns null — the local provider has no rendering engine of its own', async () => {
    const provider = createLocalHeuristicProvider();
    const job = await provider.submitRender('gmail-desktop', SAFE_HTML);
    await expect(provider.getRenderImage(job.id)).resolves.toBeNull();
    expect(provider.supportsRenderImage).toBe(false);
  });
});

describe('createLocalHeuristicProvider — render-result cache (operation 8)', () => {
  it('does not recompute for a repeated call with unchanged HTML', async () => {
    const computeChecks = vi.fn(computeCompatibilityChecks);
    const provider = createLocalHeuristicProvider({ computeChecks });

    await provider.listClientRenders(SAFE_HTML, ['gmail-desktop']);
    expect(computeChecks).toHaveBeenCalledTimes(1);

    await provider.listClientRenders(SAFE_HTML, ['gmail-desktop']);
    // Second call with byte-identical HTML reuses the cached result.
    expect(computeChecks).toHaveBeenCalledTimes(1);
  });

  it('invalidates automatically when the HTML changes — a stale result can never survive a content change', async () => {
    const computeChecks = vi.fn(computeCompatibilityChecks);
    const provider = createLocalHeuristicProvider({ computeChecks });

    await provider.listClientRenders(SAFE_HTML, ['gmail-desktop']);
    expect(computeChecks).toHaveBeenCalledTimes(1);

    const editedHtml = SAFE_HTML.replace('Hello', 'Hello there');
    const [result] = await provider.listClientRenders(editedHtml, ['gmail-desktop']);
    // Different content -> different cache key -> genuinely recomputed, not
    // served from the previous (now-stale) entry.
    expect(computeChecks).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('passed');
  });

  it('forceRefresh bypasses the cache even for unchanged HTML (Refresh / Run Full Render Test)', async () => {
    const computeChecks = vi.fn(computeCompatibilityChecks);
    const provider = createLocalHeuristicProvider({ computeChecks });

    await provider.listClientRenders(SAFE_HTML, ['gmail-desktop']);
    expect(computeChecks).toHaveBeenCalledTimes(1);

    await provider.listClientRenders(SAFE_HTML, ['gmail-desktop'], { forceRefresh: true });
    expect(computeChecks).toHaveBeenCalledTimes(2);
  });

  it('caches independently per client id', async () => {
    const computeChecks = vi.fn(computeCompatibilityChecks);
    const provider = createLocalHeuristicProvider({ computeChecks });

    await provider.listClientRenders(SAFE_HTML, ['gmail-desktop']);
    expect(computeChecks).toHaveBeenCalledTimes(1);
    // A different, never-before-requested client for the SAME html still
    // needs its own first computation.
    await provider.listClientRenders(SAFE_HTML, ['outlook-2016']);
    expect(computeChecks).toHaveBeenCalledTimes(2);
    // Both are now cached — a batch covering both recomputes neither.
    await provider.listClientRenders(SAFE_HTML, ['gmail-desktop', 'outlook-2016']);
    expect(computeChecks).toHaveBeenCalledTimes(2);
  });

  it('two independent provider instances do not share a cache', async () => {
    const computeChecksA = vi.fn(computeCompatibilityChecks);
    const computeChecksB = vi.fn(computeCompatibilityChecks);
    const providerA = createLocalHeuristicProvider({ computeChecks: computeChecksA });
    const providerB = createLocalHeuristicProvider({ computeChecks: computeChecksB });

    await providerA.listClientRenders(SAFE_HTML, ['gmail-desktop']);
    expect(computeChecksA).toHaveBeenCalledTimes(1);
    expect(computeChecksB).toHaveBeenCalledTimes(0);

    await providerB.listClientRenders(SAFE_HTML, ['gmail-desktop']);
    expect(computeChecksB).toHaveBeenCalledTimes(1);
  });
});

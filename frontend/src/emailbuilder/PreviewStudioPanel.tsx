import { useEffect, useMemo, useState } from 'react';
import { renderEmailDocument } from './htmlRenderer';
import { createLocalHeuristicProvider, type ClientRenderResult } from './previewProviders';
import { EMAIL_CLIENTS } from './emailClients';
import type { EmailDocumentContent } from './edm';
import './PreviewStudioPanel.css';

interface PreviewStudioPanelProps {
  width: number;
  content: EmailDocumentContent;
  emailTitle?: string;
  faviconUrl?: string;
  resetCssEnabled?: boolean;
  customCssEnabled?: boolean;
  customCss?: string;
}

type SubView = 'desktop' | 'mobile' | 'dark' | 'clients';

const MOBILE_PREVIEW_WIDTH = 375;
// Approximates how several inbox providers auto-darken HTML email content
// that carries no explicit dark-mode support of its own: invert lightness,
// then rotate hue back so colors read close to correct. Applied to the
// <iframe> element itself, never to the generated HTML string — the email
// markup this component renders is byte-identical to what Feature 09's
// Code Editor and the real inbox would receive.
const DARK_MODE_APPROXIMATION_FILTER = 'invert(0.92) hue-rotate(180deg)';

const provider = createLocalHeuristicProvider();

// Feature 11 — Preview Studio. Desktop/mobile/dark-mode preview render the
// SAME already-generated HTML (renderEmailDocument, the same pure function
// Feature 09's Code Editor uses) at different real iframe widths/filters —
// genuine browser layout, not a static mockup. The Email Clients matrix is
// computed by the provider-adapter interface (previewProviders.ts) so a
// future real render provider (Email on Acid/Litmus) can replace
// `localHeuristicProvider` without this component changing.
export function PreviewStudioPanel({
  width, content, emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss,
}: PreviewStudioPanelProps) {
  const [subView, setSubView] = useState<SubView>('desktop');
  const [compareMode, setCompareMode] = useState(false);
  const [clientResults, setClientResults] = useState<Map<string, ClientRenderResult>>(new Map());
  const [runningAll, setRunningAll] = useState(false);
  const [refreshingClientId, setRefreshingClientId] = useState<string | null>(null);

  const rawHtml = useMemo(
    () => renderEmailDocument({ width, content, title: emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss }),
    [width, content, emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss],
  );

  // `forceRefresh` distinguishes "just show me the current state" (tab
  // open, content changed — reuse a cached result when the content is
  // unchanged) from "Run Full Render Test" (the user explicitly asked to
  // re-check right now, bypass any cache).
  async function loadAll(forceRefresh: boolean) {
    setRunningAll(true);
    try {
      const results = await provider.listClientRenders(
        rawHtml, EMAIL_CLIENTS.map((client) => client.id), { forceRefresh },
      );
      setClientResults(new Map(results.map((result) => [result.clientId, result])));
    } finally {
      setRunningAll(false);
    }
  }

  async function runAll() {
    await loadAll(true);
  }

  async function refreshOne(clientId: string) {
    setRefreshingClientId(clientId);
    try {
      const [result] = await provider.listClientRenders(rawHtml, [clientId], { forceRefresh: true });
      setClientResults((current) => new Map(current).set(clientId, result));
    } finally {
      setRefreshingClientId(null);
    }
  }

  // Re-run automatically the first time the Email Clients tab is opened and
  // whenever the underlying content changes while it's open — status never
  // silently goes stale next to a document that has since changed. Reuses
  // the cache (forceRefresh: false): re-opening the tab on unchanged
  // content shows the cached result instead of recomputing.
  useEffect(() => {
    if (subView !== 'clients') return;
    loadAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on content/width change (rawHtml), not on every loadAll identity
  }, [subView, rawHtml]);

  const passedCount = Array.from(clientResults.values()).filter((r) => r.status === 'passed').length;

  return (
    <div className="preview-studio-panel">
      <div className="preview-studio-panel__toolbar">
        <div className="preview-studio-panel__tabs" role="tablist" aria-label="Preview mode">
          {(['desktop', 'mobile', 'dark', 'clients'] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={subView === view}
              className={subView === view ? 'preview-studio-panel__tab preview-studio-panel__tab--active' : 'preview-studio-panel__tab'}
              onClick={() => setSubView(view)}
            >
              {view === 'desktop' && 'Desktop'}
              {view === 'mobile' && 'Mobile'}
              {view === 'dark' && 'Dark Mode'}
              {view === 'clients' && 'Email Clients'}
            </button>
          ))}
        </div>

        <div className="preview-studio-panel__actions">
          {(subView === 'desktop' || subView === 'mobile') && (
            <button
              type="button"
              className="button button--outline"
              aria-pressed={compareMode}
              onClick={() => setCompareMode((current) => !current)}
            >
              <span className="mdaiw-icon mdaiw-icon--eye" aria-hidden="true" />
              {compareMode ? 'Comparing' : 'Compare Desktop / Mobile'}
            </button>
          )}
          {subView === 'clients' && (
            <button type="button" className="button button--outline" onClick={runAll} disabled={runningAll}>
              <span className="mdaiw-icon mdaiw-icon--refresh" aria-hidden="true" />
              {runningAll ? 'Running…' : 'Run Full Render Test'}
            </button>
          )}
          <button type="button" className="button button--outline" disabled title="Coming soon">
            <span className="mdaiw-icon mdaiw-icon--send" aria-hidden="true" />
            Send Test
          </button>
        </div>
      </div>

      <div className="preview-studio-panel__body">
        {subView === 'clients' ? (
          <div className="preview-studio-panel__clients">
            <p className="preview-studio-panel__clients-summary" role="status">
              {clientResults.size === 0
                ? 'Not run yet.'
                : `${passedCount} of ${clientResults.size} clients compatible.`}
            </p>
            <ul className="preview-studio-panel__client-list">
              {EMAIL_CLIENTS.map((client) => {
                const result = clientResults.get(client.id);
                return (
                  <li key={client.id} className="preview-studio-panel__client-row">
                    <span className={`mdaiw-icon mdaiw-icon--${client.icon}`} aria-hidden="true" />
                    <span className="preview-studio-panel__client-name">
                      {client.name}
                      <span className="preview-studio-panel__client-platform">{client.platformLabel}</span>
                    </span>
                    <span
                      className={
                        !result
                          ? 'preview-studio-panel__client-status'
                          : result.status === 'passed'
                            ? 'preview-studio-panel__client-status preview-studio-panel__client-status--pass'
                            : 'preview-studio-panel__client-status preview-studio-panel__client-status--fail'
                      }
                      title={result?.detail}
                    >
                      <span
                        className={`mdaiw-icon mdaiw-icon--${!result ? 'search' : result.status === 'passed' ? 'check-circle' : 'error-circle'}`}
                        aria-hidden="true"
                      />
                      {!result ? 'Not run' : result.status === 'passed' ? 'Compatible' : 'Issues found'}
                    </span>
                    <button
                      type="button"
                      className="preview-studio-panel__client-refresh"
                      aria-label={`Refresh ${client.name}`}
                      onClick={() => refreshOne(client.id)}
                      disabled={refreshingClientId === client.id}
                    >
                      <span className="mdaiw-icon mdaiw-icon--refresh" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : subView === 'dark' ? (
          <div className="preview-studio-panel__frame-wrap">
            <div className="preview-studio-panel__dark-note" role="status">
              <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
              <span>
                <strong>Approximate simulation</strong> — not genuine Gmail/Outlook/client-specific dark-mode
                rendering. Actual behavior varies by provider and cannot be exactly replicated outside each
                client&apos;s own rendering engine.
              </span>
            </div>
            <iframe
              title="Dark mode preview"
              className="preview-studio-panel__frame preview-studio-panel__frame--dark"
              style={{ width: `${width}px`, filter: DARK_MODE_APPROXIMATION_FILTER }}
              srcDoc={rawHtml}
              sandbox=""
            />
          </div>
        ) : (
          <div className={compareMode ? 'preview-studio-panel__compare' : 'preview-studio-panel__frame-wrap'}>
            {(compareMode || subView === 'desktop') && (
              <div className="preview-studio-panel__frame-column">
                {compareMode && <p className="preview-studio-panel__frame-label">Desktop ({width}px)</p>}
                <iframe
                  title="Desktop preview"
                  className="preview-studio-panel__frame"
                  style={{ width: `${width}px` }}
                  srcDoc={rawHtml}
                  sandbox=""
                />
              </div>
            )}
            {(compareMode || subView === 'mobile') && (
              <div className="preview-studio-panel__frame-column">
                {compareMode && <p className="preview-studio-panel__frame-label">Mobile ({MOBILE_PREVIEW_WIDTH}px)</p>}
                <iframe
                  title="Mobile preview"
                  className="preview-studio-panel__frame"
                  style={{ width: `${MOBILE_PREVIEW_WIDTH}px` }}
                  srcDoc={rawHtml}
                  sandbox=""
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// D4-E0 item 14 — a small administrator/developer diagnostics
// disclosure for the optional local AI provider. Deliberately NOT the
// normal-user-facing surface (that is AIEngineerPanel.tsx's own
// "Local AI • Private" badge, shown only when a local answer actually
// arrived) — this is the "is it configured, reachable, what can it do"
// view for whoever set EMAILBUILDER_LOCAL_AI_BASE_URL up. Collapsed by
// default so it never displaces anything for a normal user; fetched
// only when expanded, never on every AI Engineer panel mount.
import { useState } from 'react';
import { requestLocalAIDiagnostics } from '../api/client';
import type { LocalAIDiagnostics } from './localAIDiagnostics';

function flagLabel(value: boolean | 'unknown' | undefined | null): string {
  if (value === true) return 'Available';
  if (value === false) return 'Unavailable';
  return 'Unknown';
}

export function LocalAIDiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LocalAIDiagnostics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = event.currentTarget.open;
    setOpen(isOpen);
    if (isOpen && !diagnostics && !loading) {
      setLoading(true);
      setLoadError(null);
      requestLocalAIDiagnostics()
        .then((response) => setDiagnostics(response.diagnostics))
        .catch(() => setLoadError('Could not load diagnostics right now.'))
        .finally(() => setLoading(false));
    }
  };

  return (
    <details className="ai-engineer-panel__diagnostics" open={open} onToggle={handleToggle}>
      <summary className="ai-engineer-panel__diagnostics-toggle">
        <span className="mdaiw-icon mdaiw-icon--settings" aria-hidden="true" />
        Local AI diagnostics
      </summary>
      <div className="ai-engineer-panel__diagnostics-body">
        {loading && <p>Checking local AI runtime…</p>}
        {loadError && <p role="alert">{loadError}</p>}
        {diagnostics && (
          <dl className="ai-engineer-panel__diagnostics-list">
            <div className="ai-engineer-panel__diagnostics-row">
              <dt>Local AI</dt>
              <dd>
                {!diagnostics.configured
                  ? 'Not configured'
                  : diagnostics.reachable ? 'Connected' : 'Unavailable'}
              </dd>
            </div>
            <div className="ai-engineer-panel__diagnostics-row">
              <dt>Runtime</dt>
              <dd>{diagnostics.runtime ?? 'Unknown'}</dd>
            </div>
            <div className="ai-engineer-panel__diagnostics-row">
              <dt>Model</dt>
              <dd>
                {diagnostics.model ?? 'Not set'}
                {diagnostics.configured_model_available === false && ' (not found on server)'}
              </dd>
            </div>
            <div className="ai-engineer-panel__diagnostics-row">
              <dt>Natural language</dt>
              <dd>{flagLabel(diagnostics.capabilities?.natural_language)}</dd>
            </div>
            <div className="ai-engineer-panel__diagnostics-row">
              <dt>Multilingual</dt>
              <dd>{flagLabel(diagnostics.capabilities?.multilingual)}</dd>
            </div>
            <div className="ai-engineer-panel__diagnostics-row">
              <dt>Tool / structured output</dt>
              <dd>{flagLabel(diagnostics.capabilities?.structured_output)}</dd>
            </div>
            <div className="ai-engineer-panel__diagnostics-row">
              <dt>Deterministic fallback</dt>
              <dd>{diagnostics.deterministic_fallback_ready ? 'Ready' : 'Unknown'}</dd>
            </div>
          </dl>
        )}
      </div>
    </details>
  );
}

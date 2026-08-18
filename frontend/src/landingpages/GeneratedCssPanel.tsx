import { useState } from 'react';
import { CSS_COMPILER_ENGINE_DISPLAY_NAME } from '../types/landingpages';
import './GeneratedCssPanel.css';

export interface GeneratedCssPanelProps {
  css: string;
  stale: boolean;
  engine: string;
  engineVersion: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function GeneratedCssPanel({ css, stale, engine, engineVersion }: GeneratedCssPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const engineLabel = CSS_COMPILER_ENGINE_DISPLAY_NAME[engine] ?? engine;
  const sizeLabel = formatSize(new Blob([css]).size);

  async function handleCopy() {
    if (!navigator.clipboard) {
      setStatusMessage('Copy is not supported in this browser.');
      return;
    }
    try {
      await navigator.clipboard.writeText(css);
      setStatusMessage('Generated CSS copied.');
    } catch {
      setStatusMessage('Could not copy generated CSS.');
    }
  }

  function handleDownload() {
    const blob = new Blob([css], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'styles.css';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  if (collapsed) {
    return (
      <div className="generated-css-panel generated-css-panel--collapsed">
        <button type="button" className="button button--outline" onClick={() => setCollapsed(false)}>
          Show Generated CSS
        </button>
      </div>
    );
  }

  return (
    <section className="generated-css-panel" aria-label="Generated CSS">
      <div className="generated-css-panel__header">
        <h2 className="generated-css-panel__heading">
          Generated CSS — read-only
          {stale && <span className="generated-css-panel__stale-badge">Stale</span>}
        </h2>
        <div className="generated-css-panel__actions">
          <button
            type="button"
            className="button button--outline"
            onClick={handleCopy}
            disabled={stale || !css}
            title={stale ? 'Revalidate to copy the current generated CSS.' : undefined}
          >
            Copy Generated CSS
          </button>
          <button
            type="button"
            className="button button--outline"
            onClick={handleDownload}
            disabled={stale || !css}
            title={stale ? 'Revalidate to download the current generated CSS.' : undefined}
          >
            Download Generated CSS
          </button>
          <button type="button" className="button button--outline" onClick={() => setCollapsed(true)}>
            Hide Generated CSS
          </button>
        </div>
      </div>
      <p className="generated-css-panel__meta">
        {engineLabel} {engineVersion} &middot; {sizeLabel}
      </p>
      <pre className="generated-css-panel__code" tabIndex={0}>
        {css}
      </pre>
      <p className="generated-css-panel__visually-hidden" role="status" aria-live="polite">
        {statusMessage}
      </p>
    </section>
  );
}

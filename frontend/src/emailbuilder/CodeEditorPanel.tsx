import { useMemo, useRef, useState } from 'react';
import { CodeEditor, type CodeEditorHandle } from '../landingpages/CodeEditor';
import { renderEmailDocument } from './htmlRenderer';
import { formatEmailHtml } from './htmlFormatter';
import { computeCompatibilityChecks } from './htmlCompatibilityChecks';
import { getPlatformLabel } from './platformOptions';
import type { EmailDocumentContent } from './edm';
import type { EmailPlatform } from './types';
import './CodeEditorPanel.css';

interface CodeEditorPanelProps {
  documentName: string;
  width: number;
  content: EmailDocumentContent;
  platform: EmailPlatform;
  emailTitle?: string;
  faviconUrl?: string;
}

type CodeSubView = 'code' | 'rendered';

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9-_ ]/g, '').trim();
  return trimmed.length > 0 ? trimmed : 'email';
}

// Feature 09 — read-only, always-in-sync HTML view of the current Email
// Document Model. Deliberately read-only (operation 8, "protect
// unsupported visual round-trip"): arbitrary hand-edited HTML cannot be
// reliably mapped back onto the typed module tree, so rather than build a
// partial/unsafe HTML->EDM parser, the Code tab is a faithful, live
// projection of the EDM that can never silently overwrite it. Visual mode
// (the module tree) remains the single source of truth; this view updates
// automatically on every module/undo/redo change since it's a pure
// function of `content`, which satisfies "live preview" (operation 6)
// and "undo/redo" (operation 5) without any code-editor-specific history.
export function CodeEditorPanel({ documentName, width, content, platform, emailTitle, faviconUrl }: CodeEditorPanelProps) {
  const [subView, setSubView] = useState<CodeSubView>('code');
  const [formatted, setFormatted] = useState(true);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const editorRef = useRef<CodeEditorHandle>(null);

  const rawHtml = useMemo(
    () => renderEmailDocument({ width, content, title: emailTitle, faviconUrl }),
    [width, content, emailTitle, faviconUrl],
  );
  const displayedHtml = useMemo(
    () => (formatted ? formatEmailHtml(rawHtml) : rawHtml),
    [rawHtml, formatted],
  );
  const checks = useMemo(() => computeCompatibilityChecks(rawHtml), [rawHtml]);
  const platformLabel = getPlatformLabel(platform);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(rawHtml);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    } finally {
      setTimeout(() => setCopyState('idle'), 1500);
    }
  }

  function handleDownload() {
    const blob = new Blob([rawHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeFileName(documentName)}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleFind() {
    editorRef.current?.focusLine(1);
  }

  return (
    <div className="code-editor-panel">
      <div className="code-editor-panel__toolbar">
        <div className="code-editor-panel__tabs" role="group" aria-label="Code view">
          <button
            type="button"
            aria-pressed={subView === 'code'}
            className={subView === 'code' ? 'code-editor-panel__tab code-editor-panel__tab--active' : 'code-editor-panel__tab'}
            onClick={() => setSubView('code')}
          >
            Code
          </button>
          <button
            type="button"
            aria-pressed={subView === 'rendered'}
            className={subView === 'rendered' ? 'code-editor-panel__tab code-editor-panel__tab--active' : 'code-editor-panel__tab'}
            onClick={() => setSubView('rendered')}
          >
            Rendered
          </button>
        </div>

        <div className="code-editor-panel__platform" title="Platform scripting mode">
          <span className="mdaiw-icon mdaiw-icon--department" aria-hidden="true" />
          {platformLabel}
          {platform !== 'generic' && (
            <span className="code-editor-panel__platform-note">
              — platform-specific scripting not yet implemented
            </span>
          )}
        </div>

        {subView === 'code' && (
          <span
            className="code-editor-panel__readonly-badge"
            title="This HTML is generated from your Visual design. Edit it there — typing here will not change the email."
          >
            <span className="mdaiw-icon mdaiw-icon--lock" aria-hidden="true" />
            Read-only — generated from Visual design
          </span>
        )}

        <div className="code-editor-panel__actions">
          <button
            type="button"
            className="button button--outline"
            aria-pressed={formatted}
            onClick={() => setFormatted((current) => !current)}
            disabled={subView !== 'code'}
          >
            {formatted ? 'Formatted' : 'Raw'}
          </button>
          <button type="button" className="button button--outline" onClick={handleFind} disabled={subView !== 'code'}>
            <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
            Find
          </button>
          <button type="button" className="button button--outline" onClick={handleCopy}>
            <span className="mdaiw-icon mdaiw-icon--file" aria-hidden="true" />
            {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy HTML'}
          </button>
          <button type="button" className="button button--primary" onClick={handleDownload}>
            <span className="mdaiw-icon mdaiw-icon--upload" aria-hidden="true" />
            Download
          </button>
        </div>
      </div>

      <div className="code-editor-panel__body">
        {subView === 'code' ? (
          <CodeEditor
            ref={editorRef}
            language="html"
            value={displayedHtml}
            onChange={() => {
              // Read-only by design — see the file-level comment. Monaco
              // still fires onChange for programmatic value updates (a new
              // module added while this tab is open); there is nothing to
              // do with it here.
            }}
            ariaLabel="Generated email HTML (read-only)"
            disabled
          />
        ) : (
          <iframe
            title="Rendered email preview"
            className="code-editor-panel__preview-frame"
            srcDoc={rawHtml}
            sandbox=""
          />
        )}
      </div>

      <div className="code-editor-panel__checks" role="status" aria-label="Compatibility checks">
        {checks.map((check) => (
          <span
            key={check.id}
            className={check.ok ? 'code-editor-panel__check' : 'code-editor-panel__check code-editor-panel__check--fail'}
            title={check.detail}
          >
            <span className={`mdaiw-icon mdaiw-icon--${check.ok ? 'check-circle' : 'warning'}`} aria-hidden="true" />
            {check.label}
          </span>
        ))}
      </div>
    </div>
  );
}

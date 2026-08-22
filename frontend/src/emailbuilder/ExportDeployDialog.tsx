import { useEffect, useMemo, useRef, useState } from 'react';
import { renderEmailDocument } from './htmlRenderer';
import { buildExportSummary, buildHandoffManifest, extractImageAssetUrls, sanitizeExportFileName } from './exportDeploy';
import { PLATFORM_OPTIONS } from './platformOptions';
import type { EmailDocumentContent } from './edm';
import type { EmailDocument, EmailPlatform } from './types';
import './ExportDeployDialog.css';

interface ExportDeployDialogProps {
  document: EmailDocument;
  content: EmailDocumentContent;
  onSaveAsTemplate: (templateName: string) => Promise<EmailDocument>;
  onClose: () => void;
}

type ActionState = 'idle' | 'busy' | 'done' | 'error';

function downloadTextFile(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Feature 13 — Export / Deploy. Operations covered: final validation gate
// (blocks "Export Email" on any error-severity issue unless acknowledged),
// generic HTML export, platform-specific export (re-validates against
// whichever "Export As" platform is selected here — a preview-only choice,
// independent of the document's own saved platform, same non-mutating
// pattern Feature 10's compatibility-impact scan already uses), copy HTML,
// download HTML/assets, save as template, create deployment handoff (a
// downloadable JSON manifest alongside the HTML). Same accessible-modal
// shape (focus trap, Escape, backdrop click) as PlatformEnvironmentDialog.
export function ExportDeployDialog({ document, content, onSaveAsTemplate, onClose }: ExportDeployDialogProps) {
  const [exportPlatform, setExportPlatform] = useState<EmailPlatform>(document.platform);
  const [acknowledgeUnsafe, setAcknowledgeUnsafe] = useState(false);
  const [copyState, setCopyState] = useState<ActionState>('idle');
  const [downloadState, setDownloadState] = useState<ActionState>('idle');
  const [templateState, setTemplateState] = useState<ActionState>('idle');
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ActionState>('idle');

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusables.length === 0) return;
      const active = window.document.activeElement as HTMLElement;
      const index = focusables.indexOf(active);
      const forward = !event.shiftKey;
      let nextIndex: number;
      if (index === -1) {
        nextIndex = forward ? 0 : focusables.length - 1;
      } else {
        nextIndex = forward ? (index + 1) % focusables.length : (index - 1 + focusables.length) % focusables.length;
      }
      event.preventDefault();
      focusables[nextIndex]?.focus();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const rawHtml = useMemo(
    () => renderEmailDocument({ width: document.width, content }),
    [document.width, content],
  );

  const summary = useMemo(
    () => buildExportSummary(rawHtml, content, exportPlatform, document.name, document.width),
    [rawHtml, content, exportPlatform, document.name, document.width],
  );

  const imageAssetUrls = useMemo(() => extractImageAssetUrls(rawHtml), [rawHtml]);

  const canExport = !summary.hasBlockingIssues || acknowledgeUnsafe;
  const fileBaseName = sanitizeExportFileName(document.name);

  async function handleCopyHtml() {
    setCopyState('busy');
    try {
      await navigator.clipboard.writeText(rawHtml);
      setCopyState('done');
    } catch {
      setCopyState('error');
    } finally {
      setTimeout(() => setCopyState('idle'), 1500);
    }
  }

  function handleDownloadHtml() {
    setDownloadState('busy');
    downloadTextFile(rawHtml, `${fileBaseName}.html`, 'text/html;charset=utf-8');
    if (imageAssetUrls.length > 0) {
      window.setTimeout(
        () => downloadTextFile(imageAssetUrls.join('\n'), `${fileBaseName}-assets.txt`, 'text/plain;charset=utf-8'),
        150,
      );
    }
    setDownloadState('done');
    setTimeout(() => setDownloadState('idle'), 1500);
  }

  async function handleSaveAsTemplate() {
    setTemplateState('busy');
    setTemplateError(null);
    try {
      await onSaveAsTemplate(`${document.name} (Template)`);
      setTemplateState('done');
    } catch {
      setTemplateState('error');
      setTemplateError('We could not save this as a template. Please try again.');
    }
  }

  function handleExportEmail() {
    if (!canExport) return;
    setExportState('busy');
    downloadTextFile(rawHtml, `${fileBaseName}.html`, 'text/html;charset=utf-8');
    window.setTimeout(() => {
      const manifest = buildHandoffManifest(summary, imageAssetUrls, new Date().toISOString());
      downloadTextFile(manifest, `${fileBaseName}-handoff.json`, 'application/json;charset=utf-8');
    }, 150);
    setExportState('done');
  }

  return (
    <div className="export-deploy-dialog__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="export-deploy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-deploy-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="export-deploy-dialog__header">
          <h2 id="export-deploy-heading">Export / Deploy</h2>
          <button type="button" className="export-deploy-dialog__close" aria-label="Close" onClick={onClose}>
            <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
          </button>
        </div>

        <div className="export-deploy-dialog__body">
          <div className="export-deploy-dialog__list" role="radiogroup" aria-label="Export as">
            <p className="export-deploy-dialog__list-label">Export As</p>
            {PLATFORM_OPTIONS.filter((option) => option.value !== 'other').map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={exportPlatform === option.value}
                className={
                  exportPlatform === option.value
                    ? 'export-deploy-dialog__option export-deploy-dialog__option--active'
                    : 'export-deploy-dialog__option'
                }
                onClick={() => setExportPlatform(option.value)}
              >
                <span className={`mdaiw-icon mdaiw-icon--${option.icon}`} aria-hidden="true" />
                <span className="export-deploy-dialog__option-text">
                  <span className="export-deploy-dialog__option-label">{option.label}</span>
                  <span className="export-deploy-dialog__option-description">{option.description}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="export-deploy-dialog__detail">
            <h3>Export Summary</h3>

            <dl className="export-deploy-dialog__summary">
              <div className="export-deploy-dialog__summary-row">
                <dt>Email Name</dt>
                <dd>{summary.emailName}</dd>
              </div>
              <div className="export-deploy-dialog__summary-row">
                <dt>Environment</dt>
                <dd>{summary.platformLabel}</dd>
              </div>
              <div className="export-deploy-dialog__summary-row">
                <dt>Width</dt>
                <dd>{summary.width}px</dd>
              </div>
              <div className="export-deploy-dialog__summary-row">
                <dt>Images</dt>
                <dd>{summary.imageCount}</dd>
              </div>
              <div className="export-deploy-dialog__summary-row">
                <dt>Responsive</dt>
                <dd className={summary.responsiveStatus === 'Passed' ? 'export-deploy-dialog__pass' : 'export-deploy-dialog__fail'}>
                  <span className={`mdaiw-icon mdaiw-icon--${summary.responsiveStatus === 'Passed' ? 'check-circle' : 'warning'}`} aria-hidden="true" />
                  {summary.responsiveStatus}
                </dd>
              </div>
              <div className="export-deploy-dialog__summary-row">
                <dt>Validation</dt>
                <dd className={summary.validationStatus === 'Passed' ? 'export-deploy-dialog__pass' : 'export-deploy-dialog__fail'}>
                  <span className={`mdaiw-icon mdaiw-icon--${summary.validationStatus === 'Passed' ? 'check-circle' : 'warning'}`} aria-hidden="true" />
                  {summary.validationStatus} ({summary.score}/100)
                </dd>
              </div>
            </dl>

            {summary.hasBlockingIssues && (
              <div className="export-deploy-dialog__gate" role="alert">
                <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                <div>
                  <p className="export-deploy-dialog__gate-title">
                    This email has {summary.errorCount} validation error{summary.errorCount === 1 ? '' : 's'} for {summary.platformLabel}.
                  </p>
                  <label className="export-deploy-dialog__gate-checkbox">
                    <input
                      type="checkbox"
                      checked={acknowledgeUnsafe}
                      onChange={(event) => setAcknowledgeUnsafe(event.target.checked)}
                    />
                    I understand the risks and want to export anyway.
                  </label>
                </div>
              </div>
            )}

            {templateError && (
              <p className="export-deploy-dialog__error" role="alert">
                <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                {templateError}
              </p>
            )}

            <div className="export-deploy-dialog__utility-actions">
              <button type="button" className="button button--outline" onClick={handleCopyHtml}>
                <span className="mdaiw-icon mdaiw-icon--file" aria-hidden="true" />
                {copyState === 'done' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy HTML'}
              </button>
              <button type="button" className="button button--outline" onClick={handleDownloadHtml}>
                <span className="mdaiw-icon mdaiw-icon--upload" aria-hidden="true" />
                {downloadState === 'done' ? 'Downloaded' : 'Download HTML'}
              </button>
              <button type="button" className="button button--outline" onClick={handleSaveAsTemplate} disabled={templateState === 'busy'}>
                <span className="mdaiw-icon mdaiw-icon--check-circle" aria-hidden="true" />
                {templateState === 'busy' ? 'Saving…' : templateState === 'done' ? 'Saved as Template' : 'Save as Template'}
              </button>
            </div>
          </div>
        </div>

        <div className="export-deploy-dialog__actions">
          <button type="button" className="button button--outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleExportEmail}
            disabled={!canExport || exportState === 'done'}
          >
            <span className="mdaiw-icon mdaiw-icon--send" aria-hidden="true" />
            {exportState === 'done' ? 'Exported' : 'Export Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

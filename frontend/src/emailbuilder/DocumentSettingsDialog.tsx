import { useEffect, useRef, useState } from 'react';
import { AssetManagerDialog, type AssetSelection } from './AssetManagerDialog';
import type { ApiError } from '../types/auth';
import type { EmailDocument } from './types';
import './DocumentSettingsDialog.css';

export interface DocumentSettingsInput {
  email_title: string;
  email_subject: string;
  favicon_url: string;
}

interface DocumentSettingsDialogProps {
  document: EmailDocument;
  onApply: (input: DocumentSettingsInput) => Promise<void>;
  onClose: () => void;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const fieldErrors = apiError?.errors ? Object.values(apiError.errors).flat() : [];
  return fieldErrors[0] ?? apiError?.message ?? fallback;
}

// Email Document Standards Sub-phase 1 — Title/Subject/Favicon only (Reset
// CSS and Custom CSS toggles are Sub-phase 2 scope, per the approved
// phasing; this dialog will grow those sections then, not be replaced).
// Same accessible-modal shape (focus trap, Escape, backdrop click) as
// PlatformEnvironmentDialog/ExportDeployDialog; same async-onApply +
// inline-error convention as PlatformEnvironmentDialog's onApply so a
// failed PATCH keeps the dialog open for a retry instead of silently
// closing on an unsaved change.
export function DocumentSettingsDialog({ document: emailDocument, onApply, onClose }: DocumentSettingsDialogProps) {
  const [emailTitle, setEmailTitle] = useState(emailDocument.email_title);
  const [emailSubject, setEmailSubject] = useState(emailDocument.email_subject);
  const [faviconUrl, setFaviconUrl] = useState(emailDocument.favicon_url);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const dirty = emailTitle !== emailDocument.email_title
    || emailSubject !== emailDocument.email_subject
    || faviconUrl !== emailDocument.favicon_url;

  function handleAssetSelected(selection: AssetSelection) {
    setFaviconUrl(selection.url);
    setAssetPickerOpen(false);
  }

  async function handleSave() {
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onApply({ email_title: emailTitle.trim(), email_subject: emailSubject.trim(), favicon_url: faviconUrl.trim() });
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'We could not save document settings. Please try again.'));
      setSaving(false);
    }
  }

  return (
    <div className="document-settings-dialog__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="document-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-settings-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="document-settings-dialog__header">
          <h2 id="document-settings-heading">Document Settings</h2>
          <button type="button" className="document-settings-dialog__close" aria-label="Close" onClick={onClose}>
            <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
          </button>
        </div>

        <div className="document-settings-dialog__body">
          <div className="document-settings-dialog__field">
            <label htmlFor="document-settings-title">Email Title</label>
            <input
              id="document-settings-title"
              type="text"
              value={emailTitle}
              maxLength={150}
              onChange={(event) => setEmailTitle(event.target.value)}
              placeholder="Shown in the browser tab / preview pane"
            />
            <p className="document-settings-dialog__hint">
              Renders into the email&apos;s <code>&lt;title&gt;</code> element. Not the draft name (
              {emailDocument.name}) and not the subject line.
            </p>
          </div>

          <div className="document-settings-dialog__field">
            <label htmlFor="document-settings-subject">Email Subject</label>
            <input
              id="document-settings-subject"
              type="text"
              value={emailSubject}
              maxLength={200}
              onChange={(event) => setEmailSubject(event.target.value)}
              placeholder="Subject line for sending"
            />
            <p className="document-settings-dialog__hint">
              Send/document metadata only — never rendered into the email markup itself.
            </p>
          </div>

          <div className="document-settings-dialog__field">
            <label htmlFor="document-settings-favicon">Favicon URL</label>
            <div className="document-settings-dialog__favicon-row">
              {faviconUrl && (
                <img
                  src={faviconUrl}
                  alt=""
                  aria-hidden="true"
                  className="document-settings-dialog__favicon-preview"
                  onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                  onLoad={(event) => { event.currentTarget.style.visibility = 'visible'; }}
                />
              )}
              <input
                id="document-settings-favicon"
                type="text"
                value={faviconUrl}
                onChange={(event) => setFaviconUrl(event.target.value)}
                placeholder="https://example.com/favicon.png"
              />
              <button
                type="button"
                className="document-settings-dialog__browse-button"
                onClick={() => setAssetPickerOpen(true)}
              >
                Browse
              </button>
              {faviconUrl && (
                <button
                  type="button"
                  className="document-settings-dialog__browse-button"
                  onClick={() => setFaviconUrl('')}
                >
                  Remove
                </button>
              )}
            </div>
            <p className="document-settings-dialog__hint">
              Optional. Must be a public https:// (or http://) URL — pick from your Asset Manager or paste a link.
            </p>
          </div>
        </div>

        {error && (
          <p className="document-settings-dialog__error" role="alert">
            <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="document-settings-dialog__actions">
          <button type="button" className="button button--outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {assetPickerOpen && (
        <AssetManagerDialog onSelect={handleAssetSelected} onClose={() => setAssetPickerOpen(false)} />
      )}
    </div>
  );
}

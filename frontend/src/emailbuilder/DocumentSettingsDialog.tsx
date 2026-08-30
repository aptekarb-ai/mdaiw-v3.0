import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetManagerDialog, type AssetSelection } from './AssetManagerDialog';
import { CodeEditor, type CodeEditorMarker } from '../landingpages/CodeEditor';
import { detectCustomCssWarnings, validateCustomCss } from './emailCss';
import { validateFaviconUrl } from './faviconValidation';
import type { EmailDocumentSettingsSnapshot } from './useEmailBuilderState';
import './DocumentSettingsDialog.css';

// The one shape shared by builder.documentSettings, the Apply payload,
// and the AI Engineer's document-level proposals — no second type.
export type DocumentSettingsInput = EmailDocumentSettingsSnapshot;

interface DocumentSettingsDialogProps {
  documentSettings: EmailDocumentSettingsSnapshot;
  // The builder/dashboard draft name — shown only in the Email Title
  // field's hint text to make the name/title/subject distinction
  // concrete, never editable here (rename lives on the dashboard).
  documentName: string;
  onApply: (input: DocumentSettingsInput) => void;
  onClose: () => void;
}

// Email Document Standards Sub-phase 1+2 — Title/Subject/Favicon plus
// Reset CSS/Custom CSS. Same accessible-modal shape (focus trap, Escape,
// backdrop click) as PlatformEnvironmentDialog/ExportDeployDialog.
//
// Unified undo/redo (Sub-phase 2 closure, item 1): Apply is a SYNCHRONOUS
// LOCAL commit — builder.updateDocumentSettings() — into the exact same
// undo/redo history the module tree already uses (see
// useEmailBuilderState.ts's HistoryEntry). It never talks to the network
// directly; persistence happens later, together with module content, when
// the user clicks the toolbar's Save button (same "local edit now, PATCH
// on Save" contract every module edit already has). This is why there is
// no saving/error state here anymore, and why the primary action is
// labeled "Apply" (a local, undoable commit) rather than "Save" (which
// now specifically means "persist to the server," owned by the toolbar).
export function DocumentSettingsDialog({ documentSettings, documentName, onApply, onClose }: DocumentSettingsDialogProps) {
  const [emailTitle, setEmailTitle] = useState(documentSettings.email_title);
  const [emailSubject, setEmailSubject] = useState(documentSettings.email_subject);
  const [faviconUrl, setFaviconUrl] = useState(documentSettings.favicon_url);
  const [resetCssEnabled, setResetCssEnabled] = useState(documentSettings.reset_css_enabled);
  const [customCssEnabled, setCustomCssEnabled] = useState(documentSettings.custom_css_enabled);
  const [customCss, setCustomCss] = useState(documentSettings.custom_css);
  const [outlookVmlEnabled, setOutlookVmlEnabled] = useState(documentSettings.outlook_vml_enabled);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const faviconError = useMemo(() => validateFaviconUrl(faviconUrl), [faviconUrl]);
  const cssValidation = useMemo(() => validateCustomCss(customCss), [customCss]);
  const cssWarnings = useMemo(() => detectCustomCssWarnings(customCss), [customCss]);
  const cssMarkers = useMemo<CodeEditorMarker[]>(() => [
    ...cssValidation.errors.map((message): CodeEditorMarker => ({
      severity: 'error', message, startLine: 1, startColumn: 1, languageLabel: 'Custom CSS',
    })),
    ...cssWarnings.map((warning): CodeEditorMarker => ({
      severity: 'warning', message: warning.message, startLine: 1, startColumn: 1, languageLabel: 'Custom CSS',
    })),
  ], [cssValidation, cssWarnings]);

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

  const dirty = emailTitle !== documentSettings.email_title
    || emailSubject !== documentSettings.email_subject
    || faviconUrl !== documentSettings.favicon_url
    || resetCssEnabled !== documentSettings.reset_css_enabled
    || customCssEnabled !== documentSettings.custom_css_enabled
    || customCss !== documentSettings.custom_css
    || outlookVmlEnabled !== documentSettings.outlook_vml_enabled;

  // Apply is blocked while enabled Custom CSS fails the security
  // validator, or the favicon URL is invalid — item 1's "failed
  // validation must create no history entry": neither ever reaches
  // updateDocumentSettings, so no undo step is ever created for them.
  const blocksApply = (customCssEnabled && !cssValidation.valid) || Boolean(faviconError);

  function handleAssetSelected(selection: AssetSelection) {
    setFaviconUrl(selection.url);
    setAssetPickerOpen(false);
  }

  // Item 1 — "Cancel must create no history entry": Cancel/backdrop/
  // Escape all route to onClose directly, never calling onApply, so
  // builder.updateDocumentSettings (the only function that ever commits
  // to history) is never invoked for a cancelled edit.
  function handleApply() {
    if (!dirty) {
      onClose();
      return;
    }
    if (blocksApply) return;
    onApply({
      email_title: emailTitle.trim(),
      email_subject: emailSubject.trim(),
      favicon_url: faviconUrl.trim(),
      reset_css_enabled: resetCssEnabled,
      custom_css_enabled: customCssEnabled,
      custom_css: customCss,
      outlook_vml_enabled: outlookVmlEnabled,
    });
    onClose();
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
          <h2 id="document-settings-heading">Email Settings</h2>
          <button type="button" className="document-settings-dialog__close" aria-label="Close" onClick={onClose}>
            <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
          </button>
        </div>

        <div className="document-settings-dialog__body">
          <section className="document-settings-dialog__group" aria-labelledby="document-settings-group-metadata">
            <h3 id="document-settings-group-metadata" className="document-settings-dialog__group-heading">
              Email Metadata
            </h3>
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
              {documentName}) and not the subject line.
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
            {faviconError && (
              <div className="document-settings-dialog__css-errors" role="alert">
                <p>
                  <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                  {faviconError}
                </p>
              </div>
            )}
            <p className="document-settings-dialog__hint">
              Optional. Must be a public https:// (or http://) URL — pick from your Asset Manager or paste a link.
            </p>
          </div>
          </section>

          <section className="document-settings-dialog__group" aria-labelledby="document-settings-group-css">
            <h3 id="document-settings-group-css" className="document-settings-dialog__group-heading">
              CSS &amp; Rendering
            </h3>
          <div className="document-settings-dialog__field">
            <label className="document-settings-dialog__checkbox-row">
              <input
                type="checkbox"
                checked={resetCssEnabled}
                onChange={(event) => setResetCssEnabled(event.target.checked)}
              />
              Enable Email Reset CSS
            </label>
            <p className="document-settings-dialog__hint">
              The compatibility baseline applied across email clients (margin/spacing/table normalization).
              Disabling it may reduce visual consistency across email clients — recommended to leave enabled.
            </p>
          </div>

          <div className="document-settings-dialog__field">
            <label className="document-settings-dialog__checkbox-row">
              <input
                type="checkbox"
                checked={customCssEnabled}
                onChange={(event) => setCustomCssEnabled(event.target.checked)}
              />
              Enable Custom CSS
            </label>
            {customCssEnabled && (
              <>
                <div className="document-settings-dialog__css-editor">
                  <CodeEditor
                    language="css"
                    value={customCss}
                    onChange={setCustomCss}
                    ariaLabel="Custom CSS"
                    markers={cssMarkers}
                  />
                </div>
                {customCss.trim() === '' && (
                  <p className="document-settings-dialog__hint">
                    No Custom CSS yet — anything you add here is applied after Reset CSS and responsive CSS, so it
                    can safely override them when needed.
                  </p>
                )}
                {cssValidation.errors.length > 0 && (
                  <div className="document-settings-dialog__css-errors" role="alert">
                    {cssValidation.errors.map((message) => (
                      <p key={message}>
                        <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                        {message}
                      </p>
                    ))}
                  </div>
                )}
                {cssValidation.valid && cssWarnings.length > 0 && (
                  <div className="document-settings-dialog__css-warnings" role="status">
                    {cssWarnings.map((warning) => (
                      <p key={`${warning.selector}-${warning.property}`}>
                        <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                        {warning.message}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="document-settings-dialog__hint">
              Separate from Email Reset CSS. Applied last in the cascade (Reset CSS, then responsive CSS, then
              Custom CSS), so it intentionally wins where specificity is equal.
            </p>
          </div>
          </section>

          <section className="document-settings-dialog__group" aria-labelledby="document-settings-group-compat">
            <h3 id="document-settings-group-compat" className="document-settings-dialog__group-heading">
              Email Client Compatibility
            </h3>
          <div className="document-settings-dialog__field">
            <label className="document-settings-dialog__checkbox-row">
              <input
                type="checkbox"
                checked={outlookVmlEnabled}
                onChange={(event) => setOutlookVmlEnabled(event.target.checked)}
              />
              Outlook Compatibility — Enable Outlook/VML fallbacks
            </label>
            <p className="document-settings-dialog__hint">
              Adds Microsoft Outlook-compatible VML fallbacks for supported backgrounds and buttons. Recommended
              for broad email-client compatibility. A module that already has its own VML setting keeps that
              choice; this is the default for every other module.
            </p>
          </div>
          </section>
        </div>

        <div className="document-settings-dialog__actions">
          <button type="button" className="button button--outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleApply}
            disabled={blocksApply}
            title={blocksApply ? 'Fix the highlighted errors above before applying.' : undefined}
          >
            Apply
          </button>
        </div>
      </div>

      {assetPickerOpen && (
        <AssetManagerDialog onSelect={handleAssetSelected} onClose={() => setAssetPickerOpen(false)} />
      )}
    </div>
  );
}

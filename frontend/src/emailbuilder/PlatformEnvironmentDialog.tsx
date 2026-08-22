import { useEffect, useMemo, useRef, useState } from 'react';
import { PLATFORM_OPTIONS } from './platformOptions';
import { detectCompatibilityImpact } from './platformCompatibility';
import type { EmailPlatform } from './types';
import './PlatformEnvironmentDialog.css';

interface PlatformEnvironmentDialogProps {
  currentPlatform: EmailPlatform;
  // The already-rendered email HTML (same string Feature 09's Code Editor
  // shows) — used only for the advisory compatibility-impact scan, never
  // sent anywhere or mutated by this dialog.
  documentHtml: string;
  onApply: (platform: EmailPlatform) => Promise<void>;
  onClose: () => void;
}

// Feature 10 — Platform Environment. Operations covered: choose environment
// (radio-card list), load capability matrix (PLATFORM_OPTIONS), apply
// adapter (onApply -> parent PATCHes EmailDocument.platform, the same
// endpoint Features 03/08/09 already use), display compatibility impact
// (detectCompatibilityImpact), preserve generic portability (Generic is
// always a selectable, fully-supported option), platform-specific
// token/script support (the merge-tag reference list, copy-to-clipboard —
// never auto-inserted into content). One document model, one builder UI;
// this dialog only ever changes the `platform` field.
export function PlatformEnvironmentDialog({
  currentPlatform, documentHtml, onApply, onClose,
}: PlatformEnvironmentDialogProps) {
  const [selected, setSelected] = useState<EmailPlatform>(currentPlatform);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      const active = document.activeElement as HTMLElement;
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

  const selectedOption = PLATFORM_OPTIONS.find((option) => option.value === selected) ?? PLATFORM_OPTIONS[0];
  const isSwitching = selected !== currentPlatform;

  const impacts = useMemo(
    () => (isSwitching ? detectCompatibilityImpact(documentHtml, selected) : []),
    [documentHtml, selected, isSwitching],
  );

  async function handleCopyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((current) => (current === token ? null : current)), 1500);
    } catch {
      // Clipboard access can fail outside a trusted user gesture context;
      // the token is still visible on screen for the user to select/copy
      // manually, so there is nothing further to recover here.
    }
  }

  async function handleApply() {
    if (!isSwitching) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onApply(selected);
      onClose();
    } catch {
      setError('We could not switch the platform. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="platform-env-dialog__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="platform-env-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="platform-env-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="platform-env-dialog__header">
          <h2 id="platform-env-heading">Platform / Environment Mode</h2>
          <button type="button" className="platform-env-dialog__close" aria-label="Close" onClick={onClose}>
            <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
          </button>
        </div>

        <div className="platform-env-dialog__body">
          <div className="platform-env-dialog__list" role="radiogroup" aria-label="Target platform">
            {PLATFORM_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected === option.value}
                className={
                  selected === option.value
                    ? 'platform-env-dialog__option platform-env-dialog__option--active'
                    : 'platform-env-dialog__option'
                }
                onClick={() => setSelected(option.value)}
              >
                <span className={`mdaiw-icon mdaiw-icon--${option.icon}`} aria-hidden="true" />
                <span className="platform-env-dialog__option-text">
                  <span className="platform-env-dialog__option-label">{option.label}</span>
                  <span className="platform-env-dialog__option-description">{option.description}</span>
                </span>
                {option.value === currentPlatform && (
                  <span className="platform-env-dialog__current-badge">Current</span>
                )}
              </button>
            ))}
          </div>

          <div className="platform-env-dialog__detail">
            <h3>{selectedOption.label}</h3>

            <dl className="platform-env-dialog__matrix">
              <div className="platform-env-dialog__matrix-row">
                <dt>Compatibility Mode</dt>
                <dd>{selectedOption.compatibilityMode}</dd>
              </div>
              <div className="platform-env-dialog__matrix-row">
                <dt>HTML Structure</dt>
                <dd>{selectedOption.htmlStructure}</dd>
              </div>
              <div className="platform-env-dialog__matrix-row">
                <dt>CSS</dt>
                <dd>{selectedOption.css}</dd>
              </div>
              <div className="platform-env-dialog__matrix-row">
                <dt>Scripting</dt>
                <dd>{selectedOption.scripting}</dd>
              </div>
            </dl>

            <p className="platform-env-dialog__note">
              Switching platform may enable additional features and merge tags.
            </p>

            {selectedOption.mergeTags.length > 0 && (
              <div className="platform-env-dialog__tokens">
                <h4>Available merge tags</h4>
                <ul>
                  {selectedOption.mergeTags.map((tag) => (
                    <li key={tag.token}>
                      <button
                        type="button"
                        className="platform-env-dialog__token"
                        onClick={() => handleCopyToken(tag.token)}
                        title={`Copy: ${tag.description}`}
                      >
                        <span className="mdaiw-icon mdaiw-icon--file" aria-hidden="true" />
                        <code>{tag.token}</code>
                        <span className="platform-env-dialog__token-status">
                          {copiedToken === tag.token ? 'Copied' : 'Copy'}
                        </span>
                      </button>
                      <span className="platform-env-dialog__token-description">{tag.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {impacts.length > 0 && (
              <div className="platform-env-dialog__impact" role="status">
                <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                <div>
                  <p className="platform-env-dialog__impact-title">Compatibility impact</p>
                  <ul>
                    {impacts.map((impact) => (
                      <li key={impact.family}>
                        This email contains {impact.count} {impact.label} that {selectedOption.label} does not
                        natively support — they will render as plain text.
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="platform-env-dialog__error" role="alert">
            <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="platform-env-dialog__actions">
          <button type="button" className="button button--outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={handleApply} disabled={saving || !isSwitching}>
            {saving ? 'Applying…' : 'Apply Platform'}
          </button>
        </div>
      </div>
    </div>
  );
}

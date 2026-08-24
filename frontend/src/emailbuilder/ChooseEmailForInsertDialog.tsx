import { useEffect, useRef } from 'react';
import { EmailListPicker } from './EmailListPicker';
import type { EmailDocument } from './types';
import './SaveModuleDialog.css';
import './ChooseEmailForInsertDialog.css';

interface ChooseEmailForInsertDialogProps {
  itemLabel: string;
  creating: boolean;
  onChooseExisting: (email: EmailDocument) => void;
  onCreateBlank: () => void;
  onCancel: () => void;
}

// Module-4 Navigation Completion, Phase A — Module Library's "insert into
// an email" handoff, reached only from the standalone entry point (an
// open builder already has a document to insert into directly). Reuses
// the SAME email-list picker every other standalone destination uses;
// "Start a blank email" reuses the ordinary blank-document creation path
// (Feature 02), and the actual insertion — once a document exists — goes
// through EmailBuilderWorkspacePage's one-shot deep-link into the SAME
// builder.addModule/addSavedModule mutation path a normal in-builder
// click already uses. No second insertion mechanism.
export function ChooseEmailForInsertDialog({
  itemLabel, creating, onChooseExisting, onCreateBlank, onCancel,
}: ChooseEmailForInsertDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button, [href], input')?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="save-module-dialog__backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="save-module-dialog choose-email-for-insert"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choose-email-for-insert-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="choose-email-for-insert-heading">Use {itemLabel} in an email</h2>
        <p className="choose-email-for-insert__hint">
          Choose an existing email to insert it into, or start a new blank email.
        </p>

        <button
          type="button"
          className="button button--primary choose-email-for-insert__blank"
          disabled={creating}
          onClick={onCreateBlank}
        >
          {creating ? 'Creating…' : 'Start a blank email and insert here'}
        </button>

        <div className="choose-email-for-insert__list">
          <EmailListPicker
            heading="Or choose an existing email"
            emptyHint="No emails yet — start a blank one above."
            renderRowActions={(email) => (
              <button type="button" className="button button--outline" disabled={creating} onClick={() => onChooseExisting(email)}>
                Insert here
              </button>
            )}
          />
        </div>

        <div className="choose-email-for-insert__actions">
          <button type="button" className="button button--outline" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

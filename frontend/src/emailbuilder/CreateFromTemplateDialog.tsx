import { useEffect, useRef, useState } from 'react';
import './SaveModuleDialog.css';

interface CreateFromTemplateDialogProps {
  templateName: string;
  defaultName: string;
  onCreate: (name: string) => void;
  onCancel: () => void;
  creating: boolean;
  error: string | null;
}

// Phase B (Template Experience) — the "choose/provide a unique new email
// name" step of the create-from-template workflow (Dashboard "Choose
// Template", Create Email's Template option, and the Templates page's
// "Use this template" all land here). Same accessible-dialog shape as
// RenameEmailDialog.tsx/SaveModuleDialog.tsx (single text field + Cancel/
// primary action, minimal focus trap, Escape to close, same stylesheet) —
// a new component rather than reusing RenameEmailDialog directly because
// the heading/description/button label/prefill semantics are different
// enough ("name a new email" vs. "rename this email").
export function CreateFromTemplateDialog({
  templateName, defaultName, onCreate, onCancel, creating, error,
}: CreateFromTemplateDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const forward = !event.shiftKey;
      const active = document.activeElement;
      const focusables = [inputRef.current, createButtonRef.current, cancelButtonRef.current].filter(Boolean) as HTMLElement[];
      const index = focusables.indexOf(active as HTMLElement);
      if (index === -1) return;
      const nextIndex = forward ? (index + 1) % focusables.length : (index - 1 + focusables.length) % focusables.length;
      event.preventDefault();
      focusables[nextIndex]?.focus();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const trimmed = name.trim();

  return (
    <div className="save-module-dialog__backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="save-module-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-from-template-dialog-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="create-from-template-dialog-heading">Name your new email</h2>
        <p>
          Based on template: <strong>{templateName}</strong>
        </p>
        <label className="save-module-dialog__field">
          <span>Email name</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed && !creating) onCreate(trimmed);
            }}
          />
        </label>
        {error && <p role="alert" className="save-module-dialog__error">{error}</p>}
        <div className="save-module-dialog__actions">
          <button type="button" className="button button--outline" ref={cancelButtonRef} onClick={onCancel} disabled={creating}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            ref={createButtonRef}
            disabled={!trimmed || creating}
            onClick={() => trimmed && onCreate(trimmed)}
          >
            {creating ? 'Creating…' : 'Create Email →'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import './SaveModuleDialog.css';

interface RenameEmailDialogProps {
  currentName: string;
  onRename: (name: string) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

// Dashboard row action — same accessible-dialog shape as
// SaveModuleDialog.tsx (single text field + Cancel/Save, minimal focus
// trap, Escape to close), reusing that component's CSS classes directly
// rather than forking a near-identical stylesheet.
export function RenameEmailDialog({ currentName, onRename, onCancel, saving, error }: RenameEmailDialogProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
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
      const focusables = [inputRef.current, saveButtonRef.current, cancelButtonRef.current].filter(Boolean) as HTMLElement[];
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
        aria-labelledby="rename-email-dialog-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="rename-email-dialog-heading">Rename email</h2>
        <label className="save-module-dialog__field">
          <span>Email name</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onRename(trimmed);
            }}
          />
        </label>
        {error && <p role="alert" className="save-module-dialog__error">{error}</p>}
        <div className="save-module-dialog__actions">
          <button type="button" className="button button--outline" ref={cancelButtonRef} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            ref={saveButtonRef}
            disabled={!trimmed || saving}
            onClick={() => trimmed && onRename(trimmed)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

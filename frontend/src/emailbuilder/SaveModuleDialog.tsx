import { useEffect, useRef, useState } from 'react';
import './SaveModuleDialog.css';

interface SaveModuleDialogProps {
  moduleLabel: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  saving: boolean;
}

// Feature 04 — "Save as reusable module" flow. Minimal focus trap (two
// interactive elements) follows the same accessible-modal pattern as
// components/ConfirmDialog.tsx.
export function SaveModuleDialog({ moduleLabel, onSave, onCancel, saving }: SaveModuleDialogProps) {
  const [name, setName] = useState(moduleLabel);
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
        aria-labelledby="save-module-dialog-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="save-module-dialog-heading">Save as reusable module</h2>
        <p className="save-module-dialog__hint">
          This module will appear in your Saved Modules library so you can reuse it in any email.
        </p>
        <label className="save-module-dialog__field">
          <span>Module name</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onSave(trimmed);
            }}
          />
        </label>
        <div className="save-module-dialog__actions">
          <button type="button" className="button button--outline" ref={cancelButtonRef} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            ref={saveButtonRef}
            disabled={!trimmed || saving}
            onClick={() => trimmed && onSave(trimmed)}
          >
            {saving ? 'Saving…' : 'Save Module'}
          </button>
        </div>
      </div>
    </div>
  );
}

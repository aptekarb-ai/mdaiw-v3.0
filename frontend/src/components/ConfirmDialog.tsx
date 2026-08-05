import { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  open: boolean;
  heading: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  heading,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      confirmButtonRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
        return;
      }
      // Minimal focus trap — only two focusable elements exist in this
      // dialog, so cycling between them on Tab/Shift+Tab is sufficient;
      // no need for a full focusable-element query.
      if (event.key === 'Tab') {
        const forward = !event.shiftKey;
        const active = document.activeElement;
        if (forward && active === confirmButtonRef.current) {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        } else if (!forward && active === cancelButtonRef.current) {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        } else if (forward && active === cancelButtonRef.current) {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        } else if (!forward && active === confirmButtonRef.current) {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog__backdrop" role="presentation" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-heading"
        aria-describedby="confirm-dialog-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-heading">{heading}</h2>
        <p id="confirm-dialog-body">{body}</p>
        <div className="confirm-dialog__actions">
          <button type="button" className="button button--outline" ref={cancelButtonRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="button button--primary"
            ref={confirmButtonRef}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { explainIssue } from './validationExplanation';
import type { ValidationIssue } from './emailValidation';
import type { EmailModule } from './edm';
import './ValidationExplanationModal.css';

interface ValidationExplanationModalProps {
  issue: ValidationIssue;
  modules: EmailModule[];
  onClose: () => void;
  onGoToModule: (moduleId: string) => void;
  // E10 — issueId lets AIEngineerPanel recover the REAL ValidationIssue
  // object (via its own already-computed ValidationReport) instead of
  // re-parsing it out of the prompt string, so a follow-up like "can you
  // fix it?" can reliably resolve "it" back to this exact issue.
  onAskAiEngineer?: (prompt: string, issueId?: string) => void;
}

const SEVERITY_LABEL: Record<ValidationIssue['severity'], string> = { error: 'Error', warning: 'Warning' };

// E7 — the ONE reusable Explanation modal every issue's "Explain" action
// opens (never one modal per category — see validationExplanation.ts's
// module docstring for why every field here comes from the SAME real
// ValidationIssue this app already computed). Same accessible-modal
// contract (focus trap, Escape, backdrop click, focus restore) as
// DocumentSettingsDialog.tsx.
export function ValidationExplanationModal({
  issue, modules, onClose, onGoToModule, onAskAiEngineer,
}: ValidationExplanationModalProps) {
  const explanation = explainIssue(issue, modules);
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

  return (
    <div className="validation-explanation-modal__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="validation-explanation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="validation-explanation-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="validation-explanation-modal__header">
          <div>
            <span className={`validation-explanation-modal__severity validation-explanation-modal__severity--${issue.severity}`}>
              {SEVERITY_LABEL[issue.severity]}
            </span>
            <h2 id="validation-explanation-heading">{explanation.whatIsWrong}</h2>
          </div>
          <button type="button" className="validation-explanation-modal__close" aria-label="Close" onClick={onClose}>
            <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
          </button>
        </div>

        <div className="validation-explanation-modal__body">
          <section>
            <h3>Why it matters</h3>
            <p>{explanation.whyItMatters}</p>
          </section>
          <section>
            <h3>Where</h3>
            <p>{explanation.where}</p>
          </section>
          <section>
            <h3>Affected clients</h3>
            <p>{explanation.affectedClients}</p>
          </section>
          <section>
            <h3>What can happen</h3>
            <p>{explanation.whatCanHappen}</p>
          </section>
          <section>
            <h3>Can this be fixed automatically?</h3>
            <p>{explanation.howToFix}</p>
          </section>
        </div>

        <div className="validation-explanation-modal__actions">
          <button type="button" className="button button--outline" onClick={onClose}>
            Close
          </button>
          {issue.moduleId && (
            <button
              type="button"
              className="button button--outline"
              onClick={() => { onGoToModule(issue.moduleId!); onClose(); }}
            >
              Go to module
            </button>
          )}
          {onAskAiEngineer && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                onAskAiEngineer(`Explain this issue and, if possible, fix it: ${issue.title} — ${issue.detail}`, issue.id);
                onClose();
              }}
            >
              <span className="mdaiw-icon mdaiw-icon--ai-assistants" aria-hidden="true" />
              Ask AI Engineer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { ValidationIssue } from '../types/landingpages';
import type { FixCandidate, IssueFixState } from './fixCandidates';
import './IssueFixDialog.css';

export interface IssueFixApiError {
  code?: string;
  message: string;
}

export interface IssueFixDialogProps {
  open: boolean;
  issue: ValidationIssue | null;
  loading: boolean;
  error: IssueFixApiError | null;
  aiUnavailable: boolean;
  state: IssueFixState | null;
  applying: boolean;
  // Fix-Application Correctness sprint (spec section 5/18/19) — distinct
  // in-flight phase text, and an in-modal apply failure that must NOT
  // close the dialog (candidate rejected, selected issue still present,
  // stale proposal, revalidation itself failed). Kept separate from
  // `error` above, which is the earlier "couldn't fetch a candidate" case.
  applyPhase: 'applying' | 'revalidating' | null;
  applyError: IssueFixApiError | null;
  onApply: (fixId: string) => void;
  onCancel: () => void;
}

const RISK_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const OPTION_LETTERS = ['A', 'B', 'C'];
const METHOD_LABEL: Record<FixCandidate['method'], string> = {
  deterministic: 'Deterministic', ai: 'AI-assisted',
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

const APPLY_PHASE_LABEL: Record<'applying' | 'revalidating', string> = {
  applying: 'Applying fix…',
  revalidating: 'Revalidating…',
};

export function IssueFixDialog({
  open, issue, loading, error, aiUnavailable, state, applying, applyPhase, applyError, onApply, onCancel,
}: IssueFixDialogProps) {
  const [selectedFixId, setSelectedFixId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || loading || !state) return;
    const selectable = state.candidates.filter((c) => c.selectable);
    setSelectedFixId(selectable.length === 1 ? selectable[0].fixId : null);
  }, [open, loading, state]);

  useEffect(() => {
    if (!open) return;
    primaryButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const selectableCandidates = state?.candidates.filter((c) => c.selectable) ?? [];
  const nonSelectable = state?.candidates.filter((c) => !c.selectable) ?? [];
  const isAlternativeGroup = state?.bucket === 'alternatives';

  return (
    <div className="issue-fix-dialog__backdrop" role="presentation" onClick={onCancel}>
      <div
        className="issue-fix-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-fix-dialog-heading"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="issue-fix-dialog__header">
          <h2 id="issue-fix-dialog-heading">AI Fix This Issue</h2>
          {issue && (
            <p className="issue-fix-dialog__issue-summary">
              {issue.rule_id} &middot; Line {issue.line}
              <br />
              {issue.message}
            </p>
          )}
        </div>

        {loading && (
          <div className="issue-fix-dialog__loading" role="status">
            <span className="mdaiw-icon mdaiw-icon--spinner issue-fix-dialog__spinner" aria-hidden="true" />
            <p>Checking for a fix…</p>
          </div>
        )}

        {!loading && error && (
          <div className="issue-fix-dialog__error" role="alert">
            <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
            <p>{error.message}</p>
            <div className="issue-fix-dialog__actions">
              <button type="button" className="button button--outline" onClick={onCancel}>Close</button>
            </div>
          </div>
        )}

        {!loading && !error && state && (
          <>
            {aiUnavailable && state.bucket === 'unfixable' && (
              <p className="issue-fix-dialog__ai-unavailable" role="status">
                AI fixing is currently unavailable.
              </p>
            )}

            {state.bucket === 'unfixable' && !aiUnavailable && (
              <p className="issue-fix-dialog__review-manually" role="status">
                {nonSelectable[0]?.rejectionNotice ?? 'Review manually.'}
              </p>
            )}

            {isAlternativeGroup ? (
              <fieldset className="issue-fix-dialog__group-options">
                <legend className="issue-fix-dialog__group-legend">
                  {selectableCandidates.length} fix options — choose one.
                </legend>
                {selectableCandidates.map((candidate, index) => (
                  <label key={candidate.fixId} className="issue-fix-dialog__option">
                    <input
                      type="radio" name="issue-fix-option"
                      checked={selectedFixId === candidate.fixId}
                      onChange={() => setSelectedFixId(candidate.fixId)}
                    />
                    <div>
                      <span className="issue-fix-dialog__option-title">
                        Option {OPTION_LETTERS[index] ?? String(index + 1)}
                      </span>
                      <CandidateBody candidate={candidate} />
                    </div>
                  </label>
                ))}
              </fieldset>
            ) : (
              selectableCandidates.map((candidate) => (
                <div key={candidate.fixId} className="issue-fix-dialog__single-candidate">
                  <p className="issue-fix-dialog__recommendation-label">
                    {candidate.method === 'deterministic' ? 'Recommended fix' : 'AI-assisted recommendation'}
                  </p>
                  <CandidateBody candidate={candidate} />
                </div>
              ))
            )}

            {applying && (
              <div className="issue-fix-dialog__loading" role="status">
                <span className="mdaiw-icon mdaiw-icon--spinner issue-fix-dialog__spinner" aria-hidden="true" />
                <p>{applyPhase ? APPLY_PHASE_LABEL[applyPhase] : 'Applying fix…'}</p>
              </div>
            )}

            {!applying && applyError && (
              <div className="issue-fix-dialog__error" role="alert">
                <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
                <p>{applyError.message}</p>
              </div>
            )}

            <div className="issue-fix-dialog__actions">
              <button type="button" className="button button--outline" onClick={onCancel} disabled={applying}>
                Cancel
              </button>
              {selectableCandidates.length > 0 && (
                <button
                  type="button" className="button button--primary" ref={primaryButtonRef}
                  disabled={!selectedFixId || applying}
                  onClick={() => selectedFixId && onApply(selectedFixId)}
                >
                  {applying
                    ? (applyPhase ? APPLY_PHASE_LABEL[applyPhase] : 'Applying fix…')
                    : (applyError ? 'Try Again' : 'Apply Fix')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CandidateBody({ candidate }: { candidate: FixCandidate }) {
  return (
    <div className="issue-fix-dialog__candidate-body">
      <div className="issue-fix-dialog__candidate-meta">
        <span className={`issue-fix-dialog__method-badge issue-fix-dialog__method-badge--${candidate.method}`}>
          Fix method: {METHOD_LABEL[candidate.method]}
        </span>
        <span className={`issue-fix-dialog__risk-badge issue-fix-dialog__risk-badge--${candidate.risk}`}>
          Risk: {RISK_LABEL[candidate.risk] ?? candidate.risk}
        </span>
      </div>
      <p className="issue-fix-dialog__candidate-description">{candidate.description}</p>
      {candidate.assumptions.length > 0 && (
        <ul className="issue-fix-dialog__assumptions">
          {candidate.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
        </ul>
      )}
      {candidate.requiresConfiguration && (
        <p className="issue-fix-dialog__requires-configuration">Requires configuration before use.</p>
      )}
      <div className="issue-fix-dialog__diff">
        <div className="issue-fix-dialog__diff-row issue-fix-dialog__diff-row--removed">
          <span className="issue-fix-dialog__diff-label">Original</span>
          <code>{candidate.originalText || '(nothing — this is an insertion)'}</code>
        </div>
        <div className="issue-fix-dialog__diff-row issue-fix-dialog__diff-row--added">
          <span className="issue-fix-dialog__diff-label">Proposed</span>
          <code>{candidate.replacementText}</code>
        </div>
      </div>
    </div>
  );
}

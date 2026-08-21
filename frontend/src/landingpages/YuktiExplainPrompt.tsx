import './YuktiExplainPrompt.css';

export interface YuktiExplainPromptProps {
  open: boolean;
  issueCount: number;
  onNotNow: () => void;
  onExplainIssues: () => void;
}

// Deliberately NOT a modal dialog — no backdrop, no focus trap, the page
// underneath stays fully usable while this is showing (spec: "non-
// blocking assistance prompt"). Session-level dismissal (see
// LandingPageValidatorPage's yukti_explain_prompt_seen sessionStorage
// flag) is owned by the caller, not this component — it only renders
// when `open` is true.
export function YuktiExplainPrompt({ open, issueCount, onNotNow, onExplainIssues }: YuktiExplainPromptProps) {
  if (!open) return null;

  return (
    <div className="yukti-explain-prompt" role="status">
      <span className="mdaiw-icon mdaiw-icon--ai-assistants yukti-explain-prompt__icon" aria-hidden="true" />
      <div className="yukti-explain-prompt__body">
        <p className="yukti-explain-prompt__name">Yukti</p>
        <p className="yukti-explain-prompt__message">
          I found {issueCount} validation issue{issueCount === 1 ? '' : 's'}.
          Would you like me to explain what they mean and how they can be fixed?
        </p>
        <div className="yukti-explain-prompt__actions">
          <button type="button" className="button button--outline" onClick={onNotNow}>
            Not Now
          </button>
          <button type="button" className="button button--primary" onClick={onExplainIssues}>
            Explain Issues
          </button>
        </div>
      </div>
    </div>
  );
}

import type { ValidationScope } from '../types/landingpages';
import './ValidatorToolbar.css';

export interface ValidatorToolbarProps {
  onValidate: () => void;
  validating: boolean;
  onCopy: () => void;
  copyDisabled?: boolean;
  validateDisabled?: boolean;
  validateDisabledReason?: string;
  scope?: ValidationScope;
}

const LATER_SPRINT = 'This action will become available in a later sprint.';
const COMPLETE_LP_REQUIRED = 'Complete LP validation is required to preview or save a landing page.';

export function ValidatorToolbar({
  onValidate, validating, onCopy, copyDisabled, validateDisabled, validateDisabledReason, scope = 'complete',
}: ValidatorToolbarProps) {
  const previewSaveReason = scope === 'complete' ? undefined : COMPLETE_LP_REQUIRED;

  return (
    <div className="validator-toolbar" role="toolbar" aria-label="Validator actions">
      <div className="validator-toolbar__group">
        <button
          type="button"
          className="button button--primary"
          onClick={onValidate}
          disabled={validating || validateDisabled}
          aria-busy={validating}
          title={validateDisabled ? (validateDisabledReason ?? 'Enter code for the selected validation scope before validating.') : undefined}
        >
          {validating ? 'Validating…' : 'Validate Code'}
        </button>
        <DisabledAction label="Fix These Errors" reason={`Automatic AI repair — ${LATER_SPRINT}`} />
        <DisabledAction label="Ask AI to Review and Fix" reason={`AI-guided review — ${LATER_SPRINT}`} />
      </div>

      <div className="validator-toolbar__group">
        <DisabledAction label="Preview" reason={previewSaveReason ?? `Secure page preview — ${LATER_SPRINT}`} />
        <DisabledAction label="Save" reason={previewSaveReason ?? `Saving to a project — ${LATER_SPRINT}`} />
        <DisabledAction label="Download" reason={`Code export — ${LATER_SPRINT}`} />
        <button
          type="button"
          className="button button--outline"
          onClick={onCopy}
          disabled={copyDisabled}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <button
      type="button"
      className="button button--outline"
      disabled
      aria-disabled="true"
      aria-label={`${label} — not available yet`}
      title={reason}
    >
      {label}
    </button>
  );
}

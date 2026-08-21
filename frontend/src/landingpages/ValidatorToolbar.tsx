import type { CssSourceType, ValidationScope } from '../types/landingpages';
import './ValidatorToolbar.css';

export interface ValidatorToolbarProps {
  onValidate: () => void;
  validating: boolean;
  onCopy: () => void;
  copyDisabled?: boolean;
  validateDisabled?: boolean;
  validateDisabledReason?: string;
  scope?: ValidationScope;
  // Sprint CSS-E — "Compile to CSS" is only meaningful for the CSS-only
  // scope with a preprocessor source type selected; the request it sends
  // is identical to Validate Code (see LandingPageValidatorPage's
  // handleValidate — the backend always compiles+validates together,
  // there is no compile-only mode), it is only framed differently here.
  cssSourceType?: CssSourceType;
  hasValidated: boolean;
  isStale: boolean;
  hasActionableIssues: boolean;
  onRunAIFixIssues?: () => void;
  // Clicking "AI Fix Issues" is consent for the whole autonomous repair
  // operation (no review dialog first) — this drives the button's
  // in-flight spinner label while the server-side repair loop runs,
  // which can take several seconds across multiple validate+repair
  // rounds (spec section 32 — never freeze with no explanation).
  fixIssuesRunning?: boolean;
  onPreview?: () => void;
  previewDisabled?: boolean;
  previewDisabledReason?: string;
  previewLoading?: boolean;

  // Save/Download closure sprint.
  onSave?: () => void;
  saveDisabled?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'failed';
  // e.g. "Saved · Validation: Up to date" / "Save failed — Try again".
  // Independent of validation status by design (spec: "do NOT pretend
  // that the saved LP is validated" when the source has changed since).
  saveStatusText?: string;
  // Only rendered before the FIRST save of a brand-new landing page — a
  // saved project's name is changed via its own settings, never
  // silently overwritten by a later Save click.
  showProjectNameInput?: boolean;
  projectName?: string;
  onProjectNameChange?: (value: string) => void;
  onDownload?: () => void;
  downloadDisabled?: boolean;
  downloadDisabledReason?: string;
  onReloadSaved?: () => void;
}

const LATER_SPRINT = 'This action will become available in a later sprint.';
const COMPLETE_LP_REQUIRED = 'Complete LP validation is required to save a landing page.';
const COMPILE_LABEL: Partial<Record<CssSourceType, string>> = {
  scss: 'Compile to CSS',
  sass: 'Compile to CSS',
  less: 'Compile to CSS',
};

const AI_VALIDATE_TOOLTIP = 'Validate the selected code using standards-based validation engines and AI-assisted analysis.';
const AI_FIX_ISSUES_TOOLTIP = 'AI Engineer repairs every currently repairable issue automatically — no review dialog first.';

// Unifies the two disable conditions the internal deterministic-fix and
// AI-review systems each had on their own into ONE reason for the single
// AI Fix Issues entry point — the end user is no longer expected to know
// which internal engine would handle which issue; the autonomous repair
// loop (fixes/iterative.py::run_autonomous_repair) routes each issue to
// the correct engine internally.
function aiFixIssuesDisabledReason(hasValidated: boolean, isStale: boolean, hasActionableIssues: boolean): string | null {
  if (!hasValidated) return 'Validate the code first.';
  if (isStale) return 'Code changed. Validate again before fixing issues.';
  if (!hasActionableIssues) return 'No actionable issues found.';
  return null;
}

export function ValidatorToolbar({
  onValidate, validating, onCopy, copyDisabled, validateDisabled, validateDisabledReason, scope = 'complete',
  cssSourceType = 'css', hasValidated, isStale, hasActionableIssues, onRunAIFixIssues, fixIssuesRunning,
  onPreview, previewDisabled, previewDisabledReason, previewLoading,
  onSave, saveDisabled, saveStatus = 'idle', saveStatusText, showProjectNameInput, projectName, onProjectNameChange,
  onDownload, downloadDisabled, downloadDisabledReason, onReloadSaved,
}: ValidatorToolbarProps) {
  const saveReason = scope === 'complete' ? undefined : COMPLETE_LP_REQUIRED;
  const compileLabel = scope === 'css' ? COMPILE_LABEL[cssSourceType] : undefined;
  const aiFixIssuesReason = aiFixIssuesDisabledReason(hasValidated, isStale, hasActionableIssues);

  return (
    <div className="validator-toolbar" role="toolbar" aria-label="Validator actions">
      <div className="validator-toolbar__group">
        <button
          type="button"
          className="button button--primary"
          onClick={onValidate}
          disabled={validating || validateDisabled}
          aria-busy={validating}
          title={validateDisabled ? (validateDisabledReason ?? 'Enter code for the selected validation scope before validating.') : AI_VALIDATE_TOOLTIP}
        >
          {validating ? 'Validating…' : 'AI Validate Code'}
        </button>
        {compileLabel && (
          <button
            type="button"
            className="button button--outline"
            onClick={onValidate}
            disabled={validating || validateDisabled}
            aria-busy={validating}
            title="Compiles the current stylesheet and shows the generated CSS below."
          >
            {compileLabel}
          </button>
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={aiFixIssuesReason !== null || fixIssuesRunning}
          aria-busy={fixIssuesRunning}
          title={aiFixIssuesReason ?? AI_FIX_ISSUES_TOOLTIP}
          onClick={onRunAIFixIssues}
        >
          {fixIssuesRunning ? 'AI Engineer is repairing your code…' : 'AI Fix Issues'}
        </button>
      </div>

      <div className="validator-toolbar__group">
        <button
          type="button"
          className="button button--outline"
          onClick={onPreview}
          disabled={previewDisabled || previewLoading}
          aria-busy={previewLoading}
          title={previewDisabled ? previewDisabledReason : 'Opens the assembled landing page in a new tab.'}
        >
          {previewLoading ? 'Preparing preview…' : 'Preview'}
        </button>
        {showProjectNameInput && (
          <input
            type="text"
            className="validator-toolbar__project-name"
            placeholder="Landing page name"
            value={projectName ?? ''}
            onChange={(event) => onProjectNameChange?.(event.target.value)}
            disabled={saveStatus === 'saving'}
            aria-label="Landing page name"
          />
        )}
        {onSave ? (
          <span className="validator-toolbar__save-group">
            <button
              type="button"
              className="button button--outline"
              onClick={onSave}
              disabled={saveDisabled || saveStatus === 'saving'}
              aria-busy={saveStatus === 'saving'}
              title={saveReason ?? 'Save the current landing page.'}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {saveStatusText && (
              <span
                className={`validator-toolbar__save-status validator-toolbar__save-status--${saveStatus}`}
                role="status"
              >
                {saveStatusText}
              </span>
            )}
            {onReloadSaved && (
              <button type="button" className="button button--outline" onClick={onReloadSaved}>
                Reload Saved Version
              </button>
            )}
          </span>
        ) : (
          <DisabledAction label="Save" reason={saveReason ?? `Saving to a project — ${LATER_SPRINT}`} />
        )}
        {onDownload ? (
          <button
            type="button"
            className="button button--outline"
            onClick={onDownload}
            disabled={downloadDisabled}
            title={downloadDisabled ? downloadDisabledReason : 'Download the current landing page source.'}
          >
            Download
          </button>
        ) : (
          <DisabledAction label="Download" reason={`Code export — ${LATER_SPRINT}`} />
        )}
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

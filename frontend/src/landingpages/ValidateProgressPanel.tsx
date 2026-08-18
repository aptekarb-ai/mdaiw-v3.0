import type { ValidateOperationStatus, ValidateStage, ValidateStageState } from '../types/landingpages';
import './ValidateProgressPanel.css';

export interface ValidateProgressPanelProps {
  operation: ValidateOperationStatus | null;
}

// AI Validate Code Live Progress sprint (spec section 21-25) — a real
// progress panel driven entirely by backend-reported work, same "never a
// fake elapsed-time percentage" principle as RepairProgressPanel.
// `operation` is null only in the brief window between the click and the
// first status response; the panel still renders immediately in an
// indeterminate state rather than leaving the user with only a spinner.
const CHECKLIST_STAGES: { key: ValidateStage; label: string }[] = [
  { key: 'validating_html', label: 'HTML' },
  { key: 'validating_css', label: 'CSS' },
  { key: 'validating_js', label: 'JavaScript' },
  { key: 'validating_ampscript', label: 'AMPscript' },
  { key: 'ai_analysis', label: 'Cross-language' },
];

function checklistGlyph(state: ValidateStageState | undefined): string {
  if (state === 'done') return '✓'; // ✓
  if (state === 'active') return '●'; // ●
  return '○'; // ○ pending, or not part of this scope at all
}

export function ValidateProgressPanel({ operation }: ValidateProgressPanelProps) {
  const percent = operation?.percent ?? 0;
  const stageLabel = operation?.stage_label ?? 'Preparing source…';
  const indeterminate = operation === null;
  const checklist = operation?.stage_checklist;
  const relevantChecklist = checklist
    ? CHECKLIST_STAGES.filter((entry) => entry.key in checklist)
    : [];

  return (
    <div className="validate-progress-panel">
      <p className="validate-progress-panel__stage">AI Engineer is analyzing your code…</p>
      <div
        className={`validate-progress-panel__track${indeterminate ? ' validate-progress-panel__track--indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-label="AI Validate Code progress"
      >
        {!indeterminate && (
          <div className="validate-progress-panel__fill" style={{ width: `${percent}%` }} />
        )}
      </div>
      {!indeterminate && <p className="validate-progress-panel__percent">{percent}%</p>}

      {relevantChecklist.length > 0 && (
        <ul className="validate-progress-panel__checklist" aria-hidden="true">
          {relevantChecklist.map((entry) => (
            <li
              key={entry.key}
              className={`validate-progress-panel__checklist-item validate-progress-panel__checklist-item--${checklist?.[entry.key] ?? 'pending'}`}
            >
              <span className="validate-progress-panel__checklist-glyph">{checklistGlyph(checklist?.[entry.key])}</span>
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      <p className="validate-progress-panel__current">
        Current: {stageLabel}
      </p>

      {/* A meaningful stage change is announced; the numeric percent is
          NOT, matching RepairProgressPanel's established convention. */}
      <p className="visually-hidden" role="status" aria-live="polite">{stageLabel}</p>
    </div>
  );
}

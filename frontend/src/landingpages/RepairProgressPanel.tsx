import type { RepairOperationStatus } from '../types/landingpages';
import './RepairProgressPanel.css';

export interface RepairProgressPanelProps {
  operation: RepairOperationStatus | null;
}

// Real-Time Progress UX sprint — a real progress panel driven entirely by
// backend-reported work (spec section 2/7: "progress must never lie" —
// no elapsed-time animation, no fake percentage). `operation` is null
// only in the brief window between the click and the first status
// response; the panel still renders immediately in an indeterminate
// state (spec section 4) rather than leaving the user with only a
// spinner (spec section 1).
export function RepairProgressPanel({ operation }: RepairProgressPanelProps) {
  const percent = operation?.percent ?? 0;
  const stageLabel = operation?.stage_label ?? 'Analyzing your complete landing page…';
  const indeterminate = operation === null;

  return (
    <div className="repair-progress-panel">
      <p className="repair-progress-panel__stage">{stageLabel}</p>
      <div
        className={`repair-progress-panel__track${indeterminate ? ' repair-progress-panel__track--indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-label="AI Engineer repair progress"
      >
        {!indeterminate && (
          <div className="repair-progress-panel__fill" style={{ width: `${percent}%` }} />
        )}
      </div>
      {!indeterminate && (
        <div className="repair-progress-panel__counts">
          <span>{percent}%</span>
          <span>Resolved: {operation.issues_resolved}</span>
          <span>Remaining: {operation.issues_remaining}</span>
          {operation.issues_new > 0 && <span>New: {operation.issues_new}</span>}
        </div>
      )}
      {/* A meaningful stage change is announced; the numeric percent is
          NOT (spec section 26 — "do not announce every 1% update"). */}
      <p className="visually-hidden" role="status" aria-live="polite">{stageLabel}</p>
    </div>
  );
}

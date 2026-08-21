import type { YuktiAction } from '../types/yukti';
import './Yukti.css';

interface YuktiActionConfirmationProps {
  action: YuktiAction;
  onConfirm: () => void;
  onCancel: () => void;
}

function describeAction(action: YuktiAction): string {
  if (action.type === 'FILL_FIELD' || action.type === 'SUGGEST_FIELD_VALUE') {
    return `Enter "${action.value}" for this field?`;
  }
  return 'Apply this action?';
}

export function YuktiActionConfirmation({ action, onConfirm, onCancel }: YuktiActionConfirmationProps) {
  return (
    <div className="yukti-action-confirmation" role="alert">
      <p>{describeAction(action)}</p>
      <div className="yukti-action-confirmation__actions">
        <button type="button" className="button button--primary" onClick={onConfirm}>
          Confirm
        </button>
        <button type="button" className="button button--outline" onClick={onCancel}>
          Change
        </button>
      </div>
    </div>
  );
}

export interface ValidatorEmptyStateProps {
  message?: string;
}

export function ValidatorEmptyState({ message }: ValidatorEmptyStateProps) {
  return (
    <div className="validator-empty-state" role="status">
      <span className="mdaiw-icon mdaiw-icon--shield-check" aria-hidden="true" />
      <p>{message ?? 'Paste or write code in the editor, then select Validate Code.'}</p>
    </div>
  );
}

import './FormField.css';

interface ValidationSummaryProps {
  errors: string[];
}

export function ValidationSummary({ errors }: ValidationSummaryProps) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="validation-summary" role="alert">
      <p className="validation-summary__heading">Please correct the highlighted fields.</p>
      <ul>
        {errors.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

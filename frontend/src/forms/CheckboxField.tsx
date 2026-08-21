import type { InputHTMLAttributes, ReactNode } from 'react';
import './FormField.css';

interface CheckboxFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: ReactNode;
  error?: string;
}

export function CheckboxField({ id, label, error, ...inputProps }: CheckboxFieldProps) {
  return (
    <div className="checkbox-field">
      <label htmlFor={id} className="checkbox-field__label">
        <input
          id={id}
          type="checkbox"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          {...inputProps}
        />
        {label}
      </label>
      {error && (
        <p id={`${id}-error`} className="form-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

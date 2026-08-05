import { ENGINE_AVAILABILITY, VALIDATION_SCOPES, type ValidationScope } from '../types/landingpages';
import './ValidationScopeControl.css';

export interface ValidationScopeControlProps {
  value: ValidationScope;
  onChange: (scope: ValidationScope) => void;
  disabled?: boolean;
}

const UNAVAILABLE_REASON: Partial<Record<ValidationScope, string>> = {
  javascript: 'Available after JavaScript validation is installed',
  typescript: 'Available after TypeScript validation is installed',
};

export function ValidationScopeControl({ value, onChange, disabled }: ValidationScopeControlProps) {
  return (
    <div className="validation-scope-control">
      <span className="validation-scope-control__label" id="validation-scope-label">
        Validation scope
      </span>
      <div role="radiogroup" aria-labelledby="validation-scope-label" className="validation-scope-control__group">
        {VALIDATION_SCOPES.map((entry) => {
          const available = ENGINE_AVAILABILITY[entry.key];
          const isChecked = value === entry.key;
          const unavailableReason = UNAVAILABLE_REASON[entry.key];
          return (
            <label
              key={entry.key}
              className={
                isChecked
                  ? 'validation-scope-control__option validation-scope-control__option--active'
                  : 'validation-scope-control__option'
              }
              title={!available ? unavailableReason : undefined}
            >
              <input
                type="radio"
                name="validation-scope"
                value={entry.key}
                checked={isChecked}
                disabled={disabled || !available}
                onChange={() => onChange(entry.key)}
              />
              <span>{entry.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

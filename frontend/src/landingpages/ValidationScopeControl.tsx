import { ENGINE_AVAILABILITY, VALIDATION_SCOPES, type ValidationScope } from '../types/landingpages';
import './ValidationScopeControl.css';

export interface ValidationScopeControlProps {
  value: ValidationScope;
  onChange: (scope: ValidationScope) => void;
  disabled?: boolean;
}

// Every scope currently has a real engine — kept as an (empty) map rather
// than removed outright so a future scope without an engine yet has an
// established place to add its reason, matching how ENGINE_AVAILABILITY
// itself stays a full map rather than a partial one.
const UNAVAILABLE_REASON: Partial<Record<ValidationScope, string>> = {};

const COMPLETE_LP_TOOLTIP = 'Validate HTML, stylesheets, JavaScript and AMPscript together.';
const INDIVIDUAL_SCOPE_TOOLTIP = 'Validate only this code type.';

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
              title={!available ? unavailableReason : (entry.key === 'complete' ? COMPLETE_LP_TOOLTIP : INDIVIDUAL_SCOPE_TOOLTIP)}
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

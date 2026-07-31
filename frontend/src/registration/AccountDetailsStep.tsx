import { FormField } from '../forms/FormField';
import { PasswordField } from '../forms/PasswordField';
import { passwordRequirementChecks } from './validation';
import type { AccountFieldErrors, AccountRegistrationData } from '../types/registration';
import './AccountDetailsStep.css';
import './RegistrationWizard.css';

interface AccountDetailsStepProps {
  account: AccountRegistrationData;
  errors: AccountFieldErrors;
  onChange: (field: keyof AccountRegistrationData, value: string) => void;
}

export function AccountDetailsStep({ account, errors, onChange }: AccountDetailsStepProps) {
  const checks = passwordRequirementChecks(account.password);

  return (
    <div>
      <h2 className="registration-step-heading">Create your account</h2>
      <p className="registration-step-supporting">Fill in your account details.</p>
      <div className="account-details-step">
      <div className="account-details-step__form">
        <FormField
          id="reg-username"
          label="Username"
          required
          autoComplete="username"
          value={account.username}
          onChange={(event) => onChange('username', event.target.value)}
          error={errors.username}
        />
        <FormField
          id="reg-work-email"
          label="Work Email"
          type="email"
          required
          autoComplete="email"
          value={account.workEmail}
          onChange={(event) => onChange('workEmail', event.target.value)}
          error={errors.workEmail}
        />
        <PasswordField
          id="reg-password"
          label="Password"
          required
          autoComplete="new-password"
          value={account.password}
          onChange={(event) => onChange('password', event.target.value)}
          error={errors.password}
        />
        <PasswordField
          id="reg-confirm-password"
          label="Confirm Password"
          required
          autoComplete="new-password"
          value={account.confirmPassword}
          onChange={(event) => onChange('confirmPassword', event.target.value)}
          error={errors.confirmPassword}
        />
      </div>

      <div className="password-requirements">
        <p className="password-requirements__heading">Password must contain:</p>
        <ul>
          <li data-met={checks.minLength}>
            <span className={`mdaiw-icon mdaiw-icon--${checks.minLength ? 'check' : 'close'}`} aria-hidden="true" />
            At least 8 characters
          </li>
          <li data-met={checks.hasUppercase}>
            <span
              className={`mdaiw-icon mdaiw-icon--${checks.hasUppercase ? 'check' : 'close'}`}
              aria-hidden="true"
            />
            One uppercase letter
          </li>
          <li data-met={checks.hasLowercase}>
            <span
              className={`mdaiw-icon mdaiw-icon--${checks.hasLowercase ? 'check' : 'close'}`}
              aria-hidden="true"
            />
            One lowercase letter
          </li>
          <li data-met={checks.hasNumber}>
            <span className={`mdaiw-icon mdaiw-icon--${checks.hasNumber ? 'check' : 'close'}`} aria-hidden="true" />
            One number
          </li>
        </ul>
      </div>
      </div>
    </div>
  );
}

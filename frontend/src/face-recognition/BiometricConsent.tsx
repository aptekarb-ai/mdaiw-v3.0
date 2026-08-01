import { CheckboxField } from '../forms/CheckboxField';
import './FaceRecognition.css';

interface BiometricConsentProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}

export function BiometricConsent({ checked, onChange, error }: BiometricConsentProps) {
  return (
    <div className="biometric-consent">
      <p className="biometric-consent__explanation">
        Face Enrollment uses your live camera to create an encrypted mathematical embedding of
        your face for authentication. The camera frames you submit are never stored — only this
        encrypted embedding is kept.
      </p>
      <CheckboxField
        id="biometric-consent"
        label="I consent to the processing of my facial data for authentication."
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        error={error}
      />
    </div>
  );
}

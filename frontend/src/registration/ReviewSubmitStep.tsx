import { useEffect, useState } from 'react';
import { CheckboxField } from '../forms/CheckboxField';
import type { RegistrationFormData } from '../types/registration';
import './ReviewSubmitStep.css';
import './RegistrationWizard.css';

interface ReviewSubmitStepProps {
  formData: RegistrationFormData;
  onEditStep: (step: 1 | 2) => void;
  confirmChecked: boolean;
  onConfirmChange: (checked: boolean) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitError: string | null;
  confirmError?: string;
}

export function ReviewSubmitStep({
  formData,
  onEditStep,
  confirmChecked,
  onConfirmChange,
  onSubmit,
  isSubmitting,
  submitError,
  confirmError,
}: ReviewSubmitStepProps) {
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const { account, employee } = formData;

  useEffect(() => {
    if (!employee.profilePhoto) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(employee.profilePhoto);
    setPhotoPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [employee.profilePhoto]);

  return (
    <div className="review-step">
      <h2 className="registration-step-heading">Review &amp; Confirm</h2>
      <p className="registration-step-supporting">
        Please review your information before creating your account.
      </p>
      {submitError && (
        <div className="review-step__alert" role="alert">
          {submitError}
        </div>
      )}

      <section className="review-step__section">
        <div className="review-step__section-header">
          <h3 className="review-step__section-title">Account Details</h3>
          <button type="button" className="review-step__edit-button" onClick={() => onEditStep(1)}>
            <span className="mdaiw-icon mdaiw-icon--edit" aria-hidden="true" />
            Edit
          </button>
        </div>
        <dl className="review-step__grid">
          <div className="review-step__row">
            <dt>Username</dt>
            <dd>{account.username}</dd>
          </div>
          <div className="review-step__row">
            <dt>Work Email</dt>
            <dd>{account.workEmail}</dd>
          </div>
        </dl>
      </section>

      <section className="review-step__section">
        <div className="review-step__section-header">
          <h3 className="review-step__section-title">Employee Details</h3>
          <button type="button" className="review-step__edit-button" onClick={() => onEditStep(2)}>
            <span className="mdaiw-icon mdaiw-icon--edit" aria-hidden="true" />
            Edit
          </button>
        </div>
        <dl className="review-step__grid">
          <div className="review-step__row">
            <dt>Employee ID</dt>
            <dd>{employee.employeeId}</dd>
          </div>
          <div className="review-step__row">
            <dt>Name</dt>
            <dd>
              {employee.firstName} {employee.lastName}
            </dd>
          </div>
          <div className="review-step__row">
            <dt>Designation</dt>
            <dd>{employee.designation}</dd>
          </div>
          <div className="review-step__row">
            <dt>Department</dt>
            <dd>{employee.department}</dd>
          </div>
          <div className="review-step__row">
            <dt>Location</dt>
            <dd>{employee.location}</dd>
          </div>
          <div className="review-step__row">
            <dt>Reporting Manager</dt>
            <dd>{employee.managerName}</dd>
          </div>
          <div className="review-step__row">
            <dt>Joining Date</dt>
            <dd>{employee.dateOfJoining}</dd>
          </div>
          <div className="review-step__row">
            <dt>Phone</dt>
            <dd>{employee.phone}</dd>
          </div>
          <div className="review-step__row">
            <dt>Date of Birth</dt>
            <dd>{employee.dateOfBirth}</dd>
          </div>
        </dl>
      </section>

      <section className="review-step__section">
        <div className="review-step__section-header">
          <h3 className="review-step__section-title">Profile Photo</h3>
        </div>
        {photoPreviewUrl ? (
          <img src={photoPreviewUrl} alt="Profile photo preview" className="review-step__photo" />
        ) : (
          <p>No profile photo uploaded.</p>
        )}
      </section>

      <section className="review-step__section">
        <div className="review-step__section-header">
          <h3 className="review-step__section-title">Face Recognition</h3>
        </div>
        <p>Status: Required after registration</p>
      </section>

      <CheckboxField
        id="reg-confirm-information"
        label="I confirm that the entered information is correct."
        checked={confirmChecked}
        onChange={(event) => onConfirmChange(event.target.checked)}
        error={confirmError}
      />

      <button
        type="button"
        className="button button--primary"
        disabled={isSubmitting}
        onClick={onSubmit}
      >
        {isSubmitting ? 'Creating account...' : 'Create Account →'}
      </button>
    </div>
  );
}

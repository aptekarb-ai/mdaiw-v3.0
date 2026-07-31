import { useState } from 'react';
import { registerEmployee } from '../api/client';
import type {
  AccountRegistrationData,
  EmployeeRegistrationData,
  RegistrationFieldErrors,
  RegistrationFormData,
  RegistrationSuccessPayload,
} from '../types/registration';
import type { ApiError } from '../types/auth';
import { AccountDetailsStep } from './AccountDetailsStep';
import { EmployeeDetailsStep } from './EmployeeDetailsStep';
import { FaceEnrollmentInfoStep } from './FaceEnrollmentInfoStep';
import { ReviewSubmitStep } from './ReviewSubmitStep';
import { RegistrationSuccess } from './RegistrationSuccess';
import { RegistrationStepper } from './RegistrationStepper';
import { hasErrors, validateAccountStep, validateEmployeeStep } from './validation';
import { mapBackendErrors } from './fieldMap';
import './RegistrationWizard.css';

const STEP1_FIELD_IDS: Record<keyof AccountRegistrationData, string> = {
  username: 'reg-username',
  workEmail: 'reg-work-email',
  password: 'reg-password',
  confirmPassword: 'reg-confirm-password',
};

const STEP1_FIELD_ORDER: Array<keyof AccountRegistrationData> = [
  'username',
  'workEmail',
  'password',
  'confirmPassword',
];

const STEP2_FIELD_IDS: Record<keyof EmployeeRegistrationData, string> = {
  employeeId: 'reg-employee-id',
  firstName: 'reg-first-name',
  lastName: 'reg-last-name',
  designation: 'reg-designation',
  department: 'reg-department',
  location: 'reg-location',
  managerName: 'reg-manager-name',
  dateOfJoining: 'reg-date-of-joining',
  phone: 'reg-phone',
  dateOfBirth: 'reg-date-of-birth',
  profilePhoto: 'profile-photo-input',
};

const STEP2_FIELD_ORDER: Array<keyof EmployeeRegistrationData> = [
  'employeeId',
  'firstName',
  'lastName',
  'designation',
  'department',
  'location',
  'managerName',
  'dateOfJoining',
  'phone',
  'dateOfBirth',
];

function focusField(id: string) {
  document.getElementById(id)?.focus();
}

const emptyFormData: RegistrationFormData = {
  account: { username: '', password: '', confirmPassword: '', workEmail: '' },
  employee: {
    employeeId: '',
    firstName: '',
    lastName: '',
    designation: '',
    department: '',
    location: '',
    managerName: '',
    dateOfJoining: '',
    phone: '',
    dateOfBirth: '',
    profilePhoto: null,
  },
  confirmInformationCorrect: false,
};

export function RegistrationWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<RegistrationFormData>(emptyFormData);
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors>({ account: {}, employee: {} });
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successPayload, setSuccessPayload] = useState<RegistrationSuccessPayload | null>(null);

  function handleAccountChange(field: keyof AccountRegistrationData, value: string) {
    setFormData((prev) => ({ ...prev, account: { ...prev.account, [field]: value } }));
    setFieldErrors((prev) => ({ ...prev, account: { ...prev.account, [field]: undefined } }));
  }

  function handleEmployeeChange(field: keyof EmployeeRegistrationData, value: string) {
    setFormData((prev) => ({ ...prev, employee: { ...prev.employee, [field]: value } }));
    setFieldErrors((prev) => ({ ...prev, employee: { ...prev.employee, [field]: undefined } }));
  }

  function handlePhotoChange(file: File | null) {
    setFormData((prev) => ({ ...prev, employee: { ...prev.employee, profilePhoto: file } }));
    setFieldErrors((prev) => ({ ...prev, employee: { ...prev.employee, profilePhoto: undefined } }));
  }

  function goToStep2() {
    const errors = validateAccountStep(formData.account);
    if (hasErrors(errors)) {
      setFieldErrors((prev) => ({ ...prev, account: errors }));
      const firstInvalid = STEP1_FIELD_ORDER.find((field) => errors[field]);
      if (firstInvalid) {
        focusField(STEP1_FIELD_IDS[firstInvalid]);
      }
      return;
    }
    setCurrentStep(2);
  }

  function goToStep3() {
    const errors = validateEmployeeStep(formData.employee);
    if (hasErrors(errors)) {
      setFieldErrors((prev) => ({ ...prev, employee: errors }));
      const firstInvalid = STEP2_FIELD_ORDER.find((field) => errors[field]);
      if (firstInvalid) {
        focusField(STEP2_FIELD_IDS[firstInvalid]);
      }
      return;
    }
    setCurrentStep(3);
  }

  function goBack() {
    setCurrentStep((step) => Math.max(1, step - 1));
  }

  function handleEditStep(step: 1 | 2) {
    setCurrentStep(step);
  }

  async function handleSubmit() {
    if (isSubmitting) {
      return;
    }

    if (!formData.confirmInformationCorrect) {
      setConfirmError('Please confirm that the entered information is correct.');
      return;
    }
    setConfirmError(undefined);
    setSubmitError(null);
    setIsSubmitting(true);

    const body = new FormData();
    body.append('username', formData.account.username.trim());
    body.append('password', formData.account.password);
    body.append('confirm_password', formData.account.confirmPassword);
    body.append('work_email', formData.account.workEmail.trim());
    body.append('employee_id', formData.employee.employeeId.trim());
    body.append('first_name', formData.employee.firstName.trim());
    body.append('last_name', formData.employee.lastName.trim());
    body.append('designation', formData.employee.designation.trim());
    body.append('department', formData.employee.department.trim());
    body.append('location', formData.employee.location.trim());
    body.append('manager_name', formData.employee.managerName.trim());
    body.append('date_of_joining', formData.employee.dateOfJoining);
    body.append('phone', formData.employee.phone.trim());
    body.append('date_of_birth', formData.employee.dateOfBirth);
    if (formData.employee.profilePhoto) {
      body.append('profile_photo', formData.employee.profilePhoto);
    }

    try {
      const response = await registerEmployee(body);
      if (response.success) {
        setSuccessPayload(response.registration);
      }
    } catch (caught) {
      const apiError = caught as ApiError;
      if (apiError.errors) {
        const mapped = mapBackendErrors(apiError.errors);
        setFieldErrors(mapped);
        if (hasErrors(mapped.account)) {
          setCurrentStep(1);
        } else if (hasErrors(mapped.employee)) {
          setCurrentStep(2);
        }
        setSubmitError(apiError.message);
      } else {
        setSubmitError(apiError.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (successPayload) {
    return <RegistrationSuccess registration={successPayload} />;
  }

  return (
    <div className="registration-wizard">
      <p className="registration-wizard__eyebrow">Create your account</p>
      <h1 className="registration-wizard__heading">Employee Registration</h1>
      <p className="registration-wizard__supporting">Create your Digital AI Workspace account.</p>

      <div className="registration-wizard__card">
        <RegistrationStepper currentStep={currentStep} />

        {currentStep === 1 && (
          <AccountDetailsStep
            account={formData.account}
            errors={fieldErrors.account}
            onChange={handleAccountChange}
          />
        )}
        {currentStep === 2 && (
          <EmployeeDetailsStep
            employee={formData.employee}
            errors={fieldErrors.employee}
            onChange={handleEmployeeChange}
            onPhotoChange={handlePhotoChange}
          />
        )}
        {currentStep === 3 && <FaceEnrollmentInfoStep />}
        {currentStep === 4 && (
          <ReviewSubmitStep
            formData={formData}
            onEditStep={handleEditStep}
            confirmChecked={formData.confirmInformationCorrect}
            onConfirmChange={(checked) => {
              setFormData((prev) => ({ ...prev, confirmInformationCorrect: checked }));
              setConfirmError(undefined);
            }}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            submitError={submitError}
            confirmError={confirmError}
          />
        )}

        {currentStep < 4 && (
          <div className="registration-wizard__actions">
            {currentStep > 1 ? (
              <button type="button" className="button button--outline" onClick={goBack}>
                ← Back
              </button>
            ) : (
              <span />
            )}

            {currentStep === 1 && (
              <button type="button" className="button button--primary" onClick={goToStep2}>
                Next →
              </button>
            )}
            {currentStep === 2 && (
              <button type="button" className="button button--primary" onClick={goToStep3}>
                Next →
              </button>
            )}
            {currentStep === 3 && (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setCurrentStep(4)}
              >
                Continue to Review →
              </button>
            )}
          </div>
        )}

        {currentStep === 4 && (
          <div className="registration-wizard__actions">
            <button type="button" className="button button--outline" onClick={goBack}>
              ← Back
            </button>
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

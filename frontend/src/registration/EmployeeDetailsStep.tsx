import { DateField } from '../forms/DateField';
import { FormField } from '../forms/FormField';
import { PhotoUploader } from '../forms/PhotoUploader';
import type { EmployeeFieldErrors, EmployeeRegistrationData } from '../types/registration';
import './EmployeeDetailsStep.css';
import './RegistrationWizard.css';

interface EmployeeDetailsStepProps {
  employee: EmployeeRegistrationData;
  errors: EmployeeFieldErrors;
  onChange: (field: keyof EmployeeRegistrationData, value: string) => void;
  onPhotoChange: (file: File | null) => void;
}

export function EmployeeDetailsStep({
  employee,
  errors,
  onChange,
  onPhotoChange,
}: EmployeeDetailsStepProps) {
  return (
    <div>
      <h2 className="registration-step-heading">Employee Information</h2>
      <p className="registration-step-supporting">Please provide your employment details.</p>
      <div className="employee-details-step">
      <FormField
        id="reg-employee-id"
        label="Employee ID"
        required
        value={employee.employeeId}
        onChange={(event) => onChange('employeeId', event.target.value)}
        error={errors.employeeId}
      />
      <FormField
        id="reg-first-name"
        label="First Name"
        required
        autoComplete="given-name"
        value={employee.firstName}
        onChange={(event) => onChange('firstName', event.target.value)}
        error={errors.firstName}
      />
      <FormField
        id="reg-last-name"
        label="Last Name"
        required
        autoComplete="family-name"
        value={employee.lastName}
        onChange={(event) => onChange('lastName', event.target.value)}
        error={errors.lastName}
      />

      <FormField
        id="reg-designation"
        label="Designation"
        required
        value={employee.designation}
        onChange={(event) => onChange('designation', event.target.value)}
        error={errors.designation}
      />
      <FormField
        id="reg-department"
        label="Department"
        required
        value={employee.department}
        onChange={(event) => onChange('department', event.target.value)}
        error={errors.department}
      />
      <FormField
        id="reg-location"
        label="Location"
        required
        value={employee.location}
        onChange={(event) => onChange('location', event.target.value)}
        error={errors.location}
      />

      <FormField
        id="reg-manager-name"
        label="Reporting Manager"
        required
        value={employee.managerName}
        onChange={(event) => onChange('managerName', event.target.value)}
        error={errors.managerName}
      />
      <DateField
        id="reg-date-of-joining"
        label="Date of Joining"
        required
        value={employee.dateOfJoining}
        onChange={(event) => onChange('dateOfJoining', event.target.value)}
        error={errors.dateOfJoining}
      />
      <FormField
        id="reg-phone"
        label="Phone Number"
        type="tel"
        required
        autoComplete="tel"
        value={employee.phone}
        onChange={(event) => onChange('phone', event.target.value)}
        error={errors.phone}
      />

      <DateField
        id="reg-date-of-birth"
        label="Date of Birth"
        required
        value={employee.dateOfBirth}
        onChange={(event) => onChange('dateOfBirth', event.target.value)}
        error={errors.dateOfBirth}
      />

      <div className="employee-details-step__photo">
        <PhotoUploader
          value={employee.profilePhoto}
          onChange={onPhotoChange}
          error={errors.profilePhoto}
        />
      </div>
      </div>
    </div>
  );
}

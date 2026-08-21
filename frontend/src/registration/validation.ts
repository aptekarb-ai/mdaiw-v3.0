import type {
  AccountFieldErrors,
  AccountRegistrationData,
  EmployeeFieldErrors,
  EmployeeRegistrationData,
} from '../types/registration';

const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9-]{1,50}$/;
const PHONE_PATTERN = /^\+?[0-9\s()-]{7,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function passwordRequirementChecks(password: string) {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };
}

export function validateAccountStep(account: AccountRegistrationData): AccountFieldErrors {
  const errors: AccountFieldErrors = {};

  if (!account.username.trim()) {
    errors.username = 'Username is required.';
  }

  if (!account.workEmail.trim()) {
    errors.workEmail = 'Work email is required.';
  } else if (!EMAIL_PATTERN.test(account.workEmail.trim())) {
    errors.workEmail = 'Enter a valid email address.';
  }

  if (!account.password) {
    errors.password = 'Password is required.';
  } else {
    const checks = passwordRequirementChecks(account.password);
    if (!checks.minLength || !checks.hasUppercase || !checks.hasLowercase || !checks.hasNumber) {
      errors.password = 'Password does not meet the requirements below.';
    }
  }

  if (!account.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password.';
  } else if (account.password && account.confirmPassword !== account.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}

export function validateEmployeeStep(employee: EmployeeRegistrationData): EmployeeFieldErrors {
  const errors: EmployeeFieldErrors = {};

  if (!employee.employeeId.trim()) {
    errors.employeeId = 'Employee ID is required.';
  } else if (!EMPLOYEE_ID_PATTERN.test(employee.employeeId.trim())) {
    errors.employeeId = 'Employee ID may only contain letters, numbers, and hyphens.';
  }

  if (!employee.firstName.trim()) {
    errors.firstName = 'First name is required.';
  }
  if (!employee.lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }
  if (!employee.designation.trim()) {
    errors.designation = 'Designation is required.';
  }
  if (!employee.department.trim()) {
    errors.department = 'Department is required.';
  }
  if (!employee.location.trim()) {
    errors.location = 'Location is required.';
  }
  if (!employee.managerName.trim()) {
    errors.managerName = 'Reporting manager is required.';
  }

  if (!employee.dateOfJoining) {
    errors.dateOfJoining = 'Date of joining is required.';
  }

  if (!employee.phone.trim()) {
    errors.phone = 'Phone number is required.';
  } else if (!PHONE_PATTERN.test(employee.phone.trim())) {
    errors.phone = 'Enter a valid phone number.';
  }

  if (!employee.dateOfBirth) {
    errors.dateOfBirth = 'Date of birth is required.';
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dob = new Date(employee.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      errors.dateOfBirth = 'Enter a valid date of birth.';
    } else if (dob >= today) {
      errors.dateOfBirth = 'Date of birth cannot be today or in the future.';
    }
  }

  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

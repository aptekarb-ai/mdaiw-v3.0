import type {
  AccountFieldErrors,
  AccountRegistrationData,
  EmployeeFieldErrors,
  EmployeeRegistrationData,
  RegistrationFieldErrors,
} from '../types/registration';

const BACKEND_TO_ACCOUNT_FIELD: Record<string, keyof AccountRegistrationData> = {
  username: 'username',
  password: 'password',
  confirm_password: 'confirmPassword',
  work_email: 'workEmail',
};

const BACKEND_TO_EMPLOYEE_FIELD: Record<string, keyof EmployeeRegistrationData> = {
  employee_id: 'employeeId',
  first_name: 'firstName',
  last_name: 'lastName',
  designation: 'designation',
  department: 'department',
  location: 'location',
  manager_name: 'managerName',
  date_of_joining: 'dateOfJoining',
  phone: 'phone',
  date_of_birth: 'dateOfBirth',
  profile_photo: 'profilePhoto',
};

export function mapBackendErrors(backendErrors: Record<string, string[]>): RegistrationFieldErrors {
  const account: AccountFieldErrors = {};
  const employee: EmployeeFieldErrors = {};

  for (const [backendField, messages] of Object.entries(backendErrors)) {
    const message = messages[0];
    if (!message) {
      continue;
    }

    const accountField = BACKEND_TO_ACCOUNT_FIELD[backendField];
    if (accountField) {
      account[accountField] = message;
      continue;
    }

    const employeeField = BACKEND_TO_EMPLOYEE_FIELD[backendField];
    if (employeeField) {
      employee[employeeField] = message;
    }
  }

  return { account, employee };
}

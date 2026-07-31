export interface AccountRegistrationData {
  username: string;
  password: string;
  confirmPassword: string;
  workEmail: string;
}

export interface EmployeeRegistrationData {
  employeeId: string;
  firstName: string;
  lastName: string;
  designation: string;
  department: string;
  location: string;
  managerName: string;
  dateOfJoining: string;
  phone: string;
  dateOfBirth: string;
  profilePhoto: File | null;
}

export interface RegistrationFormData {
  account: AccountRegistrationData;
  employee: EmployeeRegistrationData;
  confirmInformationCorrect: boolean;
}

export type AccountFieldErrors = Partial<Record<keyof AccountRegistrationData, string>>;
export type EmployeeFieldErrors = Partial<Record<keyof EmployeeRegistrationData, string>>;

export interface RegistrationFieldErrors {
  account: AccountFieldErrors;
  employee: EmployeeFieldErrors;
}

export type RegistrationStatus =
  | 'PENDING_FACE_ENROLLMENT'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED';

export interface RegistrationSuccessPayload {
  user_id: number;
  username: string;
  employee_id: string;
  work_email: string;
  registration_status: RegistrationStatus;
  face_enrollment_required: boolean;
}

export interface RegistrationSuccessResponse {
  success: true;
  message: string;
  registration: RegistrationSuccessPayload;
}

export interface RegistrationValidationErrorResponse {
  success: false;
  code: 'VALIDATION_ERROR';
  message: string;
  errors: Record<string, string[]>;
}

export type RegistrationResponse = RegistrationSuccessResponse | RegistrationValidationErrorResponse;

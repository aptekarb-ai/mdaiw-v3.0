import { Link } from 'react-router';
import type { RegistrationSuccessPayload } from '../types/registration';
import './RegistrationSuccess.css';

interface RegistrationSuccessProps {
  registration: RegistrationSuccessPayload;
}

export function RegistrationSuccess({ registration }: RegistrationSuccessProps) {
  return (
    <div className="registration-success">
      <span
        className="mdaiw-icon mdaiw-icon--check-circle registration-success__icon"
        aria-hidden="true"
      />
      <h1 className="registration-success__heading">Registration details saved</h1>
      <p className="registration-success__body">
        Your employee registration has been created successfully. Complete Face Enrollment to
        activate your account and use Face Recognition login.
      </p>

      <div className="registration-success__details">
        <div className="registration-success__row">
          <span>Username</span>
          <strong>{registration.username}</strong>
        </div>
        <div className="registration-success__row">
          <span>Employee ID</span>
          <strong>{registration.employee_id}</strong>
        </div>
        <div className="registration-success__row">
          <span>Work Email</span>
          <strong>{registration.work_email}</strong>
        </div>
        <div className="registration-success__row">
          <span>Status</span>
          <strong>Pending Face Enrollment</strong>
        </div>
      </div>

      <p className="registration-success__badge">
        <span className="mdaiw-icon mdaiw-icon--face-scan" aria-hidden="true" />
        Face Enrollment required
      </p>

      <Link to="/login" className="button button--primary registration-success__action">
        Return to Login →
      </Link>
    </div>
  );
}

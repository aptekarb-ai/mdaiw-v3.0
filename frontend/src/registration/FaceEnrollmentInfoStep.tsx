import './FaceEnrollmentInfoStep.css';

export function FaceEnrollmentInfoStep() {
  return (
    <div className="face-enrollment-info-step">
      <img
        src="/assets/mdaiw/images/face-scan-frame.svg"
        alt="Face Recognition enrollment"
        className="face-enrollment-info-step__illustration"
      />
      <h2 className="face-enrollment-info-step__heading">Face Recognition Enrollment</h2>
      <p className="face-enrollment-info-step__body">
        Face Enrollment will be completed in the next secure step. Your account remains inactive
        until Face Enrollment succeeds.
      </p>
      <p className="face-enrollment-info-step__notice" role="status">
        No camera access is requested here. Continue to review your entered details — you will
        complete live Face Enrollment right after this registration is saved.
      </p>
    </div>
  );
}

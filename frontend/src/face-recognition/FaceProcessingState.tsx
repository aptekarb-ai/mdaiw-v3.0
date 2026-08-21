import './FaceRecognition.css';

export interface ProcessingStep {
  key: string;
  label: string;
  state: 'pending' | 'active' | 'complete' | 'failed';
}

interface FaceProcessingStateProps {
  heading: string;
  steps: ProcessingStep[];
}

export function FaceProcessingState({ heading, steps }: FaceProcessingStateProps) {
  return (
    <div className="face-processing-state" role="status" aria-live="polite">
      <span className="mdaiw-icon mdaiw-icon--spinner face-processing-state__spinner" aria-hidden="true" />
      <h2>{heading}</h2>
      <p>Please hold still...</p>
      <ul className="face-processing-state__checklist">
        {steps.map((step) => (
          <li key={step.key} data-state={step.state}>
            <span
              className={`mdaiw-icon mdaiw-icon--${step.state === 'complete' ? 'check' : step.state === 'failed' ? 'error-circle' : 'spinner'}`}
              aria-hidden="true"
            />
            {step.label}
          </li>
        ))}
      </ul>
      <p>Do not close this window or move away from the camera.</p>
    </div>
  );
}

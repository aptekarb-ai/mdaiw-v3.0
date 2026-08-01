import type { ChallengeAction } from '../hooks/useFaceLandmarker';
import './FaceRecognition.css';

interface CaptureProgressProps {
  actions: ChallengeAction[];
  completedCount: number;
}

export function CaptureProgress({ actions, completedCount }: CaptureProgressProps) {
  return (
    <div className="capture-progress">
      {actions.map((action, index) => {
        const state = index < completedCount ? 'complete' : index === completedCount ? 'active' : 'upcoming';
        return (
          <div key={`${action}-${index}`} className="capture-progress__step" data-state={state}>
            <span
              className={`mdaiw-icon mdaiw-icon--${state === 'complete' ? 'check-circle' : 'camera'}`}
              aria-hidden="true"
            />
            <span>
              Step {index + 1} of {actions.length}: {action.replace('_', ' ').toLowerCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

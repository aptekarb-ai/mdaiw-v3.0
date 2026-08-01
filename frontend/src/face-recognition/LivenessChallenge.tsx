import type { ChallengeAction } from '../hooks/useFaceLandmarker';
import './FaceRecognition.css';

const ACTION_LABELS: Record<ChallengeAction, string> = {
  LOOK_CENTER: 'Look directly at the camera',
  TURN_LEFT: 'Turn slightly left',
  TURN_RIGHT: 'Turn slightly right',
  BLINK: 'Blink naturally',
};

interface LivenessChallengeProps {
  action: ChallengeAction;
  isComplete: boolean;
}

export function LivenessChallenge({ action, isComplete }: LivenessChallengeProps) {
  return (
    <div className="liveness-challenge" role="status">
      <p className="liveness-challenge__instruction">{ACTION_LABELS[action]}</p>
      <p className="liveness-challenge__status" data-complete={isComplete}>
        {isComplete ? 'Action detected — capturing...' : 'Waiting for you to complete this action'}
      </p>
    </div>
  );
}

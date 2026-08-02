import type { ChallengeAction, LivenessDiagnosticsSnapshot } from '../hooks/useFaceLandmarker';
import './FaceRecognition.css';

const ACTION_LABELS: Record<ChallengeAction, string> = {
  LOOK_CENTER: 'Look directly at the camera',
  TURN_LEFT: 'Turn slightly left',
  TURN_RIGHT: 'Turn slightly right',
  BLINK: 'Blink naturally',
};

interface LivenessChallengeProps {
  action: ChallengeAction;
  diagnostics: LivenessDiagnosticsSnapshot | null;
}

/**
 * Real-time guidance text driven by the actual latest landmark-detection
 * result (Section D of the liveness-auto-detect fix) — not a static
 * instruction that never changes regardless of what the camera sees.
 */
function describeState(action: ChallengeAction, diagnostics: LivenessDiagnosticsSnapshot | null): string {
  if (!diagnostics || diagnostics.faceCount === 0) {
    return 'Position your face inside the frame.';
  }
  if (diagnostics.faceCount > 1) {
    return 'Only one person should be visible.';
  }
  if (diagnostics.actionState === 'ready') {
    return 'Action detected — capturing...';
  }
  if (diagnostics.actionState === 'holding') {
    return 'Hold that position...';
  }
  if (action === 'BLINK') {
    return 'Blink both eyes naturally.';
  }
  if (action === 'TURN_LEFT' && diagnostics.yaw !== null && diagnostics.yaw > -0.1) {
    return 'Turn a little more to your left.';
  }
  if (action === 'TURN_RIGHT' && diagnostics.yaw !== null && diagnostics.yaw < 0.1) {
    return 'Turn a little more to your right.';
  }
  if (action === 'LOOK_CENTER') {
    return 'Face detected — center your face and look at the camera.';
  }
  return 'Waiting for you to complete this action';
}

export function LivenessChallenge({ action, diagnostics }: LivenessChallengeProps) {
  const isReady = diagnostics?.actionState === 'ready';
  return (
    <div className="liveness-challenge" role="status">
      <p className="liveness-challenge__instruction">{ACTION_LABELS[action]}</p>
      <p className="liveness-challenge__status" data-complete={isReady}>
        {describeState(action, diagnostics)}
      </p>
    </div>
  );
}

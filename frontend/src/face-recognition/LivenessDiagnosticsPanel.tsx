import type { LivenessDiagnosticsSnapshot } from '../hooks/useFaceLandmarker';
import './FaceRecognition.css';

interface LivenessDiagnosticsPanelProps {
  diagnostics: LivenessDiagnosticsSnapshot | null;
}

/**
 * Development-only diagnostics for tuning/verifying the liveness capture
 * loop against a real webcam (Section D of the liveness-auto-detect fix).
 * Shows only detection-derived numbers — face count, current action, its
 * pass/fail state, the yaw signal, and the blink score — never images,
 * embeddings, or any biometric template. `import.meta.env.DEV` is
 * statically replaced with `false` by Vite in a production build, so this
 * component (and the branch that renders it) is dead code there and never
 * ships to end users. Never call this in a production build path.
 */
export function LivenessDiagnosticsPanel({ diagnostics }: LivenessDiagnosticsPanelProps) {
  if (!import.meta.env.DEV) {
    return null;
  }
  return (
    <dl className="liveness-diagnostics" aria-hidden="true">
      <div>
        <dt>faces</dt>
        <dd>{diagnostics?.faceCount ?? '—'}</dd>
      </div>
      <div>
        <dt>action</dt>
        <dd>{diagnostics?.action ?? '—'}</dd>
      </div>
      <div>
        <dt>state</dt>
        <dd>{diagnostics?.actionState ?? '—'}</dd>
      </div>
      <div>
        <dt>yaw</dt>
        <dd>{diagnostics?.yaw !== null && diagnostics?.yaw !== undefined ? diagnostics.yaw.toFixed(3) : '—'}</dd>
      </div>
      <div>
        <dt>blink</dt>
        <dd>
          {diagnostics?.blinkScore !== null && diagnostics?.blinkScore !== undefined
            ? diagnostics.blinkScore.toFixed(3)
            : '—'}
        </dd>
      </div>
    </dl>
  );
}

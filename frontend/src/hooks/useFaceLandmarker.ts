import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_BASE_PATH = '/assets/mediapipe/wasm';
const MODEL_ASSET_PATH = '/assets/mediapipe/face_landmarker.task';

export type LandmarkerStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';

export type ChallengeAction = 'LOOK_CENTER' | 'TURN_LEFT' | 'TURN_RIGHT' | 'BLINK';

export function faceCount(result: FaceLandmarkerResult | null): number {
  return result?.faceLandmarks?.length ?? 0;
}

const MIN_FACE_WIDTH_RATIO = 0.15;
const MAX_CENTER_OFFSET_RATIO = 0.3;

/**
 * Best-effort, client-side pre-capture check that exactly one face is
 * present, large enough, and roughly centered in frame — derived from the
 * landmark bounding box, no extra inference call. A heuristic only: the
 * backend independently re-validates position from its own detector's
 * facial_area on every uploaded frame regardless (see
 * faceauth/service.py::_validate_face_position).
 */
export function isFramePositionAcceptable(result: FaceLandmarkerResult | null): boolean {
  if (!result || faceCount(result) !== 1) {
    return false;
  }
  const landmarks = result.faceLandmarks[0];
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const width = maxX - minX;
  if (width < MIN_FACE_WIDTH_RATIO) {
    return false;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return Math.abs(centerX - 0.5) <= MAX_CENTER_OFFSET_RATIO && Math.abs(centerY - 0.5) <= MAX_CENTER_OFFSET_RATIO;
}

// MediaPipe Face Landmarker's canonical 468/478-point face mesh topology —
// index 1 is the nose tip in every published version of this mesh (the same
// index used across the entire MediaPipe/Face Mesh ecosystem). Used as a
// stable anchor for the landmark-geometry yaw estimate below.
const NOSE_TIP_LANDMARK_INDEX = 1;

const YAW_CENTER_THRESHOLD = 0.12;
const YAW_TURN_THRESHOLD = 0.25;

/**
 * Head-yaw signal derived directly from the 2D landmark cloud, in the same
 * raw (un-mirrored) normalized-image coordinate space already used by
 * isFramePositionAcceptable above — deliberately NOT derived from
 * facialTransformationMatrixes. The earlier version read yaw from that 4x4
 * matrix assuming a row-major layout (matrixData[4]/matrixData[8] as
 * row1-col0/row2-col0); that indexing does not reliably match the matrix
 * this API returns, so the earlier code was effectively reading unrelated
 * matrix elements and producing a yaw value with no dependable relationship
 * to the user's real head turn — which is the root cause of
 * TURN_LEFT/TURN_RIGHT/LOOK_CENTER rarely or never completing. This method
 * instead compares how far the nose tip sits from the left edge of the
 * detected face versus the right edge: turning the head to one side
 * foreshortens that side's cheek in the 2D projection, shrinking its span
 * from the nose. The result is a unitless asymmetry roughly in [-1, 1], not
 * degrees — thresholds below are tuned against that range and are
 * intentionally conservative; verify against a real webcam using the dev
 * diagnostics panel (see useLivenessCapture.ts / LivenessDiagnosticsPanel)
 * before trusting the exact threshold values in production.
 *
 * Sign convention: two people facing each other perceive left/right
 * reversed from one another ("your right is my left") — the camera faces
 * the user the same way, so a physical turn toward the user's own right
 * shrinks the LEFT side of the raw (camera-facing) frame and grows the
 * RIGHT side, giving a positive asymmetry; turning toward the user's own
 * left gives a negative asymmetry. This is independent of the CSS
 * scaleX(-1) mirroring applied to the on-screen preview (see
 * FaceRecognition.css) — that transform only affects the displayed pixels,
 * never the underlying video frame this function reads.
 */
export function estimateYawAsymmetry(landmarks: Array<{ x: number }>): number {
  if (landmarks.length <= NOSE_TIP_LANDMARK_INDEX) {
    return 0;
  }
  let minX = 1;
  let maxX = 0;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
  }
  const noseX = landmarks[NOSE_TIP_LANDMARK_INDEX].x;
  const leftSpan = noseX - minX;
  const rightSpan = maxX - noseX;
  const total = leftSpan + rightSpan;
  if (total <= 0) {
    return 0;
  }
  return (rightSpan - leftSpan) / total;
}

const BLINK_SCORE_THRESHOLD = 0.5;

/** Highest of the two per-eye blink blendshape scores for this frame, or 0 if unavailable. */
export function getBlinkScore(result: FaceLandmarkerResult | null): number {
  const categories = result?.faceBlendshapes?.[0]?.categories ?? [];
  const left = categories.find((category) => category.categoryName === 'eyeBlinkLeft')?.score ?? 0;
  const right = categories.find((category) => category.categoryName === 'eyeBlinkRight')?.score ?? 0;
  return Math.max(left, right);
}

/**
 * Single-frame action check. For BLINK this is deliberately just an
 * instantaneous "are the eyes closed right now" read — NOT the full
 * close-then-reopen cycle required for real detection (see
 * createBlinkCycleTracker below, used by the capture loop instead). Kept
 * this way because a pure, stateless function cannot hold the cross-call
 * state a real cycle needs.
 */
export function isActionComplete(result: FaceLandmarkerResult | null, action: ChallengeAction): boolean {
  if (!result || faceCount(result) !== 1) {
    return false;
  }

  if (action === 'BLINK') {
    return getBlinkScore(result) > BLINK_SCORE_THRESHOLD;
  }

  const yaw = estimateYawAsymmetry(result.faceLandmarks[0]);

  if (action === 'LOOK_CENTER') {
    return Math.abs(yaw) < YAW_CENTER_THRESHOLD;
  }
  if (action === 'TURN_LEFT') {
    return yaw < -YAW_TURN_THRESHOLD;
  }
  if (action === 'TURN_RIGHT') {
    return yaw > YAW_TURN_THRESHOLD;
  }
  return false;
}

const BLINK_OPEN_THRESHOLD = 0.3;
// A real, natural blink is quick (typically ~100-400ms). These bounds
// reject both a too-brief glitch/noise spike and an unnaturally long
// deliberate eye closure — BLINK_MAX_CLOSED_MS also makes a held-shut eye
// abandon and restart the cycle rather than eventually "count".
const BLINK_MIN_CLOSED_MS = 80;
const BLINK_MAX_CLOSED_MS = 800;

export interface BlinkCycleTracker {
  /**
   * Feed one detection tick. Returns true exactly once, on the tick where a
   * full close-then-reopen cycle is confirmed. `positionOk` should reflect
   * the same frame-quality/position gate used for pose actions — losing
   * tracking mid-blink (face turned away, moved out of frame) discards the
   * in-progress cycle rather than let a stale "closed" reading resolve
   * later against an unrelated frame.
   */
  update(result: FaceLandmarkerResult | null, nowMs: number, positionOk: boolean): boolean;
  reset(): void;
}

/**
 * Tracks a real open→closed→open blink cycle across ticks, rather than a
 * single instantaneous threshold read. This matters because the capture
 * loop previously gated BLINK the same way as a head-turn "hold": require
 * the same passing condition on several consecutive polls in a row
 * (REQUIRED_STABLE_TICKS in useLivenessCapture.ts, ~600ms of sustained
 * passing ticks). A natural blink is a brief event, not a held pose —
 * instructing the user to "blink naturally" while requiring their eyes to
 * read as closed for ~600ms straight demands an unnaturally long,
 * deliberate closure a real blink never produces, so that gate was
 * essentially unsatisfiable. This tracker instead treats BLINK as a
 * transition (open → closed → open again within a plausible duration) and
 * is used by useLivenessCapture.ts in place of the stable-ticks gate,
 * specifically for the BLINK action only.
 */
export function createBlinkCycleTracker(): BlinkCycleTracker {
  let phase: 'open' | 'closed' = 'open';
  let closedAtMs = 0;

  return {
    update(result, nowMs, positionOk) {
      if (!positionOk || faceCount(result) !== 1) {
        phase = 'open';
        return false;
      }

      const score = getBlinkScore(result);

      if (phase === 'open') {
        if (score > BLINK_SCORE_THRESHOLD) {
          phase = 'closed';
          closedAtMs = nowMs;
        }
        return false;
      }

      // phase === 'closed'
      const elapsed = nowMs - closedAtMs;
      if (score < BLINK_OPEN_THRESHOLD) {
        phase = 'open';
        return elapsed >= BLINK_MIN_CLOSED_MS && elapsed <= BLINK_MAX_CLOSED_MS;
      }
      if (elapsed > BLINK_MAX_CLOSED_MS) {
        // Held shut too long to be a natural blink — abandon and restart.
        phase = 'open';
      }
      return false;
    },
    reset() {
      phase = 'open';
      closedAtMs = 0;
    },
  };
}

export type LivenessActionState = 'waiting' | 'holding' | 'ready';

// Development-only diagnostics snapshot (Section D of the liveness-
// auto-detect fix): only detection-derived numbers, never images,
// embeddings, or any biometric template. Consumed exclusively by a
// dev-flag-gated panel and never rendered in a production build.
export interface LivenessDiagnosticsSnapshot {
  faceCount: number;
  yaw: number | null;
  blinkScore: number | null;
  action: ChallengeAction;
  actionState: LivenessActionState;
}

export function buildLivenessDiagnostics(
  result: FaceLandmarkerResult | null,
  action: ChallengeAction,
  actionState: LivenessActionState,
): LivenessDiagnosticsSnapshot {
  const count = faceCount(result);
  const landmarks = count === 1 ? result?.faceLandmarks[0] : undefined;
  return {
    faceCount: count,
    yaw: landmarks ? estimateYawAsymmetry(landmarks) : null,
    blinkScore: count === 1 ? getBlinkScore(result) : null,
    action,
    actionState,
  };
}

export function useFaceLandmarker() {
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const [status, setStatus] = useState<LandmarkerStatus>('idle');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus('loading');
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
        const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: MODEL_ASSET_PATH },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setStatus('error');
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const detect = useCallback((video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult | null => {
    if (!landmarkerRef.current) {
      return null;
    }
    return landmarkerRef.current.detectForVideo(video, timestampMs);
  }, []);

  return { status, detect };
}

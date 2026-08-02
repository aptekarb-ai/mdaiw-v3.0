import { useEffect, useRef, type RefObject } from 'react';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { isFrameQualityAcceptable } from './useCamera';
import {
  buildLivenessDiagnostics,
  createBlinkCycleTracker,
  isActionComplete,
  isFramePositionAcceptable,
  type ChallengeAction,
  type LivenessDiagnosticsSnapshot,
} from './useFaceLandmarker';

const DETECTION_INTERVAL_MS = 200;
// Require this many *consecutive* passing detection ticks (pose + quality +
// position all acceptable) before capturing a pose action — a single-tick
// match can be a momentary glitch; this asks for a short stable hold
// instead, roughly REQUIRED_STABLE_TICKS * DETECTION_INTERVAL_MS of held
// pose. Deliberately NOT applied to BLINK, which uses the cycle tracker
// instead — see useFaceLandmarker.ts::createBlinkCycleTracker for why.
const REQUIRED_STABLE_TICKS = 3;

export interface UseLivenessActionDetectorOptions {
  /** Whether the detection loop should be running right now. */
  active: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  detect: (video: HTMLVideoElement, timestampMs: number) => FaceLandmarkerResult | null;
  /** The single action currently being requested, or undefined if none. */
  action: ChallengeAction | undefined;
  /**
   * Called once the current action is confirmed complete. Must perform the
   * actual frame capture and resolve to whether it succeeded — `false`
   * (e.g. captureFrame() returned null because the video wasn't ready)
   * re-arms detection for a retry instead of getting stuck; `true` leaves
   * the loop idle until the caller changes `action` (normally by advancing
   * to the next challenge step).
   */
  onReady: () => Promise<boolean>;
  /** Optional dev-only diagnostics sink — see LivenessDiagnosticsPanel. */
  onDiagnostics?: (snapshot: LivenessDiagnosticsSnapshot) => void;
}

/**
 * Shared liveness-challenge detection loop used by the registration wizard's
 * Face Enrollment step, the Face Login page, and the standalone Face
 * Enrollment (resume) page — previously each of the three duplicated this
 * loop inline, so a bug fixed in one was still present in the other two.
 * Handles pose actions (LOOK_CENTER/TURN_LEFT/TURN_RIGHT) via a short
 * stable-hold debounce, and BLINK via the dedicated close-then-reopen cycle
 * tracker instead of the same hold-based gate (see
 * useFaceLandmarker.ts::createBlinkCycleTracker for why that distinction is
 * required for blink to ever complete under natural use).
 */
export function useLivenessActionDetector({
  active,
  videoRef,
  detect,
  action,
  onReady,
  onDiagnostics,
}: UseLivenessActionDetectorOptions): void {
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const onDiagnosticsRef = useRef(onDiagnostics);
  useEffect(() => {
    onDiagnosticsRef.current = onDiagnostics;
  }, [onDiagnostics]);

  useEffect(() => {
    if (!active || !action) {
      return;
    }

    let capturing = false;
    let stableTicks = 0;
    const blinkTracker = createBlinkCycleTracker();

    function fireReady() {
      capturing = true;
      void onReadyRef.current().then((succeeded) => {
        if (!succeeded) {
          // Capture didn't actually happen (e.g. video frame not ready) —
          // re-arm so the next passing tick can retry, instead of leaving
          // the loop permanently stuck on this action.
          capturing = false;
          stableTicks = 0;
          blinkTracker.reset();
        }
        // On success, `action` will change once the caller advances the
        // challenge index, which remounts this effect and clears the
        // interval below — no further action needed here.
      });
    }

    const interval = window.setInterval(() => {
      if (capturing || !videoRef.current) {
        return;
      }
      const result = detect(videoRef.current, performance.now());
      const positionOk = isFramePositionAcceptable(result) && isFrameQualityAcceptable(videoRef.current);

      if (action === 'BLINK') {
        const cycleComplete = blinkTracker.update(result, performance.now(), positionOk);
        onDiagnosticsRef.current?.(buildLivenessDiagnostics(result, action, cycleComplete ? 'ready' : 'waiting'));
        if (cycleComplete) {
          fireReady();
        }
        return;
      }

      const poseOk = positionOk && isActionComplete(result, action);
      if (!poseOk) {
        stableTicks = 0;
        onDiagnosticsRef.current?.(buildLivenessDiagnostics(result, action, 'waiting'));
        return;
      }
      stableTicks += 1;
      onDiagnosticsRef.current?.(
        buildLivenessDiagnostics(result, action, stableTicks >= REQUIRED_STABLE_TICKS ? 'ready' : 'holding'),
      );
      if (stableTicks < REQUIRED_STABLE_TICKS) {
        return;
      }
      fireReady();
    }, DETECTION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [active, action, videoRef, detect]);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_BASE_PATH = '/assets/mediapipe/wasm';
const MODEL_ASSET_PATH = '/assets/mediapipe/face_landmarker.task';
const YAW_TURN_THRESHOLD_DEGREES = 15;
const BLINK_SCORE_THRESHOLD = 0.5;

export type LandmarkerStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';

export type ChallengeAction = 'LOOK_CENTER' | 'TURN_LEFT' | 'TURN_RIGHT' | 'BLINK';

function estimateYawDegrees(matrixData: number[]): number {
  // Coarse yaw extraction from the facial transformation matrix — a UX
  // guidance heuristic only. The backend never trusts this value; it
  // independently re-validates liveness and identity on every submitted
  // frame. See docs/module-1/IMPLEMENTATION_STATUS.md "MVP liveness" note.
  const m00 = matrixData[0];
  const m10 = matrixData[4];
  const m20 = matrixData[8];
  const yawRad = Math.atan2(-m20, Math.sqrt(m00 * m00 + m10 * m10));
  return (yawRad * 180) / Math.PI;
}

export function faceCount(result: FaceLandmarkerResult | null): number {
  return result?.faceLandmarks?.length ?? 0;
}

export function isActionComplete(result: FaceLandmarkerResult | null, action: ChallengeAction): boolean {
  if (!result || faceCount(result) !== 1) {
    return false;
  }

  if (action === 'BLINK') {
    const categories = result.faceBlendshapes?.[0]?.categories ?? [];
    const left = categories.find((category) => category.categoryName === 'eyeBlinkLeft');
    const right = categories.find((category) => category.categoryName === 'eyeBlinkRight');
    return (left?.score ?? 0) > BLINK_SCORE_THRESHOLD || (right?.score ?? 0) > BLINK_SCORE_THRESHOLD;
  }

  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  if (!matrix) {
    return false;
  }
  const yaw = estimateYawDegrees(matrix);

  if (action === 'LOOK_CENTER') {
    return Math.abs(yaw) < YAW_TURN_THRESHOLD_DEGREES;
  }
  if (action === 'TURN_LEFT') {
    return yaw > YAW_TURN_THRESHOLD_DEGREES;
  }
  if (action === 'TURN_RIGHT') {
    return yaw < -YAW_TURN_THRESHOLD_DEGREES;
  }
  return false;
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

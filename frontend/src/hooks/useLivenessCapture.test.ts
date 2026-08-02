import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLivenessActionDetector } from './useLivenessCapture';
import type { ChallengeAction } from './useFaceLandmarker';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

// Test fixtures below only populate the fields isActionComplete/
// isFramePositionAcceptable/createBlinkCycleTracker actually read — cast
// rather than satisfying the full (much larger) real result shape.
function asResult(value: object): FaceLandmarkerResult {
  return value as unknown as FaceLandmarkerResult;
}

// jsdom has no real canvas/video decoding pipeline, so the real
// isFrameQualityAcceptable (which reads pixel data via a 2D canvas context)
// cannot meaningfully evaluate a synthetic <video> element here — mocked the
// same way the FaceEnrollmentStep/FaceLoginPage/FaceEnrollmentPage test
// suites already mock it, so this file exercises only the detection-loop
// logic under test, not jsdom's canvas limitations.
vi.mock('./useCamera', () => ({ isFrameQualityAcceptable: vi.fn(() => true) }));

// A single face, centered and large enough to satisfy
// isFramePositionAcceptable, with the nose tip (index 1) exactly centered
// between the face edges — satisfies LOOK_CENTER and is the neutral base
// for the blink fixture below (blink completion is pose-independent).
function makeCenteredFaceLandmarks() {
  return [
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.3, y: 0.3 },
    { x: 0.7, y: 0.3 },
    { x: 0.3, y: 0.7 },
    { x: 0.7, y: 0.7 },
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeVideoRef() {
  return { current: document.createElement('video') };
}

describe('useLivenessActionDetector', () => {
  it('calls onReady exactly once after the required stable hold for a pose action', async () => {
    const detect = vi.fn(() => asResult({ faceLandmarks: [makeCenteredFaceLandmarks()], faceBlendshapes: [] }));
    const onReady = vi.fn().mockResolvedValue(true);
    const videoRef = makeVideoRef();

    renderHook(() =>
      useLivenessActionDetector({
        active: true,
        videoRef,
        detect,
        action: 'LOOK_CENTER' as ChallengeAction,
        onReady,
      }),
    );

    await act(async () => sleep(900));
    expect(onReady).toHaveBeenCalledTimes(1);

    // No further ticks should fire onReady again once it has already
    // succeeded — the caller is expected to change `action` (or `active`)
    // to advance; this hook alone does not re-trigger on the same action.
    await act(async () => sleep(500));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('never fires while inactive, even with a passing pose held the whole time', async () => {
    const detect = vi.fn(() => asResult({ faceLandmarks: [makeCenteredFaceLandmarks()], faceBlendshapes: [] }));
    const onReady = vi.fn().mockResolvedValue(true);
    const videoRef = makeVideoRef();

    renderHook(() =>
      useLivenessActionDetector({ active: false, videoRef, detect, action: 'LOOK_CENTER' as ChallengeAction, onReady }),
    );

    await act(async () => sleep(900));
    expect(onReady).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
  });

  it('re-arms for a retry when onReady resolves false (e.g. captureFrame returned null)', async () => {
    const detect = vi.fn(() => asResult({ faceLandmarks: [makeCenteredFaceLandmarks()], faceBlendshapes: [] }));
    const onReady = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const videoRef = makeVideoRef();

    renderHook(() =>
      useLivenessActionDetector({ active: true, videoRef, detect, action: 'LOOK_CENTER' as ChallengeAction, onReady }),
    );

    await act(async () => sleep(900));
    expect(onReady).toHaveBeenCalledTimes(1);

    await act(async () => sleep(900));
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it('does not require a sustained hold for BLINK — a brief close-then-reopen cycle completes it', async () => {
    let tick = 0;
    const detect = vi.fn(() => {
      tick += 1;
      // Closed on ticks 2-3 only (a brief ~400-600ms blink), open before and after.
      const score = tick === 2 || tick === 3 ? 0.9 : 0.1;
      return asResult({
        faceLandmarks: [makeCenteredFaceLandmarks()],
        faceBlendshapes: [
          {
            categories: [
              { categoryName: 'eyeBlinkLeft', score, index: 0, displayName: '' },
              { categoryName: 'eyeBlinkRight', score: 0, index: 1, displayName: '' },
            ],
            headIndex: -1,
            headName: '',
          },
        ],
      });
    });
    const onReady = vi.fn().mockResolvedValue(true);
    const videoRef = makeVideoRef();

    renderHook(() =>
      useLivenessActionDetector({ active: true, videoRef, detect, action: 'BLINK' as ChallengeAction, onReady }),
    );

    await act(async () => sleep(1200));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('does not complete BLINK from eyes merely being closed on a single tick with no reopen', async () => {
    const detect = vi.fn(() =>
      asResult({
        faceLandmarks: [makeCenteredFaceLandmarks()],
        faceBlendshapes: [
          {
            categories: [
              { categoryName: 'eyeBlinkLeft', score: 0.9, index: 0, displayName: '' },
              { categoryName: 'eyeBlinkRight', score: 0, index: 1, displayName: '' },
            ],
            headIndex: -1,
            headName: '',
          },
        ],
      }),
    );
    const onReady = vi.fn().mockResolvedValue(true);
    const videoRef = makeVideoRef();

    renderHook(() =>
      useLivenessActionDetector({ active: true, videoRef, detect, action: 'BLINK' as ChallengeAction, onReady }),
    );

    // Eyes stay closed the entire time (never reopen) — must never complete,
    // no matter how long that state is held.
    await act(async () => sleep(1200));
    expect(onReady).not.toHaveBeenCalled();
  });

  it('reports diagnostics reflecting the actual detection result', async () => {
    const detect = vi.fn(() => asResult({ faceLandmarks: [makeCenteredFaceLandmarks()], faceBlendshapes: [] }));
    const onReady = vi.fn().mockResolvedValue(true);
    const onDiagnostics = vi.fn();
    const videoRef = makeVideoRef();

    renderHook(() =>
      useLivenessActionDetector({
        active: true,
        videoRef,
        detect,
        action: 'LOOK_CENTER' as ChallengeAction,
        onReady,
        onDiagnostics,
      }),
    );

    await act(async () => sleep(300));
    expect(onDiagnostics).toHaveBeenCalled();
    const [snapshot] = onDiagnostics.mock.calls[0];
    expect(snapshot.faceCount).toBe(1);
    expect(snapshot.action).toBe('LOOK_CENTER');
  });
});

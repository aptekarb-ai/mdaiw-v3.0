import { describe, expect, it } from 'vitest';
import {
  createBlinkCycleTracker,
  estimateYawAsymmetry,
  faceCount,
  isActionComplete,
  isFramePositionAcceptable,
} from './useFaceLandmarker';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

function makeSquareLandmarks(centerX: number, centerY: number, halfWidth: number) {
  // A minimal ring of points forming a square bounding box, enough to
  // exercise the min/max bounding-box math without needing real 478-point
  // landmark data.
  return [
    { x: centerX - halfWidth, y: centerY - halfWidth, z: 0, visibility: 0 },
    { x: centerX + halfWidth, y: centerY - halfWidth, z: 0, visibility: 0 },
    { x: centerX - halfWidth, y: centerY + halfWidth, z: 0, visibility: 0 },
    { x: centerX + halfWidth, y: centerY + halfWidth, z: 0, visibility: 0 },
  ];
}

// Index 1 is the nose tip (see useFaceLandmarker.ts::estimateYawAsymmetry) —
// index 0 is an unrelated filler point so the nose really is at index 1.
function makeYawLandmarks(noseX: number, minX: number, maxX: number) {
  return [
    { x: noseX, y: 0.5, z: 0, visibility: 0 },
    { x: noseX, y: 0.5, z: 0, visibility: 0 },
    { x: minX, y: 0.5, z: 0, visibility: 0 },
    { x: maxX, y: 0.5, z: 0, visibility: 0 },
  ];
}

function makeResult(overrides: Partial<FaceLandmarkerResult> = {}): FaceLandmarkerResult {
  return {
    faceLandmarks: [[]],
    faceBlendshapes: [],
    facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], rows: 4, columns: 4 }],
    ...overrides,
  } as unknown as FaceLandmarkerResult;
}

describe('faceCount', () => {
  it('returns 0 for a null result', () => {
    expect(faceCount(null)).toBe(0);
  });

  it('returns 0 when no face is detected', () => {
    expect(faceCount(makeResult({ faceLandmarks: [] }))).toBe(0);
  });

  it('returns 1 for a single detected face', () => {
    expect(faceCount(makeResult({ faceLandmarks: [[]] }))).toBe(1);
  });

  it('returns 2 when multiple faces are detected', () => {
    expect(faceCount(makeResult({ faceLandmarks: [[], []] }))).toBe(2);
  });
});

describe('isActionComplete', () => {
  it('is never complete with no result', () => {
    expect(isActionComplete(null, 'LOOK_CENTER')).toBe(false);
  });

  it('is never complete when multiple faces are detected', () => {
    const result = makeResult({ faceLandmarks: [[], []] });
    expect(isActionComplete(result, 'LOOK_CENTER')).toBe(false);
  });

  it('detects LOOK_CENTER when the nose sits roughly midway between the face edges', () => {
    const result = makeResult({ faceLandmarks: [makeYawLandmarks(0.5, 0.3, 0.7)] });
    expect(isActionComplete(result, 'LOOK_CENTER')).toBe(true);
  });

  it('detects TURN_RIGHT when the nose sits close to the left edge of the raw frame', () => {
    // Two people facing each other perceive left/right reversed ("your
    // right is my left") — the camera faces the user the same way, so a
    // physical turn to the user's own right foreshortens the LEFT side of
    // the raw (un-mirrored) frame, pulling the nose toward minX.
    const result = makeResult({ faceLandmarks: [makeYawLandmarks(0.35, 0.3, 0.7)] });
    expect(isActionComplete(result, 'TURN_RIGHT')).toBe(true);
    expect(isActionComplete(result, 'TURN_LEFT')).toBe(false);
  });

  it('detects TURN_LEFT when the nose sits close to the right edge of the raw frame', () => {
    const result = makeResult({ faceLandmarks: [makeYawLandmarks(0.65, 0.3, 0.7)] });
    expect(isActionComplete(result, 'TURN_LEFT')).toBe(true);
    expect(isActionComplete(result, 'TURN_RIGHT')).toBe(false);
  });

  it('does not detect a turn from a small, within-tolerance asymmetry', () => {
    const result = makeResult({ faceLandmarks: [makeYawLandmarks(0.52, 0.3, 0.7)] });
    expect(isActionComplete(result, 'TURN_LEFT')).toBe(false);
    expect(isActionComplete(result, 'TURN_RIGHT')).toBe(false);
  });

  it('detects BLINK from a high eyeBlink blendshape score', () => {
    const result = makeResult({
      faceBlendshapes: [
        {
          categories: [
            { categoryName: 'eyeBlinkLeft', score: 0.9, index: 0, displayName: '' },
            { categoryName: 'eyeBlinkRight', score: 0.1, index: 1, displayName: '' },
          ],
          headIndex: -1,
          headName: '',
        },
      ],
    });
    expect(isActionComplete(result, 'BLINK')).toBe(true);
  });

  it('does not detect BLINK from low blendshape scores', () => {
    const result = makeResult({
      faceBlendshapes: [
        {
          categories: [
            { categoryName: 'eyeBlinkLeft', score: 0.05, index: 0, displayName: '' },
            { categoryName: 'eyeBlinkRight', score: 0.05, index: 1, displayName: '' },
          ],
          headIndex: -1,
          headName: '',
        },
      ],
    });
    expect(isActionComplete(result, 'BLINK')).toBe(false);
  });
});

describe('isFramePositionAcceptable', () => {
  it('rejects a null result', () => {
    expect(isFramePositionAcceptable(null)).toBe(false);
  });

  it('rejects when multiple faces are detected', () => {
    const result = makeResult({ faceLandmarks: [makeSquareLandmarks(0.5, 0.5, 0.2), makeSquareLandmarks(0.5, 0.5, 0.2)] });
    expect(isFramePositionAcceptable(result)).toBe(false);
  });

  it('accepts a large, centered face', () => {
    const result = makeResult({ faceLandmarks: [makeSquareLandmarks(0.5, 0.5, 0.2)] });
    expect(isFramePositionAcceptable(result)).toBe(true);
  });

  it('rejects a face that is too small', () => {
    const result = makeResult({ faceLandmarks: [makeSquareLandmarks(0.5, 0.5, 0.02)] });
    expect(isFramePositionAcceptable(result)).toBe(false);
  });

  it('rejects a face that is off-center', () => {
    const result = makeResult({ faceLandmarks: [makeSquareLandmarks(0.9, 0.5, 0.2)] });
    expect(isFramePositionAcceptable(result)).toBe(false);
  });
});

describe('estimateYawAsymmetry', () => {
  it('returns 0 for too-few landmarks to include a nose tip', () => {
    expect(estimateYawAsymmetry([{ x: 0.5 }])).toBe(0);
  });

  it('is positive when the nose sits toward the left edge (minX) of the raw frame', () => {
    // Index 0 is filler equal to the nose (index 1) — an unrelated outlier
    // there would itself become minX/maxX and mask the effect under test.
    expect(estimateYawAsymmetry([{ x: 0.35 }, { x: 0.35 }, { x: 0.3 }, { x: 0.7 }])).toBeGreaterThan(0);
  });

  it('is negative when the nose sits toward the right edge (maxX) of the raw frame', () => {
    expect(estimateYawAsymmetry([{ x: 0.65 }, { x: 0.65 }, { x: 0.3 }, { x: 0.7 }])).toBeLessThan(0);
  });

  it('is roughly 0 when the nose is centered between the face edges', () => {
    expect(estimateYawAsymmetry([{ x: 0.5 }, { x: 0.5 }, { x: 0.3 }, { x: 0.7 }])).toBeCloseTo(0, 5);
  });
});

function makeBlinkResult(score: number) {
  return makeResult({
    faceLandmarks: [[]],
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
}

describe('createBlinkCycleTracker', () => {
  it('does not complete while the eyes stay closed without reopening', () => {
    const tracker = createBlinkCycleTracker();
    expect(tracker.update(makeBlinkResult(0.9), 0, true)).toBe(false);
    expect(tracker.update(makeBlinkResult(0.9), 150, true)).toBe(false);
  });

  it('completes exactly once on a natural close-then-reopen cycle', () => {
    const tracker = createBlinkCycleTracker();
    expect(tracker.update(makeBlinkResult(0.1), 0, true)).toBe(false);
    expect(tracker.update(makeBlinkResult(0.9), 100, true)).toBe(false);
    expect(tracker.update(makeBlinkResult(0.1), 250, true)).toBe(true);
    // Staying open afterward must not re-fire on later ticks.
    expect(tracker.update(makeBlinkResult(0.1), 400, true)).toBe(false);
  });

  it('does not complete a closure held far longer than a natural blink', () => {
    const tracker = createBlinkCycleTracker();
    tracker.update(makeBlinkResult(0.9), 0, true);
    expect(tracker.update(makeBlinkResult(0.1), 5000, true)).toBe(false);
  });

  it('does not complete a closure shorter than a plausible blink (noise rejection)', () => {
    const tracker = createBlinkCycleTracker();
    tracker.update(makeBlinkResult(0.9), 0, true);
    expect(tracker.update(makeBlinkResult(0.1), 10, true)).toBe(false);
  });

  it('discards an in-progress cycle when tracking is lost mid-blink', () => {
    const tracker = createBlinkCycleTracker();
    tracker.update(makeBlinkResult(0.9), 0, true);
    tracker.update(makeBlinkResult(0.9), 100, false);
    expect(tracker.update(makeBlinkResult(0.1), 200, true)).toBe(false);
  });

  it('reset() clears an in-progress cycle', () => {
    const tracker = createBlinkCycleTracker();
    tracker.update(makeBlinkResult(0.9), 0, true);
    tracker.reset();
    expect(tracker.update(makeBlinkResult(0.1), 100, true)).toBe(false);
  });
});

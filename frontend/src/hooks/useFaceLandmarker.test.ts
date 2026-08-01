import { describe, expect, it } from 'vitest';
import { faceCount, isActionComplete } from './useFaceLandmarker';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

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

  it('detects LOOK_CENTER when yaw is near zero', () => {
    const result = makeResult({
      facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], rows: 4, columns: 4 }],
    });
    expect(isActionComplete(result, 'LOOK_CENTER')).toBe(true);
  });

  it('detects TURN_LEFT from a positive yaw', () => {
    // Rotation matrix for a ~40 degree yaw around Y.
    const cos = Math.cos((40 * Math.PI) / 180);
    const sin = Math.sin((40 * Math.PI) / 180);
    const result = makeResult({
      facialTransformationMatrixes: [
        { data: [cos, 0, sin, 0, 0, 1, 0, 0, -sin, 0, cos, 0, 0, 0, 0, 1], rows: 4, columns: 4 },
      ],
    });
    expect(isActionComplete(result, 'TURN_LEFT')).toBe(true);
    expect(isActionComplete(result, 'TURN_RIGHT')).toBe(false);
  });

  it('detects TURN_RIGHT from a negative yaw', () => {
    const cos = Math.cos((-40 * Math.PI) / 180);
    const sin = Math.sin((-40 * Math.PI) / 180);
    const result = makeResult({
      facialTransformationMatrixes: [
        { data: [cos, 0, sin, 0, 0, 1, 0, 0, -sin, 0, cos, 0, 0, 0, 0, 1], rows: 4, columns: 4 },
      ],
    });
    expect(isActionComplete(result, 'TURN_RIGHT')).toBe(true);
    expect(isActionComplete(result, 'TURN_LEFT')).toBe(false);
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

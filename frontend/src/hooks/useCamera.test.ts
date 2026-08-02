import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFrameQualityAcceptable, useCamera } from './useCamera';

function mockStream() {
  const stopTrack = vi.fn();
  const track = { stop: stopTrack };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, stopTrack };
}

describe('useCamera', () => {
  const originalMediaDevices = navigator.mediaDevices;
  const originalIsSecureContext = window.isSecureContext;

  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', {
      value: originalIsSecureContext,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('does not request the camera before start() is called', () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result } = renderHook(() => useCamera());
    expect(result.current.status).toBe('idle');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('transitions to ready on successful permission grant', async () => {
    const { stream } = mockStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('ready');
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  });

  it('sets status to denied on NotAllowedError', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('denied');
    expect(result.current.errorMessage).toMatch(/permission was denied/i);
  });

  it('sets status to unavailable when no camera is found', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('none', 'NotFoundError'));
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('unavailable');
  });

  it('sets status to error when the camera is already in use', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('busy', 'NotReadableError'));
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
  });

  it('reports unavailable when the browser has no getUserMedia support', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', { value: undefined, configurable: true });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('unavailable');
  });

  it('reports insecure-context outside a secure origin', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const getUserMedia = vi.fn();
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('insecure-context');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('stops every track when stop() is called', async () => {
    const { stream, stopTrack } = mockStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('stops every track on unmount', async () => {
    const { stream, stopTrack } = mockStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    const { result, unmount } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});

describe('isFrameQualityAcceptable', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn> | undefined;

  function fakeVideo(readyState = 4, videoWidth = 640) {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: readyState, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: videoWidth, configurable: true });
    return video;
  }

  function mockCanvasWithLuma(fillValue: (x: number, y: number) => number) {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      return {
        drawImage: vi.fn(),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
              const value = fillValue(x, y);
              const idx = (y * w + x) * 4;
              data[idx] = value;
              data[idx + 1] = value;
              data[idx + 2] = value;
              data[idx + 3] = 255;
            }
          }
          return { data };
        },
      } as unknown as CanvasRenderingContext2D;
    });
  }

  afterEach(() => {
    getContextSpy?.mockRestore();
    getContextSpy = undefined;
  });

  it('returns false when the video has no dimensions yet', () => {
    expect(isFrameQualityAcceptable(fakeVideo(0, 0))).toBe(false);
  });

  it('accepts a well-lit, sharp (high-contrast checkerboard) frame', () => {
    mockCanvasWithLuma((x, y) => ((x + y) % 2 === 0 ? 220 : 30));
    expect(isFrameQualityAcceptable(fakeVideo())).toBe(true);
  });

  it('rejects an all-black (too dark) frame', () => {
    mockCanvasWithLuma(() => 0);
    expect(isFrameQualityAcceptable(fakeVideo())).toBe(false);
  });

  it('rejects an all-white (too bright) frame', () => {
    mockCanvasWithLuma(() => 255);
    expect(isFrameQualityAcceptable(fakeVideo())).toBe(false);
  });

  it('rejects a uniform mid-tone (blurry/blank) frame', () => {
    mockCanvasWithLuma(() => 128);
    expect(isFrameQualityAcceptable(fakeVideo())).toBe(false);
  });

  it('returns false when a 2D canvas context is unavailable', () => {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(isFrameQualityAcceptable(fakeVideo())).toBe(false);
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from './useCamera';

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
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' }, audio: false });
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

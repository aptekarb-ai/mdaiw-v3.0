import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFaceReadiness } from './useFaceReadiness';
import { getFaceReadiness } from '../api/faceauth';

vi.mock('../api/faceauth', () => ({
  getFaceReadiness: vi.fn(),
}));

describe('useFaceReadiness', () => {
  beforeEach(() => {
    // shouldAdvanceTime keeps the fake clock ticking in lockstep with real
    // time automatically, so Testing Library's own internal waitFor/
    // findBy* polling (which also uses setTimeout, and would otherwise be
    // faked into never firing) keeps working normally — advanceTimersByTimeAsync
    // is then used only for the explicit big jumps this file needs.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts in LOADING and reports READY once the backend confirms it', async () => {
    vi.mocked(getFaceReadiness).mockResolvedValue({ success: true, status: 'READY' });
    const { result } = renderHook(() => useFaceReadiness());

    expect(result.current.status).toBe('LOADING');
    await waitFor(() => expect(result.current.status).toBe('READY'));
  });

  it('polls again while LOADING and stops once READY', async () => {
    vi.mocked(getFaceReadiness)
      .mockResolvedValueOnce({ success: true, status: 'LOADING' })
      .mockResolvedValueOnce({ success: true, status: 'LOADING' })
      .mockResolvedValueOnce({ success: true, status: 'READY' });

    const { result } = renderHook(() => useFaceReadiness());
    await waitFor(() => expect(getFaceReadiness).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(getFaceReadiness).toHaveBeenCalledTimes(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(result.current.status).toBe('READY'));

    const callsAtReady = vi.mocked(getFaceReadiness).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    // No further polling once READY.
    expect(getFaceReadiness).toHaveBeenCalledTimes(callsAtReady);
  });

  it('reports UNAVAILABLE when the backend says so', async () => {
    vi.mocked(getFaceReadiness).mockResolvedValue({
      success: false,
      status: 'UNAVAILABLE',
      code: 'MODEL_UNAVAILABLE',
    });
    const { result } = renderHook(() => useFaceReadiness());
    await waitFor(() => expect(result.current.status).toBe('UNAVAILABLE'));
  });

  it('reports UNAVAILABLE on a network failure reaching the readiness endpoint', async () => {
    vi.mocked(getFaceReadiness).mockRejectedValue({ message: 'network down' });
    const { result } = renderHook(() => useFaceReadiness());
    await waitFor(() => expect(result.current.status).toBe('UNAVAILABLE'));
  });

  it('retry() resets to LOADING and starts polling again', async () => {
    vi.mocked(getFaceReadiness).mockResolvedValue({
      success: false,
      status: 'UNAVAILABLE',
      code: 'MODEL_UNAVAILABLE',
    });
    const { result } = renderHook(() => useFaceReadiness());
    await waitFor(() => expect(result.current.status).toBe('UNAVAILABLE'));

    vi.mocked(getFaceReadiness).mockResolvedValue({ success: true, status: 'READY' });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('READY'));
  });

  it('gives up and reports UNAVAILABLE after the maximum poll attempts', async () => {
    vi.mocked(getFaceReadiness).mockResolvedValue({ success: true, status: 'LOADING' });
    const { result } = renderHook(() => useFaceReadiness());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 * 61);
    });

    expect(result.current.status).toBe('UNAVAILABLE');
  });

  it('stops polling on unmount', async () => {
    vi.mocked(getFaceReadiness).mockResolvedValue({ success: true, status: 'LOADING' });
    const { unmount } = renderHook(() => useFaceReadiness());
    await waitFor(() => expect(getFaceReadiness).toHaveBeenCalledTimes(1));

    unmount();
    const callsAtUnmount = vi.mocked(getFaceReadiness).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(getFaceReadiness).toHaveBeenCalledTimes(callsAtUnmount);
  });
});

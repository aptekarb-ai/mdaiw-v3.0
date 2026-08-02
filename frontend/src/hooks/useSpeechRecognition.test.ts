import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpeechRecognition } from './useSpeechRecognition';

class FakeSpeechRecognition implements Partial<SpeechRecognitionLike> {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn(() => {
    this.onstart?.();
  });
  stop = vi.fn(() => {
    this.onend?.();
  });
  abort = vi.fn();
}

describe('useSpeechRecognition', () => {
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('reports unsupported when no browser API exists', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.status).toBe('unsupported');
  });

  it('does not listen until start() is called', () => {
    let instance: FakeSpeechRecognition | null = null;
    window.SpeechRecognition = vi.fn(() => {
      instance = new FakeSpeechRecognition();
      return instance;
    }) as unknown as new () => SpeechRecognitionLike;

    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.status).toBe('idle');
    expect(instance).toBeNull();
  });

  it('transitions to listening then processing on a final transcript', () => {
    let instance: FakeSpeechRecognition = new FakeSpeechRecognition();
    window.SpeechRecognition = vi.fn(function SpeechRecognitionCtor() {
      return instance;
    }) as unknown as new () => SpeechRecognitionLike;

    const { result } = renderHook(() => useSpeechRecognition());
    const onFinal = vi.fn();

    act(() => {
      result.current.start(onFinal);
    });
    expect(result.current.status).toBe('listening');

    act(() => {
      instance.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'open registration' } }],
      } as unknown as SpeechRecognitionEventLike);
    });

    expect(result.current.status).toBe('processing');
    expect(result.current.transcript).toBe('open registration');
    expect(onFinal).toHaveBeenCalledWith('open registration');
  });

  it('reports a denial-specific error message', () => {
    const instance = new FakeSpeechRecognition();
    window.SpeechRecognition = vi.fn(function SpeechRecognitionCtor() {
      return instance;
    }) as unknown as new () => SpeechRecognitionLike;

    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => {
      instance.onerror?.({ error: 'not-allowed' } as SpeechRecognitionErrorEventLike);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toMatch(/permission was denied/i);
  });

  it('aborts recognition on unmount', () => {
    const instance = new FakeSpeechRecognition();
    window.SpeechRecognition = vi.fn(function SpeechRecognitionCtor() {
      return instance;
    }) as unknown as new () => SpeechRecognitionLike;

    const { result, unmount } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    unmount();

    expect(instance.abort).toHaveBeenCalled();
  });

  it('stop() calls the underlying recognition stop', () => {
    const instance = new FakeSpeechRecognition();
    window.SpeechRecognition = vi.fn(function SpeechRecognitionCtor() {
      return instance;
    }) as unknown as new () => SpeechRecognitionLike;

    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => result.current.stop());

    expect(instance.stop).toHaveBeenCalled();
  });
});

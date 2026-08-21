import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPreferredVoice, useSpeechSynthesis } from './useSpeechSynthesis';

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeVoice(overrides: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return {
    voiceURI: 'voice-1',
    name: 'Test Voice',
    lang: 'en-IN',
    default: false,
    localService: true,
    ...overrides,
  } as SpeechSynthesisVoice;
}

describe('useSpeechSynthesis', () => {
  let cancel: ReturnType<typeof vi.fn>;
  let speak: ReturnType<typeof vi.fn>;
  let getVoices: ReturnType<typeof vi.fn>;
  let voiceschangedHandlers: Array<() => void>;

  beforeEach(() => {
    window.localStorage.clear();
    cancel = vi.fn();
    speak = vi.fn((utterance: FakeUtterance) => {
      utterance.onstart?.();
    });
    getVoices = vi.fn().mockReturnValue([]);
    voiceschangedHandlers = [];
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel,
      speak,
      getVoices,
      addEventListener: (event: string, handler: () => void) => {
        if (event === 'voiceschanged') voiceschangedHandlers.push(handler);
      },
      removeEventListener: vi.fn(),
    };
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reports unsupported when speechSynthesis is absent', () => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    const { result } = renderHook(() => useSpeechSynthesis());
    expect(result.current.status).toBe('unsupported');
  });

  it('speaks text and updates status to speaking', () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.speak('Hello'));
    expect(speak).toHaveBeenCalled();
    expect(result.current.status).toBe('speaking');
  });

  it('never speaks while muted', () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.toggleMuted());
    expect(result.current.muted).toBe(true);

    act(() => result.current.speak('Hello'));
    expect(speak).not.toHaveBeenCalled();
  });

  it('cancel() stops speech and resets status', () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.speak('Hello'));
    act(() => result.current.cancel());
    expect(cancel).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('cancels any in-progress speech on unmount', () => {
    const { unmount } = renderHook(() => useSpeechSynthesis());
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it('loads the voice list on mount when already available', () => {
    getVoices.mockReturnValue([fakeVoice({ voiceURI: 'a' }), fakeVoice({ voiceURI: 'b' })]);
    const { result } = renderHook(() => useSpeechSynthesis());
    expect(result.current.voices).toHaveLength(2);
  });

  it('loads the voice list via the voiceschanged event when not available synchronously', () => {
    getVoices.mockReturnValue([]);
    const { result } = renderHook(() => useSpeechSynthesis());
    expect(result.current.voices).toHaveLength(0);

    getVoices.mockReturnValue([fakeVoice({ voiceURI: 'late-loaded' })]);
    act(() => voiceschangedHandlers.forEach((handler) => handler()));

    expect(result.current.voices.map((v) => v.voiceURI)).toEqual(['late-loaded']);
  });

  it('previewVoice speaks a short sample', () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.previewVoice());
    expect(speak).toHaveBeenCalled();
  });

  it('persists and restores the speech rate', () => {
    const { result, unmount } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.setRate(1.2));
    expect(result.current.rate).toBe(1.2);
    unmount();

    const { result: second } = renderHook(() => useSpeechSynthesis());
    expect(second.current.rate).toBe(1.2);
  });

  it('clamps an out-of-range speech rate', () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.setRate(10));
    expect(result.current.rate).toBeLessThanOrEqual(1.5);
    act(() => result.current.setRate(-5));
    expect(result.current.rate).toBeGreaterThanOrEqual(0.5);
  });

  it('persists and restores the selected voice', () => {
    const { result, unmount } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.setVoiceURI('chosen-voice'));
    expect(result.current.selectedVoiceURI).toBe('chosen-voice');
    unmount();

    const { result: second } = renderHook(() => useSpeechSynthesis());
    expect(second.current.selectedVoiceURI).toBe('chosen-voice');
  });

  it('persists and restores the selected language', () => {
    const { result, unmount } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.setLanguage('hi-IN'));
    unmount();

    const { result: second } = renderHook(() => useSpeechSynthesis());
    expect(second.current.language).toBe('hi-IN');
  });
});

describe('findPreferredVoice', () => {
  it('returns null when no voices are available (safe fallback to browser default)', () => {
    expect(findPreferredVoice([], 'en-IN', null)).toBeNull();
  });

  it('prefers the user-saved voice when it still exists', () => {
    const saved = fakeVoice({ voiceURI: 'saved', name: 'Saved Voice' });
    const other = fakeVoice({ voiceURI: 'other', name: 'Other Voice' });
    expect(findPreferredVoice([other, saved], 'en-IN', 'saved')).toBe(saved);
  });

  it('falls back gracefully when the saved voice no longer exists', () => {
    const only = fakeVoice({ voiceURI: 'only' });
    expect(findPreferredVoice([only], 'en-IN', 'missing-voice')).toBe(only);
  });

  it('prefers a natural feminine-pattern voice matching the language when no voice is saved', () => {
    const masculine = fakeVoice({ voiceURI: 'm', name: 'David', lang: 'en-US' });
    const feminine = fakeVoice({ voiceURI: 'f', name: 'Microsoft Zira', lang: 'en-US' });
    expect(findPreferredVoice([masculine, feminine], 'en-US', null)).toBe(feminine);
  });

  it('matches by language when no feminine-pattern voice is available', () => {
    const english = fakeVoice({ voiceURI: 'en', name: 'Generic', lang: 'en-GB' });
    const hindi = fakeVoice({ voiceURI: 'hi', name: 'Generic Hindi', lang: 'hi-IN' });
    expect(findPreferredVoice([english, hindi], 'hi-IN', null)).toBe(hindi);
  });

  it('falls back to the device default voice when no language match exists', () => {
    const fallbackDefault = fakeVoice({ voiceURI: 'def', lang: 'ja-JP', default: true });
    const other = fakeVoice({ voiceURI: 'other', lang: 'ja-JP', default: false });
    expect(findPreferredVoice([other, fallbackDefault], 'hi-IN', null)).toBe(fallbackDefault);
  });

  it('never claims a language it does not have — falls back to the first voice as a last resort', () => {
    const only = fakeVoice({ voiceURI: 'only', lang: 'ja-JP', default: false });
    expect(findPreferredVoice([only], 'hi-IN', null)).toBe(only);
  });
});

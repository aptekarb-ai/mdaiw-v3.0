import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechSynthesisStatus = 'idle' | 'unsupported' | 'speaking';

const VOICE_URI_STORAGE_KEY = 'yukti_voice_uri';
const LANGUAGE_STORAGE_KEY = 'yukti_speech_language';
const RATE_STORAGE_KEY = 'yukti_speech_rate';
const MUTED_STORAGE_KEY = 'yukti_speech_muted';

const DEFAULT_LANGUAGE = 'en-IN';
const DEFAULT_RATE = 0.95;

// Configurable name fragments (case-insensitive) that tend to identify a
// warmer, natural-sounding feminine voice across common desktop/mobile
// speech engines. This is a *preference* heuristic, not a guarantee — never
// claim a device has a female voice when it does not; see
// `findPreferredVoice`'s fallback chain.
const PREFERRED_FEMININE_VOICE_NAME_PATTERNS = [
  'female',
  'samantha',
  'victoria',
  'zira',
  'aria',
  'jenny',
  'neerja',
  'google us english',
  'google uk english female',
];

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStoredString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

function readStoredBoolean(key: string): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(key) === 'true';
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Picks the best available voice, in order of trust:
 * 1. The user's explicitly saved voice (by voiceURI), if it still exists.
 * 2. A voice matching the requested language whose name matches one of the
 *    configured "natural feminine voice" patterns.
 * 3. Any voice matching the requested language.
 * 4. The device/browser default voice (or the first available voice).
 * 5. null, if no voices are available at all — callers fall back to the
 *    browser's own default voice by omitting `utterance.voice`.
 */
export function findPreferredVoice(
  voices: SpeechSynthesisVoice[],
  language: string,
  savedVoiceURI: string | null,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null;
  }
  if (savedVoiceURI) {
    const saved = voices.find((voice) => voice.voiceURI === savedVoiceURI);
    if (saved) return saved;
  }

  const languagePrefix = language.split('-')[0].toLowerCase();
  const matchesLanguage = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().startsWith(languagePrefix);

  const languageMatches = voices.filter(matchesLanguage);
  const feminineMatch = languageMatches.find((voice) =>
    PREFERRED_FEMININE_VOICE_NAME_PATTERNS.some((pattern) => voice.name.toLowerCase().includes(pattern)),
  );
  if (feminineMatch) return feminineMatch;

  if (languageMatches.length > 0) {
    return languageMatches[0];
  }

  const defaultVoice = voices.find((voice) => voice.default);
  return defaultVoice ?? voices[0];
}

/**
 * Never speaks automatically. `speak()` is only ever called in response to
 * an explicit prior user action elsewhere in the app (opening Yukti,
 * pressing the mic) or an already-user-initiated welcome flow. Passwords
 * and other secret values are never passed to `speak()` — see
 * YuktiDrawer/useYuktiVoice, which never forward password fields into any
 * spoken response.
 */
export function useSpeechSynthesis() {
  const [status, setStatus] = useState<SpeechSynthesisStatus>(
    isSpeechSynthesisSupported() ? 'idle' : 'unsupported',
  );
  const [muted, setMuted] = useState(() => readStoredBoolean(MUTED_STORAGE_KEY));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(() =>
    readStoredString(VOICE_URI_STORAGE_KEY),
  );
  const [language, setLanguageState] = useState<string>(
    () => readStoredString(LANGUAGE_STORAGE_KEY) ?? DEFAULT_LANGUAGE,
  );
  const [rate, setRateState] = useState<number>(() => readStoredNumber(RATE_STORAGE_KEY, DEFAULT_RATE));

  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const selectedVoiceURIRef = useRef(selectedVoiceURI);
  selectedVoiceURIRef.current = selectedVoiceURI;
  const languageRef = useRef(language);
  languageRef.current = language;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  voicesRef.current = voices;

  // Robust voice loading: some browsers populate getVoices() synchronously,
  // others only after the async voiceschanged event fires (sometimes more
  // than once as different voice packs finish loading).
  useEffect(() => {
    if (!isSpeechSynthesisSupported()) {
      return;
    }
    function loadVoices() {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) {
        setVoices(available);
      }
    }
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      if (isSpeechSynthesisSupported()) {
        window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      }
    };
  }, []);

  const cancel = useCallback(() => {
    if (isSpeechSynthesisSupported()) {
      window.speechSynthesis.cancel();
    }
    setStatus((current) => (current === 'unsupported' ? current : 'idle'));
  }, []);

  const speak = useCallback((text: string, options?: { language?: string }) => {
    if (!isSpeechSynthesisSupported() || !text) {
      return;
    }
    window.speechSynthesis.cancel();
    if (mutedRef.current) {
      return;
    }

    const effectiveLanguage = options?.language || languageRef.current;
    const voice = findPreferredVoice(voicesRef.current, effectiveLanguage, selectedVoiceURIRef.current);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || effectiveLanguage;
    utterance.rate = rateRef.current;
    if (voice) {
      utterance.voice = voice;
    }
    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    utterance.onerror = () => setStatus('idle');
    window.speechSynthesis.speak(utterance);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MUTED_STORAGE_KEY, String(next));
      }
      if (next) {
        window.speechSynthesis?.cancel();
        setStatus((current) => (current === 'unsupported' ? current : 'idle'));
      }
      return next;
    });
  }, []);

  const setVoiceURI = useCallback((voiceURI: string | null) => {
    setSelectedVoiceURI(voiceURI);
    if (typeof window === 'undefined') return;
    if (voiceURI) {
      window.localStorage.setItem(VOICE_URI_STORAGE_KEY, voiceURI);
    } else {
      window.localStorage.removeItem(VOICE_URI_STORAGE_KEY);
    }
  }, []);

  const setLanguage = useCallback((nextLanguage: string) => {
    setLanguageState(nextLanguage);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    }
  }, []);

  const setRate = useCallback((nextRate: number) => {
    const clamped = Math.min(1.5, Math.max(0.5, nextRate));
    setRateState(clamped);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(RATE_STORAGE_KEY, String(clamped));
    }
  }, []);

  const previewVoice = useCallback(
    (sampleText = "Hello, I'm Yukti, your AI assistant.") => {
      speak(sampleText);
    },
    [speak],
  );

  useEffect(() => {
    return () => {
      if (isSpeechSynthesisSupported()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    status,
    muted,
    speak,
    cancel,
    toggleMuted,
    voices,
    selectedVoiceURI,
    setVoiceURI,
    language,
    setLanguage,
    rate,
    setRate,
    previewVoice,
  };
}

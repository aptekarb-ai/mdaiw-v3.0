import { useCallback } from 'react';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useSpeechSynthesis } from './useSpeechSynthesis';

/**
 * Combines push-to-talk recognition and speech output, keeping them from
 * talking over each other: starting to listen always cancels any speech in
 * progress first, and speaking always stops listening first.
 */
export function useYuktiVoice() {
  const recognition = useSpeechRecognition();
  const synthesis = useSpeechSynthesis();

  const startListening = useCallback(
    (onFinalTranscript: (text: string) => void) => {
      synthesis.cancel();
      recognition.start(onFinalTranscript, synthesis.language);
    },
    [recognition, synthesis],
  );

  const stopListening = useCallback(() => {
    recognition.stop();
  }, [recognition]);

  const speak = useCallback(
    (text: string, options?: { language?: string }) => {
      recognition.stop();
      synthesis.speak(text, options);
    },
    [recognition, synthesis],
  );

  const stopAll = useCallback(() => {
    recognition.stop();
    synthesis.cancel();
  }, [recognition, synthesis]);

  return {
    micStatus: recognition.status,
    transcript: recognition.transcript,
    micError: recognition.errorMessage,
    resetMic: recognition.reset,
    startListening,
    stopListening,
    speechStatus: synthesis.status,
    muted: synthesis.muted,
    toggleMuted: synthesis.toggleMuted,
    speak,
    stopSpeaking: synthesis.cancel,
    stopAll,
    voiceSupported: recognition.status !== 'unsupported',
    speechOutputSupported: synthesis.status !== 'unsupported',
    voices: synthesis.voices,
    selectedVoiceURI: synthesis.selectedVoiceURI,
    setVoiceURI: synthesis.setVoiceURI,
    language: synthesis.language,
    setLanguage: synthesis.setLanguage,
    rate: synthesis.rate,
    setRate: synthesis.setRate,
    previewVoice: synthesis.previewVoice,
  };
}

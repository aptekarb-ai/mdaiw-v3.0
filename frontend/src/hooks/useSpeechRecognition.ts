import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechRecognitionStatus = 'idle' | 'unsupported' | 'listening' | 'processing' | 'error';

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

/**
 * Push-to-talk only: the caller decides exactly when to start/stop
 * (e.g. mic button press/release). This hook never listens continuously
 * and never starts on its own. No raw audio is ever stored or uploaded —
 * only the transcript string the browser itself produces.
 */
export function useSpeechRecognition() {
  const [status, setStatus] = useState<SpeechRecognitionStatus>(
    isSpeechRecognitionSupported() ? 'idle' : 'unsupported',
  );
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(
    (onFinalTranscript?: (text: string) => void, language = 'en-IN') => {
      const Constructor = getSpeechRecognitionConstructor();
      if (!Constructor) {
        setStatus('unsupported');
        return;
      }

      recognitionRef.current?.abort();
      setTranscript('');
      setErrorMessage(null);

      const recognition = new Constructor();
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setStatus('listening');

      recognition.onresult = (event) => {
        let finalText = '';
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result.isFinal) {
            finalText += result[0].transcript;
          } else {
            interimText += result[0].transcript;
          }
        }
        if (finalText) {
          setTranscript(finalText);
          setStatus('processing');
          onFinalTranscript?.(finalText.trim());
        } else {
          setTranscript(interimText);
        }
      };

      recognition.onerror = (event) => {
        setStatus('error');
        setErrorMessage(
          event.error === 'not-allowed'
            ? 'Microphone permission was denied.'
            : 'Could not understand that. Please try again or type your request.',
        );
      };

      recognition.onend = () => {
        setStatus((current) => (current === 'listening' ? 'idle' : current));
      };

      recognitionRef.current = recognition;
      recognition.start();
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus((current) => (current === 'unsupported' ? current : 'idle'));
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { status, transcript, errorMessage, start, stop, reset };
}

import { useYukti } from '../hooks/useYukti';
import './Yukti.css';

export function YuktiMicrophoneButton() {
  const { micStatus, voiceSupported, startListening, stopListening, isProcessing } = useYukti();
  const listening = micStatus === 'listening';

  if (!voiceSupported) {
    return null;
  }

  return (
    <button
      type="button"
      className="yukti-mic-button"
      data-listening={listening}
      aria-label={listening ? 'Release to stop listening' : 'Hold to talk to Yukti'}
      aria-pressed={listening}
      disabled={micStatus === 'processing' || isProcessing}
      onPointerDown={(event) => {
        event.preventDefault();
        startListening();
      }}
      onPointerUp={stopListening}
      onPointerLeave={() => {
        if (listening) {
          stopListening();
        }
      }}
    >
      <span className="mdaiw-icon mdaiw-icon--microphone" aria-hidden="true" />
    </button>
  );
}

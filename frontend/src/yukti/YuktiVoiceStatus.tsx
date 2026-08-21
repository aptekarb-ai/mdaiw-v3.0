import './Yukti.css';

interface YuktiVoiceStatusProps {
  micStatus: string;
  speechStatus: string;
}

const LABELS: Record<string, string> = {
  listening: 'Listening...',
  processing: 'Processing your request...',
  error: 'I could not understand that. Please try again or type your request.',
  speaking: 'Speaking...',
};

export function YuktiVoiceStatus({ micStatus, speechStatus }: YuktiVoiceStatusProps) {
  const label = LABELS[micStatus] ?? (speechStatus === 'speaking' ? LABELS.speaking : null);
  if (!label) {
    return null;
  }
  return (
    <p className="yukti-voice-status" role="status" aria-live="polite">
      {label}
    </p>
  );
}

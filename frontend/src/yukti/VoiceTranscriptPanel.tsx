import './Yukti.css';

interface VoiceTranscriptPanelProps {
  transcript: string;
}

export function VoiceTranscriptPanel({ transcript }: VoiceTranscriptPanelProps) {
  if (!transcript) {
    return null;
  }
  return (
    <p className="yukti-voice-transcript" aria-live="polite">
      {transcript}
    </p>
  );
}

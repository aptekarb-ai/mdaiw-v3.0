import { useState, type FormEvent } from 'react';
import { useYukti } from '../hooks/useYukti';
import { YuktiMicrophoneButton } from './YuktiMicrophoneButton';
import './Yukti.css';

export function YuktiComposer() {
  const { sendMessage, isProcessing } = useYukti();
  const [value, setValue] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || isProcessing) {
      return;
    }
    void sendMessage(value);
    setValue('');
  }

  return (
    <form className="yukti-composer" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Type your message..."
        aria-label="Message to Yukti"
        value={value}
        disabled={isProcessing}
        onChange={(event) => setValue(event.target.value)}
      />
      <YuktiMicrophoneButton />
      <button
        type="submit"
        className="yukti-composer__send"
        aria-label="Send message"
        disabled={isProcessing}
      >
        <span className="mdaiw-icon mdaiw-icon--send" aria-hidden="true" />
      </button>
    </form>
  );
}

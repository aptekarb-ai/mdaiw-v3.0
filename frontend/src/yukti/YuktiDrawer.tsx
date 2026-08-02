import { useEffect, useState } from 'react';
import { useYukti } from '../hooks/useYukti';
import { YuktiActionConfirmation } from './YuktiActionConfirmation';
import { YuktiComposer } from './YuktiComposer';
import { YuktiMessageList } from './YuktiMessageList';
import { YuktiVoiceStatus } from './YuktiVoiceStatus';
import { YuktiVoiceSettings } from './YuktiVoiceSettings';
import { VoiceTranscriptPanel } from './VoiceTranscriptPanel';
import './Yukti.css';

export function YuktiDrawer() {
  const {
    isOpen,
    close,
    messages,
    pendingConfirmation,
    confirmPendingAction,
    cancelPendingAction,
    clearMessages,
    micStatus,
    transcript,
    speechStatus,
    muted,
    toggleMuted,
  } = useYukti();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div className="yukti-drawer__backdrop" onClick={close} />
      <div className="yukti-drawer" role="dialog" aria-modal="true" aria-label="Yukti assistant">
        <div className="yukti-drawer__header">
          <img src="/assets/mdaiw/images/yukti-assistant.svg" alt="" aria-hidden="true" />
          <div className="yukti-drawer__header-text">
            <h2>Yukti</h2>
            <p>Your AI Assistant</p>
          </div>
          <div className="yukti-drawer__header-actions">
            <button
              type="button"
              className="yukti-drawer__icon-button"
              aria-label={muted ? 'Unmute Yukti' : 'Mute Yukti'}
              onClick={toggleMuted}
            >
              <span className={`mdaiw-icon mdaiw-icon--${muted ? 'volume-off' : 'volume'}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="yukti-drawer__icon-button"
              aria-label={settingsOpen ? 'Hide voice settings' : 'Voice settings'}
              aria-pressed={settingsOpen}
              onClick={() => setSettingsOpen((prev) => !prev)}
            >
              <span className="mdaiw-icon mdaiw-icon--settings" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="yukti-drawer__icon-button"
              aria-label="Clear conversation"
              onClick={clearMessages}
            >
              <span className="mdaiw-icon mdaiw-icon--refresh" aria-hidden="true" />
            </button>
            <button type="button" className="yukti-drawer__icon-button" aria-label="Close Yukti" onClick={close}>
              <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
            </button>
          </div>
        </div>

        {settingsOpen && <YuktiVoiceSettings />}

        <YuktiMessageList messages={messages} />
        <VoiceTranscriptPanel transcript={transcript} />
        <YuktiVoiceStatus micStatus={micStatus} speechStatus={speechStatus} />

        {pendingConfirmation && (
          <YuktiActionConfirmation
            action={pendingConfirmation.action}
            onConfirm={confirmPendingAction}
            onCancel={cancelPendingAction}
          />
        )}

        <YuktiComposer />
      </div>
    </>
  );
}

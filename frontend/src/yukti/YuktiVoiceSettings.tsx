import { useState } from 'react';
import { useYukti } from '../hooks/useYukti';
import { isWelcomeEnabled, setWelcomeEnabled, SUPPORTED_SPEECH_LANGUAGES } from './voicePreferences';
import './Yukti.css';

/**
 * Voice preferences panel — voice selection, language, speech rate,
 * preview, and the welcome-on-open preference. Mute itself lives in the
 * drawer header (already always visible); this panel is reached via a
 * settings toggle there. The available spoken languages/voices depend
 * entirely on what the browser and OS report — never claim a voice or
 * language is supported when `voices` doesn't actually contain it.
 */
export function YuktiVoiceSettings() {
  const {
    voices,
    selectedVoiceURI,
    setVoiceURI,
    language,
    setLanguage,
    rate,
    setRate,
    previewVoice,
    speechOutputSupported,
  } = useYukti();
  const [welcomeEnabled, setWelcomeEnabledState] = useState(isWelcomeEnabled());

  const voicesForLanguage = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(language.split('-')[0].toLowerCase()),
  );
  const voiceOptions = voicesForLanguage.length > 0 ? voicesForLanguage : voices;

  function handleWelcomeToggle(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.checked;
    setWelcomeEnabledState(next);
    setWelcomeEnabled(next);
  }

  if (!speechOutputSupported) {
    return (
      <div className="yukti-voice-settings">
        <p className="yukti-voice-settings__unsupported">
          Voice output is not supported in this browser. You can still use typed chat.
        </p>
      </div>
    );
  }

  return (
    <div className="yukti-voice-settings">
      <div className="yukti-voice-settings__field">
        <label htmlFor="yukti-language-select">Spoken language</label>
        <select
          id="yukti-language-select"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {SUPPORTED_SPEECH_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="yukti-voice-settings__field">
        <label htmlFor="yukti-voice-select">Voice</label>
        <select
          id="yukti-voice-select"
          value={selectedVoiceURI ?? ''}
          onChange={(event) => setVoiceURI(event.target.value || null)}
        >
          <option value="">Automatic (best match)</option>
          {voiceOptions.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
        {voices.length === 0 && (
          <p className="yukti-voice-settings__hint">
            Your browser has not reported any voices yet. The default device voice will be used.
          </p>
        )}
      </div>

      <div className="yukti-voice-settings__field">
        <label htmlFor="yukti-rate-range">
          Speech rate <span className="yukti-voice-settings__rate-value">{rate.toFixed(2)}x</span>
        </label>
        <input
          id="yukti-rate-range"
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={rate}
          onChange={(event) => setRate(Number(event.target.value))}
        />
      </div>

      <button type="button" className="button button--outline" onClick={() => previewVoice()}>
        Preview voice
      </button>

      <label className="yukti-voice-settings__checkbox">
        <input type="checkbox" checked={welcomeEnabled} onChange={handleWelcomeToggle} />
        Speak a welcome message when I open the app
      </label>
    </div>
  );
}

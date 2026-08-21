import { useEffect, useMemo, useRef, useState } from 'react';
import type { ValidationIssue, YuktiExplainResponse } from '../types/landingpages';
import { useSpeechSynthesis, isSpeechSynthesisSupported } from '../hooks/useSpeechSynthesis';
import './YuktiExplanationPanel.css';

export interface YuktiExplainApiError {
  code?: string;
  message: string;
}

export interface YuktiExplanationPanelProps {
  open: boolean;
  mode: 'batch' | 'issue';
  issue?: ValidationIssue | null;
  loading: boolean;
  error: YuktiExplainApiError | null;
  result: YuktiExplainResponse | null;
  onClose: () => void;
}

const LANGUAGE_LABEL: Record<string, string> = {
  html: 'HTML', css: 'CSS', javascript: 'JavaScript', ampscript: 'AMPscript', typescript: 'TypeScript', cdn: 'CDN',
};
const FIX_METHOD_LABEL: Record<string, string> = { deterministic: 'Deterministic', 'ai-assisted': 'AI-assisted' };
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5];

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

// Builds the same text the panel already shows as a transcript — audio is
// never given anything beyond this generated explanation text, and never
// the raw landing-page source (spec section 43: explanation text -> TTS,
// never raw source -> TTS). Browser speech synthesis never leaves the
// browser at all, which satisfies the privacy requirement even more
// strictly than a server round-trip would.
function buildSpeechText(result: YuktiExplainResponse, mode: 'batch' | 'issue'): string {
  if (mode === 'issue') {
    const entry = result.per_issue[0];
    if (!entry) return result.summary;
    return [entry.what, entry.why, entry.impact, entry.recommended_correction].filter(Boolean).join('. ');
  }
  return [result.summary, result.why_it_matters, result.how_to_fix, result.recommended_order]
    .filter(Boolean)
    .join('. ');
}

export function YuktiExplanationPanel({
  open, mode, issue, loading, error, result, onClose,
}: YuktiExplanationPanelProps) {
  const [audioStage, setAudioStage] = useState<'prompt' | 'player'>('prompt');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const {
    status: speechStatus, muted, speak, cancel, pause, resume, progress, toggleMuted, rate, setRate,
  } = useSpeechSynthesis();

  useEffect(() => {
    if (open) setAudioStage('prompt');
    if (!open) cancel();
    // cancel() is stable (useCallback with no deps) — only `open` should
    // re-run this; including cancel would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Never speaks on its own — cancel any in-flight speech the moment this
  // panel unmounts/closes, so navigating away never leaves audio running.
  useEffect(() => () => cancel(), [cancel]);

  const speechText = useMemo(() => (result ? buildSpeechText(result, mode) : ''), [result, mode]);

  if (!open) return null;

  function handlePlayAudio() {
    setAudioStage('player');
    speak(speechText);
  }

  function handleReplay() {
    speak(speechText);
  }

  function handleStop() {
    cancel();
    setAudioStage('prompt');
  }

  const heading = mode === 'issue' ? 'Yukti — Explain This Issue' : "Yukti's Explanation";
  const singleIssue = mode === 'issue' ? result?.per_issue[0] : undefined;

  return (
    <div className="yukti-explanation-panel__backdrop" role="presentation" onClick={onClose}>
      <div
        className="yukti-explanation-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="yukti-explanation-heading"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="yukti-explanation-panel__header">
          <h2 id="yukti-explanation-heading">{heading}</h2>
          <button
            type="button" ref={closeButtonRef} className="button button--outline"
            onClick={onClose} aria-label="Close Yukti's explanation"
          >
            Close
          </button>
        </div>

        {loading && (
          <div className="yukti-explanation-panel__loading" role="status">
            <span className="mdaiw-icon mdaiw-icon--spinner yukti-explanation-panel__spinner" aria-hidden="true" />
            <p>Yukti is preparing an explanation…</p>
          </div>
        )}

        {!loading && error && (
          <div className="yukti-explanation-panel__error" role="alert">
            <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
            <p>{error.message}</p>
          </div>
        )}

        {!loading && !error && result && (
          <div className="yukti-explanation-panel__content">
            {mode === 'batch' ? (
              <>
                <p className="yukti-explanation-panel__summary">{result.summary}</p>

                {result.language_breakdown.length > 0 && (
                  <section aria-label="Issues by language" className="yukti-explanation-panel__section">
                    <h3>Issues by Area</h3>
                    <ul className="yukti-explanation-panel__language-list">
                      {result.language_breakdown.map((entry) => (
                        <li key={entry.language}>
                          <strong>{LANGUAGE_LABEL[entry.language] ?? entry.language}:</strong>{' '}
                          {entry.errors + entry.warnings + entry.info}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {result.most_important.length > 0 && (
                  <section aria-label="Most important issues" className="yukti-explanation-panel__section">
                    <h3>Most Important Issues</h3>
                    <ul>
                      {result.most_important.map((item) => <li key={item.issue_id}>{item.reason}</li>)}
                    </ul>
                  </section>
                )}

                <section className="yukti-explanation-panel__section">
                  <h3>Why They Matter</h3>
                  <p>{result.why_it_matters}</p>
                </section>
                <section className="yukti-explanation-panel__section">
                  <h3>How They Can Be Fixed</h3>
                  <p>{result.how_to_fix}</p>
                </section>
                <section className="yukti-explanation-panel__section">
                  <h3>Recommended Order</h3>
                  <p>{result.recommended_order}</p>
                </section>
                {result.truncated && (
                  <p className="yukti-explanation-panel__truncated-notice" role="status">
                    Only the first issues were explained in detail — validate a smaller selection for full coverage.
                  </p>
                )}
              </>
            ) : (
              singleIssue && (
                <>
                  {issue && <p className="yukti-explanation-panel__summary">{issue.message}</p>}
                  <span className={`yukti-explanation-panel__method-badge yukti-explanation-panel__method-badge--${singleIssue.fix_method}`}>
                    Fix method: {FIX_METHOD_LABEL[singleIssue.fix_method] ?? singleIssue.fix_method}
                  </span>
                  {singleIssue.requires_decision && (
                    <p className="yukti-explanation-panel__decision-notice">You will need to review and choose to apply this fix.</p>
                  )}
                  <section className="yukti-explanation-panel__section">
                    <h3>What This Means</h3>
                    <p>{singleIssue.what}</p>
                  </section>
                  <section className="yukti-explanation-panel__section">
                    <h3>Why It Occurs</h3>
                    <p>{singleIssue.why}</p>
                  </section>
                  <section className="yukti-explanation-panel__section">
                    <h3>Impact If Not Fixed</h3>
                    <p>{singleIssue.impact}</p>
                  </section>
                  <section className="yukti-explanation-panel__section">
                    <h3>Recommended Correction</h3>
                    <p>{singleIssue.recommended_correction}</p>
                  </section>
                </>
              )
            )}

            {isSpeechSynthesisSupported() ? (
              audioStage === 'prompt' ? (
                <div className="yukti-explanation-panel__audio-prompt">
                  <p>Would you like me to explain these issues aloud?</p>
                  <div className="yukti-explanation-panel__audio-prompt-actions">
                    <button type="button" className="button button--outline" onClick={() => setAudioStage('player')}>
                      No Thanks
                    </button>
                    <button type="button" className="button button--primary" onClick={handlePlayAudio}>
                      🔊 Play Audio Explanation
                    </button>
                  </div>
                </div>
              ) : (
                <div className="yukti-explanation-panel__audio-player" role="group" aria-label="Yukti audio explanation controls">
                  <div className="yukti-explanation-panel__audio-transport">
                    {speechStatus === 'speaking' ? (
                      <button type="button" className="button button--outline" onClick={pause} aria-label="Pause Yukti explanation">
                        ⏸ Pause
                      </button>
                    ) : (
                      <button
                        type="button" className="button button--outline"
                        onClick={speechStatus === 'paused' ? resume : handlePlayAudio}
                        aria-label={speechStatus === 'paused' ? 'Resume Yukti explanation' : 'Play Yukti explanation'}
                      >
                        ▶ {speechStatus === 'paused' ? 'Resume' : 'Play'}
                      </button>
                    )}
                    <button type="button" className="button button--outline" onClick={handleStop} aria-label="Stop Yukti explanation">
                      ⏹ Stop
                    </button>
                    <button type="button" className="button button--outline" onClick={handleReplay} aria-label="Replay Yukti explanation">
                      ↺ Replay
                    </button>
                    <button
                      type="button" className="button button--outline" onClick={toggleMuted}
                      aria-label={muted ? 'Unmute Yukti' : 'Mute Yukti'}
                    >
                      {muted ? '🔇' : '🔊'}
                    </button>
                  </div>

                  <div className="yukti-explanation-panel__progress" role="progressbar" aria-label="Explanation playback progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                    <div className="yukti-explanation-panel__progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>

                  <div className="yukti-explanation-panel__speed" role="group" aria-label="Playback speed">
                    {SPEED_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`yukti-explanation-panel__speed-option${rate === option ? ' yukti-explanation-panel__speed-option--active' : ''}`}
                        aria-pressed={rate === option}
                        onClick={() => setRate(option)}
                      >
                        {option}×
                      </button>
                    ))}
                  </div>
                  <p className="yukti-explanation-panel__speed-note">
                    Speed changes apply the next time you press Play or Replay.
                  </p>
                </div>
              )
            ) : (
              <p className="yukti-explanation-panel__audio-unsupported" role="status">
                Audio explanation is not supported in this browser. You can still read Yukti's explanation above.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

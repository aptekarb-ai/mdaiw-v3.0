import { useRef, useState } from 'react';
import { requestAICommand } from '../api/client';
import { isSpeechRecognitionSupported, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  describeAction,
  type AIActionHistoryEntry, type AICommandAction, type AICommandProviderId, type AICommandSelectedModuleContext,
} from './aiCommand';
import type { EmailModule } from './edm';
import type { EmailPlatform } from './types';
import './AIEngineerPanel.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface PendingProposal {
  messageId: string;
  command: string;
  interpretation: string;
  action: AICommandAction;
  requiresConfirmation: boolean;
  provider: AICommandProviderId;
  capturedSelectedModuleId: string | null;
}

interface AIEngineerPanelProps {
  platform: EmailPlatform;
  width: number;
  selectedModule: EmailModule | null;
  // Applies the action through the existing builder mutation functions
  // (see EmailBuilderWorkspacePage.handleApplyAiAction). Returns false
  // when the action could not be safely applied — e.g. the canvas
  // selection changed after the proposal was made — so the panel can
  // report an honest outcome instead of claiming success.
  onApplyAction: (action: AICommandAction, capturedSelectedModuleId: string | null) => boolean;
}

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

const HISTORY_STATUS_LABEL: Record<AIActionHistoryEntry['status'], string> = {
  applied: 'Applied',
  cancelled: 'Cancelled',
  clarification: 'Needs clarification',
  failed: 'Failed',
};

export function AIEngineerPanel({ platform, width, selectedModule, onApplyAction }: AIEngineerPanelProps) {
  const [subView, setSubView] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<AIActionHistoryEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingProposal | null>(null);
  const [resolving, setResolving] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const speech = useSpeechRecognition();

  function appendMessage(role: ChatMessage['role'], text: string) {
    setMessages((current) => [...current, { id: newId('msg'), role, text }]);
  }

  async function handleSend() {
    const message = draft.trim();
    if (!message || sending || pending) return;

    appendMessage('user', message);
    setDraft('');
    setSending(true);

    // Feature 14 V2 — every registered module type is now a potential AI
    // target (the generated capability manifest, not this component,
    // decides which fields are actually editable on it), so context is
    // sent whenever anything is selected — no more type pre-filtering.
    const selectedContext: AICommandSelectedModuleContext | null = selectedModule
      ? { type: selectedModule.type, props: selectedModule.props ?? {} }
      : null;

    try {
      const response = await requestAICommand({
        message,
        selected_module: selectedContext,
        platform,
        width,
      });

      appendMessage('assistant', response.reply);

      if (response.action.type === 'NONE') {
        setHistory((current) => [...current, {
          id: newId('hist'),
          command: message,
          interpretation: response.reply,
          action: response.action,
          status: 'clarification',
          summary: response.reply,
          provider: response.provider,
          requiresConfirmation: false,
        }]);
      } else {
        setPending({
          messageId: newId('proposal'),
          command: message,
          interpretation: response.reply,
          action: response.action,
          requiresConfirmation: response.requires_confirmation,
          provider: response.provider,
          capturedSelectedModuleId: selectedModule?.id ?? null,
        });
      }
    } catch {
      appendMessage('assistant', 'We could not reach the AI Engineer. Please try again.');
      setHistory((current) => [...current, {
        id: newId('hist'),
        command: message,
        interpretation: 'We could not reach the AI Engineer. Please try again.',
        action: { type: 'NONE' },
        status: 'failed',
        summary: 'Request failed',
        provider: 'deterministic',
        requiresConfirmation: false,
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleApply() {
    if (!pending || resolving) return;
    setResolving(true);
    const applied = onApplyAction(pending.action, pending.capturedSelectedModuleId);
    const summary = applied
      ? describeAction(pending.action)
      : 'Could not apply — the canvas selection changed. Please select the module again and retry.';
    appendMessage('assistant', applied ? `Applied: ${summary}` : summary);
    setHistory((current) => [...current, {
      id: newId('hist'),
      command: pending.command,
      interpretation: pending.interpretation,
      action: pending.action,
      status: applied ? 'applied' : 'failed',
      summary,
      provider: pending.provider,
      requiresConfirmation: pending.requiresConfirmation,
    }]);
    setPending(null);
    setResolving(false);
  }

  function handleCancel() {
    if (!pending) return;
    const summary = describeAction(pending.action);
    appendMessage('assistant', 'Cancelled.');
    setHistory((current) => [...current, {
      id: newId('hist'),
      command: pending.command,
      interpretation: pending.interpretation,
      action: pending.action,
      status: 'cancelled',
      summary,
      provider: pending.provider,
      requiresConfirmation: pending.requiresConfirmation,
    }]);
    setPending(null);
  }

  function handleMicClick() {
    if (speech.status === 'listening') {
      speech.stop();
      return;
    }
    speech.start((finalTranscript) => {
      setDraft(finalTranscript);
    });
  }

  const micUnsupported = !isSpeechRecognitionSupported();

  return (
    <div className="ai-engineer-panel">
      <div className="ai-engineer-panel__toolbar">
        <div className="ai-engineer-panel__tabs" role="tablist" aria-label="AI Engineer view">
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'chat'}
            className={subView === 'chat' ? 'ai-engineer-panel__tab ai-engineer-panel__tab--active' : 'ai-engineer-panel__tab'}
            onClick={() => setSubView('chat')}
          >
            <span className="mdaiw-icon mdaiw-icon--ai-assistants" aria-hidden="true" />
            Chat &amp; Voice
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'history'}
            className={subView === 'history' ? 'ai-engineer-panel__tab ai-engineer-panel__tab--active' : 'ai-engineer-panel__tab'}
            onClick={() => setSubView('history')}
          >
            History{history.length > 0 ? ` (${history.length})` : ''}
          </button>
        </div>
      </div>

      {subView === 'chat' ? (
        <div className="ai-engineer-panel__chat">
          <div className="ai-engineer-panel__messages" ref={listRef} role="log" aria-live="polite">
            {messages.length === 0 && !pending && (
              <div className="ai-engineer-panel__empty" role="status">
                <span className="mdaiw-icon mdaiw-icon--ai-assistants" aria-hidden="true" />
                <p>
                  Ask the AI Engineer to add a module, change the selected module&apos;s color/text/size/
                  alignment, delete or duplicate it, or restyle every module of one type. Type a command or
                  press the microphone.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`ai-engineer-panel__message ai-engineer-panel__message--${message.role}`}
              >
                {message.text}
              </div>
            ))}

            {pending && (
              <div
                className={
                  pending.requiresConfirmation
                    ? 'ai-engineer-panel__proposal ai-engineer-panel__proposal--confirm'
                    : 'ai-engineer-panel__proposal'
                }
                role="alert"
              >
                <p className="ai-engineer-panel__proposal-title">
                  {pending.requiresConfirmation && (
                    <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                  )}
                  {describeAction(pending.action)}
                </p>
                <p className="ai-engineer-panel__proposal-detail">{pending.interpretation}</p>
                <div className="ai-engineer-panel__proposal-actions">
                  <button type="button" className="button button--outline" onClick={handleCancel} disabled={resolving}>
                    Cancel
                  </button>
                  <button type="button" className="button button--primary" onClick={handleApply} disabled={resolving}>
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ai-engineer-panel__composer">
            {speech.status === 'error' && speech.errorMessage && (
              <p className="ai-engineer-panel__mic-error" role="alert">{speech.errorMessage}</p>
            )}
            <div className="ai-engineer-panel__composer-row">
              <textarea
                className="ai-engineer-panel__input"
                placeholder="Type your command… e.g. Add a button"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={sending || Boolean(pending)}
                rows={2}
              />
              <button
                type="button"
                className={
                  speech.status === 'listening'
                    ? 'ai-engineer-panel__mic-button ai-engineer-panel__mic-button--listening'
                    : 'ai-engineer-panel__mic-button'
                }
                onClick={handleMicClick}
                disabled={micUnsupported || sending || Boolean(pending)}
                aria-label={speech.status === 'listening' ? 'Stop listening' : 'Talk to the AI Engineer'}
                title={micUnsupported ? 'Voice input is not supported in this browser. You can continue using typed commands.' : undefined}
              >
                <span
                  className={`mdaiw-icon ${speech.status === 'listening' ? 'mdaiw-icon--stop' : 'mdaiw-icon--microphone'}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void handleSend()}
                disabled={sending || Boolean(pending) || !draft.trim()}
              >
                <span className="mdaiw-icon mdaiw-icon--send" aria-hidden="true" />
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
            <p className="ai-engineer-panel__composer-status">
              {micUnsupported && 'Voice input is not supported in this browser. You can continue using typed commands.'}
              {!micUnsupported && speech.status === 'listening' && 'Listening…'}
              {!micUnsupported && speech.status === 'processing' && 'Processing your request…'}
              {!micUnsupported && speech.status === 'idle' && 'This conversation clears when you leave this email.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="ai-engineer-panel__history">
          {history.length === 0 ? (
            <div className="ai-engineer-panel__empty" role="status">
              <span className="mdaiw-icon mdaiw-icon--check-circle" aria-hidden="true" />
              <p>No AI Engineer actions yet this session.</p>
            </div>
          ) : (
            <ul className="ai-engineer-panel__history-list">
              {history.slice().reverse().map((entry) => (
                <li key={entry.id} className="ai-engineer-panel__history-item">
                  <div className="ai-engineer-panel__history-row">
                    <span className={`ai-engineer-panel__history-status ai-engineer-panel__history-status--${entry.status}`}>
                      {HISTORY_STATUS_LABEL[entry.status]}
                    </span>
                    <span className="ai-engineer-panel__history-provider">{entry.provider}</span>
                  </div>
                  <p className="ai-engineer-panel__history-command">&quot;{entry.command}&quot;</p>
                  <p className="ai-engineer-panel__history-summary">{entry.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import { requestAICommand } from '../api/client';
import { isSpeechRecognitionSupported, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  describeAction, DOCUMENT_SCOPE_ACTION_TYPES,
  type AIActionHistoryEntry, type AICommandAction, type AICommandProviderId, type AICommandSelectedModuleContext,
  type RepairActionItem,
} from './aiCommand';
import { detectCustomCssWarnings } from './emailCss';
import { renderEmailDocument } from './htmlRenderer';
import { validateEmail } from './emailValidation';
import { matchDocumentIntent, resolveDocumentIntent } from './aiDocumentIntelligence';
import type { RepairCandidate } from './repairEngine';
import type { EmailDocumentContent, EmailModule } from './edm';
import type { EmailPlatform } from './types';
import type { EmailDocumentSettingsSnapshot } from './useEmailBuilderState';
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
  requiresStrongConfirmation: boolean;
  provider: AICommandProviderId;
  capturedSelectedModuleId: string | null;
}

interface AIEngineerPanelProps {
  platform: EmailPlatform;
  width: number;
  selectedModule: EmailModule | null;
  // Sub-phase 4, item 2 — full module tree + document settings, so this
  // panel can compute the SAME ValidationReport Validation Center shows
  // (validateEmail on the real rendered HTML — item 7: one canonical rule
  // set, never a second opinion) for the diagnose/explain/repair intents
  // below. `content` was not previously threaded here because Phase A/
  // Sub-phase 2/3's AI actions never needed the full document, only the
  // selected module and document CSS state.
  content: EmailDocumentContent;
  emailTitle: string;
  emailSubject: string;
  faviconUrl: string;
  // Sub-phase 2, item F — current document CSS state, read-only here,
  // used only to render the proposal's "current" side of the diff view.
  resetCssEnabled: boolean;
  customCssEnabled: boolean;
  customCss: string;
  // Applies the action through the existing builder mutation functions
  // (see EmailBuilderWorkspacePage.handleApplyAiAction). Returns false
  // when the action could not be safely applied — e.g. the canvas
  // selection changed after the proposal was made — so the panel can
  // report an honest outcome instead of claiming success.
  onApplyAction: (action: AICommandAction, capturedSelectedModuleId: string | null) => boolean;
  // Document-level (Reset/Custom CSS/title/subject/favicon) actions PATCH
  // the EmailDocument through the API — genuinely async, unlike
  // onApplyAction above, which only ever mutates local, already-loaded
  // EDM state synchronously. Rejects on a failed PATCH so the panel can
  // report a real failure.
  onApplyDocumentSettingAction: (action: AICommandAction) => Promise<boolean>;
  // Sub-phase 4, item 4 — the Repair Engine's batched Apply: every item
  // (module-scope or document-scope) commits through
  // builder.applyRepairPatch in ONE history step. Never fails (a local
  // commit cannot fail), kept synchronous/boolean for symmetry with
  // onApplyAction.
  onApplyRepairAction: (items: RepairActionItem[]) => boolean;
}

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

interface CssProposalDetails {
  current: string;
  proposed: string;
  affectedClients: string;
  warnings: ReturnType<typeof detectCustomCssWarnings>;
}

// Item F's proposal card fields (current/proposed/affected clients/
// warnings), extended in Sub-phase 4 to cover title/subject/favicon too —
// built entirely from data already in this component (current document
// state via props, the proposed value from the action itself), no extra
// request.
function cssProposalDetails(
  action: AICommandAction, resetCssEnabled: boolean, customCssEnabled: boolean, customCss: string,
  emailTitle: string, emailSubject: string, faviconUrl: string,
): CssProposalDetails | null {
  switch (action.type) {
    case 'SET_EMAIL_TITLE':
      return {
        current: emailTitle.trim() || '(empty)',
        proposed: action.title,
        affectedClients: 'Browser tabs and clients that display the document <title>.',
        warnings: [],
      };
    case 'SET_EMAIL_SUBJECT':
      return {
        current: emailSubject.trim() || '(empty)',
        proposed: action.subject,
        affectedClients: 'Send/document metadata — never rendered into the email HTML.',
        warnings: [],
      };
    case 'SET_FAVICON':
      return {
        current: faviconUrl.trim() || '(empty)',
        proposed: action.url,
        affectedClients: 'Clients/browser tabs that display a favicon link.',
        warnings: [],
      };
    case 'CLEAR_FAVICON':
      return {
        current: faviconUrl.trim() || '(empty)',
        proposed: '(empty)',
        affectedClients: 'N/A — removes the favicon entirely.',
        warnings: [],
      };
    case 'SET_RESET_CSS_ENABLED':
      return {
        current: resetCssEnabled ? 'Enabled' : 'Disabled',
        proposed: action.enabled ? 'Enabled' : 'Disabled',
        affectedClients: 'All email clients (this is the compatibility baseline).',
        warnings: [],
      };
    case 'SET_CUSTOM_CSS_ENABLED':
      return {
        current: customCssEnabled ? 'Enabled' : 'Disabled',
        proposed: action.enabled ? 'Enabled' : 'Disabled',
        affectedClients: 'Any client rendering this document\'s Custom CSS.',
        warnings: [],
      };
    case 'SET_CUSTOM_CSS':
      return {
        current: customCss.trim() || '(empty)',
        proposed: action.css,
        affectedClients: 'Depends on the selectors used — see warnings below, if any.',
        warnings: detectCustomCssWarnings(action.css),
      };
    case 'CLEAR_CUSTOM_CSS':
      return {
        current: customCss.trim() || '(empty)',
        proposed: '(empty)',
        affectedClients: 'N/A — removes Custom CSS entirely.',
        warnings: [],
      };
    default:
      return null;
  }
}

const HISTORY_STATUS_LABEL: Record<AIActionHistoryEntry['status'], string> = {
  applied: 'Applied',
  cancelled: 'Cancelled',
  clarification: 'Needs clarification',
  failed: 'Failed',
  reported: 'Reported',
};

interface PendingRepairProposal {
  messageId: string;
  command: string;
  candidates: RepairCandidate[];
}

export function AIEngineerPanel({
  platform, width, selectedModule, content, emailTitle, emailSubject, faviconUrl,
  resetCssEnabled, customCssEnabled, customCss,
  onApplyAction, onApplyDocumentSettingAction, onApplyRepairAction,
}: AIEngineerPanelProps) {
  const [subView, setSubView] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<AIActionHistoryEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingProposal | null>(null);
  // Sub-phase 4, item 4 — a SEPARATE pending state from the backend-
  // routed `pending` above: a repair proposal is a LIST of items (each
  // possibly module- or document-scoped), never a single AICommandAction,
  // so it renders and applies differently (see the repair proposal card
  // below and handleApplyRepair).
  const [pendingRepair, setPendingRepair] = useState<PendingRepairProposal | null>(null);
  const [resolving, setResolving] = useState(false);
  // Item F — "require stronger confirmation than a trivial property
  // change" for a substantial Custom CSS replacement: Apply stays
  // disabled until this explicit checkbox is checked, on top of the
  // ordinary Apply click every proposal already requires.
  const [strongConfirmChecked, setStrongConfirmChecked] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const speech = useSpeechRecognition();

  // Sub-phase 4, item 2/7 — the SAME validateEmail() call Validation
  // Center makes, over the SAME rendered HTML — one canonical report, so
  // an AI Engineer diagnosis can never disagree with what Validation
  // Center itself shows. Recomputes whenever the document actually
  // changes, exactly like ValidationCenterPanel's own useMemo.
  const documentSettings: EmailDocumentSettingsSnapshot = useMemo(() => ({
    email_title: emailTitle, email_subject: emailSubject, favicon_url: faviconUrl,
    reset_css_enabled: resetCssEnabled, custom_css_enabled: customCssEnabled, custom_css: customCss,
  }), [emailTitle, emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss]);

  const validationReport = useMemo(() => {
    try {
      const html = renderEmailDocument({
        width, content, title: emailTitle, faviconUrl,
        resetCssEnabled, customCssEnabled, customCss,
      });
      return validateEmail(html, content, platform, {
        emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss,
      });
    } catch {
      return null;
    }
  }, [width, content, platform, emailTitle, emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss]);

  function appendMessage(role: ChatMessage['role'], text: string) {
    setMessages((current) => [...current, { id: newId('msg'), role, text }]);
  }

  async function handleSend() {
    const message = draft.trim();
    if (!message || sending || pending || pendingRepair) return;

    appendMessage('user', message);
    setDraft('');

    // Sub-phase 4, item 2/4 — document-level diagnose/explain/repair
    // intents are recognized and answered ENTIRELY LOCALLY, before ever
    // reaching the backend: only this component has a live
    // ValidationReport, and routing these through the network would mean
    // either duplicating validation rules server-side (item 7 forbids a
    // second rule set) or sending the whole rendered HTML over the wire
    // for no benefit. An unmatched message falls through unchanged to the
    // normal backend-routed command flow below — module/CSS/title/
    // subject/favicon commands are entirely unaffected by this addition.
    const intentMatch = matchDocumentIntent(message);
    if (intentMatch && validationReport) {
      const result = resolveDocumentIntent(intentMatch, validationReport, content.modules, documentSettings);
      appendMessage('assistant', result.reply);
      if (result.repairCandidates && result.repairCandidates.length > 0) {
        setPendingRepair({ messageId: newId('repair'), command: message, candidates: result.repairCandidates });
      } else {
        setHistory((current) => [...current, {
          id: newId('hist'),
          command: message,
          interpretation: result.reply,
          action: { type: 'NONE' },
          status: 'reported',
          summary: result.reply,
          provider: 'deterministic',
          requiresConfirmation: false,
        }]);
      }
      return;
    }

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
        setStrongConfirmChecked(false);
        setPending({
          messageId: newId('proposal'),
          command: message,
          interpretation: response.reply,
          action: response.action,
          requiresConfirmation: response.requires_confirmation,
          requiresStrongConfirmation: response.requires_strong_confirmation,
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

  async function handleApply() {
    if (!pending || resolving) return;
    if (pending.requiresStrongConfirmation && !strongConfirmChecked) return;
    setResolving(true);

    const isDocumentAction = DOCUMENT_SCOPE_ACTION_TYPES.has(pending.action.type);
    let applied: boolean;
    let summary: string;
    if (isDocumentAction) {
      applied = await onApplyDocumentSettingAction(pending.action);
      summary = applied
        ? describeAction(pending.action)
        : 'Could not apply — saving to the server failed. Please try again.';
    } else {
      applied = onApplyAction(pending.action, pending.capturedSelectedModuleId);
      summary = applied
        ? describeAction(pending.action)
        : 'Could not apply — the canvas selection changed. Please select the module again and retry.';
    }

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
    setStrongConfirmChecked(false);
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
    setStrongConfirmChecked(false);
  }

  // Sub-phase 4, item 4 — Apply for a repair proposal: every candidate's
  // item (module- or document-scoped) is handed to
  // onApplyRepairAction/builder.applyRepairPatch in ONE call, so the
  // whole batch commits as a single undo step, then Validation Center's
  // own useMemo automatically recomputes on the next render (this
  // component's own `validationReport` recomputes too — no manual
  // "revalidate" call needed).
  function handleApplyRepair() {
    if (!pendingRepair || resolving) return;
    setResolving(true);
    const items = pendingRepair.candidates.map((candidate) => candidate.item);
    const applied = onApplyRepairAction(items);
    const summary = applied
      ? `Repaired ${items.length} issue${items.length === 1 ? '' : 's'}.`
      : 'Could not apply the repair. Please try again.';
    appendMessage('assistant', summary);
    setHistory((current) => [...current, {
      id: newId('hist'),
      command: pendingRepair.command,
      interpretation: summary,
      action: { type: 'REPAIR_ISSUES', items },
      status: applied ? 'applied' : 'failed',
      summary,
      provider: 'deterministic',
      requiresConfirmation: true,
    }]);
    setPendingRepair(null);
    setResolving(false);
  }

  function handleCancelRepair() {
    if (!pendingRepair) return;
    appendMessage('assistant', 'Cancelled. Nothing was changed.');
    setHistory((current) => [...current, {
      id: newId('hist'),
      command: pendingRepair.command,
      interpretation: 'Repair proposal cancelled.',
      action: { type: 'REPAIR_ISSUES', items: pendingRepair.candidates.map((c) => c.item) },
      status: 'cancelled',
      summary: 'Cancelled.',
      provider: 'deterministic',
      requiresConfirmation: true,
    }]);
    setPendingRepair(null);
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
            {messages.length === 0 && !pending && !pendingRepair && (
              <div className="ai-engineer-panel__empty" role="status">
                <span className="mdaiw-icon mdaiw-icon--ai-assistants" aria-hidden="true" />
                <p>
                  Ask the AI Engineer to add a module, change the selected module&apos;s color/text/size/
                  alignment, delete or duplicate it, restyle every module of one type, enable/disable Email
                  Reset CSS and set/remove Custom CSS, change the title/subject/favicon, diagnose Outlook
                  compatibility ("check this email for Classic Outlook issues"), or repair safe issues
                  ("repair all safe issues"). Type a command or press the microphone.
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

            {pending && (() => {
              const cssDetails = cssProposalDetails(
                pending.action, resetCssEnabled, customCssEnabled, customCss, emailTitle, emailSubject, faviconUrl,
              );
              const applyBlocked = resolving || (pending.requiresStrongConfirmation && !strongConfirmChecked);
              return (
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

                  {cssDetails && (
                    <div className="ai-engineer-panel__proposal-css">
                      <div className="ai-engineer-panel__proposal-css-column">
                        <span className="ai-engineer-panel__proposal-css-label">Current</span>
                        <pre>{cssDetails.current}</pre>
                      </div>
                      <div className="ai-engineer-panel__proposal-css-column">
                        <span className="ai-engineer-panel__proposal-css-label">Proposed</span>
                        <pre>{cssDetails.proposed}</pre>
                      </div>
                      <p className="ai-engineer-panel__proposal-affected">
                        <strong>Affected clients:</strong> {cssDetails.affectedClients}
                      </p>
                      {cssDetails.warnings.length > 0 && (
                        <ul className="ai-engineer-panel__proposal-warnings">
                          {cssDetails.warnings.map((warning) => (
                            <li key={`${warning.selector}-${warning.property}`}>{warning.message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {pending.requiresStrongConfirmation && (
                    <label className="ai-engineer-panel__strong-confirm">
                      <input
                        type="checkbox"
                        checked={strongConfirmChecked}
                        onChange={(event) => setStrongConfirmChecked(event.target.checked)}
                      />
                      I understand this replaces a substantial amount of Custom CSS.
                    </label>
                  )}

                  <div className="ai-engineer-panel__proposal-actions">
                    <button type="button" className="button button--outline" onClick={handleCancel} disabled={resolving}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => void handleApply()}
                      disabled={applyBlocked}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              );
            })()}

            {pendingRepair && (
              <div className="ai-engineer-panel__proposal ai-engineer-panel__proposal--confirm" role="alert">
                <p className="ai-engineer-panel__proposal-title">
                  <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                  {pendingRepair.candidates.length === 1 ? 'Repair 1 issue' : `Repair ${pendingRepair.candidates.length} issues`}
                </p>
                <ul className="ai-engineer-panel__repair-list">
                  {pendingRepair.candidates.map((candidate) => (
                    <li key={candidate.issueId} className="ai-engineer-panel__repair-item">
                      <p className="ai-engineer-panel__repair-item-title">{candidate.title}</p>
                      <p className="ai-engineer-panel__repair-item-detail">{candidate.detail}</p>
                      <dl className="ai-engineer-panel__repair-item-meta">
                        <div>
                          <dt>Affected</dt>
                          <dd>{candidate.affectedClient}</dd>
                        </div>
                        <div>
                          <dt>Severity</dt>
                          <dd>{candidate.severity}</dd>
                        </div>
                        <div>
                          <dt>Before</dt>
                          <dd>{candidate.before}</dd>
                        </div>
                        <div>
                          <dt>After</dt>
                          <dd>{candidate.after}</dd>
                        </div>
                        <div>
                          <dt>Confidence</dt>
                          <dd>{Math.round(candidate.confidence * 100)}%</dd>
                        </div>
                        <div>
                          <dt>Fix type</dt>
                          <dd>Safe automatic fix</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
                <div className="ai-engineer-panel__proposal-actions">
                  <button type="button" className="button button--outline" onClick={handleCancelRepair} disabled={resolving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={handleApplyRepair}
                    disabled={resolving}
                  >
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
                disabled={sending || Boolean(pending) || Boolean(pendingRepair)}
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
                disabled={micUnsupported || sending || Boolean(pending) || Boolean(pendingRepair)}
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
                disabled={sending || Boolean(pending) || Boolean(pendingRepair) || !draft.trim()}
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

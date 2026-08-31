import { useEffect, useMemo, useRef, useState } from 'react';
import { requestAICommand } from '../api/client';
import { isSpeechRecognitionSupported, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { isSpeechSynthesisSupported, useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  describeAction, DOCUMENT_SCOPE_ACTION_TYPES,
  type AIActionHistoryEntry, type AICommandAction, type AICommandImportReconstructionContext,
  type AICommandProviderId, type AICommandSelectedModuleContext, type RepairActionItem,
} from './aiCommand';
import { detectCustomCssWarnings } from './emailCss';
import { renderEmailDocument } from './htmlRenderer';
import { validateEmail } from './emailValidation';
import { matchDocumentIntent, resolveDocumentIntent } from './aiDocumentIntelligence';
import { affectedClientLabel, signatureForIssueId, type RepairCandidate } from './repairEngine';
import { createConsumedHandoffTracker, type AIEngineerHandoff } from './aiEngineerHandoff';
import { formatReconstructionReviewMessage } from './reconstructionReview';
import { clearLearnedRepairSignals, newLearningEventId, recordRepairSignal } from './learningSignals';
import { findModuleById } from './layoutModel';
import { resolveReference, type LastReferent } from './referenceResolver';
import { FIDELITY_CATEGORY_ORDER } from './htmlImportFidelity';
import {
  boundedHistoryForRequest, clearConversation, loadConversation, saveConversation,
  type StoredConversationMessage,
} from './aiConversationStorage';
import { speakableSummary } from './aiSpeech';
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
  // E10 — the conversation persists per-document, keyed by this id. Never
  // used for anything else (no network call keys on it beyond the AI
  // command request's own document-agnostic shape).
  documentId: number;
  // E9 — which top-level tab the user is currently on. Threaded through so
  // both the local intent layer (aiDocumentIntelligence.ts) and the
  // backend-routed request can answer "what am I looking at"-style
  // questions without guessing.
  editorMode: string;
  platform: EmailPlatform;
  width: number;
  selectedModule: EmailModule | null;
  // E9 — informational context only (see the module docstring on
  // AIEditorContext below for why this does not yet drive a real
  // column-scoped edit action).
  selectedColumn: { layoutId: string; columnId: string } | null;
  // E7 -> E9/E10 cross-feature integration — a one-shot handoff created
  // when the user clicks "Ask AI Engineer"/"Review N more with AI
  // Engineer" in Validation Center. Consumed here by id via
  // onConsumeAiEngineerHandoff (the caller's own idempotency tracker,
  // which survives this panel's own mount/unmount — see
  // aiEngineerHandoff.ts's module docstring for why that ownership
  // matters), then reported back via onHandoffConsumed. If the caller
  // omits onConsumeAiEngineerHandoff, this panel falls back to a
  // same-instance ref guard — safe for a standalone render (e.g. tests)
  // but NOT a substitute for the caller-owned tracker across a real
  // remount; production always wires the real one.
  aiEngineerHandoff?: AIEngineerHandoff | null;
  onConsumeAiEngineerHandoff?: (handoffId: string) => boolean;
  onHandoffConsumed?: () => void;
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
  outlookVml?: boolean;
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

// Sub-phase 7 — one readable line per top-level composition item, so the
// proposal card shows enough for the user to understand what will be
// created BEFORE Apply (master-prompt "proposal-before-apply" contract),
// without needing the full module registry client-side just to render a
// human label — the raw module_type string plus nested/list-item counts
// is honest and sufficient (Applying still shows the real result on the
// canvas immediately after).
function compositionSummaryLines(action: AICommandAction): string[] | null {
  if (action.type !== 'COMPOSE_EMAIL') return null;
  return action.items.map((item, index) => {
    const nestedCount = item.children?.reduce((sum, group) => sum + group.modules.length, 0) ?? 0;
    const listItemCount = item.repeatable_items?.length ?? 0;
    let line = `${index + 1}. ${item.module_type}`;
    if (nestedCount > 0) line += ` — ${nestedCount} nested module${nestedCount === 1 ? '' : 's'}`;
    if (listItemCount > 0) line += ` — ${listItemCount} list item${listItemCount === 1 ? '' : 's'}`;
    return line;
  });
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
  documentId, editorMode, platform, width, selectedModule, selectedColumn, content,
  emailTitle, emailSubject, faviconUrl,
  resetCssEnabled, customCssEnabled, customCss, outlookVml,
  aiEngineerHandoff, onConsumeAiEngineerHandoff, onHandoffConsumed,
  onApplyAction, onApplyDocumentSettingAction, onApplyRepairAction,
}: AIEngineerPanelProps) {
  const [subView, setSubView] = useState<'chat' | 'history'>('chat');
  // E10 — LAZY initial state, loaded synchronously from THIS document's
  // persisted conversation before the first render ever paints. This is
  // deliberate, not just an optimization: an effect-based load (setState
  // AFTER mount) would leave one render where `messages` is still `[]`,
  // during which a naive "save on every messages change" effect could
  // read that stale empty array and overwrite the real persisted data
  // before the load's own update had a chance to apply — see
  // appendMessage below for how persistence is done instead (no separate
  // reactive save effect at all, so this race cannot happen).
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => loadConversation(documentId).map((entry) => ({ id: newId('msg'), role: entry.role, text: entry.text })),
  );
  const [history, setHistory] = useState<AIActionHistoryEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // R4-B2 §24 — "In AI Engineer, later expose a subtle status: Local AI
  // when the local intelligence engine is active." Deliberately just the
  // last-seen provider id from an actual backend response, not a
  // separate "which provider is configured" query — matches what
  // literally just answered, and stays accurate even if the deployment's
  // provider config changes mid-session (falls back mid-conversation,
  // for example). Never shown for 'deterministic' or 'openai' — only
  // 'local' gets a badge, per spec; no model/runtime details here (those
  // belong in admin/settings diagnostics, never this conversation view).
  const [lastProvider, setLastProvider] = useState<AICommandProviderId | null>(null);
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
  // Sub-phase 8 — "Clear learned preferences." Confirmed (this deletes
  // real rows), separate from the action History list above (that's this
  // session's chat/repair log; this clears the durable per-user ranking
  // data across ALL sessions).
  const [showClearLearningConfirm, setShowClearLearningConfirm] = useState(false);
  const [clearingLearning, setClearingLearning] = useState(false);
  const [clearLearningNotice, setClearLearningNotice] = useState<string | null>(null);

  const speech = useSpeechRecognition();
  // E11 — voice OUTPUT (reading replies aloud), a distinct hook/concern
  // from `speech` above (voice INPUT/dictation). Same shared hook every
  // other spoken-response surface in this app already uses (Yukti) — see
  // useSpeechSynthesis.ts's own docstring; never a second speech library.
  const voice = useSpeechSynthesis();
  const voiceSupported = isSpeechSynthesisSupported();

  // E10 — "last discussed" validation issue, so a bare follow-up like
  // "can you fix it?" right after "explain this issue" can resolve "it"
  // deterministically — see handleSend's local-intent branch below. This
  // is a genuinely bounded, real mechanism (not a claim that the
  // deterministic router understands arbitrary pronoun reference); it
  // resets whenever a fresh handoff issueId arrives or the document
  // changes.
  // A plain ref, not React state: nothing in this component's JSX
  // displays it, and handleSend() is sometimes invoked in the SAME tick
  // as a change to it (the handoff-consuming effect below) — React state
  // updates are async/batched, so a ref is what guarantees handleSend
  // always reads the value that was JUST set, not a stale one.
  const lastDiscussedIssueIdRef = useRef<string | null>(aiEngineerHandoff?.issueId ?? null);
  function setLastDiscussedIssueId(id: string | null) {
    lastDiscussedIssueIdRef.current = id;
  }

  // R4-B2 §12 — the SAME reason lastDiscussedIssueIdRef is a ref, not
  // state: kept alive for the WHOLE conversation (every requestAICommand
  // call for this document), not just the one-shot handoff moment — the
  // handoff itself is consumed and cleared after the first turn, but a
  // follow-up two turns later ("why was the ratio approximated?") still
  // needs this to answer with real grounding instead of a generic
  // fallback. Initialized from the handoff synchronously (same StrictMode-
  // safety reasoning as lastDiscussedIssueIdRef's own init).
  const importReconstructionContextRef = useRef<AICommandImportReconstructionContext | null>(
    aiEngineerHandoff?.importReconstructionContext ?? null,
  );

  // R4-B3 §B/§F — Referential Context Resolver's own memory: which
  // reconstruction fidelity category was last discussed (feeds the
  // resolver's priority chain for a bare "it"/"fix it" follow-up), and
  // the generic "whatever we were just talking about" referent (the
  // resolver's own lowest-priority fallback, one level more specific
  // than "nothing at all"). Both refs, not state, for the same reason
  // lastDiscussedIssueIdRef is a ref — read synchronously within the
  // same handleSend tick that sets them.
  const lastDiscussedReconstructionCategoryRef = useRef<string | null>(null);
  const lastReferentRef = useRef<LastReferent | null>(null);
  // R4-B3 §B — when the resolver identifies a referent that differs from
  // the LIVE canvas selection (e.g. "that button" resolved to the
  // document's only button module while nothing is actually selected),
  // this carries the resolved module's {type, props} for exactly one
  // outgoing request — read once building selectedContext below, then
  // cleared. Never persisted longer than one turn: the live selection
  // (or the next resolution) is always the source of truth after that.
  const resolvedModuleOverrideRef = useRef<AICommandSelectedModuleContext | null>(null);

  // C-3 remediation — explicit pending-repair context for the placeholder-
  // link conversational flow: which real module (never "whatever's
  // currently selected") is awaiting a destination URL, so a later bare
  // URL reply is understood as the answer to THIS specific repair rather
  // than re-guessed from scratch or applied to the wrong module when
  // several placeholder links exist. A plain ref for the same reason
  // lastDiscussedIssueIdRef is a ref, not state (see above) — set/read
  // synchronously within the same handleSend invocation's tick.
  const pendingPlaceholderLinkModuleIdRef = useRef<string | null>(null);
  // The exact sentinel ai_command.py's placeholder-link handler always
  // uses when it declines to invent a URL — see
  // "I won't guess a destination for this link" in ai_command.py.
  const PLACEHOLDER_LINK_ASK_SENTINEL = "won't guess a destination for this link";
  // Any scheme://... token — deliberately not http(s)-only here, so a
  // rejected scheme (e.g. javascript:) still gets a clear "not allowed"
  // reply instead of the generic "no URL found" one.
  const URL_TOKEN_PATTERN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/;

  // E10 — reload when `documentId` changes on an ALREADY-MOUNTED instance
  // (e.g. the URL's document id changes via client-side routing while the
  // AI Engineer tab stays open the whole time — the one realistic case
  // the lazy initial state above does NOT cover, since that only runs
  // once per component instance). Explicitly skips the very first render
  // via the ref below — that case is already handled by the lazy initial
  // state, and re-running this here too would just be a redundant,
  // harmless-but-wasteful reload, not a bug — the guard keeps intent
  // clear: this effect's job is CHANGE handling, not initial load.
  const previousDocumentIdRef = useRef(documentId);
  useEffect(() => {
    if (previousDocumentIdRef.current === documentId) return;
    previousDocumentIdRef.current = documentId;
    const stored = loadConversation(documentId);
    setMessages(stored.map((entry) => ({ id: newId('msg'), role: entry.role, text: entry.text })));
    setLastDiscussedIssueId(null);
    pendingPlaceholderLinkModuleIdRef.current = null;
    importReconstructionContextRef.current = null;
    lastDiscussedReconstructionCategoryRef.current = null;
    lastReferentRef.current = null;
    resolvedModuleOverrideRef.current = null;
    setHistory([]);
    setLastProvider(null);
  }, [documentId]);

  function handleClearConversation() {
    clearConversation(documentId);
    setMessages([]);
    setLastDiscussedIssueId(null);
    pendingPlaceholderLinkModuleIdRef.current = null;
    voice.cancel();
  }

  // Same-instance fallback guard ONLY — used when the caller doesn't wire
  // onConsumeAiEngineerHandoff (e.g. a standalone test render). This ref
  // is reset on every remount, so it does NOT protect against a real
  // AIEngineerPanel unmount/remount (tab switch) the way the caller's own
  // tracker does — see aiEngineerHandoff.ts's module docstring. Production
  // (EmailBuilderWorkspacePage) always passes the real tracker.
  const fallbackConsumedHandoffTrackerRef = useRef(createConsumedHandoffTracker());

  // E7 -> E9/E10 cross-feature integration — a one-shot handoff arriving
  // from Validation Center's "Ask AI Engineer"/"Review N more with AI
  // Engineer" is sent as the first user turn EXACTLY once, then reported
  // back as consumed. Consumption is guarded by the handoff's own unique
  // id (never by message text — a user may legitimately send the same
  // text twice) via onConsumeAiEngineerHandoff, a compare-and-swap that
  // returns true only for the very first caller to see this id. This is
  // what makes the effect body safe under React StrictMode's dev-only
  // double-invocation of a mount's effects: both invocations run
  // synchronously against the SAME tracker (no re-render needed in
  // between, unlike clearing state), so only the first can ever pass.
  // issueId (when present) is applied first so the seeded message's own
  // local-intent match (if it matches 'explain-selected-issue'-style
  // phrasing) already has the right issue in context.
  useEffect(() => {
    const handoff = aiEngineerHandoff;
    if (!handoff) return;
    if (handoff.documentId !== documentId) return; // a different document's handoff can never be consumed here
    const tryConsume = onConsumeAiEngineerHandoff
      ?? ((id: string) => fallbackConsumedHandoffTrackerRef.current.tryConsume(id));
    if (!tryConsume(handoff.id)) return; // already consumed — StrictMode's second invoke, or a stale remount
    if (handoff.issueId) setLastDiscussedIssueId(handoff.issueId);
    if (handoff.importReconstructionContext) importReconstructionContextRef.current = handoff.importReconstructionContext;
    // R4-B — import-reconstruction handoffs never call the backend for
    // their first turn: the classification is already fully deterministic
    // (§4 — "AI may interpret but must NOT contradict high-confidence
    // deterministic detection"), so the assistant's opening reply is
    // rendered straight from formatReconstructionReviewMessage() instead of
    // handleSend()'s normal requestAICommand() round trip. This also keeps
    // §2's "never a JSON/technical dump" guarantee — the message is the
    // same professional-prose summary a human reviewer would get.
    if (handoff.source === 'import-reconstruction' && handoff.reconstructionReview) {
      appendMessage('user', handoff.prompt);
      appendMessage('assistant', formatReconstructionReviewMessage(handoff.reconstructionReview));
    } else {
      void handleSend(handoff.prompt);
    }
    onHandoffConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per new handoff object only; the id-based tryConsume guard above (not this dependency array) is what makes re-invocation safe
  }, [aiEngineerHandoff]);

  // Sub-phase 4, item 2/7 — the SAME validateEmail() call Validation
  // Center makes, over the SAME rendered HTML — one canonical report, so
  // an AI Engineer diagnosis can never disagree with what Validation
  // Center itself shows. Recomputes whenever the document actually
  // changes, exactly like ValidationCenterPanel's own useMemo.
  const documentSettings: EmailDocumentSettingsSnapshot = useMemo(() => ({
    email_title: emailTitle, email_subject: emailSubject, favicon_url: faviconUrl,
    reset_css_enabled: resetCssEnabled, custom_css_enabled: customCssEnabled, custom_css: customCss,
    outlook_vml_enabled: outlookVml ?? false,
  }), [emailTitle, emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss, outlookVml]);

  const validationReport = useMemo(() => {
    try {
      const html = renderEmailDocument({
        width, content, title: emailTitle, faviconUrl,
        resetCssEnabled, customCssEnabled, customCss, outlookVml,
      });
      return validateEmail(html, content, platform, {
        emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss,
      });
    } catch {
      return null;
    }
  }, [width, content, platform, emailTitle, emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss, outlookVml]);

  function appendMessage(role: ChatMessage['role'], text: string) {
    setMessages((current) => {
      const next = [...current, { id: newId('msg'), role, text }];
      // E10 — persisted HERE, inside the functional updater, rather than
      // a separate reactive "save on messages change" effect — this is
      // the ONE place that always has the true, up-to-date next array,
      // with no possible race against a stale/pre-load render (see the
      // lazy initial-state docstring above for the exact race this
      // avoids).
      const forStorage: StoredConversationMessage[] = next.map((m) => ({ role: m.role, text: m.text }));
      saveConversation(documentId, forStorage);
      return next;
    });
    // E11 — every assistant reply is a candidate for voice output, in
    // exactly ONE place, so no call site has to remember to speak. New
    // speech interrupts old speech automatically (useSpeechSynthesis's
    // speak() cancels before speaking) and stops on unmount/navigation
    // (the hook's own cleanup effect) — nothing extra needed here.
    if (role === 'assistant' && voiceSupported && !voice.muted) {
      const spoken = speakableSummary(text);
      if (spoken) voice.speak(spoken);
    }
  }

  async function handleSend(overrideMessage?: string) {
    const message = (overrideMessage ?? draft).trim();
    if (!message || sending || pending || pendingRepair) return;

    appendMessage('user', message);
    if (overrideMessage === undefined) setDraft('');

    // C-3 remediation — a placeholder-link repair is currently pending
    // (the AI already declined to invent a URL and asked for one): this
    // message is understood as the answer to THAT specific repair —
    // targeting the real moduleId captured when the question was asked,
    // never whatever happens to be selected on canvas now — rather than
    // being re-routed through local-intent matching or the backend (which
    // has no memory of this conversation's pending question). Checked
    // before everything else in this function.
    if (pendingPlaceholderLinkModuleIdRef.current) {
      const moduleId = pendingPlaceholderLinkModuleIdRef.current;
      const urlToken = message.match(URL_TOKEN_PATTERN);

      if (!urlToken) {
        // Explicit cancel/new-topic escape — without this, any message
        // that isn't a URL would trap the conversation forever demanding
        // one. Clears the pending repair; a genuine new command in the
        // same message is not re-processed this turn (kept simple and
        // predictable) — the user can just send it again.
        if (/\b(cancel|never\s*mind|forget\s+it|skip|stop)\b/i.test(message)) {
          pendingPlaceholderLinkModuleIdRef.current = null;
          appendMessage('assistant', 'No problem — that link repair is no longer pending.');
        } else {
          appendMessage(
            'assistant',
            "I still need a destination URL for that link — please send a full https:// (or http://) address, "
            + 'or say "cancel" to drop it.',
          );
        }
        return;
      }

      const candidateUrl = urlToken[0].replace(/[)\].,;:!?'"]+$/, '');
      if (!/^https?:\/\//i.test(candidateUrl)) {
        // Invalid scheme (e.g. javascript:) — reject and keep the
        // pending repair armed so the user can retry with a real URL.
        appendMessage(
          'assistant',
          `"${candidateUrl}" isn't an allowed link type — please provide a full https:// (or http://) URL.`,
        );
        return;
      }

      const targetModule = findModuleById(content.modules, moduleId);
      const moduleProps = (targetModule?.props ?? {}) as Record<string, unknown>;
      const propKey = (['href', 'ctaHref'] as const).find((key) => {
        const value = moduleProps[key];
        return typeof value === 'string' && (value.trim() === '' || value.trim() === '#');
      }) ?? 'href';
      const beforeValue = moduleProps[propKey];
      const candidate: RepairCandidate = {
        issueId: 'links:placeholder-href',
        title: 'Placeholder link',
        detail: `Set the link to ${candidateUrl}.`,
        severity: 'error',
        category: 'links',
        affectedClient: affectedClientLabel('links:placeholder-href'),
        moduleId,
        before: typeof beforeValue === 'string' && beforeValue.trim() !== '' ? beforeValue : '(empty)',
        after: candidateUrl,
        confidence: 1.0,
        safeAutoFix: true,
        item: { kind: 'module', issueId: 'links:placeholder-href', moduleId, propPatch: { [propKey]: candidateUrl } },
      };
      pendingPlaceholderLinkModuleIdRef.current = null;
      appendMessage('assistant', `Got it — I will set the link to ${candidateUrl}. Review the proposed change below.`);
      setPendingRepair({ messageId: newId('repair'), command: message, candidates: [candidate] });
      return;
    }

    // Sub-phase 4, item 2/4 (extended E9/E10) — document-level diagnose/
    // explain/repair/context intents are recognized and answered ENTIRELY
    // LOCALLY, before ever reaching the backend: only this component has
    // a live ValidationReport, and routing these through the network
    // would mean either duplicating validation rules server-side (item 7
    // forbids a second rule set) or sending the whole rendered HTML over
    // the wire for no benefit. An unmatched message falls through
    // unchanged to the normal backend-routed command flow below —
    // module/CSS/title/subject/favicon commands are entirely unaffected.
    const intentMatch = matchDocumentIntent(message);
    if (intentMatch && validationReport) {
      const selectedIssue = lastDiscussedIssueIdRef.current
        ? validationReport.issues.find((issue) => issue.id === lastDiscussedIssueIdRef.current) ?? null
        : null;
      const result = resolveDocumentIntent(intentMatch, validationReport, content.modules, documentSettings, {
        editorMode, selectedModule, selectedValidationIssue: selectedIssue,
      });
      appendMessage('assistant', result.reply);
      if (intentMatch.kind === 'explain-selected-issue' && selectedIssue) {
        setLastDiscussedIssueId(selectedIssue.id);
      }
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

    // R4-B3 §B — the Referential Context Resolver, run entirely locally
    // BEFORE any backend call. A genuinely ambiguous reference (more
    // than one real candidate, and none is the current selection) is
    // answered with a concise clarifying question right here — no
    // wasted round trip, no risk of the backend/LLM silently guessing
    // wrong. An unambiguous reference is folded into the outgoing
    // request's context below (resolvedModuleOverrideRef / setLast-
    // DiscussedIssueId) so the provider answers with real grounding
    // instead of generic language. A message with no referring
    // expression at all (the common case) passes through unchanged.
    const resolverLayoutModule = selectedColumn ? findModuleById(content.modules, selectedColumn.layoutId) : null;
    const resolverColumnIndex = resolverLayoutModule?.columns?.findIndex((c) => c.id === selectedColumn?.columnId) ?? -1;
    const referentialResolution = resolveReference({
      message,
      modules: content.modules,
      selectedModule: selectedModule ? { id: selectedModule.id, type: selectedModule.type, label: `the selected ${selectedModule.type} module` } : null,
      selectedColumn: resolverLayoutModule && resolverColumnIndex >= 0
        ? { layoutModuleId: resolverLayoutModule.id, layoutModuleType: resolverLayoutModule.type, columnIndex: resolverColumnIndex }
        : null,
      lastDiscussedValidationIssue: lastDiscussedIssueIdRef.current
        ? (() => {
            const issue = validationReport?.issues.find((i) => i.id === lastDiscussedIssueIdRef.current);
            return issue ? { id: issue.id, title: issue.title, category: issue.category } : null;
          })()
        : null,
      openValidationIssues: (validationReport?.issues ?? []).map((i) => ({ id: i.id, title: i.title, category: i.category })),
      importReconstructionContext: importReconstructionContextRef.current,
      lastDiscussedReconstructionCategory: lastDiscussedReconstructionCategoryRef.current,
      lastReferent: lastReferentRef.current,
    });

    if (referentialResolution.status === 'ambiguous') {
      appendMessage('assistant', referentialResolution.clarifyingQuestion);
      setHistory((current) => [...current, {
        id: newId('hist'),
        command: message,
        interpretation: referentialResolution.clarifyingQuestion,
        action: { type: 'NONE' },
        status: 'clarification',
        summary: referentialResolution.clarifyingQuestion,
        provider: 'deterministic',
        requiresConfirmation: false,
      }]);
      return;
    }
    if (referentialResolution.status === 'resolved') {
      const { referent } = referentialResolution;
      lastReferentRef.current = referent.id !== 'none' ? referent : lastReferentRef.current;
      if (referent.kind === 'validationIssue' && referent.id !== 'none') {
        setLastDiscussedIssueId(referent.id);
      }
      if (referent.kind === 'reconstructionCategory' && referent.id !== 'none' && referent.id !== 'overall') {
        lastDiscussedReconstructionCategoryRef.current = referent.id;
      }
      if (referent.kind === 'module' && referent.id !== 'none' && referent.id !== selectedModule?.id) {
        const resolvedModule = findModuleById(content.modules, referent.id);
        resolvedModuleOverrideRef.current = resolvedModule
          ? { type: resolvedModule.type, props: resolvedModule.props ?? {} }
          : null;
      } else {
        resolvedModuleOverrideRef.current = null;
      }
    }

    setSending(true);

    // Feature 14 V2 — every registered module type is now a potential AI
    // target (the generated capability manifest, not this component,
    // decides which fields are actually editable on it), so context is
    // sent whenever anything is selected — no more type pre-filtering.
    // R4-B3 §B — the live canvas selection always wins when present;
    // resolvedModuleOverrideRef only ever fills in when NOTHING is
    // currently selected but the resolver found an unambiguous referent
    // elsewhere in the document (see the resolution block above).
    const selectedContext: AICommandSelectedModuleContext | null = selectedModule
      ? { type: selectedModule.type, props: selectedModule.props ?? {} }
      : resolvedModuleOverrideRef.current;

    // E9 — informational-only column context (never drives a real
    // column-scoped edit action yet — see AIEngineerPanelProps'
    // selectedColumn docstring). Resolved from the live module tree
    // rather than sending raw layoutId/columnId strings, so the backend
    // only ever sees a whitelisted module type + numeric index.
    const layoutModule = selectedColumn ? findModuleById(content.modules, selectedColumn.layoutId) : null;
    const columnIndex = layoutModule?.columns?.findIndex((column) => column.id === selectedColumn?.columnId) ?? -1;
    const selectedColumnContext = layoutModule && columnIndex >= 0
      ? { layout_module_type: layoutModule.type, column_index: columnIndex }
      : null;

    // E9/E10 — the last-discussed validation issue (if any), trimmed to
    // the same small whitelist the backend serializer expects — see
    // aiCommand.ts's AICommandValidationIssueContext.
    const lastIssue = lastDiscussedIssueIdRef.current
      ? validationReport?.issues.find((issue) => issue.id === lastDiscussedIssueIdRef.current) ?? null
      : null;
    const selectedValidationIssueContext = lastIssue
      ? { id: lastIssue.id, title: lastIssue.title, detail: lastIssue.detail, severity: lastIssue.severity, category: lastIssue.category }
      : null;

    try {
      const response = await requestAICommand({
        message,
        selected_module: selectedContext,
        platform,
        width,
        editor_mode: editorMode,
        selected_column: selectedColumnContext,
        selected_validation_issue: selectedValidationIssueContext,
        conversation_history: boundedHistoryForRequest(messages).map((m) => ({ role: m.role, content: m.text })),
        // R4-B2 §12 — present on every turn for an import-reconstruction
        // conversation (not just the seeded first one), so a follow-up
        // question can be answered with real grounding by whichever AI
        // provider is active. null for every other conversation, same as
        // every other optional context field.
        import_reconstruction: importReconstructionContextRef.current,
      });

      appendMessage('assistant', response.reply);
      setLastProvider(response.provider);
      // R4-B3 §B/§F — keeps the Referential Context Resolver's
      // reconstruction-category memory fresh across turns: if this
      // reply names one of the 8 fixed fidelity categories (the same
      // set formatReconstructionReviewMessage() itself always uses), a
      // later bare "why was that?" can resolve to it. Best-effort only —
      // never blocks or alters the reply itself.
      if (importReconstructionContextRef.current) {
        const mentioned = FIDELITY_CATEGORY_ORDER.find((id) => new RegExp(`\\b${id}\\b`, 'i').test(response.reply));
        if (mentioned) lastDiscussedReconstructionCategoryRef.current = mentioned;
      }

      if (response.action.type === 'NONE') {
        // C-3 remediation — arm the pending-repair ref only when the
        // reply is genuinely the placeholder-link "I won't guess" ask,
        // correlated against the REAL current validation report's
        // placeholder-link issue (never inferred from the reply text
        // alone) so the next bare-URL message targets the right module.
        if (response.reply.includes(PLACEHOLDER_LINK_ASK_SENTINEL)) {
          const issue = validationReport?.issues.find((i) => i.id === 'links:placeholder-href');
          pendingPlaceholderLinkModuleIdRef.current = issue?.moduleId ?? null;
        }
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
    if (applied) {
      // Each candidate is its own decision with its own event_id, even
      // though the batch commits as one undo step — three candidates
      // accepted together are three separate learning events, matching
      // three separate ACCEPTED clicks on individual candidates.
      for (const candidate of pendingRepair.candidates) {
        void recordRepairSignal({
          eventId: newLearningEventId(), signature: signatureForIssueId(candidate.issueId),
          outcome: 'accepted', source: 'ai_engineer_repair',
        });
      }
    }
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
    for (const candidate of pendingRepair.candidates) {
      void recordRepairSignal({
        eventId: newLearningEventId(), signature: signatureForIssueId(candidate.issueId),
        outcome: 'rejected', source: 'ai_engineer_repair',
      });
    }
    setPendingRepair(null);
  }

  async function handleClearLearnedPreferences() {
    setClearingLearning(true);
    const succeeded = await clearLearnedRepairSignals();
    setClearingLearning(false);
    setShowClearLearningConfirm(false);
    setClearLearningNotice(
      succeeded
        ? 'Learned preferences cleared. Recommendation ordering has been reset.'
        : 'Could not clear learned preferences. Please try again.',
    );
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
        <div className="ai-engineer-panel__toolbar-controls">
          {lastProvider === 'local' && (
            <span className="ai-engineer-panel__local-ai-badge" title="Answered by the local AI engine — nothing left this environment">
              Local AI • Private
            </span>
          )}
          {voiceSupported && (
            <>
              <button
                type="button"
                className="ai-engineer-panel__voice-toggle"
                aria-pressed={!voice.muted}
                title={voice.muted ? 'Turn on voice output' : 'Turn off voice output'}
                onClick={() => voice.toggleMuted()}
              >
                <span
                  className={`mdaiw-icon ${voice.muted ? 'mdaiw-icon--volume-off' : 'mdaiw-icon--volume'}`}
                  aria-hidden="true"
                />
                {voice.muted ? 'Voice output off' : 'Voice output on'}
              </button>
              {voice.status === 'speaking' && (
                <button type="button" className="ai-engineer-panel__voice-stop" onClick={() => voice.cancel()}>
                  <span className="mdaiw-icon mdaiw-icon--stop" aria-hidden="true" />
                  Stop
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="ai-engineer-panel__clear-conversation"
            onClick={handleClearConversation}
            disabled={messages.length === 0}
            title="Clear this email's AI Engineer conversation"
          >
            Clear conversation
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
                  compatibility ("check this email for Classic Outlook issues"), repair safe issues
                  ("repair all safe issues"), or compose a whole email from a brief ("create a promotional
                  email for a summer sale with hero, products, CTA, social links and footer", "build a
                  newsletter with two content sections", "make a welcome email"). Type a command or press
                  the microphone.
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
              const compositionLines = compositionSummaryLines(pending.action);
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

                  {compositionLines && (
                    <ol className="ai-engineer-panel__composition-list">
                      {compositionLines.map((line, index) => (
                        // eslint-disable-next-line react/no-array-index-key -- the list is a fixed, freshly-built plan snapshot for this one proposal, re-rendered whole on every change
                        <li key={index}>{line}</li>
                      ))}
                    </ol>
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
          <div className="ai-engineer-panel__learning-controls">
            <button
              type="button"
              className="button button--outline"
              onClick={() => setShowClearLearningConfirm(true)}
            >
              Clear learned preferences
            </button>
            {clearLearningNotice && (
              <p className="ai-engineer-panel__learning-notice" role="status">{clearLearningNotice}</p>
            )}
          </div>

          {showClearLearningConfirm && (
            <div className="ai-engineer-panel__learning-confirm" role="alertdialog" aria-modal="true" aria-label="Clear learned preferences">
              <p>
                Clear learned preferences? This resets recommendation ordering only and does not affect
                email content, validation rules, or safety rules.
              </p>
              <div className="ai-engineer-panel__learning-confirm-actions">
                <button
                  type="button"
                  className="button button--outline"
                  onClick={() => setShowClearLearningConfirm(false)}
                  disabled={clearingLearning}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={handleClearLearnedPreferences}
                  disabled={clearingLearning}
                >
                  {clearingLearning ? 'Clearing…' : 'Clear'}
                </button>
              </div>
            </div>
          )}

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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createEmailAttachment, deleteEmailAttachment, listEmailAttachments, requestAICommand, requestConstructionPlan,
} from '../api/client';
import { matchConstructionIntent } from './constructionIntentMatcher';
import type { ConstructionPlan } from './constructionPlan';
import type { ApiError } from '../types/auth';
import type { EmailAttachmentType } from './types';
import { ImportReviewWorkspace } from './ImportReviewWorkspace';
import { renderSanitizedSourceHtml } from './htmlImportSanitize';
import { isSpeechRecognitionSupported, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { isSpeechSynthesisSupported, useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  describeAction, DOCUMENT_SCOPE_ACTION_TYPES,
  type AIActionHistoryEntry, type AICommandAction, type AICommandCopySourceContext, type AICommandImportReconstructionContext,
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
import { toRepairCandidate } from './reconstructionRepairCandidate';
import { matchReconstructionIntent } from './reconstructionIntentMatcher';
import { matchUndoIntent } from './undoIntentMatcher';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildImportReconstructionContext } from './importReconstructionContext';
import {
  MAX_RECONSTRUCTION_PASSES, projectModulesWithCandidates, runReconstructionPass, shouldStopCorrectionLoop,
} from './reconstructionCorrectionLoop';
import {
  loadReconstructionSession, updateReconstructionSessionProgress, type ReconstructionSessionData,
} from './reconstructionSessionStorage';
import { findModuleById } from './layoutModel';
import { resolveCopySourceRequest, resolveReference, type LastReferent } from './referenceResolver';
import { FIDELITY_CATEGORY_ORDER } from './htmlImportFidelity';
import {
  boundedHistoryForRequest, clearConversation, loadConversation, saveConversation,
  type StoredConversationMessage,
} from './aiConversationStorage';
import { speakableSummary } from './aiSpeech';
import { LocalAIDiagnosticsPanel } from './LocalAIDiagnosticsPanel';
import type { EmailDocumentContent, EmailModule } from './edm';
import type { EmailPlatform } from './types';
import type { EmailDocumentSettingsSnapshot } from './useEmailBuilderState';
import './AIEngineerPanel.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

// D4-B (Feature 14 V4) — one attached file's client-side lifecycle.
// 'selected' briefly precedes the network call; 'uploading' spans the
// single synchronous upload+extract request (see attachment_extraction.py's
// module docstring on the backend — there is no separate server-side
// "extracting" phase the client can observe, so this deliberately does
// not fabricate one); 'ready'/'unsupported'/'failed' come straight from
// the server response. `factCount`/`warnings` are chip-display summaries
// only — the full ExtractedFact[] from the response is intentionally NOT
// retained in this state; D4-B stops at "attachment appears in the
// conversation", never builds an EmailBrief or touches document content.
//
// D4-B hardening — `filename` (not the original `File` object): once
// upload completes, only the name is ever displayed again, and a chip
// RESTORED from the server (see the documentId effect below) never had a
// browser File object in the first place — the backend never returns
// file bytes. `factCount` stays undefined for a restored chip (facts are
// never persisted — see models.EmailAttachment's docstring), so its chip
// reads plain "Ready" rather than claiming a stale/fabricated count.
interface AttachmentChip {
  clientId: string;
  filename: string;
  status: 'selected' | 'uploading' | 'ready' | 'unsupported' | 'failed';
  serverId?: number;
  detectedType?: EmailAttachmentType;
  errorMessage?: string;
  warnings?: string[];
  factCount?: number;
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
  // D4-D — populated only for a construction-plan-sourced proposal
  // (requestConstructionPlan); undefined for every ordinary ai-command
  // proposal. Apply/Cancel/onApplyAction are IDENTICAL either way — this
  // only changes what the proposal card RENDERS (see
  // constructionPlanSummary below), never how it's applied.
  constructionPlan?: ConstructionPlan;
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
  // R4-D Checkpoint D2 — Conversational Undo. Both come straight from
  // useEmailBuilderState.ts (the SAME instance already wired to Ctrl+Z
  // and the toolbar Undo button in EmailBuilderWorkspacePage.tsx) — this
  // panel never gets its own history, snapshot, or reverse-patch logic;
  // it only decides WHEN to call the one real undo() (see handleSend's
  // own D2 block) and reports canUndo honestly rather than always
  // attempting the call.
  canUndo: boolean;
  onUndo: () => void;
}

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

// D4-B — pure display helpers for AttachmentChip; no component state, so
// these live at module scope like newId() above.
function attachmentChipIconClass(status: AttachmentChip['status']): string {
  switch (status) {
    case 'uploading':
      return 'mdaiw-icon--spinner ai-engineer-panel__attachment-chip-icon--spin';
    case 'ready':
      return 'mdaiw-icon--check-circle';
    case 'unsupported':
      return 'mdaiw-icon--warning';
    case 'failed':
      return 'mdaiw-icon--error-circle';
    default:
      return 'mdaiw-icon--file';
  }
}

function attachmentChipStatusText(chip: AttachmentChip): string {
  switch (chip.status) {
    case 'selected':
      return 'Selected';
    case 'uploading':
      return 'Uploading & extracting…';
    case 'ready': {
      if (!chip.factCount) return 'Ready';
      return `Ready · ${chip.factCount} item${chip.factCount === 1 ? '' : 's'} found`;
    }
    case 'unsupported':
      return chip.errorMessage || 'Unsupported file type.';
    case 'failed':
      return chip.errorMessage || 'Could not process this file.';
    default:
      return '';
  }
}

// D4-D — pure display helper for a construction-plan proposal's
// per-section classification badge.
function constructionPlanClassificationLabel(classification: string): string {
  switch (classification) {
    case 'exact':
      return 'Exact match';
    case 'normalized':
      return 'Normalized';
    case 'approximated':
      return 'Approximated';
    case 'unsupported':
      return 'Not supported';
    case 'requires_new_module':
      return 'Needs a new module';
    default:
      return classification;
  }
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

// R4-D Checkpoint D3 — a real gap found during live QA: the document-scope
// actions above (SET_CUSTOM_CSS, SET_EMAIL_TITLE, ...) already show a real
// Current/Proposed diff before Apply, but the far more common MODULE-scope
// property/settings actions ("make this button green", "give this button
// 24px padding") showed only a generic sentence like "Update the selected
// button module's settings (desktop)" — the actual before/after VALUES
// were never surfaced, so the user had no way to verify what would change
// without applying it first. This reuses data ALREADY on hand (the live
// `selectedModule` prop this component already receives) — no new backend
// field, no second diff engine. Settings patches are nested one level by
// device (`{desktop: {paddingTop: 24, ...}}` — see EmailModuleSettings),
// so those rows get a "(desktop)"/"(mobile)" suffix; prop patches are flat.
// APPLY_GLOBAL_STYLE touches every module of a type at once, so a single
// "before" value would be misleading if those modules currently disagree —
// shown as "(varies per module)" instead of a fabricated single value.
interface ModulePatchDiffRow {
  label: string;
  before: string;
  after: string;
}

function humanizePatchKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatPatchValue(value: unknown): string {
  if (value === undefined || value === null) return '(not set)';
  if (typeof value === 'string' && value.trim() === '') return '(empty)';
  return String(value);
}

function modulePatchDiffRows(action: AICommandAction, selectedModule: EmailModule | null): ModulePatchDiffRow[] | null {
  if (action.type === 'UPDATE_MODULE_PROPS' || action.type === 'REPLACE_UNSUPPORTED_PROPERTY') {
    const currentProps = (selectedModule?.props ?? {}) as Record<string, unknown>;
    return Object.entries(action.patch).map(([key, after]) => ({
      label: humanizePatchKey(key), before: formatPatchValue(currentProps[key]), after: formatPatchValue(after),
    }));
  }
  if (action.type === 'UPDATE_MODULE_SETTINGS') {
    const currentSettings = (selectedModule?.settings ?? {}) as Record<string, unknown>;
    const rows: ModulePatchDiffRow[] = [];
    for (const [device, devicePatch] of Object.entries(action.patch)) {
      if (!devicePatch || typeof devicePatch !== 'object') continue;
      const currentDevice = (currentSettings[device] ?? {}) as Record<string, unknown>;
      for (const [key, after] of Object.entries(devicePatch as Record<string, unknown>)) {
        rows.push({
          label: `${humanizePatchKey(key)} (${device})`, before: formatPatchValue(currentDevice[key]), after: formatPatchValue(after),
        });
      }
    }
    return rows;
  }
  if (action.type === 'APPLY_GLOBAL_STYLE') {
    return Object.entries(action.patch).map(([key, after]) => ({
      label: humanizePatchKey(key), before: '(varies per module)', after: formatPatchValue(after),
    }));
  }
  return null;
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
  canUndo, onUndo,
}: AIEngineerPanelProps) {
  const [subView, setSubView] = useState<'chat' | 'history'>('chat');
  // R4-C6 — collapsed by default so an ordinary (non-reconstruction)
  // conversation's chat area is never pushed down by a section that
  // never renders for it anyway (see the gate on reconstructionSessionRef.
  // current below); expanded by default the FIRST time a reconstruction
  // session is present, matching "Original and Reconstructed remain
  // available."
  const [reconstructionPanelExpanded, setReconstructionPanelExpanded] = useState(true);
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
  // D4-B hardening — attachments are document-scoped server-side (see
  // models.EmailAttachment), and RESTORED here whenever `documentId`
  // changes (mount, remount, or a document switch within the same
  // mounted instance) via the effect below. Only metadata is restored
  // (id/filename/detected type/status/size/warnings/error) — never
  // facts, which the backend never persisted in the first place.
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const attachmentFileInputRef = useRef<HTMLInputElement>(null);
  // Guards against a slow, stale list() response from a PREVIOUS
  // documentId landing after the user has already switched documents
  // again — "latest documentId wins", same pattern as every other
  // async-response-vs-fast-navigation race in this codebase.
  const attachmentDocumentIdRef = useRef(documentId);

  useEffect(() => {
    attachmentDocumentIdRef.current = documentId;
    // A document switch must clear the OLD document's chips immediately
    // (not wait for the new list() to resolve) — otherwise Document A's
    // chips would remain visible, misattributed, for one frame/until the
    // network responds, which is exactly the leak this hardening pass
    // closes.
    setAttachments([]);
    let cancelled = false;
    void listEmailAttachments(documentId)
      .then((records) => {
        if (cancelled || attachmentDocumentIdRef.current !== documentId) return;
        setAttachments(records.map((record) => ({
          clientId: newId('attachment'),
          filename: record.original_filename,
          // The backend only ever persists 'ready'/'failed' — an
          // 'unsupported' upload is rejected before a row is created
          // (see attachment_validation.py), so it can never be restored.
          status: record.status === 'ready' ? 'ready' : 'failed',
          serverId: record.id,
          detectedType: record.detected_type,
          errorMessage: record.error_message,
          warnings: record.warnings,
        })));
      })
      .catch(() => {
        // Best-effort restore only — a failed list() leaves the chip row
        // empty rather than blocking the panel or showing a scary error
        // for what is, at worst, "your attachments didn't come back."
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);
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

  // R4-C3/C4 — the persisted reconstruction session (source HTML + pass
  // bookkeeping), loaded synchronously at mount for the SAME reason
  // every other per-document ref above is (a follow-up "fix everything
  // you can" two turns later still needs it, not just the first turn).
  // null for every document that was never imported via "Review
  // reconstruction with AI Engineer" — the reconstruction-repair local
  // intent matcher below is gated on this being non-null, so it never
  // fires for an ordinary (non-reconstruction) document.
  const reconstructionSessionRef = useRef<ReconstructionSessionData | null>(loadReconstructionSession(documentId));
  // Bookkeeping for the CURRENTLY PENDING reconstruction repair
  // proposal only — set right before setPendingRepair when the pending
  // batch came from the reconstruction matcher below, consumed (session
  // updated) on a successful Apply, discarded (no session update) on
  // Cancel — matches "Cancel leaves the document unchanged," which here
  // extends to "and never advances the pass counter either."
  const pendingReconstructionPassRef = useRef<{ passesUsed: number; score: number } | null>(null);
  // R4-C6 — the Original/Reconstructed/Proposed comparison workspace's
  // own state. `originalHtml`/`reconstructedHtml` are always available
  // for an active reconstruction session (independent of any pending
  // proposal); `projectedHtml` (and its FidelityReport/summary) exist
  // ONLY while `pendingRepair` is a reconstruction batch — read directly
  // off `pendingReconstructionPassRef`/`pendingRepair`, so this
  // naturally disappears the instant either is cleared (Cancel, Apply,
  // or a new command superseding the old proposal), exactly matching
  // ImportReviewWorkspace's own "projectedHtml going away" contract. A
  // PURE read: never touches `content`, never calls onApplyRepairAction,
  // never persists anything — recomputed from scratch on every render
  // that changes one of its own dependencies, so it can never leak a
  // stale projection into what the user sees after a real Apply.
  const reconstructionOriginalHtml = useMemo(() => {
    const session = reconstructionSessionRef.current;
    if (!session) return null;
    const doc = new DOMParser().parseFromString(session.sourceHtml, 'text/html');
    return renderSanitizedSourceHtml(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);
  const reconstructionReconstructedHtml = useMemo(() => {
    if (!reconstructionSessionRef.current) return null;
    return renderEmailDocument({
      width, content: { version: 1, modules: content.modules }, title: emailTitle,
      faviconUrl, resetCssEnabled, customCssEnabled, customCss,
    });
  }, [content.modules, width, emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss]);
  const reconstructionProjection = useMemo(() => {
    const session = reconstructionSessionRef.current;
    if (!session || !pendingRepair || pendingReconstructionPassRef.current === null) return null;
    const items = pendingRepair.candidates.map((candidate) => candidate.item);
    const projected = projectModulesWithCandidates(content.modules, items);
    const html = renderEmailDocument({
      width, content: { version: 1, modules: projected }, title: emailTitle,
      faviconUrl, resetCssEnabled, customCssEnabled, customCss,
    });
    const summary = `${pendingRepair.candidates.length} repair candidate${pendingRepair.candidates.length === 1 ? '' : 's'} applied in this preview — nothing is changed until you Apply.`;
    return { html, summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.modules, pendingRepair, width, emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss]);
  // The Fidelity panel below the comparison always reflects the CURRENT
  // real reconstruction (never the projection) — the projected pane's
  // own summary line communicates the candidate count/expected effect;
  // adding a second toggled fidelity view was judged unnecessary UI for
  // what the chat's own post-Apply score message already states plainly.
  const reconstructionFidelity = useMemo(() => {
    const session = reconstructionSessionRef.current;
    if (!session) return null;
    return runReconstructionPass(session.sourceHtml, session.documentWidthPx, content.modules).fidelity;
  }, [content.modules]);
  // R4-B3 §B — when the resolver identifies a referent that differs from
  // the LIVE canvas selection (e.g. "that button" resolved to the
  // document's only button module while nothing is actually selected),
  // this carries the resolved module's {type, props} for exactly one
  // outgoing request — read once building selectedContext below, then
  // cleared. Never persisted longer than one turn: the live selection
  // (or the next resolution) is always the source of truth after that.
  const resolvedModuleOverrideRef = useRef<AICommandSelectedModuleContext | null>(null);

  // R4-B4 Closure §B/§C — set for exactly one outgoing request when
  // resolveCopySourceRequest() has already read a property value from a
  // resolved source module (see handleSend's own copy-source block
  // below), then cleared — same one-turn-only convention as
  // resolvedModuleOverrideRef above.
  const copySourceContextRef = useRef<AICommandCopySourceContext | null>(null);

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
    reconstructionSessionRef.current = loadReconstructionSession(documentId);
    pendingReconstructionPassRef.current = null;
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

  // D4-B — one file, one upload+extract request. Never blocks the
  // composer/Send flow (attachments upload independently of `sending`),
  // and never touches `messages`/document content — see AttachmentChip's
  // docstring above.
  async function uploadAttachment(file: File) {
    const clientId = newId('attachment');
    setAttachments((current) => [...current, { clientId, filename: file.name, status: 'uploading' }]);
    try {
      const response = await createEmailAttachment(file, documentId);
      setAttachments((current) => current.map((chip) => (
        chip.clientId === clientId
          ? {
            ...chip,
            status: response.attachment.status === 'ready' ? 'ready' : 'failed',
            serverId: response.attachment.id,
            detectedType: response.attachment.detected_type,
            errorMessage: response.attachment.error_message,
            warnings: response.warnings,
            factCount: response.facts.length,
          }
          : chip
      )));
    } catch (caught) {
      const apiError = caught as ApiError;
      const unsupported = apiError.code === 'UNSUPPORTED_FILE_TYPE';
      setAttachments((current) => current.map((chip) => (
        chip.clientId === clientId
          ? {
            ...chip,
            status: unsupported ? 'unsupported' : 'failed',
            errorMessage: apiError.message ?? 'This file could not be uploaded.',
          }
          : chip
      )));
    }
  }

  function handleAttachClick() {
    attachmentFileInputRef.current?.click();
  }

  function handleAttachmentFilesSelected(fileList: FileList | null) {
    for (const file of Array.from(fileList ?? [])) {
      void uploadAttachment(file);
    }
  }

  function handleRemoveAttachment(clientId: string) {
    setAttachments((current) => {
      const target = current.find((chip) => chip.clientId === clientId);
      // Best-effort server cleanup — a failed delete never blocks the
      // chip from disappearing; removal is a client-side UI action first.
      if (target?.serverId) {
        void deleteEmailAttachment(target.serverId).catch(() => {});
      }
      return current.filter((chip) => chip.clientId !== clientId);
    });
  }

  async function handleSend(overrideMessage?: string) {
    const message = (overrideMessage ?? draft).trim();
    if (!message || sending) return;

    // R4-D Checkpoint D2 — a proposal is still pending Apply. The composer
    // stays enabled through this state (see the textarea/mic/Send
    // `disabled` props below — the SAME "still open for exactly one kind
    // of reply" shape the placeholder-link clarifying question above
    // already established for this component), because an undo-family
    // message here ("cancel that", "never mind, undo that", ...) means
    // CANCEL that proposal, never history Undo — nothing has been
    // applied yet for history to revert. Routed to the EXACT SAME
    // handleCancel/handleCancelRepair functions the proposal card's own
    // Cancel button already calls — never a second cancel path. Any
    // OTHER message here is answered honestly rather than silently
    // dropped now that the field no longer looks disabled.
    if (pending || pendingRepair) {
      appendMessage('user', message);
      if (overrideMessage === undefined) setDraft('');
      if (matchUndoIntent(message)) {
        if (pendingRepair) handleCancelRepair(); else handleCancel();
      } else {
        appendMessage(
          'assistant',
          'There is a proposal waiting for Apply or Cancel — use the buttons below, or say "cancel that" to discard it.',
        );
      }
      return;
    }

    appendMessage('user', message);
    if (overrideMessage === undefined) setDraft('');

    // R4-D Checkpoint D2 — Conversational Undo. Checked before every
    // other local intent matcher and before the backend request path:
    // this is a pure local builder-history operation (see onUndo's own
    // prop docstring — the SAME undo() already wired to Ctrl+Z), never
    // something an AI provider decides or a chat-text reconstruction
    // could approximate. Checked this early so an undo-family phrase can
    // never be shadowed by reconstruction-repair matching,
    // matchDocumentIntent, or the Referential Context Resolver (which
    // would otherwise try to resolve the bare "it" in "put it back" as a
    // module reference). Document-history-scoped, not selection-scoped —
    // reads no module/selection state at all, so it is unaffected by
    // tab changes, selection changes, or a remount (canUndo/onUndo are
    // just props, sourced fresh from the parent on every render).
    if (matchUndoIntent(message)) {
      if (canUndo) {
        onUndo();
        appendMessage('assistant', 'Done — I restored the previous email state.');
        setHistory((current) => [...current, {
          id: newId('hist'), command: message, interpretation: 'Undo the most recent applied change.',
          action: { type: 'NONE' }, status: 'applied', summary: 'Restored the previous email state.',
          provider: 'deterministic', requiresConfirmation: false,
        }]);
      } else {
        const reply = "There isn't a previous applied change to undo.";
        appendMessage('assistant', reply);
        setHistory((current) => [...current, {
          id: newId('hist'), command: message, interpretation: 'Undo requested with no undoable history.',
          action: { type: 'NONE' }, status: 'reported', summary: reply,
          provider: 'deterministic', requiresConfirmation: false,
        }]);
      }
      return;
    }

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

    // D4-D — "create/build/generate/make/compose/draft ... email" routes
    // to the builder-aware construction planner instead of the ordinary
    // ai-command endpoint. Checked before every other local intent below
    // (mirrors composition.py's own compose-verb+"email" gate, so this
    // client-side check and the backend's zero-OpenAI deterministic
    // composer stay conceptually in sync) — a compose request is
    // distinctive enough in wording that it never collides with an
    // undo/reconstruction/repair phrase, but is still checked early for
    // the same "never shadowed" reasoning those blocks already document.
    // Only READY attachments (a real server id, successfully extracted)
    // are ever sent — a still-uploading or failed chip contributes
    // nothing.
    if (matchConstructionIntent(message)) {
      setSending(true);
      const readyAttachmentIds = attachments
        .filter((chip) => chip.status === 'ready' && chip.serverId !== undefined)
        .map((chip) => chip.serverId as number);
      try {
        const response = await requestConstructionPlan({ document: documentId, message, attachmentIds: readyAttachmentIds });
        appendMessage('assistant', response.reply);
        setLastProvider(response.provider);
        if (response.action.type === 'NONE') {
          setHistory((current) => [...current, {
            id: newId('hist'), command: message, interpretation: response.reply, action: response.action,
            status: 'clarification', summary: response.reply, provider: response.provider, requiresConfirmation: false,
          }]);
        } else {
          setStrongConfirmChecked(false);
          setPending({
            messageId: newId('proposal'), command: message, interpretation: response.reply, action: response.action,
            requiresConfirmation: response.requires_confirmation, requiresStrongConfirmation: response.requires_strong_confirmation,
            provider: response.provider, capturedSelectedModuleId: selectedModule?.id ?? null,
            constructionPlan: response.plan,
          });
        }
      } catch {
        appendMessage('assistant', 'We could not build a construction plan for this email. Please try again.');
        setHistory((current) => [...current, {
          id: newId('hist'), command: message, interpretation: 'We could not build a construction plan for this email. Please try again.',
          action: { type: 'NONE' }, status: 'failed', summary: 'Request failed', provider: 'deterministic', requiresConfirmation: false,
        }]);
      } finally {
        setSending(false);
      }
      return;
    }

    // Sub-phase 4, item 2/4 (extended E9/E10) — computed here (rather than
    // at its own block below) so the reconstruction-repair check next can
    // consult it — see that block's own comment for why.
    const intentMatch = matchDocumentIntent(message);

    // R4-C3/C4 — reconstruction repair commands ("fix everything you
    // safely can", "use the original spacing", ...), recognized and
    // answered ENTIRELY LOCALLY, exactly like the document-intent block
    // below (zero network for the DETECTION step — R4-C8's "deterministic
    // first"). Gated on an active reconstruction session existing at
    // all, so this can never affect an ordinary (non-imported) document's
    // conversation, and checked BEFORE matchDocumentIntent below: a
    // reconstruction-active "fix everything" is about THIS email's
    // fidelity gaps, the more specific and currently relevant reading,
    // not the generic validation-issue repair matchDocumentIntent's own
    // 'repair-all-safe' pattern would otherwise claim.
    //
    // R4-D Checkpoint D3 — a real bug found during live QA: a message
    // naming a SPECIFIC validation issue by name right after that issue
    // was handed off from Validation Center ("Ask AI Engineer" on
    // "Placeholder link", then "fix the placeholder link") was swallowed
    // by this block purely because it also contains a reconstruction
    // CATEGORY_KEYWORDS hit ("link" -> the 'links' fidelity category),
    // giving a generic "nothing safely repairable" reconstruction-scoped
    // reply instead of matchDocumentIntent's own 'repair-keyword' path,
    // which correctly names the actual issue and gives real next steps.
    // Deliberately narrow: this only defers to matchDocumentIntent when
    // (a) a validation issue was JUST discussed (lastDiscussedIssueIdRef
    // — the same explicit handoff/selection signal the block below
    // already uses) AND (b) the message actually parses as a document
    // intent at all — every other reconstruction-repair phrase, on any
    // document, in any other context, is completely unaffected.
    const deferToValidationIntent = Boolean(lastDiscussedIssueIdRef.current) && Boolean(intentMatch);
    if (reconstructionSessionRef.current && !deferToValidationIntent) {
      const reconIntent = matchReconstructionIntent(message);
      if (reconIntent) {
        const session = reconstructionSessionRef.current;
        if (session.passesUsed >= MAX_RECONSTRUCTION_PASSES) {
          const reply = `I've already run ${MAX_RECONSTRUCTION_PASSES} reconstruction correction passes for this email, which is the limit for automatic repair passes — this keeps the process bounded rather than looping indefinitely. I can still explain any remaining differences, or you can make individual changes directly.`;
          appendMessage('assistant', reply);
          setHistory((current) => [...current, {
            id: newId('hist'), command: message, interpretation: reply, action: { type: 'NONE' },
            status: 'reported', summary: reply, provider: 'deterministic', requiresConfirmation: false,
          }]);
          return;
        }
        // R4-C3 — re-analyzes against the CURRENT live document
        // (content.modules, which already reflects every earlier
        // Applied repair this session), never the original import-time
        // modules — see runReconstructionPass's own docstring.
        const passResult = runReconstructionPass(session.sourceHtml, session.documentWidthPx, content.modules);
        let selected = passResult.candidates.filter((candidate) => candidate.safeAutoFix);
        if (reconIntent.kind === 'fix-category') selected = selected.filter((candidate) => candidate.categoryId === reconIntent.categoryId);

        if (selected.length === 0) {
          const stopReason = shouldStopCorrectionLoop(session.passesUsed, session.lastFidelityScore, passResult);
          const reply = stopReason === 'no-repairable-differences'
            ? 'Everything I can safely repair has already been applied — the remaining differences are intentional normalizations or things this builder cannot represent exactly. Ask me to explain any of them if you would like.'
            : stopReason === 'only-architectural-limitations'
              ? 'The remaining differences here are architectural limitations I cannot safely auto-repair without guessing (there is no safe, unambiguous way to match them to a specific module). I can explain any of them if you would like.'
              : reconIntent.kind === 'fix-category'
                ? "I didn't find any safely-repairable differences in that category right now."
                : 'There is nothing safely repairable right now.';
          appendMessage('assistant', reply);
          setHistory((current) => [...current, {
            id: newId('hist'), command: message, interpretation: reply, action: { type: 'NONE' },
            status: 'reported', summary: reply, provider: 'deterministic', requiresConfirmation: false,
          }]);
          return;
        }

        const repairCandidates = selected.map(toRepairCandidate);
        const reply = `I found ${selected.length} safely repairable difference${selected.length === 1 ? '' : 's'} I can fix now (current reconstruction fidelity: ${passResult.score}/100). Review the proposed changes below.`;
        appendMessage('assistant', reply);
        // Consumed by handleApplyRepair on a successful Apply; cleared
        // without effect by handleCancelRepair — the pass counter and
        // persisted session only ever advance on a REAL applied change.
        pendingReconstructionPassRef.current = { passesUsed: session.passesUsed + 1, score: passResult.score };
        setPendingRepair({ messageId: newId('repair'), command: message, candidates: repairCandidates });
        return;
      }
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
    // (`intentMatch` itself is computed earlier now — see the
    // reconstruction-repair block's own D3 comment for why.)
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

    // R4-D Checkpoint D1 live-QA fix — a real bug, not a D1 feature:
    // importReconstructionContextRef (see its own declaration comment
    // above) was only ever populated from the one-shot import handoff, so
    // navigating away from this document and back — completely ordinary,
    // not just a page reload — silently lost it on every later turn, even
    // though reconstructionSessionRef (and therefore the comparison UI and
    // the "fix everything you can" repair loop just above) survives that
    // exact same navigation via sessionStorage. That broke the request
    // payload's own documented promise a few dozen lines below ("present
    // on every turn for an import-reconstruction conversation, not just
    // the seeded first one") for every turn after the first in a
    // reconstruction conversation resumed from a fresh mount. Backfilled
    // here, once per mount, from the exact same persisted source facts
    // (sourceHtml/documentWidthPx) reconstructionFidelity above already
    // re-derives — never a second analysis engine, just reusing
    // buildImportReconstructionContext (the one existing function that
    // condenses DetectedStructure+FidelityReport into this wire shape,
    // already used for the handoff's own first-turn context).
    if (!importReconstructionContextRef.current && reconstructionSessionRef.current && reconstructionFidelity) {
      const session = reconstructionSessionRef.current;
      const sourceDoc = new DOMParser().parseFromString(session.sourceHtml, 'text/html');
      const structure = analyzeImportedHtml(sourceDoc, session.documentWidthPx);
      importReconstructionContextRef.current = buildImportReconstructionContext(structure, reconstructionFidelity, content.modules.length);
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
    const referentialCtx = {
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
    };

    // R4-B4 Closure §B/§C — "use the same padding as the previous
    // section", "give this the same spacing as the section above", "use
    // the same background color as the previous module", "make these
    // columns the same ratio as the previous layout". Checked BEFORE
    // resolveReference() below: a copy-source message like "the same
    // padding as THE PREVIOUS SECTION" would otherwise also trip
    // resolveReference()'s own section-reference branch (matching
    // "previous section" as an ordinary TARGET reference), which is not
    // what this message means. A 'declined' result (ambiguous target/
    // source, or an honestly-unsupported property/target combination —
    // see resolveCopySourceRequest's own docstring) is answered locally,
    // exactly like resolveReference()'s 'ambiguous' branch below: no
    // wasted round trip, no mutation, no silent guess. A 'resolved'
    // result carries the ALREADY-READ value forward into the outgoing
    // request's context (copySourceContextRef) so the backend only ever
    // builds + validates the existing canonical action from it — see
    // compute_copy_source_result()'s own docstring for why this never
    // becomes a second mutation system.
    copySourceContextRef.current = null;
    const copySourceRequest = resolveCopySourceRequest(referentialCtx);
    if (copySourceRequest.status === 'declined') {
      appendMessage('assistant', copySourceRequest.message);
      setHistory((current) => [...current, {
        id: newId('hist'),
        command: message,
        interpretation: copySourceRequest.message,
        action: { type: 'NONE' },
        status: 'clarification',
        summary: copySourceRequest.message,
        provider: 'deterministic',
        requiresConfirmation: false,
      }]);
      return;
    }
    if (copySourceRequest.status === 'resolved') {
      copySourceContextRef.current = {
        property: copySourceRequest.property,
        value: copySourceRequest.value,
        source_label: copySourceRequest.sourceLabel,
      };
    }

    const referentialResolution = resolveReference(referentialCtx);

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
        // R4-B4 Closure §B/§C — see the copy-source block earlier in
        // this function; null on every ordinary turn.
        copy_source: copySourceContextRef.current,
      });
      copySourceContextRef.current = null;

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
    // R4-C9 — a reconstruction batch is whatever produced a non-null
    // pendingReconstructionPassRef (set by the reconstruction-repair
    // local intent branch above, right before this same setPendingRepair
    // call) — every OTHER repair batch (ordinary validation-issue
    // repairs) leaves it null, so this changes nothing for them.
    const reconstructionPass = pendingReconstructionPassRef.current;
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
          outcome: 'accepted', source: reconstructionPass ? 'ai_engineer_reconstruction' : 'ai_engineer_repair',
        });
      }
      if (reconstructionPass && applied && reconstructionSessionRef.current) {
        // R4-C3/C6 — `content.modules` here is still the PRE-apply prop
        // value: onApplyRepairAction's mutation flows through the parent
        // (EmailBuilderWorkspacePage -> useEmailBuilderState) and only
        // reaches this component's `content` prop on ITS next render,
        // which has not happened yet within this same synchronous
        // handler. Re-reading reconstructionPass.score here would
        // therefore silently announce the PRE-apply number (a real bug
        // caught during R4-C12 live QA — a single-candidate Outlook fix
        // reported the exact unchanged pre-fix score). Instead, project
        // what the document WILL look like using the SAME pure
        // projectModulesWithCandidates function R4-C6's preview path
        // uses (never a guess — it applies the EXACT same patches
        // onApplyRepairAction's own mutators do) and re-run the pass
        // against THAT, giving the true post-apply score synchronously,
        // without waiting for or depending on the next render.
        const projected = projectModulesWithCandidates(content.modules, items);
        const postApplyPass = runReconstructionPass(reconstructionSessionRef.current.sourceHtml, reconstructionSessionRef.current.documentWidthPx, projected);
        updateReconstructionSessionProgress(documentId, reconstructionPass.passesUsed, postApplyPass.score);
        reconstructionSessionRef.current = {
          ...reconstructionSessionRef.current, passesUsed: reconstructionPass.passesUsed, lastFidelityScore: postApplyPass.score,
        };
        const remainingPasses = MAX_RECONSTRUCTION_PASSES - reconstructionPass.passesUsed;
        const followUp = remainingPasses > 0
          ? `Reconstruction fidelity is now ${postApplyPass.score}/100. Ask me to "fix everything you can" again if you'd like me to check for more.`
          : `Reconstruction fidelity is now ${postApplyPass.score}/100. That was the last automatic correction pass (limit: ${MAX_RECONSTRUCTION_PASSES}) — I can still explain any remaining differences.`;
        appendMessage('assistant', followUp);
      }
    }
    pendingReconstructionPassRef.current = null;
    setPendingRepair(null);
    setResolving(false);
  }

  function handleCancelRepair() {
    if (!pendingRepair) return;
    // R4-C3 — Cancel never advances the pass counter or touches the
    // persisted session; only a real Apply does (see handleApplyRepair).
    // Read BEFORE clearing so the learning-signal source below can still
    // tell a reconstruction batch apart from an ordinary one.
    const wasReconstructionBatch = pendingReconstructionPassRef.current !== null;
    pendingReconstructionPassRef.current = null;
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
        outcome: 'rejected', source: wasReconstructionBatch ? 'ai_engineer_reconstruction' : 'ai_engineer_repair',
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

      {reconstructionSessionRef.current && reconstructionOriginalHtml && reconstructionReconstructedHtml && reconstructionFidelity && (
        <div className="ai-engineer-panel__reconstruction-panel">
          <button
            type="button"
            className="ai-engineer-panel__reconstruction-toggle"
            aria-expanded={reconstructionPanelExpanded}
            onClick={() => setReconstructionPanelExpanded((current) => !current)}
          >
            <span className="mdaiw-icon mdaiw-icon--layout" aria-hidden="true" />
            {reconstructionPanelExpanded ? 'Hide' : 'Show'} Original / Reconstructed{reconstructionProjection ? ' / Proposed Improvement' : ''} comparison
          </button>
          {reconstructionPanelExpanded && (
            <ImportReviewWorkspace
              originalHtml={reconstructionOriginalHtml}
              reconstructedHtml={reconstructionReconstructedHtml}
              width={width}
              moduleCount={content.modules.length}
              fidelity={reconstructionFidelity}
              projectedHtml={reconstructionProjection?.html ?? null}
              projectedSummary={reconstructionProjection?.summary ?? null}
            />
          )}
        </div>
      )}

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
              // Only compute a module before/after diff when the LIVE
              // selection still matches what this proposal was built
              // against — a selection change since the proposal was
              // created (the same staleness onApplyAction's own "Could
              // not apply — the canvas selection changed" failure path
              // already guards against) would otherwise show another
              // module's current values as if they were this one's.
              const diffRows = selectedModule?.id === pending.capturedSelectedModuleId
                ? modulePatchDiffRows(pending.action, selectedModule)
                : null;
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

                  {diffRows && diffRows.length > 0 && (
                    <dl className="ai-engineer-panel__repair-item-meta ai-engineer-panel__proposal-diff">
                      {diffRows.map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>{row.before} → {row.after}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {pending.constructionPlan ? (
                    <div className="ai-engineer-panel__construction-plan">
                      {pending.constructionPlan.platform_notes.map((note, index) => (
                        // eslint-disable-next-line react/no-array-index-key -- fixed, freshly-built snapshot for this one proposal
                        <p key={index} className="ai-engineer-panel__construction-plan-platform-note">{note}</p>
                      ))}
                      <ol className="ai-engineer-panel__construction-plan-sections">
                        {pending.constructionPlan.sections.map((section, index) => (
                          // eslint-disable-next-line react/no-array-index-key -- fixed, freshly-built snapshot for this one proposal
                          <li
                            key={index}
                            className={
                              `ai-engineer-panel__construction-plan-section `
                              + `ai-engineer-panel__construction-plan-section--${section.match.classification}`
                            }
                          >
                            <div className="ai-engineer-panel__construction-plan-section-head">
                              <span className="ai-engineer-panel__construction-plan-section-module">
                                {section.match.module_type ?? `${section.match.section_role} (no matching module)`}
                              </span>
                              <span className="ai-engineer-panel__construction-plan-section-badge">
                                {constructionPlanClassificationLabel(section.match.classification)}
                              </span>
                            </div>
                            {section.match.reasons[0] && (
                              <p className="ai-engineer-panel__construction-plan-section-reason">{section.match.reasons[0]}</p>
                            )}
                            {section.match.approximation_notes.map((note, noteIndex) => (
                              // eslint-disable-next-line react/no-array-index-key -- fixed, freshly-built snapshot for this one proposal
                              <p key={noteIndex} className="ai-engineer-panel__construction-plan-section-note">{note}</p>
                            ))}
                          </li>
                        ))}
                      </ol>
                      {pending.constructionPlan.warnings.length > 0 && (
                        <ul className="ai-engineer-panel__proposal-warnings">
                          {pending.constructionPlan.warnings.map((warning, index) => (
                            // eslint-disable-next-line react/no-array-index-key -- fixed, freshly-built snapshot for this one proposal
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : compositionLines && (
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
            {attachments.length > 0 && (
              <ul className="ai-engineer-panel__attachment-list" aria-label="Attached files">
                {attachments.map((chip) => (
                  <li
                    key={chip.clientId}
                    className={`ai-engineer-panel__attachment-chip ai-engineer-panel__attachment-chip--${chip.status}`}
                  >
                    <span
                      className={`mdaiw-icon ${attachmentChipIconClass(chip.status)}`}
                      aria-hidden="true"
                    />
                    <span className="ai-engineer-panel__attachment-chip-body">
                      <span className="ai-engineer-panel__attachment-chip-name">{chip.filename}</span>
                      <span className="ai-engineer-panel__attachment-chip-status">
                        {attachmentChipStatusText(chip)}
                      </span>
                      {chip.status === 'ready' && chip.warnings && chip.warnings.length > 0 && (
                        <span className="ai-engineer-panel__attachment-chip-warnings">
                          {chip.warnings.join(' ')}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="ai-engineer-panel__attachment-chip-remove"
                      onClick={() => handleRemoveAttachment(chip.clientId)}
                      aria-label={`Remove ${chip.filename}`}
                    >
                      <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="ai-engineer-panel__composer-row">
              <input
                ref={attachmentFileInputRef}
                type="file"
                className="visually-hidden ai-engineer-panel__attachment-input"
                accept=".txt,.csv,.md,.markdown,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  handleAttachmentFilesSelected(event.target.files);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                className="ai-engineer-panel__attach-button"
                onClick={handleAttachClick}
                disabled={sending}
                aria-label="Attach a file"
                title="Attach a file — .txt, .csv, .md, .pdf, .docx, .xlsx, or an image"
              >
                <span className="mdaiw-icon mdaiw-icon--upload" aria-hidden="true" />
              </button>
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
                // R4-D Checkpoint D2 — no longer disabled merely because a
                // proposal is pending (see handleSend's own comment on
                // this same state): the composer must stay open to accept
                // a conversational "cancel that". `sending` is the only
                // real disable condition left — the same one every other
                // control here already used for an in-flight backend call.
                disabled={sending}
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
                disabled={micUnsupported || sending}
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
                disabled={sending || !draft.trim()}
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

          <LocalAIDiagnosticsPanel />

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

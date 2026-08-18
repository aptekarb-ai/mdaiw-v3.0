import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CodeEditorTabs, type CodeEditorTabsHandle } from '../landingpages/CodeEditorTabs';
import { ValidatorToolbar } from '../landingpages/ValidatorToolbar';
import { AnalysisCoveragePanel } from '../landingpages/AnalysisCoveragePanel';
import { ValidationIssuesPanel } from '../landingpages/ValidationIssuesPanel';
import { ValidatorEmptyState } from '../landingpages/ValidatorEmptyState';
import { ValidationScopeControl } from '../landingpages/ValidationScopeControl';
import { StylesheetSourceControl } from '../landingpages/StylesheetSourceControl';
import { GeneratedCssPanel } from '../landingpages/GeneratedCssPanel';
import { IssueFixDialog, type IssueFixApiError } from '../landingpages/IssueFixDialog';
import {
  candidateFromPatch, candidateFromProposal, groupIssueStates, type FixCandidate,
} from '../landingpages/fixCandidates';
import { AmpscriptMockValuesPanel } from '../landingpages/AmpscriptMockValuesPanel';
import { YuktiExplainPrompt } from '../landingpages/YuktiExplainPrompt';
import { YuktiExplanationPanel, type YuktiExplainApiError } from '../landingpages/YuktiExplanationPanel';
import { RepairProgressPanel } from '../landingpages/RepairProgressPanel';
import { ValidateProgressPanel } from '../landingpages/ValidateProgressPanel';
import type { ApiError } from '../types/auth';
import type { CodeEditorMarker } from '../landingpages/CodeEditor';
import type { RepairOperationStatus } from '../types/landingpages';
import { useValidator } from '../hooks/useValidator';
import { applyFixes, previewFixes, startAiFix, getAiFixStatus } from '../api/fixes';
import { applyAIReview, requestAIReview } from '../api/aiReview';
import { requestYuktiExplanation } from '../api/yuktiExplain';
import { createPreview } from '../api/preview';
import { loadLatestVersion, saveVersion } from '../api/landingpages';
import { API_BASE_URL } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { downloadCompleteLp } from '../landingpages/downloadFiles';
import {
  EDITOR_LANGUAGES,
  EMPTY_STATE_MESSAGE_FOR_SCOPE,
  ENGINE_AVAILABILITY,
  LANGUAGE_DISPLAY_NAME,
  CSS_SOURCE_TYPES,
  MONACO_LANGUAGE_FOR_CSS_SOURCE_TYPE,
  SCOPE_TO_EDITOR_LANGUAGE,
  type CssSourceType,
  type EditorLanguage,
  type AIFixIssuesRunResponse,
  type FixMetrics,
  type FixSourceFile,
  type IssueFile,
  type PreviewApiError,
  type ValidationIssue,
  type ValidationReport,
  type ValidationScope,
  type YuktiExplainResponse,
} from '../types/landingpages';
import './LandingPageValidatorPage.css';

// Session-level only ("Do not repeatedly ask for audio/explanation after
// every validation during one session" — sessionStorage, not
// localStorage, so a NEW browser session asks again; this deliberately
// does not use the existing yukti_* localStorage preference keys, which
// are Yukti's global voice settings, not this page-specific prompt-
// dismissal flag).
const EXPLAIN_PROMPT_SEEN_KEY = 'yukti_explain_prompt_seen';

function hasSeenExplainPrompt(): boolean {
  if (typeof window === 'undefined') return true;
  return window.sessionStorage.getItem(EXPLAIN_PROMPT_SEEN_KEY) === 'true';
}

function markExplainPromptSeen() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(EXPLAIN_PROMPT_SEEN_KEY, 'true');
}

const FIX_SOURCE_FILE_TO_LANGUAGE: Record<FixSourceFile, EditorLanguage> = {
  html: 'html', css: 'css', js: 'js', ampscript: 'ampscript',
};

// Consistent Validation Counts + Verified Learning sprint, spec section
// 29/30 — "Another pass may resolve more" is never shown again: if
// another pass could help, the backend loop already ran it (that is the
// whole point of autonomous repair — see fixes/iterative.py). When the
// loop stops with issues still remaining, state the PRECISE reason
// instead of a vague suggestion the user can't act on. Shared by the
// live-region announcement and the visible banner so the two can never
// drift apart.
function fixOutcomeMessage(metrics: FixMetrics): string {
  if (metrics.issues_remaining === 0) {
    return 'All detected issues were fixed and the code was revalidated.';
  }
  // Repair-architecture closure sprint, spec section 8/10 — deterministic
  // validators, compiler/parser autofix, Verified Repair Knowledge, and
  // the formatter/autofix layer ALL run regardless of AI availability
  // (see run_autonomous_repair) — an unavailable AI provider only ever
  // means genuinely CONTEXTUAL findings (issues_unrepairable > 0) were
  // left for a later run, never a mechanically-fixable one. The banner
  // must say so plainly instead of implying "all technically repairable
  // issues" were handled when contextual ones still remain.
  if (metrics.ai_unavailable && metrics.issues_unrepairable > 0) {
    return 'Verified automatic repairs were applied. AI-assisted repair is temporarily unavailable for the '
      + `remaining contextual issues. Resolved: ${metrics.issues_resolved} · `
      + `Remaining: ${metrics.issues_remaining} · Requires Input: ${metrics.issues_requires_input}.`;
  }
  // JavaScript Source-Recovery Architecture sprint, spec section 21 — a
  // 'no_actionable' stop does NOT always mean everything technically
  // repairable actually got repaired (e.g. a whole-source candidate that
  // would have fixed a parser blocker was itself rejected, or every
  // remaining file was already attempted this run and declined) — only
  // claim full success when what's left is genuinely non-technical
  // (requires-input or advisory-only), matching fixOutcomeIsSuccess's own
  // condition exactly, so the text and the banner styling never disagree.
  const nothingTechnicalRemains = metrics.issues_remaining === metrics.issues_requires_input + metrics.issues_advisory;
  let headline: string;
  switch (metrics.stopped_reason) {
    case 'no_actionable':
      headline = nothingTechnicalRemains
        ? 'AI Engineer fixed all technically repairable issues.'
        : 'AI Engineer could not safely complete the repair. Some issues remain.';
      break;
    case 'no_progress':
      headline = 'AI Engineer could not make further safe progress on the remaining issues this run.';
      break;
    case 'max_iterations':
      headline = 'AI Engineer reached its safety iteration limit for this run while repairs were still in progress.';
      break;
    case 'regression_reverted':
      headline = 'AI Engineer reverted a repair that would have made the code worse and stopped for safety review.';
      break;
    case 'candidate_rejected':
      headline = 'AI Engineer rejected a repair candidate that did not pass validation and stopped for safety review.';
      break;
    case 'structural_recovery_failed':
      // HTML Whole-Document Structural Recovery sprint, spec section 19
      // — a corrupted document shell that neither deterministic
      // recovery nor the whole-source AI fallback could confidently
      // repair. Never phrased as a routine "did what it could" outcome.
      headline = 'AI Engineer stopped because the current document requires structural recovery. No unsafe candidate was published.';
      break;
    default:
      headline = 'AI Engineer fixed what it could safely repair.';
  }
  return `${headline} Resolved: ${metrics.issues_resolved} · `
    + `Remaining: ${metrics.issues_remaining} · Requires Input: ${metrics.issues_requires_input}.`;
}

// Repair-architecture closure sprint, spec section 19 — a green,
// checkmark-styled success banner is only ever accurate when the run
// actually converged (or left behind nothing but genuine requires-input
// decisions, never a technical defect the system already knows how to
// fix). Anything else uses the attention/warning presentation instead.
function fixOutcomeIsSuccess(metrics: FixMetrics | null): boolean {
  if (!metrics) return true; // the simpler single-issue-fix summary path — unaffected by this sprint
  if (metrics.issues_remaining === 0) return true;
  return metrics.issues_remaining === metrics.issues_requires_input + metrics.issues_advisory;
}

interface GeneratedCssState {
  css: string;
  engine: string;
  engineVersion: string;
}

// Every distinct reason a compile attempt did not produce usable CSS gets
// its own status — collapsing them into one generic "Compilation failed"
// hid whether the problem was the user's own stylesheet syntax, a missing
// Node dependency, a timeout, an internal bridge failure, or an oversized
// generated-output response, each of which needs a different next step.
type CompileStatus =
  | 'not-compiled'
  | 'compiling'
  | 'compiled'
  | 'blocked-by-source-errors'
  | 'compiler-unavailable'
  | 'timed-out'
  | 'failed-internally'
  | 'output-limit-exceeded'
  | 'stale';

const COMPILE_STATUS_LABEL: Record<CompileStatus, string> = {
  'not-compiled': 'Not compiled',
  compiling: 'Compiling…',
  compiled: 'Compiled successfully',
  'blocked-by-source-errors': 'Compilation blocked',
  'compiler-unavailable': 'Compiler unavailable',
  'timed-out': 'Compilation timed out',
  'failed-internally': 'Compilation failed internally',
  'output-limit-exceeded': 'Generated output exceeded the limit',
  stale: 'Generated output stale',
};

// Shown under the status badge only for the statuses where a next step is
// actionable/clarifying — the rest are self-explanatory from the badge
// text alone.
const COMPILE_STATUS_HELPER_TEXT: Partial<Record<CompileStatus, string>> = {
  'blocked-by-source-errors': 'Resolve the stylesheet errors before generating CSS.',
  'compiler-unavailable': 'Generated CSS is unavailable until compilation succeeds.',
  'timed-out': 'Generated CSS is unavailable until compilation succeeds.',
  'failed-internally': 'Generated CSS is unavailable until compilation succeeds.',
  'output-limit-exceeded': 'Generated CSS is unavailable until compilation succeeds.',
};

// The engine_status entry name each preprocessor's compiler reports
// under (see engine.py's css_adapters dispatch / css_scss_sass.py's
// _ENGINE_NAME_BY_SYNTAX) — 'css' has no compiler of its own, so it maps
// to null (there is nothing to classify a compile status for).
const COMPILER_ENGINE_NAME_FOR_SOURCE_TYPE: Record<CssSourceType, string | null> = {
  css: null,
  scss: 'scss-compiler',
  sass: 'sass-compiler',
  less: 'less-compiler',
};

// Classifies a FAILED compile attempt using the compiler's own
// engine_status entry — success + no generated CSS means the compiler
// itself ran fine but the user's source didn't compile ("blocked by
// source errors"); success === false means the compiler engine itself
// never got to run the user's source, and `message` (now the real,
// safe NodeBridgeError text — see engine.py::_run_adapters) says why.
function classifyCompileFailure(report: ValidationReport, sourceType: CssSourceType): CompileStatus {
  const engineName = COMPILER_ENGINE_NAME_FOR_SOURCE_TYPE[sourceType];
  const entry = engineName ? report.engine_status.find((candidate) => candidate.engine_name === engineName) : undefined;
  if (!entry || entry.success) return 'blocked-by-source-errors';
  const message = entry.message.toLowerCase();
  if (message.includes('timed out')) return 'timed-out';
  if (message.includes('is not installed') || message.includes('could not be started') || message.includes('is not available')) {
    return 'compiler-unavailable';
  }
  if (message.includes('exceeded the maximum size')) return 'output-limit-exceeded';
  return 'failed-internally';
}

const FILE_TO_LANGUAGE: Record<IssueFile, EditorLanguage | null> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
  ampscript: 'ampscript',
  // No tab to jump to for a legacy TypeScript-tagged issue — same as 'cdn'.
  typescript: null,
  cdn: null,
};

// Which engine_status entries are relevant to each editor language — used
// to decide whether a revalidation is trustworthy enough to confirm a
// resolved issue (see computeResolvedLines below).
const ENGINE_NAMES_BY_LANGUAGE: Record<EditorLanguage, string[]> = {
  html: [
    'html5lib', 'html-structure', 'html-lexical', 'html-tag-stack',
    'html-accessibility', 'html-seo', 'html-responsive', 'html-required',
  ],
  css: ['css-conformance'],
  js: ['javascript-conformance'],
  ampscript: ['ampscript-conformance'],
};
// AI Engineer runs across every populated language (see
// ai_engineer/__init__.py) rather than being scoped to one editor tab —
// if it failed, no language's resolved-line confirmation should be
// treated as fully trustworthy either, so it's appended to every list.
Object.values(ENGINE_NAMES_BY_LANGUAGE).forEach((names) => names.push('ai-engineer'));

const EMPTY_VALUES: Record<EditorLanguage, string> = { html: '', css: '', js: '', ampscript: '' };
const EMPTY_MARKERS: Partial<Record<EditorLanguage, CodeEditorMarker[]>> = {};
const EMPTY_RESOLVED: Partial<Record<EditorLanguage, number[]>> = {};

function buildMarkersByLanguage(issues: ValidationIssue[]): Partial<Record<EditorLanguage, CodeEditorMarker[]>> {
  const result: Partial<Record<EditorLanguage, CodeEditorMarker[]>> = {};
  for (const issue of issues) {
    const editorLanguage = FILE_TO_LANGUAGE[issue.file];
    if (!editorLanguage) continue;
    const marker: CodeEditorMarker = {
      severity: issue.severity,
      message: issue.message,
      startLine: issue.line,
      startColumn: issue.column,
      endLine: issue.end_line,
      endColumn: issue.end_column,
      ruleId: issue.rule_id,
      suggestion: issue.suggestion,
      languageLabel: `${LANGUAGE_DISPLAY_NAME[issue.file]} ${issue.severity === 'error' ? 'Error' : issue.severity === 'warning' ? 'Warning' : 'Information'}`,
    };
    const existing = result[editorLanguage] ?? [];
    existing.push(marker);
    result[editorLanguage] = existing;
  }
  return result;
}

// Resolved = existed in the previous report for this language, the engine
// for this language succeeded on the new report, results were not
// truncated, and the same fingerprint/rule+location no longer appears.
function computeResolvedLines(
  previousReport: ValidationReport | null,
  newReport: ValidationReport,
  editorLanguage: EditorLanguage,
): number[] {
  if (!previousReport) return [];
  const file = EDITOR_LANGUAGES.find((entry) => entry.key === editorLanguage)!.file;
  const previousForLanguage = previousReport.issues.filter((issue) => issue.file === file);
  if (previousForLanguage.length === 0) return [];

  const relevantEngines = ENGINE_NAMES_BY_LANGUAGE[editorLanguage];
  const engineFailed = newReport.engine_status.some(
    (entry) => relevantEngines.includes(entry.engine_name) && !entry.success,
  );
  if (engineFailed) return [];

  const wasTruncated = newReport.engine_status.some((entry) => entry.message.toLowerCase().includes('truncated'));
  if (wasTruncated) return [];

  const newIssuesForLanguage = newReport.issues.filter((issue) => issue.file === file);
  const newFingerprints = new Set(newIssuesForLanguage.map((issue) => issue.fingerprint));

  const resolvedLines = new Set<number>();
  for (const oldIssue of previousForLanguage) {
    if (newFingerprints.has(oldIssue.fingerprint)) continue;
    const equivalentStillPresent = newIssuesForLanguage.some(
      (issue) => issue.rule_id === oldIssue.rule_id && issue.line === oldIssue.line,
    );
    if (!equivalentStillPresent) {
      resolvedLines.add(oldIssue.line);
    }
  }
  return Array.from(resolvedLines);
}

export interface FixSummary {
  resolved: number;
  remaining: number;
  newIssues: number;
}

// Spec section 10/24 — never say "Fixes applied." alone; report what
// revalidation actually found. Fingerprint-based (not issue-id-based,
// since every validate() call produces an entirely new ValidationReport
// with new ValidationIssue rows) — same identity signal
// computeResolvedLines already uses per-language. Deliberately whole-
// report rather than scoped to only the issues the fix batch targeted:
// an issue resolved as a side effect of an unrelated fix is still
// honestly "resolved", and a regression introduced anywhere is still
// honestly "new" — narrowing to the targeted set would let a "9 of 9
// resolved" summary quietly hide a new problem the fix caused elsewhere.
function computeFixSummary(previousReport: ValidationReport, newReport: ValidationReport): FixSummary {
  const oldFingerprints = new Set(previousReport.issues.map((issue) => issue.fingerprint));
  const newFingerprints = new Set(newReport.issues.map((issue) => issue.fingerprint));
  const resolved = previousReport.issues.filter((issue) => !newFingerprints.has(issue.fingerprint)).length;
  const newIssues = newReport.issues.filter((issue) => !oldFingerprints.has(issue.fingerprint)).length;
  return { resolved, remaining: newReport.issues.length, newIssues };
}

// Fix-Application Correctness sprint, spec section 21 — never decide
// "the selected issue was fixed" from an HTTP 200 alone. A persisted
// ValidationReport always carries fresh row ids, so identity has to
// come from the same fingerprint/rule+location signal
// computeResolvedLines already uses for highlighting: the OLD
// fingerprint must be gone (it always will be after ANY edit near it,
// including a legitimate reposition — e.g. charset-declared-late
// moving from line 6 to line 4), AND no equivalent instance of the
// SAME rule must remain at the SAME line (which is what a fix that
// silently failed — or fixed the wrong region — would still show).
function isIssueResolved(targetIssue: ValidationIssue, newReport: ValidationReport): boolean {
  const sameFile = newReport.issues.filter((issue) => issue.file === targetIssue.file);
  if (sameFile.some((issue) => issue.fingerprint === targetIssue.fingerprint)) return false;
  // rule_id + line + column, not line alone — a minified/single-line
  // source can carry several distinct instances of the same rule on one
  // line; matching by line alone would treat an untouched sibling
  // instance as "this issue is still present."
  const equivalentStillPresent = sameFile.some(
    (issue) => issue.rule_id === targetIssue.rule_id
      && issue.line === targetIssue.line
      && issue.column === targetIssue.column,
  );
  return !equivalentStillPresent;
}

function sameSourceValues(a: Record<EditorLanguage, string>, b: Record<EditorLanguage, string>): boolean {
  return EDITOR_LANGUAGES.every((entry) => a[entry.key] === b[entry.key]);
}

export function LandingPageValidatorPage() {
  const [values, setValues] = useState<Record<EditorLanguage, string>>(EMPTY_VALUES);
  const [validationScope, setValidationScope] = useState<ValidationScope>('complete');
  const [liveMessage, setLiveMessage] = useState('');
  const [isStale, setIsStale] = useState(false);
  const [resolvedLinesByLanguage, setResolvedLinesByLanguage] =
    useState<Partial<Record<EditorLanguage, number[]>>>(EMPTY_RESOLVED);
  const [cssSourceType, setCssSourceType] = useState<CssSourceType>('css');
  const [activeEditorLanguage, setActiveEditorLanguage] = useState<EditorLanguage>('html');
  const [generatedCss, setGeneratedCss] = useState<GeneratedCssState | null>(null);
  const [generatedCssStale, setGeneratedCssStale] = useState(false);
  const [compileFailureStatus, setCompileFailureStatus] = useState<CompileStatus | null>(null);
  const [preFixSnapshot, setPreFixSnapshot] = useState<Record<EditorLanguage, string> | null>(null);
  const [postFixValidationFailed, setPostFixValidationFailed] = useState(false);
  const [lastFixSummary, setLastFixSummary] = useState<FixSummary | null>(null);
  // AI Fix Issues functional-completion sprint — richer, server-computed
  // metrics from the iterative endpoint (/api/v1/lp/ai-fix/run/). Present
  // only after a BULK "AI Fix Issues" run; the single-issue "AI Fix This
  // Issue" flow still uses lastFixSummary above (unchanged, unaffected by
  // this sprint). Exactly one of the two is ever non-null at a time.
  const [lastFixMetrics, setLastFixMetrics] = useState<FixMetrics | null>(null);

  // AI Engineer Autonomous Repair — clicking "AI Fix Issues" IS consent
  // for the whole operation (spec section 1/17/18): no review dialog, no
  // per-issue selection. handleAutonomousFix calls the server-side loop
  // directly; these track the in-flight/error state for the toolbar
  // button and banner.
  const [autonomousFixRunning, setAutonomousFixRunning] = useState(false);
  const [autonomousFixError, setAutonomousFixError] = useState<IssueFixApiError | null>(null);
  // Real-Time Progress UX sprint — polled while the background operation
  // runs; null only in the brief window before the first status response
  // (RepairProgressPanel renders an indeterminate state for that window).
  const [repairOperation, setRepairOperation] = useState<RepairOperationStatus | null>(null);
  const repairPollActiveRef = useRef(false);

  // AI Fix This Issue — the single-issue flow (spec section 11), same
  // deterministic-first/AI-fallback classification scoped to one issue.
  const [issueFixOpen, setIssueFixOpen] = useState(false);
  const [issueFixIssue, setIssueFixIssue] = useState<ValidationIssue | null>(null);
  const [issueFixLoading, setIssueFixLoading] = useState(false);
  const [issueFixError, setIssueFixError] = useState<IssueFixApiError | null>(null);
  const [issueFixAiUnavailable, setIssueFixAiUnavailable] = useState(false);
  const [issueFixCandidates, setIssueFixCandidates] = useState<FixCandidate[]>([]);
  const [issueFixAiReviewId, setIssueFixAiReviewId] = useState<string | null>(null);
  const [issueFixApplying, setIssueFixApplying] = useState(false);
  // Fix-Application Correctness sprint — 'revalidating' distinguishes the
  // "candidate applied, waiting for the authoritative re-check" phase
  // from plain 'applying' (spec section 5/18). issueFixApplyError is an
  // IN-MODAL failure (candidate rejected / not resolved / stale / server
  // error) that must keep the dialog open — entirely separate from
  // issueFixError above, which is the earlier "couldn't even fetch a
  // candidate" failure.
  const [issueFixApplyPhase, setIssueFixApplyPhase] = useState<'applying' | 'revalidating' | null>(null);
  const [issueFixApplyError, setIssueFixApplyError] = useState<IssueFixApiError | null>(null);

  // Yukti explains validation issues (Master AI Yukti sprint) — a
  // read-only assistance layer, entirely separate from the two fix
  // dialogs above. `explainPromptDismissed` mirrors sessionStorage so the
  // non-blocking prompt never reappears after the user has engaged with
  // it once this session (either "Not Now" or "Explain Issues").
  const [explainPromptDismissed, setExplainPromptDismissed] = useState(hasSeenExplainPrompt);
  const [explainPanelOpen, setExplainPanelOpen] = useState(false);
  const [explainMode, setExplainMode] = useState<'batch' | 'issue'>('batch');
  const [explainIssue, setExplainIssue] = useState<ValidationIssue | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<YuktiExplainApiError | null>(null);
  const [explainResult, setExplainResult] = useState<YuktiExplainResponse | null>(null);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewApiError | null>(null);
  const [ampscriptMockValues, setAmpscriptMockValues] = useState<Record<string, string>>({});

  // Save/Download closure sprint. `savedProjectId`/`savedProjectName` are
  // null until the FIRST successful save; every save after that reuses
  // the same project (a new LandingPageVersion row each time, never
  // overwriting a prior one — see SaveLandingPageVersionView). Validation
  // freshness is tracked independently via the EXISTING `isStale` state
  // (spec: never pretend a saved LP is validated when the source has
  // changed since) — save status and validation status are never
  // conflated into one flag.
  const [savedProjectId, setSavedProjectId] = useState<number | null>(null);
  const [savedProjectName, setSavedProjectName] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [downloadConfirmOpen, setDownloadConfirmOpen] = useState(false);
  const editorTabsRef = useRef<CodeEditorTabsHandle>(null);
  const previousReportRef = useRef<ValidationReport | null>(null);
  const pendingFixRevalidationRef = useRef(false);
  // Guards against a known @monaco-editor/react behavior: syncing the
  // controlled `value` prop after a PROGRAMMATIC update (apply fixes,
  // undo, clear tab) calls the underlying model's setValue(), which
  // fires the same onChange event a real keystroke would — otherwise
  // indistinguishable from a genuine user edit. Populated with every
  // language about to be programmatically overwritten right before the
  // triggering setValues() call; each language is consumed (removed) the
  // first time handleCodeChange sees it, so a later GENUINE edit to that
  // same tab is never accidentally suppressed too.
  const suppressStaleForRef = useRef<Set<EditorLanguage>>(new Set());
  // Set immediately before applyExternalReport() for a bulk iterative fix
  // result — consumed (and cleared) by the very next success effect run,
  // so the effect can tell "this success came from the iterative fix
  // endpoint, show its richer metrics" apart from a normal validate.
  const pendingFixMetricsRef = useRef<FixMetrics | null>(null);
  // Fix-Application Correctness sprint — set immediately before the
  // revalidation triggered by an individual "AI Fix This Issue" apply;
  // the success/error effect below checks this FIRST so it can verify
  // the ONE selected issue actually disappeared (spec section 4/6/21)
  // before deciding whether the dialog is allowed to close, instead of
  // treating a 200 response from the apply endpoint as success.
  const pendingIssueFixTargetRef = useRef<ValidationIssue | null>(null);
  // The source the dialog's candidates were generated against — if the
  // editor changes while the dialog is open, the cached proposal no
  // longer describes the current source (spec section 20) and must be
  // invalidated rather than applied blind.
  const issueFixSourceSnapshotRef = useRef<Record<EditorLanguage, string> | null>(null);
  const { status, report, error, operation: validateOperation, validate, reset, applyExternalReport } = useValidator();

  useEffect(() => {
    if (status === 'validating') {
      setLiveMessage('Validating code…');
    } else if (status === 'success' && report) {
      const total = report.error_count + report.warning_count + report.info_count;
      const wasFixRevalidation = pendingFixRevalidationRef.current;
      const issueFixTarget = pendingIssueFixTargetRef.current;
      if (wasFixRevalidation && issueFixTarget) {
        // Individual "AI Fix This Issue" revalidation — the transactional
        // outcome (spec section 4-9): report/highlighting are always
        // refreshed to the new authoritative result (source really did
        // change), but the dialog is allowed to close ONLY when the
        // SPECIFIC selected issue is verified gone.
        pendingIssueFixTargetRef.current = null;
        const resolved = isIssueResolved(issueFixTarget, report);
        setLastFixSummary(previousReportRef.current ? computeFixSummary(previousReportRef.current, report) : null);
        setLastFixMetrics(null);
        if (resolved) {
          setIssueFixOpen(false);
          setIssueFixIssue(null);
          setIssueFixCandidates([]);
          setIssueFixAiReviewId(null);
          setIssueFixApplyError(null);
          issueFixSourceSnapshotRef.current = null;
          setLiveMessage('Issue fixed and code revalidated.');
        } else {
          setIssueFixApplyError({
            message: 'The proposed fix did not resolve this issue. No successful fix was applied.',
          });
          setLiveMessage('The proposed fix did not resolve this issue. No successful fix was applied.');
        }
      } else if (wasFixRevalidation && pendingFixMetricsRef.current) {
        // AI Engineer Autonomous Repair result — richer, server-computed
        // metrics covering every round the loop ran, not just a
        // before/after fingerprint diff. See spec section 33 for the
        // exact two message shapes.
        const metrics = pendingFixMetricsRef.current;
        setLastFixMetrics(metrics);
        setLastFixSummary(null);
        setLiveMessage(fixOutcomeMessage(metrics));
        pendingFixMetricsRef.current = null;
      } else {
        setLastFixSummary(null);
        setLastFixMetrics(null);
        setLiveMessage(
          total === 0
            ? 'Validation completed. No issues found.'
            : `Validation completed. ${total} issue${total === 1 ? '' : 's'} found — `
              + `${report.error_count} error${report.error_count === 1 ? '' : 's'}, `
              + `${report.warning_count} warning${report.warning_count === 1 ? '' : 's'}.`,
        );
      }
      setIsStale(false);
      pendingFixRevalidationRef.current = false;
      setPostFixValidationFailed(false);

      const nextResolved: Partial<Record<EditorLanguage, number[]>> = {};
      for (const entry of EDITOR_LANGUAGES) {
        const lines = computeResolvedLines(previousReportRef.current, report, entry.key);
        if (lines.length > 0) nextResolved[entry.key] = lines;
      }
      setResolvedLinesByLanguage(nextResolved);
      previousReportRef.current = report;

      // Sprint CSS-E — the response carries the compiled CSS as a
      // transient (non-persisted) field, only ever populated for a
      // scss/sass/less source that actually compiled (see views.py).
      if (report.css_source_type !== 'css' && report.generated_css_compiled && report.generated_css) {
        setGeneratedCss({
          css: report.generated_css,
          engine: report.generated_css_engine ?? '',
          engineVersion: report.generated_css_engine_version ?? '',
        });
        setGeneratedCssStale(false);
        setCompileFailureStatus(null);
      } else if (report.css_source_type !== 'css') {
        // Compilation genuinely failed (as opposed to plain-CSS scope,
        // where these fields are simply absent) — never show stale output
        // next to a fresh failure. Which of the distinct failure reasons
        // this was is classified from the compiler's own engine_status
        // entry (see classifyCompileFailure).
        setGeneratedCss(null);
        setGeneratedCssStale(false);
        setCompileFailureStatus(classifyCompileFailure(report, report.css_source_type));
      }
    } else if (status === 'error' && error) {
      setLiveMessage(`Validation failed: ${error.message}`);
      if (pendingIssueFixTargetRef.current) {
        // The candidate WAS applied (source already mutated locally), but
        // the mandatory revalidation itself failed — never claim the
        // issue was fixed without a successful re-check (spec section 4).
        // Keep the dialog open with an in-modal error rather than a
        // silent close.
        pendingIssueFixTargetRef.current = null;
        setIssueFixApplyError({
          code: error.code,
          message: 'The proposed fix was applied, but the code could not be revalidated. Please try again.',
        });
      } else if (pendingFixRevalidationRef.current) {
        setPostFixValidationFailed(true);
      }
      pendingFixRevalidationRef.current = false;
    }
  }, [status, report, error]);

  function handleCodeChange(language: EditorLanguage, value: string) {
    setValues((previous) => ({ ...previous, [language]: value }));
    if (language === 'css' && generatedCss && !generatedCssStale) {
      setGeneratedCssStale(true);
    }

    // A PROGRAMMATIC sync (apply fixes / undo / clear tab) re-fires this
    // same onChange — see suppressStaleForRef's declaration. Those callers
    // already own their own, deliberate isStale transition, so this one
    // spurious event must be dropped rather than layered on top of it.
    if (suppressStaleForRef.current.has(language)) {
      suppressStaleForRef.current.delete(language);
      return;
    }

    if (!report) return;

    const reportCoversThisLanguage = report.validation_scope === 'complete'
      || SCOPE_TO_EDITOR_LANGUAGE[report.validation_scope] === language;
    if (reportCoversThisLanguage && !isStale) {
      setIsStale(true);
      setResolvedLinesByLanguage(EMPTY_RESOLVED);
      setLastFixSummary(null);
      setLastFixMetrics(null);
      setLiveMessage('Code changed. Validate again to update the results.');
    }
  }

  function handleScopeChange(nextScope: ValidationScope) {
    setValidationScope(nextScope);
    // A previous report/error belongs to the OLD scope — carrying it
    // forward risks showing another language's results (or a stale error
    // banner) under the newly selected scope. Clearing here, rather than
    // only on a source edit, is what keeps scope switches honest.
    if (report || error) {
      reset();
      setIsStale(false);
      setResolvedLinesByLanguage(EMPTY_RESOLVED);
      previousReportRef.current = null;
      setGeneratedCss(null);
      setGeneratedCssStale(false);
      setCompileFailureStatus(null);
      setPreFixSnapshot(null);
      setPostFixValidationFailed(false);
      setLastFixSummary(null);
      setLastFixMetrics(null);
      setAutonomousFixError(null);
      setIssueFixOpen(false);
      setIssueFixApplyError(null);
      setIssueFixApplyPhase(null);
      pendingIssueFixTargetRef.current = null;
      issueFixSourceSnapshotRef.current = null;
      setLiveMessage('Validation scope changed. Previous results were cleared — validate again to see results for the new scope.');
    }
  }

  function handleSourceTypeChange(next: CssSourceType) {
    setCssSourceType(next);
    setGeneratedCss(null);
    setGeneratedCssStale(false);
    setCompileFailureStatus(null);
    setPreFixSnapshot(null);
    setLastFixSummary(null);
    setLastFixMetrics(null);
    if (report) {
      const reportCoversCss = report.validation_scope === 'complete' || report.validation_scope === 'css';
      if (reportCoversCss) {
        setIsStale(true);
        setResolvedLinesByLanguage(EMPTY_RESOLVED);
      }
    }
    setLiveMessage('Stylesheet type changed. Previous stylesheet results and generated CSS were cleared — validate again to see results.');
    requestAnimationFrame(() => {
      editorTabsRef.current?.focusLine('css', 1, 1);
    });
  }

  function isValidateEnabled(): boolean {
    if (validationScope === 'complete' || validationScope === 'html') return values.html.trim().length > 0;
    if (validationScope === 'css') return values.css.trim().length > 0;
    if (validationScope === 'javascript') return ENGINE_AVAILABILITY.javascript && values.js.trim().length > 0;
    if (validationScope === 'ampscript') return ENGINE_AVAILABILITY.ampscript && values.ampscript.trim().length > 0;
    return false;
  }

  // Preview needs real HTML to assemble a page around — see the Secure
  // Preview spec's "Do not create an empty fake document just to enable
  // Preview." A known stylesheet compile failure from the last validate
  // is also a pre-check here purely to avoid a doomed round trip; the
  // backend independently re-verifies compilation regardless (see
  // PreviewCreateView) and is the only real source of truth.
  function previewDisabledReason(): string | undefined {
    if (!values.html.trim()) {
      return 'Enter HTML content before previewing — Preview needs a page to assemble.';
    }
    if (cssSourceType !== 'css' && compileFailureStatus !== null) {
      return 'Stylesheet must compile successfully before preview.';
    }
    return undefined;
  }

  function emptyStateMessage(): string {
    if (!ENGINE_AVAILABILITY[validationScope]) return EMPTY_STATE_MESSAGE_FOR_SCOPE[validationScope];
    return isValidateEnabled() ? 'Ready to validate — select AI Validate Code.' : EMPTY_STATE_MESSAGE_FOR_SCOPE[validationScope];
  }

  function runValidate(source: Record<EditorLanguage, string>) {
    return validate({
      html: source.html, css: source.css, js: source.js, ampscript: source.ampscript,
      validation_scope: validationScope,
      css_source_type: cssSourceType,
    });
  }

  function handleValidate() {
    runValidate(values);
  }

  // Applies a mixed batch of deterministic + AI fix ids in the CORRECT
  // order: deterministic first (cheap, always authoritative for the
  // issues it covers), then AI against whatever the deterministic step
  // already produced — never the original, possibly-now-stale source.
  // This is what keeps the two systems safely composable: each apply
  // endpoint independently re-verifies its own patches' original_text
  // against whatever source it is given (see the fixes/ai_review offset-
  // verification work), so feeding the AI step the deterministic step's
  // own output is what makes a patch on the same file/region land at the
  // right place instead of against stale offsets.
  async function applyUnifiedFixes(
    deterministicFixIds: string[],
    aiFixIds: string[],
    aiReviewId: string | null,
    candidates: FixCandidate[],
  ): Promise<{ appliedCount: number; finalValues: Record<EditorLanguage, string> }> {
    if (!report) return { appliedCount: 0, finalValues: values };
    let workingValues = { ...values };
    let appliedCount = 0;

    if (deterministicFixIds.length > 0) {
      const issueIds = Array.from(new Set(
        deterministicFixIds
          .map((fixId) => candidates.find((c) => c.fixId === fixId)?.issueId)
          .filter((id): id is number => id !== undefined),
      ));
      const response = await applyFixes({
        report: report.id, issue_ids: issueIds,
        html: workingValues.html, css: workingValues.css, js: workingValues.js, ampscript: workingValues.ampscript,
        css_source_type: cssSourceType, validation_scope: validationScope, profile: report.profile,
      });
      appliedCount += response.results.filter((result) => result.status === 'applied').length;
      for (const [file, source] of Object.entries(response.proposed_sources)) {
        const language = FIX_SOURCE_FILE_TO_LANGUAGE[file as FixSourceFile];
        if (language && source != null) workingValues = { ...workingValues, [language]: source };
      }
    }

    if (aiFixIds.length > 0 && aiReviewId) {
      const response = await applyAIReview({
        report: report.id, review_id: aiReviewId, accepted_fix_ids: aiFixIds,
        html: workingValues.html, css: workingValues.css, js: workingValues.js, ampscript: workingValues.ampscript,
        css_source_type: cssSourceType, validation_scope: validationScope, profile: report.profile,
      });
      appliedCount += response.results.filter((result) => result.status === 'applied').length;
      for (const [file, source] of Object.entries(response.proposed_sources)) {
        const language = FIX_SOURCE_FILE_TO_LANGUAGE[file as FixSourceFile];
        if (language && source != null) workingValues = { ...workingValues, [language]: source };
      }
    }

    return { appliedCount, finalValues: workingValues };
  }

  async function commitAppliedFixes(finalValues: Record<EditorLanguage, string>, appliedCount: number) {
    const preFixValues = { ...values };
    for (const entry of EDITOR_LANGUAGES) {
      if (finalValues[entry.key] !== preFixValues[entry.key]) {
        suppressStaleForRef.current.add(entry.key);
      }
    }
    setValues(finalValues);
    setPreFixSnapshot(preFixValues);
    setLiveMessage(`Applying ${appliedCount} fix${appliedCount === 1 ? '' : 'es'} and revalidating…`);
    pendingFixRevalidationRef.current = true;
    await runValidate(finalValues);
  }

  // AI Fix Issues functional-completion sprint — commits the result of
  // the SERVER-SIDE iterative loop. Unlike commitAppliedFixes (which
  // still has to trigger a real revalidation after a client-computed
  // apply), the iterative endpoint already returns a complete, freshly-
  // authoritative report — applyExternalReport sets it directly (no
  // redundant extra validate() round trip), while pendingFixRevalidationRef
  // + pendingFixMetricsRef still route through the SAME success-effect
  // machinery (isStale reset, resolved-line highlighting, generated_css
  // handling) a normal revalidation uses, just with richer messaging.
  function commitIterativeFixResult(response: AIFixIssuesRunResponse) {
    const preFixValues = { ...values };
    let finalValues = { ...values };
    for (const [file, source] of Object.entries(response.final_sources)) {
      const language = FIX_SOURCE_FILE_TO_LANGUAGE[file as FixSourceFile];
      if (language && source != null) finalValues = { ...finalValues, [language]: source };
    }
    for (const entry of EDITOR_LANGUAGES) {
      if (finalValues[entry.key] !== preFixValues[entry.key]) {
        suppressStaleForRef.current.add(entry.key);
      }
    }
    setValues(finalValues);
    setPreFixSnapshot(preFixValues);
    setLiveMessage('Applying fixes and revalidating…');
    pendingFixRevalidationRef.current = true;
    pendingFixMetricsRef.current = response.fix_metrics;
    applyExternalReport(response);
  }

  function handleUndoAppliedFixes() {
    if (!preFixSnapshot) return;
    for (const entry of EDITOR_LANGUAGES) {
      if (preFixSnapshot[entry.key] !== values[entry.key]) {
        suppressStaleForRef.current.add(entry.key);
      }
    }
    setValues(preFixSnapshot);
    setPreFixSnapshot(null);
    setGeneratedCss(null);
    setGeneratedCssStale(false);
    setCompileFailureStatus(null);
    setLastFixSummary(null);
    setLastFixMetrics(null);
    setAutonomousFixError(null);
    setPostFixValidationFailed(false);
    setIsStale(true);
    setResolvedLinesByLanguage(EMPTY_RESOLVED);
    setLiveMessage('Applied fixes undone. Previous code restored — validate again to see current results.');
  }

  // AI Engineer Autonomous Repair — clicking "AI Fix Issues" IS the
  // user's consent to repair every currently repairable issue in scope
  // (spec section 1/17/18). No review dialog, no per-issue selection:
  // one call runs the full server-side detect-fix-revalidate loop
  // (fixes/iterative.py::run_autonomous_repair) and returns ONE final,
  // authoritative report. `Undo Applied Fixes` remains the rollback.
  async function handleAutonomousFix() {
    // Source-Repair Integrity sprint — a guard independent of the
    // toolbar button's own disabled state (belt-and-suspenders against a
    // double-click/duplicate call landing before a re-render), PLUS a
    // fresh operation_id per click so the backend can de-duplicate a
    // genuine network-level retry of the SAME click without ever
    // mutating source twice (see AIFixIssuesRunView).
    if (!report || report.issues.length === 0 || autonomousFixRunning) return;
    setAutonomousFixRunning(true);
    setAutonomousFixError(null);
    setRepairOperation(null);
    setLiveMessage('AI Engineer is repairing your code…');
    repairPollActiveRef.current = true;
    const operationId = crypto.randomUUID();
    try {
      await startAiFix({
        report: report.id, operation_id: operationId,
        html: values.html, css: values.css, js: values.js, ampscript: values.ampscript,
        css_source_type: cssSourceType, validation_scope: validationScope, profile: report.profile,
      });

      // Real-Time Progress UX sprint — lightweight polling (spec section
      // 5: "SSE if it fits the existing architecture, otherwise
      // lightweight polling" — this project has no streaming
      // infrastructure today, see repair_operations.py). The FIRST status
      // check happens immediately (no artificial delay — spec section 23,
      // "user must see activity within ~100-200ms"); only subsequent
      // checks wait between polls. Never claims 100% itself; that only
      // ever comes from the backend's own final update, made after the
      // real ValidationReport exists.
      let operation = await getAiFixStatus(operationId);
      setRepairOperation(operation);
      while (operation.status === 'running') {
        await new Promise((resolve) => { setTimeout(resolve, 700); });
        if (!repairPollActiveRef.current) return;
        operation = await getAiFixStatus(operationId);
        setRepairOperation(operation);
      }

      setAutonomousFixRunning(false);
      if (operation.status === 'completed' && operation.response_body && 'final_sources' in operation.response_body) {
        commitIterativeFixResult(operation.response_body);
      } else {
        const failure = operation.response_body as { message?: string; code?: string } | null;
        const message = failure?.message ?? operation.failure_reason ?? 'Could not apply fixes. Please try again.';
        setAutonomousFixError({ code: failure?.code, message });
        setLiveMessage(message);
      }
    } catch (caught) {
      setAutonomousFixRunning(false);
      const apiError = caught as ApiError;
      const message = apiError?.message ?? 'Could not apply fixes. Please try again.';
      setAutonomousFixError({ code: apiError?.code, message });
      setLiveMessage(message);
    } finally {
      repairPollActiveRef.current = false;
    }
  }

  // AI Fix This Issue (per issue) — the same deterministic-first
  // classification as the bulk flow, scoped to exactly one issue: a
  // deterministic patch (if one exists) is always found with a local,
  // free fixes/preview call; the AI provider is only ever called when
  // that comes back empty (spec section 12/28 — "do not waste OpenAI
  // calls on deterministic fixes").
  async function handleOpenIssueFix(issue: ValidationIssue) {
    if (!report) return;
    setIssueFixOpen(true);
    setIssueFixIssue(issue);
    setIssueFixLoading(true);
    setIssueFixError(null);
    setIssueFixApplyError(null);
    setIssueFixApplyPhase(null);
    setIssueFixAiUnavailable(false);
    setIssueFixCandidates([]);
    setIssueFixAiReviewId(null);
    // spec section 20 — the source the proposal is about to be generated
    // against; checked again right before Apply so a proposal built
    // against source the user has since edited is never applied blind.
    issueFixSourceSnapshotRef.current = { ...values };

    try {
      const detResult = await previewFixes({
        report: report.id, issue_ids: [issue.id],
        html: values.html, css: values.css, js: values.js, ampscript: values.ampscript,
        css_source_type: cssSourceType, validation_scope: validationScope, profile: report.profile,
      });
      const safeDet = detResult.patches.filter((p) => p.status === 'safe');
      if (safeDet.length > 0) {
        setIssueFixCandidates(detResult.patches.map(candidateFromPatch));
        setIssueFixLoading(false);
        return;
      }

      try {
        const aiResult = await requestAIReview({
          report: report.id, issue_ids: [issue.id],
          html: values.html, css: values.css, js: values.js, ampscript: values.ampscript,
          css_source_type: cssSourceType, validation_scope: validationScope, profile: report.profile,
        });
        setIssueFixAiReviewId(aiResult.review_id);
        setIssueFixCandidates(aiResult.proposals.map(candidateFromProposal));
        setIssueFixLoading(false);
      } catch (caught) {
        const apiError = caught as ApiError;
        if (apiError?.code !== 'AI_REVIEW_UNAVAILABLE') throw caught;
        setIssueFixAiUnavailable(true);
        setIssueFixCandidates([]);
        setIssueFixLoading(false);
      }
    } catch (caught) {
      const apiError = caught as ApiError;
      setIssueFixError({ code: apiError?.code, message: apiError?.message ?? 'Could not check for a fix. Please try again.' });
      setIssueFixLoading(false);
    }
  }

  function handleCancelIssueFix() {
    setIssueFixOpen(false);
    setIssueFixIssue(null);
    setIssueFixLoading(false);
    setIssueFixError(null);
    setIssueFixApplyError(null);
    setIssueFixApplyPhase(null);
    setIssueFixCandidates([]);
    pendingIssueFixTargetRef.current = null;
    issueFixSourceSnapshotRef.current = null;
  }

  // Fix-Application Correctness sprint — transactional per spec section
  // 4: apply the candidate, then MANDATORY revalidate, then verify the
  // SELECTED issue's fingerprint/rule+location actually disappeared
  // (isIssueResolved) before the dialog is allowed to close. The
  // success/error effect above does the actual closing/messaging once
  // the awaited revalidation lands, since that is where the fresh
  // ValidationReport becomes available; this function only decides
  // whether to even attempt an apply and drives the in-flight UI state.
  async function handleApplyIssueFix(fixId: string) {
    if (!report || issueFixApplying) return;
    const candidate = issueFixCandidates.find((c) => c.fixId === fixId);
    const targetIssue = issueFixIssue;
    if (!candidate || !targetIssue) return;

    // spec section 20 — re-resolve against CURRENT source before
    // applying; if the editor changed while the dialog was open, the
    // cached proposal's offsets may no longer describe the current
    // source. Never apply a stale proposal against new source.
    if (issueFixSourceSnapshotRef.current && !sameSourceValues(issueFixSourceSnapshotRef.current, values)) {
      setIssueFixApplyError({
        message: 'The code changed since this proposal was generated. Close this dialog and try AI Fix This Issue again.',
      });
      return;
    }

    const det = candidate.method === 'deterministic' ? [fixId] : [];
    const ai = candidate.method === 'ai' ? [fixId] : [];
    setIssueFixApplying(true);
    setIssueFixApplyPhase('applying');
    setIssueFixApplyError(null);
    try {
      const { appliedCount, finalValues } = await applyUnifiedFixes(det, ai, issueFixAiReviewId, issueFixCandidates);
      if (appliedCount === 0) {
        setIssueFixApplying(false);
        setIssueFixApplyPhase(null);
        setIssueFixApplyError({
          message: 'The proposed fix did not resolve this issue. No successful fix was applied.',
        });
        return;
      }

      setIssueFixApplyPhase('revalidating');
      pendingIssueFixTargetRef.current = targetIssue;
      await commitAppliedFixes(finalValues, appliedCount);
      setIssueFixApplying(false);
      setIssueFixApplyPhase(null);
    } catch {
      pendingIssueFixTargetRef.current = null;
      setIssueFixApplying(false);
      setIssueFixApplyPhase(null);
      setIssueFixApplyError({ message: 'Could not apply the fix. Please try again.' });
    }
  }

  function handleDismissExplainPrompt() {
    markExplainPromptSeen();
    setExplainPromptDismissed(true);
  }

  async function runExplain(mode: 'batch' | 'issue', issueIds: number[], issue: ValidationIssue | null) {
    if (!report) return;
    markExplainPromptSeen();
    setExplainPromptDismissed(true);
    setExplainMode(mode);
    setExplainIssue(issue);
    setExplainPanelOpen(true);
    setExplainLoading(true);
    setExplainError(null);
    setExplainResult(null);
    try {
      const result = await requestYuktiExplanation({
        report: report.id, issue_ids: issueIds,
        html: values.html, css: values.css, js: values.js, ampscript: values.ampscript,
        css_source_type: cssSourceType, validation_scope: validationScope, profile: report.profile,
      });
      setExplainResult(result);
      setExplainLoading(false);
    } catch (caught) {
      const apiError = caught as ApiError;
      setExplainError({
        code: apiError?.code,
        message: apiError?.message ?? 'Yukti could not prepare an explanation. Please try again.',
      });
      setExplainLoading(false);
    }
  }

  function handleExplainPromptExplainIssues() {
    void runExplain('batch', [], null);
  }

  function handleAskYukti(issue: ValidationIssue) {
    void runExplain('issue', [issue.id], issue);
  }

  function handleCloseExplanation() {
    setExplainPanelOpen(false);
    setExplainResult(null);
    setExplainError(null);
    setExplainIssue(null);
  }

  function handleGoToLine(issue: ValidationIssue) {
    const language = FILE_TO_LANGUAGE[issue.file];
    if (language) {
      editorTabsRef.current?.focusLine(language, issue.line, issue.column ?? 1, issue.end_line, issue.end_column);
    }
    const languageLabel = LANGUAGE_DISPLAY_NAME[issue.file] ?? issue.file;
    setLiveMessage(
      `Moved to ${languageLabel} ${issue.severity} at line ${issue.line}, column ${issue.column ?? 1}.`,
    );
  }

  function handleClearTab(language: EditorLanguage) {
    if (values[language] !== '') {
      suppressStaleForRef.current.add(language);
    }
    setValues((previous) => ({ ...previous, [language]: '' }));
    if (language === 'css') {
      setGeneratedCss(null);
      setGeneratedCssStale(false);
      setCompileFailureStatus(null);
    }
    if (report) {
      const reportCoversThisLanguage = report.validation_scope === 'complete'
        || SCOPE_TO_EDITOR_LANGUAGE[report.validation_scope] === language;
      if (reportCoversThisLanguage) {
        setIsStale(true);
        setResolvedLinesByLanguage(EMPTY_RESOLVED);
        setLastFixSummary(null);
        setLastFixMetrics(null);
      }
    }
    const label = EDITOR_LANGUAGES.find((entry) => entry.key === language)?.label ?? language;
    setLiveMessage(`${label} code cleared.`);
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await createPreview({
        html: values.html, css: values.css, js: values.js, ampscript: values.ampscript,
        css_source_type: cssSourceType, validation_scope: validationScope,
        profile: report?.profile ?? 'standard',
        ampscript_mock_values: ampscriptMockValues,
      });
      // A new, independent tab — noopener/noreferrer severs window.opener
      // so the previewed page (see backend/landingpages/preview/) can
      // never reach back into this authenticated application tab; the
      // main editor stays open and untouched.
      window.open(`${API_BASE_URL}${result.preview_url}`, '_blank', 'noopener,noreferrer');
      setLiveMessage('Preview opened in a new tab.');
    } catch (caught) {
      setPreviewError(caught as PreviewApiError);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Save/Download closure sprint — persists the exact current editor
  // sources. Never reformats, never runs AI, never applies a fix, never
  // compiles a preprocessor source (see downloadFiles.ts's identical
  // "read directly from editor state" posture for Download).
  async function handleSave() {
    setSaveStatus('saving');
    setSaveErrorMessage(null);
    try {
      const response = await saveVersion({
        html: values.html, css: values.css, js: values.js, ampscript: values.ampscript,
        css_source_type: cssSourceType,
        project: savedProjectId,
        name: savedProjectId ? undefined : projectNameDraft,
      });
      setSavedProjectId(response.project.id);
      setSavedProjectName(response.project.name);
      setSaveStatus('saved');
      setSavedAt(new Date());
      setLiveMessage(`Saved "${response.project.name}", version ${response.version_number}.`);
    } catch (caught) {
      const apiError = caught as ApiError;
      setSaveStatus('failed');
      setSaveErrorMessage(apiError.message || 'Save failed. Please try again.');
    }
  }

  // "Refresh/reopen saved LP" — reconstructs the exact saved sources.
  // Only reachable once a project has actually been saved this session
  // (savedProjectId is set) since the validator page itself carries no
  // project id in its URL (spec section: ad-hoc paste-and-validate is
  // still the page's primary mode; loading an EXISTING project by URL is
  // out of this sprint's scope).
  async function handleReloadSaved() {
    if (savedProjectId === null) return;
    try {
      const loaded = await loadLatestVersion(savedProjectId);
      suppressStaleForRef.current = new Set(EDITOR_LANGUAGES.map((entry) => entry.key));
      setValues({ html: loaded.html, css: loaded.css, js: loaded.js, ampscript: loaded.ampscript });
      setCssSourceType(loaded.css_source_type);
      setIsStale(true); // the reloaded source has not been (re-)validated in THIS session
      setLiveMessage(`Reloaded "${loaded.project.name}", version ${loaded.version.version_number}.`);
    } catch (caught) {
      const apiError = caught as ApiError;
      setSaveErrorMessage(apiError.message || 'Could not reload the saved landing page.');
    }
  }

  function performDownload() {
    downloadCompleteLp(
      { html: values.html, css: values.css, js: values.js, ampscript: values.ampscript, cssSourceType },
      report ? JSON.stringify(report, null, 2) : null,
    );
    setLiveMessage('Download started.');
  }

  function handleDownload() {
    if (isStale || report === null) {
      setDownloadConfirmOpen(true);
      return;
    }
    performDownload();
  }

  async function handleCopy() {
    const combined = [
      '<!-- HTML -->', values.html,
      '', '/* CSS */', values.css,
      '', '// JavaScript', values.js,
      '', '/* AMPscript */', values.ampscript,
    ].join('\n');

    if (!navigator.clipboard) {
      setLiveMessage('Copy is not supported in this browser.');
      return;
    }
    try {
      await navigator.clipboard.writeText(combined);
      setLiveMessage('Code copied to clipboard.');
    } catch {
      setLiveMessage('Could not copy code to clipboard.');
    }
  }

  const markersByLanguage = isStale || !report ? EMPTY_MARKERS : buildMarkersByLanguage(report.issues);
  const effectiveResolvedLinesByLanguage = isStale ? EMPTY_RESOLVED : resolvedLinesByLanguage;

  // Sprint CSS-E — the selector only makes sense where a stylesheet is
  // actually being edited: the CSS-only scope always, or Complete LP only
  // while the css tab itself is active (per spec section 2 — never shown
  // for HTML-only/JavaScript-only/AMPscript-only scope).
  const showStylesheetControls = validationScope === 'css'
    || (validationScope === 'complete' && activeEditorLanguage === 'css');

  const issueFixState = useMemo(
    () => (issueFixIssue ? groupIssueStates(issueFixCandidates, [issueFixIssue.id])[0] : null),
    [issueFixCandidates, issueFixIssue],
  );

  let compileStatus: CompileStatus | null = null;
  if (cssSourceType !== 'css') {
    if (status === 'validating') compileStatus = 'compiling';
    else if (compileFailureStatus) compileStatus = compileFailureStatus;
    else if (generatedCss && generatedCssStale) compileStatus = 'stale';
    else if (generatedCss) compileStatus = 'compiled';
    else compileStatus = 'not-compiled';
  }

  // Save/Download closure sprint.
  const hasAnyEditorContent = Boolean(
    values.html.trim() || values.css.trim() || values.js.trim() || values.ampscript.trim(),
  );
  const saveDisabled = validationScope !== 'complete' || !hasAnyEditorContent
    || (savedProjectId === null && !projectNameDraft.trim());
  const validationFreshnessLabel = (isStale || report === null) ? 'Validation: Code changed since last validation' : 'Validation: Up to date';
  const saveStatusText = saveStatus === 'failed'
    ? (saveErrorMessage ?? 'Save failed — Try again')
    : saveStatus === 'saved'
      ? `Saved "${savedProjectName ?? ''}"${savedAt ? ` at ${savedAt.toLocaleTimeString()}` : ''} · ${validationFreshnessLabel}`
      : undefined;
  const downloadDisabled = !hasAnyEditorContent;

  return (
    <section className="validator-page">
      <div className="validator-page__header">
        <Link to="/dashboard" className="validator-page__back" aria-label="Back to Dashboard">
          <span className="mdaiw-icon mdaiw-icon--arrow-left" aria-hidden="true" />
        </Link>
        <h1>LP Validator &amp; Fixer</h1>
      </div>

      <ValidationScopeControl value={validationScope} onChange={handleScopeChange} disabled={status === 'validating'} />

      {showStylesheetControls && (
        <div className="validator-page__stylesheet-bar">
          <StylesheetSourceControl
            value={cssSourceType}
            onChange={handleSourceTypeChange}
            sourceIsEmpty={!values.css.trim()}
            disabled={status === 'validating'}
          />
          {compileStatus && (
            <span className={`validator-page__compile-status validator-page__compile-status--${compileStatus}`}>
              {COMPILE_STATUS_LABEL[compileStatus]}
              {COMPILE_STATUS_HELPER_TEXT[compileStatus] && (
                <span className="validator-page__compile-status-helper">
                  {COMPILE_STATUS_HELPER_TEXT[compileStatus]}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      <ValidatorToolbar
        onValidate={handleValidate}
        validating={status === 'validating'}
        onCopy={handleCopy}
        validateDisabled={!isValidateEnabled()}
        validateDisabledReason={isValidateEnabled() ? undefined : emptyStateMessage()}
        scope={validationScope}
        cssSourceType={cssSourceType}
        hasValidated={report !== null}
        isStale={isStale}
        // Correctness-pass sprint — an 'info'-severity finding is always
        // advisory-only in this project's convention (see ValidationIssueCard's
        // identical canFix condition): a report containing ONLY info-severity
        // issues has nothing AI Fix Issues could actually repair, so the
        // button must not invite a click that can only ever be a no-op.
        hasActionableIssues={!!report && report.issues.some((issue) => issue.severity !== 'info')}
        onRunAIFixIssues={() => { void handleAutonomousFix(); }}
        fixIssuesRunning={autonomousFixRunning}
        onPreview={handlePreview}
        previewDisabled={!!previewDisabledReason()}
        previewDisabledReason={previewDisabledReason()}
        previewLoading={previewLoading}
        onSave={() => { void handleSave(); }}
        saveDisabled={saveDisabled}
        saveStatus={saveStatus}
        saveStatusText={saveStatusText}
        showProjectNameInput={savedProjectId === null}
        projectName={projectNameDraft}
        onProjectNameChange={setProjectNameDraft}
        onReloadSaved={savedProjectId !== null ? () => { void handleReloadSaved(); } : undefined}
        onDownload={handleDownload}
        downloadDisabled={downloadDisabled}
        downloadDisabledReason={downloadDisabled ? 'Add some code before downloading.' : undefined}
      />

      <ConfirmDialog
        open={downloadConfirmOpen}
        heading="Code has changed since the last validation."
        body="You can validate the code again before downloading, or download the current editor content anyway."
        confirmLabel="Download Anyway"
        cancelLabel="Validate Before Download"
        onConfirm={() => { setDownloadConfirmOpen(false); performDownload(); }}
        onCancel={() => { setDownloadConfirmOpen(false); void handleValidate(); }}
      />

      {(validationScope === 'ampscript' || values.ampscript.trim().length > 0) && (
        <AmpscriptMockValuesPanel values={ampscriptMockValues} onChange={setAmpscriptMockValues} />
      )}

      {autonomousFixRunning && <RepairProgressPanel operation={repairOperation} />}

      {previewError && (
        <div className="validator-page__preview-error" role="alert">
          <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
          <p>{previewError.message}</p>
        </div>
      )}

      {autonomousFixError && (
        <div className="validator-page__preview-error" role="alert">
          <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
          <p>{autonomousFixError.message}</p>
        </div>
      )}

      {preFixSnapshot && !isStale && !autonomousFixRunning && !issueFixApplying && !postFixValidationFailed && (
        <div
          className={
            fixOutcomeIsSuccess(lastFixMetrics)
              ? 'validator-page__fix-applied-banner'
              : 'validator-page__fix-applied-banner validator-page__fix-applied-banner--attention'
          }
          role="status"
        >
          <span
            className={
              fixOutcomeIsSuccess(lastFixMetrics)
                ? 'mdaiw-icon mdaiw-icon--check-circle'
                : 'mdaiw-icon mdaiw-icon--warning'
            }
            aria-hidden="true"
          />
          {lastFixMetrics ? (
            <p>
              {fixOutcomeMessage(lastFixMetrics)}
              {lastFixMetrics.issues_remaining > 0 && lastFixMetrics.iterations_run > 1
                && ` (${lastFixMetrics.iterations_run} passes)`}
            </p>
          ) : lastFixSummary ? (
            <p>
              Fixes applied and code revalidated. Resolved: {lastFixSummary.resolved} &middot;
              {' '}Remaining: {lastFixSummary.remaining} &middot; New issues: {lastFixSummary.newIssues}
            </p>
          ) : (
            <p>Fixes applied and code revalidated.</p>
          )}
          <button type="button" className="button button--outline" onClick={handleUndoAppliedFixes}>
            Undo Applied Fixes
          </button>
        </div>
      )}

      <div className="validator-page__workspace">
        <div className="validator-page__editor">
          <CodeEditorTabs
            ref={editorTabsRef}
            values={values}
            onChange={handleCodeChange}
            onClear={handleClearTab}
            markersByLanguage={markersByLanguage}
            resolvedLinesByLanguage={effectiveResolvedLinesByLanguage}
            scope={validationScope}
            cssMonacoLanguage={MONACO_LANGUAGE_FOR_CSS_SOURCE_TYPE[cssSourceType]}
            cssTabLabel={cssSourceType === 'css' ? undefined : CSS_SOURCE_TYPES.find((e) => e.key === cssSourceType)?.label}
            onActiveLanguageChange={setActiveEditorLanguage}
          />
        </div>

        <div className="validator-page__results">
          {status === 'error' && error && postFixValidationFailed ? (
            <div className="validator-error-banner" role="alert">
              <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
              <p>Fixes were applied, but validation could not confirm the result.</p>
              <div className="validator-page__fix-failed-actions">
                <button type="button" className="button button--outline" onClick={handleValidate}>
                  Retry validation
                </button>
                {preFixSnapshot && (
                  <button type="button" className="button button--outline" onClick={handleUndoAppliedFixes}>
                    Undo Applied Fixes
                  </button>
                )}
              </div>
            </div>
          ) : status === 'error' && error ? (
            <div className="validator-error-banner" role="alert">
              <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
              <p>{error.message}</p>
              <button type="button" className="button button--outline" onClick={handleValidate}>
                Try Again
              </button>
            </div>
          ) : status === 'validating' ? (
            <ValidateProgressPanel operation={validateOperation} />
          ) : isStale && report ? (
            <div className="validator-stale-banner" role="status">
              <span className="mdaiw-icon mdaiw-icon--refresh" aria-hidden="true" />
              <p>Code changed. Validate again to update the results.</p>
            </div>
          ) : report ? (
            <>
              <YuktiExplainPrompt
                open={!explainPromptDismissed && report.issues.length > 0}
                issueCount={report.issues.length}
                onNotNow={handleDismissExplainPrompt}
                onExplainIssues={handleExplainPromptExplainIssues}
              />
              <AnalysisCoveragePanel coverage={report.analysis_coverage} />
              <ValidationIssuesPanel
                issues={report.issues}
                counts={{
                  error: report.error_count,
                  warning: report.warning_count,
                  info: report.info_count,
                }}
                onGoToLine={handleGoToLine}
                onFixThisIssue={(issue) => { void handleOpenIssueFix(issue); }}
                onAskYukti={handleAskYukti}
                issueStatuses={autonomousFixRunning ? repairOperation?.issue_updates : undefined}
              />
            </>
          ) : (
            <ValidatorEmptyState message={emptyStateMessage()} />
          )}
        </div>
      </div>

      {generatedCss && (
        <GeneratedCssPanel
          css={generatedCss.css}
          stale={generatedCssStale}
          engine={generatedCss.engine}
          engineVersion={generatedCss.engineVersion}
        />
      )}

      <IssueFixDialog
        open={issueFixOpen}
        issue={issueFixIssue}
        loading={issueFixLoading}
        error={issueFixError}
        aiUnavailable={issueFixAiUnavailable}
        state={issueFixState}
        applying={issueFixApplying}
        applyPhase={issueFixApplyPhase}
        applyError={issueFixApplyError}
        onApply={(fixId) => { void handleApplyIssueFix(fixId); }}
        onCancel={handleCancelIssueFix}
      />

      <YuktiExplanationPanel
        open={explainPanelOpen}
        mode={explainMode}
        issue={explainIssue}
        loading={explainLoading}
        error={explainError}
        result={explainResult}
        onClose={handleCloseExplanation}
      />

      <p className="visually-hidden" role="status" aria-live="polite">
        {liveMessage}
      </p>
    </section>
  );
}

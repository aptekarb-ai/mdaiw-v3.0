export type LandingPageType = 'validator' | 'builder' | 'ai-generated';
export type LandingPageStatus = 'draft' | 'validating' | 'needs-fixes' | 'ready' | 'archived';
export type FrameworkType = 'bootstrap' | 'tailwind' | 'custom';

export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueCategory =
  | 'syntax'
  | 'accessibility'
  | 'seo'
  | 'security'
  | 'performance'
  | 'responsive'
  // CSS structural/semantic validation phases.
  | 'structure'
  | 'property'
  | 'value'
  | 'compatibility';
// 'typescript' stays a valid value here (never produced by any adapter
// anymore, but a legacy ValidationIssue row could still carry it) so the
// UI renders old data gracefully instead of falling back to a raw key —
// see LANGUAGE_DISPLAY_NAME below. It is deliberately absent from every
// *selection*-oriented map (EDITOR_LANGUAGES, VALIDATION_SCOPES, etc.).
export type IssueFile = 'html' | 'css' | 'javascript' | 'ampscript' | 'typescript' | 'cdn';
export type IssueRisk = 'low' | 'medium' | 'high';

export interface LandingPageProject {
  id: number;
  name: string;
  slug: string;
  type: LandingPageType;
  status: LandingPageStatus;
  framework: FrameworkType;
  created_at: string;
  updated_at: string;
}

export interface ValidationIssue {
  id: number;
  fingerprint: string;
  severity: IssueSeverity;
  category: IssueCategory;
  rule_id: string;
  message: string;
  file: IssueFile;
  language: IssueFile;
  line: number;
  column: number | null;
  end_line?: number | null;
  end_column?: number | null;
  suggestion: string;
  auto_fixable: boolean;
  risk: IssueRisk;
  source_engine?: string;
  engine_version?: string;
  confidence?: 'definite' | 'likely' | 'possible';
  // Sprint CSS-A — where an embedded-CSS finding actually came from
  // within its editor tab (e.g. 'html-inline-style', 'html-style-block').
  // Absent/blank for every issue produced before this sprint.
  source_context?: string;
  source_block_index?: number | null;
  // Sprint CSS-B — storage-relative path of the local project asset a
  // finding came from, when one was actually resolved. Blank otherwise.
  source_asset_id?: string;
  // Sprint CSS-C — for a finding produced against SCSS/Sass's generated
  // CSS, its position in that generated CSS before mapping back to the
  // original source (start_line/column above are always the original-
  // source position, or the generated position itself when unmapped —
  // see suggestion text for an "unmapped" notice). Null otherwise.
  generated_start_line?: number | null;
  generated_start_column?: number | null;
  // AI Engineer full-source-analysis sprint. Null for every issue no AI
  // Engineer pass ever touched — either a purely deterministic finding, or
  // one the AI Engineer independently corroborated (in which case
  // `source_engine` becomes e.g. 'html-structure+ai-engineer' and this
  // carries the AI's own reasoning as supplementary context, never
  // replacing the deterministic message/rule_id above it).
  ai_metadata?: AIEngineerMetadata | null;
}

export interface AIEngineerMetadata {
  reasoning: string;
  evidence: string;
  cross_language: boolean;
  verifiable: boolean;
  chunk_index: number;
  total_chunks: number;
  // Present only when this metadata was attached to an EXISTING
  // deterministic issue that the AI Engineer independently corroborated
  // (see ai_engineer/__init__.py::_merge_or_append) — the AI's own
  // message/confidence, kept distinct from the issue's authoritative
  // (deterministic) message/confidence above it.
  ai_message?: string;
  ai_confidence?: 'definite' | 'likely' | 'possible';
  // IMPORTANT — this issue's `fixable: false` means only "not eligible
  // for automatic/bulk apply as a verified deterministic patch." It does
  // NOT mean "AI Fix This Issue / AI Fix Issues can't help here" — both
  // already treat any current issue (deterministic or AI Engineer-
  // sourced) as valid input and independently re-verify/generate/risk-
  // classify a proposal before anything is ever applied. This flag is
  // always true for every AI Engineer finding in practice (it only ever
  // analyzes real editor-tab languages) — present explicitly so this
  // distinction isn't left implicit in one overloaded boolean.
  ai_fix_pipeline_eligible: boolean;
}

export interface AnalysisCoverageLanguageEntry {
  source_lines: number;
  engine: 'complete' | 'not-applicable';
  ai: 'complete' | 'partial' | 'unavailable' | 'skipped-too-large' | 'skipped-empty';
  chunks: number;
  failure_reason?: string;
}

export interface AnalysisCoverageCrossLanguageEntry {
  status: 'complete' | 'unavailable' | 'skipped';
  failure_reason?: string;
}

export type AnalysisCoverage = Partial<
  Record<'html' | 'css' | 'javascript' | 'ampscript', AnalysisCoverageLanguageEntry>
> & { cross_language?: AnalysisCoverageCrossLanguageEntry };

// Sprint CSS-C/D/E — which syntax the standalone CSS-tab source is
// written in. 'css' needs no compilation; 'scss'/'sass' compile via Dart
// Sass; 'less' compiles via the `less` package. All four have real
// backend engines as of Sprint CSS-D.
export type CssSourceType = 'css' | 'scss' | 'sass' | 'less';

export const CSS_SOURCE_TYPES: readonly { key: CssSourceType; label: string }[] = [
  { key: 'css', label: 'CSS' },
  { key: 'scss', label: 'SCSS' },
  { key: 'sass', label: 'Sass' },
  { key: 'less', label: 'LESS' },
] as const;

// Monaco's own language id for each stylesheet source type. Monaco ships
// built-in 'scss'/'less' grammars but no indented-Sass grammar — 'sass'
// uses the 'scss' tokenizer as the closest available approximation
// (highlighting is imperfect for indented syntax; validation itself is
// unaffected, since that always runs server-side against Dart Sass).
export const MONACO_LANGUAGE_FOR_CSS_SOURCE_TYPE: Record<CssSourceType, string> = {
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
};

// Raw backend engine name -> presentable label, for the Generated CSS
// panel's "compiler name and version" line.
export const CSS_COMPILER_ENGINE_DISPLAY_NAME: Record<string, string> = {
  'dart-sass': 'Dart Sass',
  'less-compiler': 'LESS',
};

export interface EngineStatusEntry {
  engine_name: string;
  success: boolean;
  duration_ms: number;
  issue_count: number;
  message: string;
}

export type ValidationScope = 'complete' | 'html' | 'css' | 'javascript' | 'ampscript';

export interface ValidationReport {
  id: number;
  project: number | null;
  version: number | null;
  duration_ms: number;
  profile: string;
  validation_scope: ValidationScope;
  // Sprint CSS-C — which syntax the standalone CSS-tab source was
  // written in for this report. 'css' whenever the CSS tab wasn't part
  // of the scope at all.
  css_source_type: CssSourceType;
  engine_status: EngineStatusEntry[];
  // AI Engineer full-source-analysis sprint. `{}` whenever AI Engineer
  // wasn't configured/available for this validation — never exposes
  // source content, only per-language line counts and coverage status.
  analysis_coverage?: AnalysisCoverage;
  error_count: number;
  warning_count: number;
  info_count: number;
  created_at: string;
  issues: ValidationIssue[];
  // Sprint CSS-E — the compiled CSS for a scss/sass/less stylesheet
  // source, present only when css_source_type isn't 'css' and compilation
  // actually succeeded. Never persisted server-side — response-only, same
  // lifetime as the report object itself.
  generated_css?: string | null;
  generated_css_compiled?: boolean;
  generated_css_engine?: string;
  generated_css_engine_version?: string;
}

export interface ValidateRequest {
  html: string;
  css?: string;
  js?: string;
  ampscript?: string;
  project?: number | null;
  validation_scope?: ValidationScope;
  css_source_type?: CssSourceType;
}

// Save/Download closure sprint.
export interface LandingPageProjectSummary {
  id: number;
  name: string;
  slug: string;
  type: string;
  status: string;
  framework: string;
  created_at: string;
  updated_at: string;
}

export interface SaveVersionRequest {
  html?: string;
  css?: string;
  js?: string;
  ampscript?: string;
  css_source_type?: CssSourceType;
  project?: number | null;
  name?: string;
}

export interface SaveVersionResponse {
  id: number;
  project: LandingPageProjectSummary;
  version_number: number;
  css_source_type: CssSourceType;
  created_at: string;
}

export interface LoadVersionResponse {
  html: string;
  css: string;
  js: string;
  ampscript: string;
  css_source_type: CssSourceType;
  version: { id: number; project: number; version_number: number; css_source_type: CssSourceType; created_at: string };
  project: LandingPageProjectSummary;
}

// The four editable code tabs. Deliberately excludes 'cdn' — no CDN input
// exists yet, matching the "only existing endpoints, nothing invented"
// boundary. TypeScript was replaced by AMPscript as the fourth tab — see
// the AMPscript-replacement sprint; the frontend never sends a legacy `ts`
// field and never shows a TypeScript tab/label/filter anywhere.
export type EditorLanguage = 'html' | 'css' | 'js' | 'ampscript';

export const EDITOR_LANGUAGES: readonly { key: EditorLanguage; label: string; file: IssueFile }[] = [
  { key: 'html', label: 'HTML', file: 'html' },
  { key: 'css', label: 'CSS', file: 'css' },
  { key: 'js', label: 'JavaScript', file: 'javascript' },
  { key: 'ampscript', label: 'AMPscript', file: 'ampscript' },
] as const;

export type IssueFilter = 'all' | 'error' | 'warning' | 'info';

export const VALIDATION_SCOPES: readonly { key: ValidationScope; label: string }[] = [
  { key: 'complete', label: 'Complete LP' },
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'javascript', label: 'JavaScript' },
  { key: 'ampscript', label: 'AMPscript' },
] as const;

// Backend language/file codes -> full user-facing names. Never show a raw
// internal value like "js"/"html5lib"/"stylelint" in the UI. 'typescript'
// stays mapped (rather than omitted) purely so a legacy ValidationIssue row
// still renders a real word instead of a raw key — no current adapter
// produces it and no current UI list offers it as a choice.
export const LANGUAGE_DISPLAY_NAME: Record<IssueFile, string> = {
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript',
  ampscript: 'AMPscript',
  typescript: 'TypeScript',
  cdn: 'CDN',
};

export const SEVERITY_DISPLAY_NAME: Record<IssueSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Information',
};

// Editor tab key -> Monaco's own language id. 'ampscript' is a locally
// registered custom language (see landingpages/monacoAmpscript.ts) — never
// loaded from a CDN.
export const MONACO_LANGUAGE_FOR: Record<EditorLanguage, string> = {
  html: 'html',
  css: 'css',
  js: 'javascript',
  ampscript: 'ampscript',
};

// Backend `file` value -> the editor tab key that source lives in (the
// inverse of EDITOR_LANGUAGES[].file) — used by Go to Line / markers to
// find the right tab for an issue. No 'typescript' entry — a legacy issue
// with that file value simply has no tab to jump to, same as 'cdn'.
export const EDITOR_LANGUAGE_FOR_FILE: Partial<Record<IssueFile, EditorLanguage>> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
  ampscript: 'ampscript',
};

// Which engines currently exist. JavaScript has a real ESLint-backed
// engine as of the JS engine sprint. AMPscript has a real static-analysis
// engine as of the AMPscript-replacement sprint.
export const ENGINE_AVAILABILITY: Record<ValidationScope, boolean> = {
  complete: true,
  html: true,
  css: true,
  javascript: true,
  ampscript: true,
};

// A single-language scope maps to exactly one editor tab; 'complete' has
// no single answer (all four apply), so it is deliberately absent here —
// callers branch on `undefined` to mean "every tab applies".
export const SCOPE_TO_EDITOR_LANGUAGE: Partial<Record<ValidationScope, EditorLanguage>> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
  ampscript: 'ampscript',
};

// Empty-workspace guidance shown per scope before the scope-relevant
// source has any content — also used as the disabled Validate button's
// tooltip. 'html'/'css'/'javascript'/'ampscript' mirror the backend
// serializer's own per-scope required-field messages exactly (see
// ValidateRequestSerializer.validate in serializers.py) so the two never
// drift out of sync; 'complete' is worded differently on purpose — an
// empty HTML source under Complete LP is a reportable landing-page
// defect (see engine.py::_required_html_issue), not a rejected request,
// so its guidance frames HTML as the thing to *add*, not "enter before
// validating".
export const EMPTY_STATE_MESSAGE_FOR_SCOPE: Record<ValidationScope, string> = {
  complete: 'Add HTML to begin complete landing-page validation.',
  html: 'Enter HTML code before validating HTML.',
  css: 'Enter CSS code before validating CSS.',
  javascript: 'Enter JavaScript code before validating JavaScript.',
  ampscript: 'Enter AMPscript before validating AMPscript.',
};

// Deterministic Apply Safe Fixes — a server-generated, server-verified
// patch (see backend/landingpages/fixes/). Never trust a `replacement_text`
// that didn't come from a /fixes/preview/ or /fixes/apply/ response; the
// backend never accepts one supplied by the client either (see
// serializers.FixRequestSerializer — there is no such input field).
export type FixSourceFile = 'html' | 'css' | 'js' | 'ampscript';
export type FixStatus = 'safe' | 'conflict';

export interface FixPatch {
  fix_id: string;
  issue_id: number;
  fingerprint: string;
  language: string;
  source_context: string;
  file: FixSourceFile;
  start_offset: number;
  end_offset: number;
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
  original_text: string;
  replacement_text: string;
  description: string;
  risk: IssueRisk;
  confidence: 'definite' | 'likely' | 'possible';
  status: FixStatus;
}

export interface FixPreviewResponse {
  patches: FixPatch[];
  conflicts: number[]; // issue_ids whose patch could not be safely auto-selected
  review_required: number[]; // issue_ids with no deterministic patch at all
  not_found: number[]; // requested issue_ids no longer present on the report
}

export interface FixApplyResult {
  fix_id: string;
  issue_id: number;
  file: FixSourceFile;
  status: 'applied' | 'failed';
  reason?: string;
}

export interface FixApplyResponse {
  results: FixApplyResult[];
  proposed_sources: Partial<Record<FixSourceFile, string>>;
  conflicts: number[];
  review_required: number[];
  not_found: number[];
}

export interface FixRequest {
  report: number;
  issue_ids: number[];
  html: string;
  css?: string;
  js?: string;
  ampscript?: string;
  css_source_type?: CssSourceType;
  validation_scope?: ValidationScope;
  profile?: string;
}

// AI Fix Issues functional-completion sprint — POST /api/v1/lp/ai-fix/run/.
// One call runs the FULL detect-fix-revalidate loop server-side (see
// backend/landingpages/fixes/iterative.py::run_autonomous_repair).
// Clicking "AI Fix Issues" IS consent to repair every currently
// repairable issue in scope — there is no issue-id selection step, so
// this carries only the sources/scope the loop needs to work from.
export interface AIFixIssuesRunPayload {
  report: number;
  // Source-Repair Integrity sprint — a fresh client-generated idempotency
  // key per click. The backend de-duplicates a retried request carrying
  // the SAME id for the SAME user, returning the first real result
  // instead of mutating source a second time.
  operation_id?: string;
  html: string;
  css?: string;
  js?: string;
  ampscript?: string;
  css_source_type?: CssSourceType;
  validation_scope?: ValidationScope;
  profile?: string;
}

export interface FixIterationRecord {
  iteration: number;
  issues_before: number;
  fix_candidates_generated: number;
  fixes_applied: number;
  ai_requested: boolean;
  ai_unavailable: boolean;
}

export interface FixMetrics {
  iterations_run: number;
  iterations: FixIterationRecord[];
  issues_before: number;
  fix_candidates_generated: number;
  fixes_applied: number;
  issues_resolved: number;
  issues_remaining: number;
  issues_new: number;
  // Reserved for issues that genuinely need external input (missing
  // business/configuration data, a true conflict between incompatible
  // edits) — never set merely because an ordinary structural repair
  // wasn't pre-approved (spec section 18).
  issues_requires_input: number;
  // Consistent Validation Counts sprint, section 1/33 — explicit
  // lifecycle breakdown so FINAL == INITIAL - RESOLVED + NEW can be
  // reconciled without re-deriving error/warning splits by hand.
  issues_before_errors: number;
  issues_before_warnings: number;
  issues_final_errors: number;
  issues_final_warnings: number;
  issues_unrepairable: number;
  // Verified Repair Memory closure spec, section 12 — an advisory-only
  // finding (informational, no repair strategy exists) is not counted
  // in issues_unrepairable and must never be presented as a failure.
  issues_advisory: number;
  by_language: Partial<Record<'html' | 'css' | 'javascript' | 'ampscript', {
    before: number; remaining: number; resolved: number; new: number;
  }>>;
  stopped_reason:
    | 'all_resolved' | 'no_actionable' | 'no_progress' | 'max_iterations'
    | 'regression_reverted' | 'candidate_rejected' | 'structural_recovery_failed';
  ai_unavailable: boolean;
}

// Real-Time Progress UX sprint — polled while an AI Fix Issues operation
// (started via POST /api/v1/lp/ai-fix/start/) runs in the background.
// `response_body`/`response_status` are populated once `status` is
// 'completed'/'failed', carrying the exact same shape the synchronous
// /ai-fix/run/ endpoint returns, so the frontend applies it through one
// shared code path regardless of which entry point produced it.
// AI Engineer Formatting + Documentation sprint added 'formatting' and
// 'documenting' as two new real stages emitted once, after the repair
// loop itself has converged (never interleaved with it).
export type RepairStage = 'analyzing' | 'repairing' | 'revalidating' | 'formatting' | 'documenting' | 'finalizing';

// Per-issue-card live status, keyed by the issue's stable fingerprint
// (schema.py::compute_fingerprint) — never a DB id, since revalidation
// persists a fresh ValidationReport with fresh row ids each round.
export type IssueCardStatus =
  | 'pending'
  | 'fixing'
  | 'revalidating'
  | 'resolved'
  | 'requires_input'
  | 'newly_exposed'
  | 'failed';

export interface RepairOperationStatus {
  operation_id: string;
  status: 'running' | 'completed' | 'failed';
  stage: RepairStage;
  stage_label: string;
  percent: number;
  current_language: string | null;
  current_iteration: number;
  issues_initial: number;
  issues_resolved: number;
  issues_remaining: number;
  issues_new: number;
  issue_updates: Record<string, IssueCardStatus>;
  started_at: number;
  updated_at: number;
  failure_reason: string | null;
  response_body: AIFixIssuesRunResponse | { success: false; code: string; message: string; request_id?: string } | null;
  response_status: number | null;
}

// AI Validate Code Live Progress sprint — polled while an AI Validate
// Code operation (started via POST /api/v1/lp/validate/start/) runs in
// the background. `response_body`/`response_status` are populated once
// `status` is 'completed'/'failed', carrying the exact same shape the
// synchronous /validate/ endpoint returns.
export type ValidateStage =
  | 'preparing'
  | 'validating_html'
  | 'validating_css'
  | 'validating_js'
  | 'validating_ampscript'
  | 'ai_analysis'
  | 'normalizing'
  | 'finalizing';

export type ValidateStageState = 'pending' | 'active' | 'done';

export interface ValidateOperationStatus {
  operation_id: string;
  status: 'running' | 'completed' | 'failed';
  stage: ValidateStage;
  stage_label: string;
  percent: number;
  total_stages: number;
  completed_stages: number;
  stage_checklist: Record<ValidateStage, ValidateStageState>;
  response_body: ValidationReport | { success: false; code: string; message: string; request_id?: string } | null;
  response_status: number | null;
  failure_reason: string | null;
}

export interface StartAiFixResponse {
  operation_id: string;
  status: 'running';
}

export interface StartValidateResponse {
  operation_id: string;
  status: 'running';
}

// The final, authoritative ValidationReport (same shape AI Validate Code
// itself returns) plus the source TEXT the loop actually produced and
// the completeness metrics proving what it did.
export interface AIFixIssuesRunResponse extends ValidationReport {
  final_sources: Partial<Record<FixSourceFile, string>>;
  fix_metrics: FixMetrics;
}

// AI Review & Fix — a proposal is only ever shown/applied after the
// backend has independently re-verified it against the CURRENT source
// (see backend/landingpages/ai_review/validation.py); `status` reflects
// that verification, never the AI's own claim. Never trust
// `replacement_text` beyond what the server already validated — Apply
// only ever sends back `fix_id`, never proposal content (see
// AIReviewApplyRequest).
export type AIRisk = 'low' | 'medium' | 'high';
export type AIConfidence = 'definite' | 'likely' | 'possible';
export type AIProposalStatus = 'safe' | 'conflict' | 'rejected';

export interface AIProposal {
  fix_id: string;
  issue_id: number;
  language: string;
  source_context: string;
  file: FixSourceFile;
  start_line: number;
  start_column: number | null;
  end_line: number;
  end_column: number | null;
  original_text: string;
  replacement_text: string;
  explanation: string;
  risk: AIRisk;
  confidence: AIConfidence;
  assumptions: string[];
  requires_configuration: boolean;
  status: AIProposalStatus;
  rejection_reason: string;
}

export interface AIReviewRiskCounts {
  low: number;
  medium: number;
  high: number;
  total: number;
}

export interface AIReviewRequestResponse {
  review_id: string;
  summary: string;
  proposals: AIProposal[];
  not_reviewed: number[];
  counts: AIReviewRiskCounts;
}

export interface AIReviewApplyResponse {
  results: FixApplyResult[];
  proposed_sources: Partial<Record<FixSourceFile, string>>;
  conflicts: number[];
}

export interface AIReviewRequestPayload {
  report: number;
  issue_ids: number[];
  html: string;
  css?: string;
  js?: string;
  ampscript?: string;
  css_source_type?: CssSourceType;
  validation_scope?: ValidationScope;
  profile?: string;
}

// Yukti explains validation issues — read-only, never writes to source,
// never proposes a patch. `issue_ids: []` means "every actionable issue
// currently on the report" (batch/Complete-LP explanation); a non-empty
// list scopes the explanation to just those issues (normally one, for the
// per-issue "Ask Yukti" flow). See backend/landingpages/yukti_explain/.
export interface YuktiExplainRequestPayload {
  report: number;
  issue_ids?: number[];
  html: string;
  css?: string;
  js?: string;
  ampscript?: string;
  css_source_type?: CssSourceType;
  validation_scope?: ValidationScope;
  profile?: string;
}

export type YuktiFixMethod = 'deterministic' | 'ai-assisted';

export interface YuktiExplainCounts {
  errors: number;
  warnings: number;
  info: number;
}

export interface YuktiLanguageBreakdown {
  language: string;
  errors: number;
  warnings: number;
  info: number;
}

export interface YuktiMostImportantIssue {
  issue_id: number;
  reason: string;
}

export interface YuktiPerIssueExplanation {
  issue_id: number;
  what: string;
  why: string;
  impact: string;
  recommended_correction: string;
  fix_method: YuktiFixMethod;
  requires_decision: boolean;
}

// Every numeric fact here (`counts`, `language_breakdown`, and each
// per_issue entry's `fix_method`/`requires_decision`) is computed
// server-side from real ValidationIssue rows and the real deterministic-
// fix engine — never asked of or trusted from the AI provider. Only
// `summary`/`most_important[].reason`/`why_it_matters`/`how_to_fix`/
// `recommended_order`/`per_issue[].{what,why,impact,recommended_correction}`
// are AI-generated narration around those facts.
export interface YuktiExplainResponse {
  counts: YuktiExplainCounts;
  language_breakdown: YuktiLanguageBreakdown[];
  truncated: boolean;
  summary: string;
  most_important: YuktiMostImportantIssue[];
  why_it_matters: string;
  how_to_fix: string;
  recommended_order: string;
  per_issue: YuktiPerIssueExplanation[];
}

export interface AIReviewApplyPayload {
  report: number;
  review_id: string;
  accepted_fix_ids: string[];
  html: string;
  css?: string;
  js?: string;
  ampscript?: string;
  css_source_type?: CssSourceType;
  validation_scope?: ValidationScope;
  profile?: string;
}

// Secure Preview — the assembled document is never rendered by this React
// app itself (see backend/landingpages/preview/__init__.py). The page only
// ever receives a short-lived snapshot token/URL and opens it in a new,
// noopener/noreferrer tab; it never sees the assembled HTML string.
export interface PreviewRequestPayload {
  html: string;
  css?: string;
  js?: string;
  ampscript?: string;
  css_source_type?: CssSourceType;
  validation_scope?: ValidationScope;
  profile?: string;
  ampscript_mock_values?: Record<string, string>;
}

export interface PreviewRequestResponse {
  token: string;
  preview_url: string;
  expires_at: string;
  ampscript_simulated: boolean;
}

export interface PreviewApiError {
  code?: string;
  message: string;
}

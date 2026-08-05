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
export type IssueFile = 'html' | 'css' | 'javascript' | 'typescript' | 'cdn';
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
}

export interface EngineStatusEntry {
  engine_name: string;
  success: boolean;
  duration_ms: number;
  issue_count: number;
  message: string;
}

export type ValidationScope = 'complete' | 'html' | 'css' | 'javascript' | 'typescript';

export interface ValidationReport {
  id: number;
  project: number | null;
  version: number | null;
  duration_ms: number;
  profile: string;
  validation_scope: ValidationScope;
  engine_status: EngineStatusEntry[];
  error_count: number;
  warning_count: number;
  info_count: number;
  created_at: string;
  issues: ValidationIssue[];
}

export interface ValidateRequest {
  html: string;
  css?: string;
  js?: string;
  ts?: string;
  project?: number | null;
  validation_scope?: ValidationScope;
}

// The four editable code tabs. Deliberately excludes 'cdn' — no CDN input
// exists yet in Sprint 1B, matching the "only existing Sprint 1A endpoints,
// nothing invented" boundary.
export type EditorLanguage = 'html' | 'css' | 'js' | 'ts';

export const EDITOR_LANGUAGES: readonly { key: EditorLanguage; label: string; file: IssueFile }[] = [
  { key: 'html', label: 'HTML', file: 'html' },
  { key: 'css', label: 'CSS', file: 'css' },
  { key: 'js', label: 'JavaScript', file: 'javascript' },
  { key: 'ts', label: 'TypeScript', file: 'typescript' },
] as const;

export type IssueFilter = 'all' | 'error' | 'warning' | 'info';

export const VALIDATION_SCOPES: readonly { key: ValidationScope; label: string }[] = [
  { key: 'complete', label: 'Complete LP' },
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'javascript', label: 'JavaScript' },
  { key: 'typescript', label: 'TypeScript' },
] as const;

// Backend language/file codes -> full user-facing names. Never show a raw
// internal value like "js"/"ts"/"html5lib"/"stylelint" in the UI.
export const LANGUAGE_DISPLAY_NAME: Record<IssueFile, string> = {
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  cdn: 'CDN',
};

export const SEVERITY_DISPLAY_NAME: Record<IssueSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Information',
};

// Editor tab key -> Monaco's own language id.
export const MONACO_LANGUAGE_FOR: Record<EditorLanguage, string> = {
  html: 'html',
  css: 'css',
  js: 'javascript',
  ts: 'typescript',
};

// Backend `file` value -> the editor tab key that source lives in (the
// inverse of EDITOR_LANGUAGES[].file) — used by Go to Line / markers to
// find the right tab for an issue.
export const EDITOR_LANGUAGE_FOR_FILE: Partial<Record<IssueFile, EditorLanguage>> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
  typescript: 'ts',
};

// Which engines currently exist. Sprint 1D: only HTML/CSS. Updated in
// Sprint 1E when JS/TS adapters land — the scope control reads this
// directly, so no redesign is needed then, only flipping these to true.
export const ENGINE_AVAILABILITY: Record<ValidationScope, boolean> = {
  complete: true,
  html: true,
  css: true,
  javascript: false,
  typescript: false,
};

// A single-language scope maps to exactly one editor tab; 'complete' has
// no single answer (all four apply), so it is deliberately absent here —
// callers branch on `undefined` to mean "every tab applies".
export const SCOPE_TO_EDITOR_LANGUAGE: Partial<Record<ValidationScope, EditorLanguage>> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
  typescript: 'ts',
};

// Empty-workspace guidance shown per scope before the scope-relevant
// source has any content — also used as the disabled Validate button's
// tooltip. 'html'/'css'/'javascript'/'typescript' mirror the backend
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
  javascript: 'JavaScript validation is not available yet.',
  typescript: 'TypeScript validation is not available yet.',
};

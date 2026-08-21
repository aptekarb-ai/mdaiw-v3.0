import { LANGUAGE_DISPLAY_NAME, SEVERITY_DISPLAY_NAME, type IssueCardStatus, type IssueSeverity, type ValidationIssue } from '../types/landingpages';

// Verified-green rule (non-negotiable, mega-spec section 6): a card may
// only read "✓ Fixed" once a repair candidate was applied AND
// authoritative revalidation confirmed the issue no longer exists — never
// merely because a proposal was generated or an HTTP call returned 200.
// That distinction is enforced upstream (fixes/iterative.py only ever
// emits 'resolved' via _fingerprint_status_diff, computed from a REAL
// before/after issue-list diff) — this component only renders whatever
// status it is given, so the guarantee lives in the data, not the paint.
const CARD_STATUS_LABEL: Record<IssueCardStatus, string> = {
  pending: '',
  fixing: 'Fixing…',
  revalidating: 'Revalidating…',
  resolved: '✓ Fixed',
  requires_input: 'Needs input',
  newly_exposed: 'Newly detected after repair',
  failed: 'Could not safely repair',
};

// Secure JavaScript DOM Repair closure spec, section 13 — the same
// verified-green invariant above, just with wording specific to a
// dangerous-DOM-sink finding so the user can see this repair is doing
// security-sensitive work, not a generic text edit. Only 'fixing' and
// 'revalidating' change; 'requires_input'/'failed'/'newly_exposed' keep
// their generic wording since those already communicate the real state.
const SECURITY_RULE_PREFIX = 'mdaiw-security/';
const SECURITY_CARD_STATUS_LABEL: Partial<Record<IssueCardStatus, string>> = {
  fixing: 'Building secure DOM replacement…',
  revalidating: 'Revalidating JavaScript security…',
  resolved: '✓ Securely fixed',
};

function cardStatusLabel(cardStatus: IssueCardStatus | undefined, ruleId: string): string {
  if (!cardStatus) return '';
  if (ruleId.startsWith(SECURITY_RULE_PREFIX)) {
    return SECURITY_CARD_STATUS_LABEL[cardStatus] ?? CARD_STATUS_LABEL[cardStatus];
  }
  return CARD_STATUS_LABEL[cardStatus];
}

const SEVERITY_ICON: Record<IssueSeverity, string> = {
  error: 'error-circle',
  warning: 'warning',
  info: 'help',
};

// Known raw engine names -> a presentable label with version, e.g.
// "Stylelint 17.14.1". Anything unrecognized falls back to the raw
// engine name (still never shown as the PRIMARY label — only in the
// secondary technical metadata line).
const ENGINE_DISPLAY_NAME: Record<string, string> = {
  html5lib: 'html5lib',
  postcss: 'PostCSS',
  stylelint: 'Stylelint',
  'html-structure': 'HTML Structure Checker',
  'html-lexical': 'HTML Tag Syntax Checker',
  'html-tag-stack': 'HTML Structure Checker (Independent)',
  'nu-html-checker': 'Nu Html Checker',
  'html-accessibility': 'HTML Accessibility Checker',
  'html-seo': 'HTML SEO Checker',
  'html-responsive': 'HTML Responsive Checker',
  'html-inline-style': 'Inline Style Checker',
  'html-style-block': 'Style Block Checker',
  'html-external-stylesheet': 'External Stylesheet Checker',
  'css-custom': 'MDAIW CSS Rules',
  eslint: 'ESLint',
  'html-embedded-javascript': 'Embedded Script Checker',
  'html-inline-event-handler': 'Inline Handler Checker',
  'html-external-script': 'External Script Checker',
  'mdaiw-security': 'MDAIW JavaScript Security Rules',
  'mdaiw-lp': 'MDAIW Landing Page Rules',
  'mdaiw-compat': 'MDAIW Compatibility Notices',
  orchestrator: 'MDAIW Validator',
  'ai-engineer': 'AI Engineer',
  'ai-engineer-cross-language': 'AI Engineer — Cross-Language Analysis',
};

// A merged finding's source_engine is composite, e.g.
// 'html-structure+ai-engineer' (see ai_engineer/__init__.py::
// _merge_or_append) — "Detected by: HTML Structure Checker + AI Engineer",
// per spec. Each '+'-separated part is looked up independently so an
// unrecognized deterministic engine name still degrades to its raw id
// rather than losing the whole label.
function formatDetectedBy(sourceEngine: string): string {
  return sourceEngine.split('+').map((part) => ENGINE_DISPLAY_NAME[part] ?? part).join(' + ');
}

// An issue's `file` says which editor tab to open (Go to Line); its
// `language` says what it actually is. They differ only for CSS embedded
// in HTML — an inline style="..." attribute or an internal <style> block
// is language: 'css' but file: 'html', since that's where the developer
// edits it. The primary label must reflect `language` (what it is), with
// a context prefix identifying where it came from.
const SOURCE_CONTEXT_LABEL_PREFIX: Record<string, string> = {
  'html-inline-style': 'Inline',
  'html-style-block': 'Internal',
  'local-external-stylesheet': 'External',
  'approved-external-stylesheet': 'External',
  'external-stylesheet-reference': 'External',
  // Sprint CSS-E — a finding against SCSS/Sass/LESS's *generated* CSS is
  // still language: 'css' (see css_scss_sass.py/css_less.py), but the
  // developer wrote SCSS/Sass/LESS, not CSS — the prefix says what they
  // actually typed, matching the spec's "SCSS Error"/"CSS Warning
  // generated from SCSS" labeling.
  'standalone-scss': 'SCSS',
  'standalone-sass': 'Sass',
  'standalone-less': 'LESS',
  // JS engine sprint — same "where it came from" prefix pattern as the
  // CSS embedded/external contexts above.
  'html-script-block': 'Embedded',
  'html-inline-event-handler': 'Inline',
  'local-external-script': 'External',
  'approved-external-script-reference': 'External',
  'external-script-reference': 'External',
};

const SOURCE_CONTEXT_DETAIL: Record<string, string> = {
  'html-inline-style': 'Inline style in HTML',
  'html-style-block': 'Internal <style> block · HTML',
  'local-external-stylesheet': 'Local project stylesheet · <link>',
  'approved-external-stylesheet': 'Approved external stylesheet reference · <link>',
  'external-stylesheet-reference': 'External stylesheet reference · <link>',
  'standalone-scss': 'Generated from SCSS',
  'standalone-sass': 'Generated from Sass',
  'standalone-less': 'Generated from LESS',
  // AMPscript-replacement sprint — neither context gets a label prefix
  // (the primary label always reads plain "AMPscript Error/Warning/
  // Information"); this detail line alone distinguishes where it came
  // from, per the spec's own two examples.
  'ampscript-source': 'AMPscript source',
  'html-embedded-ampscript': 'Embedded in HTML',
  'standalone-javascript': 'JavaScript source',
  'html-script-block': 'Embedded <script> block · HTML',
  'html-inline-event-handler': 'Inline event handler · HTML',
  'local-external-script': 'Local project script · <script src>',
  'approved-external-script-reference': 'Approved external script reference · <script src>',
  'external-script-reference': 'External script reference · <script src>',
};

export interface ValidationIssueCardProps {
  issue: ValidationIssue;
  onGoToLine: (issue: ValidationIssue) => void;
  onFixThisIssue: (issue: ValidationIssue) => void;
  onAskYukti: (issue: ValidationIssue) => void;
  cardStatus?: IssueCardStatus;
}

// 'cdn'/'typescript' issues have no editor tab to locate or patch a
// source range in (see FILE_TO_LANGUAGE in LandingPageValidatorPage.tsx)
// — there is structurally nothing for either fix engine to target, so
// AI Fix This Issue is disabled up front rather than opening a dialog
// that can only ever say "review manually" (spec section 15: "If issue
// cannot safely be fixed... rather than offering a fake fix").
const NON_ACTIONABLE_FILES = new Set(['cdn', 'typescript']);

// Sprint CSS-E — a preprocessor's OWN diagnostic (Dart Sass/Less rejecting
// the source itself, e.g. an undefined variable) is reported at the real
// SCSS/Sass/LESS source line and should read "SCSS Error", not "CSS
// Error" — the developer never wrote any CSS. A finding from the CSS
// pipeline (Stylelint/PostCSS/css-tree) running against the *generated*
// CSS is genuinely a CSS-level finding and should read "CSS Warning",
// with "Generated from SCSS" as context — see css_scss_sass.py/
// css_less.py's source_engine ('scss'/'sass'/'less' for the compiler's
// own errors; 'stylelint'/'postcss'/'csstree' for everything else).
const STANDALONE_PREPROCESSOR_CONTEXTS = new Set(['standalone-scss', 'standalone-sass', 'standalone-less']);
const PREPROCESSOR_OWN_ENGINES = new Set(['scss', 'sass', 'less']);
const COMPILER_DETAIL_LABEL: Record<string, string> = {
  'standalone-scss': 'SCSS compiler',
  'standalone-sass': 'Sass compiler',
  'standalone-less': 'LESS compiler',
};

export function ValidationIssueCard({ issue, onGoToLine, onFixThisIssue, onAskYukti, cardStatus }: ValidationIssueCardProps) {
  const languageLabel = LANGUAGE_DISPLAY_NAME[issue.language] ?? issue.language;
  const severityLabel = SEVERITY_DISPLAY_NAME[issue.severity];
  const contextPrefix = issue.source_context ? SOURCE_CONTEXT_LABEL_PREFIX[issue.source_context] : undefined;
  const isStandaloneContext = STANDALONE_PREPROCESSOR_CONTEXTS.has(issue.source_context ?? '');
  const isPreprocessorOwnDiagnostic = isStandaloneContext && PREPROCESSOR_OWN_ENGINES.has(issue.source_engine ?? '');

  // A failed compilation's own diagnostic (and any supplemental recovery
  // finding alongside it — see compile_less.mjs/compile_scss.mjs) must
  // never say "Generated from SCSS/Sass/LESS": no CSS was generated.
  // Applies uniformly to all three preprocessors' own compiler
  // diagnostics; a CSS-pipeline finding against genuinely generated CSS
  // keeps the existing "Generated from ..." detail text.
  const detailContext = isPreprocessorOwnDiagnostic
    ? COMPILER_DETAIL_LABEL[issue.source_context ?? '']
    : (issue.source_context && SOURCE_CONTEXT_DETAIL[issue.source_context]) || languageLabel;

  let combinedLabel: string;
  if (isPreprocessorOwnDiagnostic) {
    combinedLabel = `${contextPrefix} ${severityLabel}`;
  } else if (isStandaloneContext || issue.language === 'ampscript' || !contextPrefix) {
    combinedLabel = `${languageLabel} ${severityLabel}`;
  } else {
    combinedLabel = `${contextPrefix} ${languageLabel} ${severityLabel}`;
  }
  const icon = SEVERITY_ICON[issue.severity];

  const engineLabel = issue.source_engine ? formatDetectedBy(issue.source_engine) : '';
  const engineMeta = [engineLabel, issue.engine_version].filter(Boolean).join(' ');
  const aiMetadata = issue.ai_metadata;

  // While a repair operation is actively working this specific card
  // (fixing/revalidating) or has already verified it resolved, both
  // actions are disabled — there is nothing left to trigger, and firing
  // a second repair mid-flight would race the operation already running.
  const busyOrDone = cardStatus === 'fixing' || cardStatus === 'revalidating' || cardStatus === 'resolved';
  // Correctness-pass sprint — an 'info'-severity finding is always
  // advisory-only in this project's convention (e.g. a guarded-optional
  // DOM selector reference, a legacy-profile modern-feature notice) —
  // there is nothing to fix, so offering the button would only ever open
  // a dialog saying "review manually," which spec section 15 already
  // treats as worse than not offering it at all (see NON_ACTIONABLE_
  // FILES above, same reasoning).
  const canFix = !NON_ACTIONABLE_FILES.has(issue.file) && issue.severity !== 'info' && !busyOrDone;
  const statusLabel = cardStatusLabel(cardStatus, issue.rule_id);
  const cardStatusModifier = cardStatus && cardStatus !== 'pending' ? ` validation-issue-card--status-${cardStatus}` : '';

  const displayIcon = cardStatus === 'resolved' ? 'check-circle' : icon;

  return (
    <li className={`validation-issue-card validation-issue-card--${issue.severity}${cardStatusModifier}`}>
      <span
        className={`mdaiw-icon mdaiw-icon--${displayIcon} validation-issue-card__icon`}
        aria-hidden="true"
      />
      <div className="validation-issue-card__body">
        <div className="validation-issue-card__meta">
          <span className="validation-issue-card__severity">{combinedLabel}</span>
          <span className="validation-issue-card__location">
            Line {issue.line}
            {issue.column ? `:${issue.column}` : ''}
          </span>
          {/* Status must never be color-only (mega-spec section 23) — the
              border/tint is a reinforcement, this text/icon pairing is
              the actual signal. */}
          {statusLabel && (
            <span className={`validation-issue-card__status validation-issue-card__status--${cardStatus}`}>
              {statusLabel}
            </span>
          )}
        </div>
        <p className="validation-issue-card__message">{issue.message}</p>
        <p className="validation-issue-card__detail">
          {issue.category} &middot; {issue.rule_id} &middot; {detailContext}
        </p>
        {issue.suggestion && <p className="validation-issue-card__suggestion">{issue.suggestion}</p>}
        {engineMeta && <p className="validation-issue-card__engine">Detected by: {engineMeta}</p>}
        {aiMetadata && (
          <p className="validation-issue-card__ai-reasoning">
            {aiMetadata.ai_message
              ? `The AI Engineer also flagged this: ${aiMetadata.reasoning}`
              : aiMetadata.reasoning}
            {aiMetadata.cross_language && ' (cross-language finding)'}
          </p>
        )}
      </div>
      {cardStatus !== 'resolved' && (
        <div className="validation-issue-card__actions">
          <button
            type="button"
            className="button button--outline validation-issue-card__goto"
            onClick={() => onGoToLine(issue)}
          >
            Go to Line
          </button>
          <button
            type="button"
            className="button button--outline validation-issue-card__fix"
            disabled={!canFix}
            title={canFix ? 'Review and generate a correction for this validation issue.' : 'Review manually.'}
            onClick={() => onFixThisIssue(issue)}
          >
            AI Fix This Issue
          </button>
          <button
            type="button"
            className="button button--outline validation-issue-card__ask-yukti"
            aria-label="Ask Yukti to Explain"
            title="Ask Yukti to explain this issue, why it matters, and how it can be fixed."
            onClick={() => onAskYukti(issue)}
          >
            Ask Yukti to Explain
          </button>
        </div>
      )}
    </li>
  );
}

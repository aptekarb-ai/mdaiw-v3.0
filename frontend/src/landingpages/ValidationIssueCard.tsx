import { LANGUAGE_DISPLAY_NAME, SEVERITY_DISPLAY_NAME, type IssueSeverity, type ValidationIssue } from '../types/landingpages';

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
  'html-accessibility': 'HTML Accessibility Checker',
  'html-seo': 'HTML SEO Checker',
  'html-responsive': 'HTML Responsive Checker',
  'html-inline-style': 'Inline Style Checker',
  'html-style-block': 'Style Block Checker',
  'css-custom': 'MDAIW CSS Rules',
  orchestrator: 'MDAIW Validator',
};

// An issue's `file` says which editor tab to open (Go to Line); its
// `language` says what it actually is. They differ only for CSS embedded
// in HTML — an inline style="..." attribute or an internal <style> block
// is language: 'css' but file: 'html', since that's where the developer
// edits it. The primary label must reflect `language` (what it is), with
// a context prefix identifying where it came from.
const SOURCE_CONTEXT_LABEL_PREFIX: Record<string, string> = {
  'html-inline-style': 'Inline',
  'html-style-block': 'Internal',
};

const SOURCE_CONTEXT_DETAIL: Record<string, string> = {
  'html-inline-style': 'Inline style in HTML',
  'html-style-block': 'Internal <style> block · HTML',
};

export interface ValidationIssueCardProps {
  issue: ValidationIssue;
  onGoToLine: (issue: ValidationIssue) => void;
}

export function ValidationIssueCard({ issue, onGoToLine }: ValidationIssueCardProps) {
  const languageLabel = LANGUAGE_DISPLAY_NAME[issue.language] ?? issue.language;
  const severityLabel = SEVERITY_DISPLAY_NAME[issue.severity];
  const contextPrefix = issue.source_context ? SOURCE_CONTEXT_LABEL_PREFIX[issue.source_context] : undefined;
  const combinedLabel = contextPrefix
    ? `${contextPrefix} ${languageLabel} ${severityLabel}`
    : `${languageLabel} ${severityLabel}`;
  const detailContext = (issue.source_context && SOURCE_CONTEXT_DETAIL[issue.source_context]) || languageLabel;
  const icon = SEVERITY_ICON[issue.severity];

  const engineLabel = issue.source_engine ? (ENGINE_DISPLAY_NAME[issue.source_engine] ?? issue.source_engine) : '';
  const engineMeta = [engineLabel, issue.engine_version].filter(Boolean).join(' ');

  return (
    <li className={`validation-issue-card validation-issue-card--${issue.severity}`}>
      <span
        className={`mdaiw-icon mdaiw-icon--${icon} validation-issue-card__icon`}
        aria-hidden="true"
      />
      <div className="validation-issue-card__body">
        <div className="validation-issue-card__meta">
          <span className="validation-issue-card__severity">{combinedLabel}</span>
          <span className="validation-issue-card__location">
            Line {issue.line}
            {issue.column ? `:${issue.column}` : ''}
          </span>
        </div>
        <p className="validation-issue-card__message">{issue.message}</p>
        <p className="validation-issue-card__detail">
          {issue.category} &middot; {issue.rule_id} &middot; {detailContext}
        </p>
        {issue.suggestion && <p className="validation-issue-card__suggestion">{issue.suggestion}</p>}
        {engineMeta && <p className="validation-issue-card__engine">{engineMeta}</p>}
      </div>
      <button
        type="button"
        className="button button--outline validation-issue-card__goto"
        onClick={() => onGoToLine(issue)}
      >
        Go to Line
      </button>
    </li>
  );
}

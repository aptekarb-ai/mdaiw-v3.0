import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CodeEditorTabs, type CodeEditorTabsHandle } from '../landingpages/CodeEditorTabs';
import { ValidatorToolbar } from '../landingpages/ValidatorToolbar';
import { ValidationIssuesPanel } from '../landingpages/ValidationIssuesPanel';
import { ValidatorEmptyState } from '../landingpages/ValidatorEmptyState';
import { ValidationScopeControl } from '../landingpages/ValidationScopeControl';
import type { CodeEditorMarker } from '../landingpages/CodeEditor';
import { useValidator } from '../hooks/useValidator';
import {
  EDITOR_LANGUAGES,
  EMPTY_STATE_MESSAGE_FOR_SCOPE,
  ENGINE_AVAILABILITY,
  LANGUAGE_DISPLAY_NAME,
  SCOPE_TO_EDITOR_LANGUAGE,
  type EditorLanguage,
  type IssueFile,
  type ValidationIssue,
  type ValidationReport,
  type ValidationScope,
} from '../types/landingpages';
import './LandingPageValidatorPage.css';

const FILE_TO_LANGUAGE: Record<IssueFile, EditorLanguage | null> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
  typescript: 'ts',
  cdn: null,
};

// Which engine_status entries are relevant to each editor language — used
// to decide whether a revalidation is trustworthy enough to confirm a
// resolved issue (see computeResolvedLines below).
const ENGINE_NAMES_BY_LANGUAGE: Record<EditorLanguage, string[]> = {
  html: ['html5lib', 'html-structure', 'html-accessibility', 'html-seo', 'html-responsive', 'html-required'],
  css: ['css-conformance'],
  js: ['javascript-conformance'],
  ts: ['typescript-conformance'],
};

const EMPTY_VALUES: Record<EditorLanguage, string> = { html: '', css: '', js: '', ts: '' };
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

export function LandingPageValidatorPage() {
  const [values, setValues] = useState<Record<EditorLanguage, string>>(EMPTY_VALUES);
  const [validationScope, setValidationScope] = useState<ValidationScope>('complete');
  const [liveMessage, setLiveMessage] = useState('');
  const [isStale, setIsStale] = useState(false);
  const [resolvedLinesByLanguage, setResolvedLinesByLanguage] =
    useState<Partial<Record<EditorLanguage, number[]>>>(EMPTY_RESOLVED);
  const editorTabsRef = useRef<CodeEditorTabsHandle>(null);
  const previousReportRef = useRef<ValidationReport | null>(null);
  const { status, report, error, validate, reset } = useValidator();

  useEffect(() => {
    if (status === 'validating') {
      setLiveMessage('Validating code…');
    } else if (status === 'success' && report) {
      const total = report.error_count + report.warning_count + report.info_count;
      setLiveMessage(
        total === 0
          ? 'Validation complete. No issues found.'
          : `Validation complete. ${total} issue${total === 1 ? '' : 's'} found.`,
      );
      setIsStale(false);

      const nextResolved: Partial<Record<EditorLanguage, number[]>> = {};
      for (const entry of EDITOR_LANGUAGES) {
        const lines = computeResolvedLines(previousReportRef.current, report, entry.key);
        if (lines.length > 0) nextResolved[entry.key] = lines;
      }
      setResolvedLinesByLanguage(nextResolved);
      previousReportRef.current = report;
    } else if (status === 'error' && error) {
      setLiveMessage(`Validation failed: ${error.message}`);
    }
  }, [status, report, error]);

  function handleCodeChange(language: EditorLanguage, value: string) {
    setValues((previous) => ({ ...previous, [language]: value }));
    if (!report) return;

    const reportCoversThisLanguage = report.validation_scope === 'complete'
      || SCOPE_TO_EDITOR_LANGUAGE[report.validation_scope] === language;
    if (reportCoversThisLanguage && !isStale) {
      setIsStale(true);
      setResolvedLinesByLanguage(EMPTY_RESOLVED);
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
      setLiveMessage('Validation scope changed. Previous results were cleared — validate again to see results for the new scope.');
    }
  }

  function isValidateEnabled(): boolean {
    if (validationScope === 'complete' || validationScope === 'html') return values.html.trim().length > 0;
    if (validationScope === 'css') return values.css.trim().length > 0;
    if (validationScope === 'javascript') return ENGINE_AVAILABILITY.javascript && values.js.trim().length > 0;
    if (validationScope === 'typescript') return ENGINE_AVAILABILITY.typescript && values.ts.trim().length > 0;
    return false;
  }

  function emptyStateMessage(): string {
    if (!ENGINE_AVAILABILITY[validationScope]) return EMPTY_STATE_MESSAGE_FOR_SCOPE[validationScope];
    return isValidateEnabled() ? 'Ready to validate — select Validate Code.' : EMPTY_STATE_MESSAGE_FOR_SCOPE[validationScope];
  }

  function handleValidate() {
    void validate({
      html: values.html, css: values.css, js: values.js, ts: values.ts,
      validation_scope: validationScope,
    });
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
    setValues((previous) => ({ ...previous, [language]: '' }));
    if (report) {
      const reportCoversThisLanguage = report.validation_scope === 'complete'
        || SCOPE_TO_EDITOR_LANGUAGE[report.validation_scope] === language;
      if (reportCoversThisLanguage) {
        setIsStale(true);
        setResolvedLinesByLanguage(EMPTY_RESOLVED);
      }
    }
    const label = EDITOR_LANGUAGES.find((entry) => entry.key === language)?.label ?? language;
    setLiveMessage(`${label} code cleared.`);
  }

  async function handleCopy() {
    const combined = [
      '<!-- HTML -->', values.html,
      '', '/* CSS */', values.css,
      '', '// JavaScript', values.js,
      '', '// TypeScript', values.ts,
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

  return (
    <section className="validator-page">
      <div className="validator-page__header">
        <Link to="/dashboard" className="validator-page__back" aria-label="Back to Dashboard">
          <span className="mdaiw-icon mdaiw-icon--arrow-left" aria-hidden="true" />
        </Link>
        <h1>LP Validator &amp; Fixer</h1>
      </div>

      <ValidationScopeControl value={validationScope} onChange={handleScopeChange} disabled={status === 'validating'} />

      <ValidatorToolbar
        onValidate={handleValidate}
        validating={status === 'validating'}
        onCopy={handleCopy}
        validateDisabled={!isValidateEnabled()}
        validateDisabledReason={isValidateEnabled() ? undefined : emptyStateMessage()}
        scope={validationScope}
      />

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
          />
        </div>

        <div className="validator-page__results">
          {status === 'error' && error ? (
            <div className="validator-error-banner" role="alert">
              <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
              <p>{error.message}</p>
              <button type="button" className="button button--outline" onClick={handleValidate}>
                Try Again
              </button>
            </div>
          ) : status === 'validating' ? (
            <div className="validator-empty-state" role="status">
              <span className="mdaiw-icon mdaiw-icon--spinner validator-empty-state__spinner" aria-hidden="true" />
              <p>Validating code…</p>
            </div>
          ) : isStale && report ? (
            <div className="validator-stale-banner" role="status">
              <span className="mdaiw-icon mdaiw-icon--refresh" aria-hidden="true" />
              <p>Code changed. Validate again to update the results.</p>
            </div>
          ) : report ? (
            <ValidationIssuesPanel
              issues={report.issues}
              counts={{
                error: report.error_count,
                warning: report.warning_count,
                info: report.info_count,
              }}
              onGoToLine={handleGoToLine}
            />
          ) : (
            <ValidatorEmptyState message={emptyStateMessage()} />
          )}
        </div>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {liveMessage}
      </p>
    </section>
  );
}

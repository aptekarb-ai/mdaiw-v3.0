import type { AnalysisCoverage, AnalysisCoverageLanguageEntry } from '../types/landingpages';
import './AnalysisCoveragePanel.css';

const LANGUAGE_LABEL: Record<string, string> = {
  html: 'HTML', css: 'CSS', javascript: 'JavaScript', ampscript: 'AMPscript',
};

const AI_STATUS_LABEL: Record<AnalysisCoverageLanguageEntry['ai'], string> = {
  complete: 'Complete',
  partial: 'Partial',
  unavailable: 'Unavailable',
  'skipped-too-large': 'Skipped — source too large',
  'skipped-empty': 'Not applicable',
};

export interface AnalysisCoveragePanelProps {
  coverage: AnalysisCoverage | undefined;
}

// Spec section 19 — a subtle status entry, never a cluttering primary
// element: collapsed by default (native <details>, no extra JS state),
// showing just "Analysis Complete" or "Analysis Details" (when anything
// is partial/unavailable) until the user opens it.
export function AnalysisCoveragePanel({ coverage }: AnalysisCoveragePanelProps) {
  if (!coverage || Object.keys(coverage).length === 0) return null;

  const { cross_language: crossLanguage, ...languageEntries } = coverage;
  const entries = Object.entries(languageEntries) as [string, AnalysisCoverageLanguageEntry][];
  const applicableEntries = entries.filter(([, entry]) => entry.ai !== 'skipped-empty');
  if (applicableEntries.length === 0 && !crossLanguage) return null;

  const allComplete = applicableEntries.every(([, entry]) => entry.ai === 'complete')
    && (!crossLanguage || crossLanguage.status === 'complete');
  const summaryLabel = allComplete ? 'Analysis Complete' : 'Analysis Details';
  // Spec section 16/8 — AI Engineer being unavailable must never read as
  // "Validation could not be completed" (that message is reserved for a
  // genuine DETERMINISTIC failure — see LandingPageValidatorPage's error
  // branch, entirely separate from this panel). This is the explicit,
  // calm notice for that specific case: deterministic findings above are
  // still complete and trustworthy; only the AI enrichment layer failed.
  const anyUnavailable = applicableEntries.some(([, entry]) => entry.ai === 'unavailable')
    || crossLanguage?.status === 'unavailable';

  return (
    <details className="analysis-coverage-panel">
      <summary className="analysis-coverage-panel__summary">
        <span className={`mdaiw-icon mdaiw-icon--${allComplete ? 'check-circle' : 'help'}`} aria-hidden="true" />
        {summaryLabel}
      </summary>
      {anyUnavailable && (
        <p className="analysis-coverage-panel__unavailable-notice">
          AI Engineer — Unavailable. Deterministic validation findings above are unaffected.
        </p>
      )}
      <table className="analysis-coverage-panel__table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Lines</th>
            <th scope="col">Engine coverage</th>
            <th scope="col">AI Engineer coverage</th>
          </tr>
        </thead>
        <tbody>
          {applicableEntries.map(([language, entry]) => (
            <tr key={language}>
              <th scope="row">{LANGUAGE_LABEL[language] ?? language}</th>
              <td>{entry.source_lines}</td>
              <td>{entry.engine === 'complete' ? 'Complete' : 'Not applicable'}</td>
              <td>
                {AI_STATUS_LABEL[entry.ai]}
                {entry.failure_reason && (
                  <span className="analysis-coverage-panel__reason"> — {entry.failure_reason}</span>
                )}
              </td>
            </tr>
          ))}
          {crossLanguage && (
            <tr>
              <th scope="row">Cross-language</th>
              <td>—</td>
              <td>—</td>
              <td>
                {crossLanguage.status === 'complete' ? 'Complete'
                  : crossLanguage.status === 'unavailable' ? 'Unavailable' : 'Skipped'}
                {crossLanguage.failure_reason && (
                  <span className="analysis-coverage-panel__reason"> — {crossLanguage.failure_reason}</span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </details>
  );
}

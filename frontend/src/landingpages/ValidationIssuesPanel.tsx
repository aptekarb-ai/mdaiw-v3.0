import { useRef, useState, type KeyboardEvent } from 'react';
import { ValidationIssueCard } from './ValidationIssueCard';
import { LANGUAGE_DISPLAY_NAME, type IssueFile, type IssueFilter, type ValidationIssue } from '../types/landingpages';
import './ValidationIssuesPanel.css';

export interface ValidationIssuesPanelProps {
  issues: ValidationIssue[];
  counts: { error: number; warning: number; info: number };
  onGoToLine: (issue: ValidationIssue) => void;
}

const FILTERS: { key: IssueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'error', label: 'Errors' },
  { key: 'warning', label: 'Warnings' },
  { key: 'info', label: 'Information' },
];
const FILTER_KEYS = FILTERS.map((entry) => entry.key);

type LanguageFilterKey = 'all' | IssueFile;

function severityCounts(scopedIssues: ValidationIssue[]) {
  return {
    error: scopedIssues.filter((issue) => issue.severity === 'error').length,
    warning: scopedIssues.filter((issue) => issue.severity === 'warning').length,
    info: scopedIssues.filter((issue) => issue.severity === 'info').length,
  };
}

export function ValidationIssuesPanel({ issues, counts, onGoToLine }: ValidationIssuesPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<IssueFilter>('all');
  const [languageFilter, setLanguageFilter] = useState<LanguageFilterKey>('all');
  const filterRefs = useRef<Partial<Record<IssueFilter, HTMLButtonElement | null>>>({});
  const languageFilterRefs = useRef<Partial<Record<LanguageFilterKey, HTMLButtonElement | null>>>({});

  // Only languages actually present in this report get a filter button.
  const availableLanguages = Array.from(new Set(issues.map((issue) => issue.file)));
  const languageFilters: { key: LanguageFilterKey; label: string }[] = [
    { key: 'all', label: 'All Languages' },
    ...availableLanguages.map((file) => ({ key: file as LanguageFilterKey, label: LANGUAGE_DISPLAY_NAME[file] })),
  ];
  const languageFilterKeys = languageFilters.map((entry) => entry.key);

  const languageScoped = languageFilter === 'all' ? issues : issues.filter((issue) => issue.file === languageFilter);

  // Documented behaviour (see Part 11): severity counts reflect the
  // selected language filter; language-filter counts always reflect the
  // complete, unfiltered report. When no language filter is applied, the
  // parent-supplied `counts` is used as-is (it is truncation-aware —
  // computed server-side before any MAX_ISSUES slicing — which a
  // client-side recount of the visible `issues` array cannot reproduce).
  const effectiveCounts = languageFilter === 'all' ? counts : severityCounts(languageScoped);
  const effectiveTotal = effectiveCounts.error + effectiveCounts.warning + effectiveCounts.info;
  const reportTotal = counts.error + counts.warning + counts.info;

  const filtered = severityFilter === 'all'
    ? languageScoped
    : languageScoped.filter((issue) => issue.severity === severityFilter);

  function countFor(key: IssueFilter) {
    return key === 'all' ? effectiveTotal : effectiveCounts[key];
  }

  function handleFilterKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: IssueFilter) {
    const index = FILTER_KEYS.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % FILTER_KEYS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + FILTER_KEYS.length) % FILTER_KEYS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = FILTER_KEYS.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      const nextKey = FILTER_KEYS[nextIndex];
      setSeverityFilter(nextKey);
      filterRefs.current[nextKey]?.focus();
    }
  }

  function handleLanguageFilterKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: LanguageFilterKey) {
    const index = languageFilterKeys.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % languageFilterKeys.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + languageFilterKeys.length) % languageFilterKeys.length;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      const nextKey = languageFilterKeys[nextIndex];
      setLanguageFilter(nextKey);
      languageFilterRefs.current[nextKey]?.focus();
    }
  }

  return (
    <section className="validation-issues-panel" aria-label="Validation issues">
      <h2 className="validation-issues-panel__heading">Validation Issues ({reportTotal})</h2>

      {languageFilters.length > 2 && (
        <div
          role="tablist"
          aria-label="Filter issues by language"
          className="validation-issues-panel__filters validation-issues-panel__filters--language"
        >
          {languageFilters.map((entry) => (
            <button
              key={entry.key}
              ref={(el) => {
                languageFilterRefs.current[entry.key] = el;
              }}
              type="button"
              role="tab"
              aria-selected={languageFilter === entry.key}
              tabIndex={languageFilter === entry.key ? 0 : -1}
              className={
                languageFilter === entry.key
                  ? 'validation-issues-panel__filter validation-issues-panel__filter--active'
                  : 'validation-issues-panel__filter'
              }
              onClick={() => setLanguageFilter(entry.key)}
              onKeyDown={(event) => handleLanguageFilterKeyDown(event, entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div role="tablist" aria-label="Filter issues by severity" className="validation-issues-panel__filters">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            ref={(el) => {
              filterRefs.current[entry.key] = el;
            }}
            type="button"
            role="tab"
            aria-selected={severityFilter === entry.key}
            tabIndex={severityFilter === entry.key ? 0 : -1}
            className={
              severityFilter === entry.key
                ? 'validation-issues-panel__filter validation-issues-panel__filter--active'
                : 'validation-issues-panel__filter'
            }
            onClick={() => setSeverityFilter(entry.key)}
            onKeyDown={(event) => handleFilterKeyDown(event, entry.key)}
          >
            {entry.label} ({countFor(entry.key)})
          </button>
        ))}
      </div>

      {reportTotal === 0 ? (
        <div className="validation-issues-panel__empty-wrapper">
          <p className="validation-issues-panel__empty" role="status">
            No issues found. This code passed all current checks.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="validation-issues-panel__empty-wrapper">
          <p className="validation-issues-panel__empty" role="status">
            No {severityFilter === 'all' ? '' : severityFilter} issues in this filter.
          </p>
        </div>
      ) : (
        <ul className="validation-issues-panel__list" aria-label="Validation issues list">
          {filtered.map((issue) => (
            <ValidationIssueCard key={issue.id} issue={issue} onGoToLine={onGoToLine} />
          ))}
        </ul>
      )}
    </section>
  );
}

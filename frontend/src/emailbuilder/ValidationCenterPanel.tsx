import { useEffect, useMemo, useState } from 'react';
import { renderEmailDocument } from './htmlRenderer';
import { validateEmail, type ValidationIssue } from './emailValidation';
import type { EmailDocumentContent } from './edm';
import type { EmailPlatform } from './types';
import './ValidationCenterPanel.css';

interface ValidationCenterPanelProps {
  width: number;
  content: EmailDocumentContent;
  platform: EmailPlatform;
  emailTitle?: string;
  faviconUrl?: string;
  resetCssEnabled?: boolean;
  customCssEnabled?: boolean;
  customCss?: string;
  onNavigateToModule: (moduleId: string) => void;
  onApplySafeFix: (moduleId: string, propPatch: Record<string, unknown>) => void;
}

const SCORE_CIRCUMFERENCE = 2 * Math.PI * 52;

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-accent-green)';
  if (score >= 50) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function scoreMessage(score: number): string {
  if (score >= 90) return 'Great! Your email is almost ready.';
  if (score >= 70) return 'Good — a few things are worth a look.';
  if (score >= 40) return 'Several issues need attention before sending.';
  return 'This email has significant issues to fix.';
}

const STATUS_LABEL: Record<'good' | 'needs-improvement' | 'needs-attention', string> = {
  good: 'Good',
  'needs-improvement': 'Needs Improvement',
  'needs-attention': 'Needs Attention',
};

// Feature 12 — Validation Center. Deterministic-only (see
// emailValidation.ts's own header note): no AI backend exists yet in
// Module-4, so "AI-assisted fix" is a labeled "Coming soon" affordance,
// the same honest pattern Feature 11's "Send Test" already established,
// rather than a fabricated call. The PNG reference's "Recommendations"
// section is not implemented — it has no grounding in any real,
// checkable rule this app's EDM can evaluate (e.g. "preheader text" is
// not a concept that exists anywhere in the module system), so inventing
// generic advice text would be exactly the kind of fabrication this
// project has consistently avoided; every issue shown here traces to a
// real, reproducible check.
export function ValidationCenterPanel({
  width, content, platform, emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss,
  onNavigateToModule, onApplySafeFix,
}: ValidationCenterPanelProps) {
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [revalidateNonce, setRevalidateNonce] = useState(0);

  // Rendering/validating a corrupted document (e.g. a module missing its
  // props after a partial write) must not crash the whole Email Builder —
  // contained here, at this panel's own boundary, rather than by touching
  // the shared renderer Code Editor/Preview Studio also depend on.
  const rawHtml = useMemo(() => {
    try {
      return renderEmailDocument({ width, content, title: emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss });
    } catch {
      return null;
    }
  }, [width, content, emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss]);

  // Re-evaluated on every relevant change automatically (rawHtml/platform
  // are already reactive); revalidateNonce exists only so the explicit
  // "Revalidate" button gives visible feedback even when content happens
  // not to have changed since the last run.
  const report = useMemo(() => {
    if (rawHtml === null) return null;
    try {
      return validateEmail(rawHtml, content, platform);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revalidateNonce intentionally forces recompute on manual Revalidate
  }, [rawHtml, content, platform, revalidateNonce]);

  // Auto-revalidate whenever the document changes while this tab is open —
  // same convention as Preview Studio's Email Clients auto-run-on-change.
  useEffect(() => {
    setRevalidateNonce((n) => n + 1);
  }, [rawHtml]);

  const safeIssues = report?.issues.filter((issue) => issue.fixType === 'safe') ?? [];

  function handleFixOne(issue: ValidationIssue) {
    if (issue.fixType === 'safe' && issue.safeFix) {
      setApplyingFixId(issue.id);
      onApplySafeFix(issue.safeFix.moduleId, issue.safeFix.propPatch);
      setTimeout(() => setApplyingFixId(null), 300);
    } else if (issue.fixType === 'manual' && issue.moduleId) {
      onNavigateToModule(issue.moduleId);
    }
  }

  async function handleFixAllSafe() {
    setApplyingAll(true);
    for (const issue of safeIssues) {
      if (issue.safeFix) onApplySafeFix(issue.safeFix.moduleId, issue.safeFix.propPatch);
    }
    setTimeout(() => setApplyingAll(false), 300);
  }

  if (report === null) {
    return (
      <div className="validation-center-panel">
        <div className="validation-center-panel__error" role="alert">
          <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
          <div>
            <p className="validation-center-panel__issue-title">Unable to validate this email</p>
            <p className="validation-center-panel__issue-detail">
              This email&apos;s content could not be checked — it may be corrupted. Try reloading, or continue editing in Visual mode.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const dashOffset = SCORE_CIRCUMFERENCE * (1 - report.score / 100);

  return (
    <div className="validation-center-panel">
      <div className="validation-center-panel__toolbar">
        <button
          type="button"
          className="button button--outline"
          onClick={() => setRevalidateNonce((n) => n + 1)}
        >
          <span className="mdaiw-icon mdaiw-icon--refresh" aria-hidden="true" />
          Revalidate
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={handleFixAllSafe}
          disabled={safeIssues.length === 0 || applyingAll}
        >
          {applyingAll ? 'Fixing…' : `Fix All Safe Issues (${safeIssues.length})`}
        </button>
        <button type="button" className="button button--outline" disabled title="Coming soon">
          <span className="mdaiw-icon mdaiw-icon--ai-assistants" aria-hidden="true" />
          AI-Assisted Fix
        </button>
      </div>

      <div className="validation-center-panel__body">
        <div className="validation-center-panel__score-column">
          <h3>Email Health Score</h3>
          <div className="validation-center-panel__gauge" role="img" aria-label={`Health score ${report.score} out of 100`}>
            <svg viewBox="0 0 120 120" width="120" height="120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-border)" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="52" fill="none" stroke={scoreColor(report.score)} strokeWidth="10"
                strokeDasharray={SCORE_CIRCUMFERENCE} strokeDashoffset={dashOffset} strokeLinecap="round"
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className="validation-center-panel__gauge-text">
              <span className="validation-center-panel__gauge-score">{report.score}</span>
              <span className="validation-center-panel__gauge-max">/100</span>
            </div>
          </div>
          <p className="validation-center-panel__gauge-message">{scoreMessage(report.score)}</p>

          <ul className="validation-center-panel__categories">
            {report.categories.map((category) => (
              <li key={category.id} className="validation-center-panel__category-row">
                <span>{category.label}</span>
                <span className={`validation-center-panel__category-status validation-center-panel__category-status--${category.status}`}>
                  {STATUS_LABEL[category.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="validation-center-panel__issues-column">
          <h3>Issues Found ({report.issues.length})</h3>
          {report.issues.length === 0 ? (
            <div className="validation-center-panel__empty" role="status">
              <span className="mdaiw-icon mdaiw-icon--check-circle" aria-hidden="true" />
              No issues found — this email passes every check.
            </div>
          ) : (
            <ul className="validation-center-panel__issue-list">
              {report.issues.map((issue) => (
                <li key={issue.id} className="validation-center-panel__issue-card">
                  <span
                    className={`mdaiw-icon mdaiw-icon--${issue.severity === 'error' ? 'error-circle' : 'warning'} validation-center-panel__issue-icon validation-center-panel__issue-icon--${issue.severity}`}
                    aria-hidden="true"
                  />
                  <div className="validation-center-panel__issue-text">
                    <p className="validation-center-panel__issue-title">{issue.title}</p>
                    <p className="validation-center-panel__issue-detail">{issue.detail}</p>
                  </div>
                  {issue.fixType !== 'none' && (
                    <button
                      type="button"
                      className="button button--outline validation-center-panel__issue-fix"
                      onClick={() => handleFixOne(issue)}
                      disabled={applyingFixId === issue.id}
                    >
                      {issue.fixType === 'safe' ? 'Fix' : 'Go to module'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

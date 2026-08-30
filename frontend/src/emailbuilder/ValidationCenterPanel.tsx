import { useEffect, useMemo, useRef, useState } from 'react';
import { renderEmailDocument } from './htmlRenderer';
import { validateEmail, type ValidationIssue } from './emailValidation';
import { signatureForIssueId } from './repairEngine';
import {
  fetchRepairRanking, newLearningEventId, rankWithinTiers, recordRepairSignal,
  type RepairRanking,
} from './learningSignals';
import { ValidationExplanationModal } from './ValidationExplanationModal';
import type { EmailDocumentContent } from './edm';
import type { EmailPlatform } from './types';
import './ValidationCenterPanel.css';

interface ValidationCenterPanelProps {
  width: number;
  content: EmailDocumentContent;
  platform: EmailPlatform;
  emailTitle?: string;
  emailSubject?: string;
  faviconUrl?: string;
  resetCssEnabled?: boolean;
  customCssEnabled?: boolean;
  customCss?: string;
  outlookVml?: boolean;
  onNavigateToModule: (moduleId: string) => void;
  onApplySafeFix: (moduleId: string, propPatch: Record<string, unknown>) => void;
  // Sub-phase 6 — module SETTINGS-scope safe fixes (e.g. enabling the VML
  // fallback) apply through the SAME updateModuleSettings path a manual
  // Properties-panel edit already uses — never a new mutation pathway.
  onApplySettingsFix: (moduleId: string, settingsPatch: Record<string, unknown>) => void;
  // Sub-phase 4, item 1/4 — document-scope safe fixes (e.g. re-enable
  // Reset CSS, clear an invalid favicon) apply through the SAME
  // builder.updateDocumentSettings path DocumentSettingsDialog and the AI
  // Engineer already use — never a new mutation pathway.
  onApplyDocumentFix: (patch: Record<string, unknown>) => void;
  // Phase E1 (Export -> Validation nav) — when set, the matching issue
  // card (by the SAME ValidationIssue.id this panel already keys its
  // list on) is scrolled into view and briefly highlighted on mount/
  // change. Purely a display effect: it navigates attention, it never
  // mutates content, applies a fix, or re-runs validation differently.
  highlightIssueId?: string | null;
  // E7/E8 — "Ask AI Engineer" / "Review N more with AI Engineer": switches
  // to the AI Engineer tab and seeds one user turn with the given prompt
  // text (and, for a single-issue Explain, that issue's real id — see
  // ValidationExplanationModal's own docstring on why). Optional so any
  // other future caller of this panel (there is only one today) is not
  // forced to wire it.
  onAskAiEngineer?: (prompt: string, issueId?: string) => void;
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
  width, content, platform, emailTitle, emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss,
  outlookVml, onNavigateToModule, onApplySafeFix, onApplySettingsFix, onApplyDocumentFix, highlightIssueId,
  onAskAiEngineer,
}: ValidationCenterPanelProps) {
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [revalidateNonce, setRevalidateNonce] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // E7 — which issue's Explanation modal is currently open, if any. ONE
  // reusable modal for every issue, never one per category.
  const [explainingIssue, setExplainingIssue] = useState<ValidationIssue | null>(null);
  const issueCardRefs = useRef<Record<string, HTMLLIElement | null>>({});
  // Sub-phase 8 — advisory-only display ranking, fetched independently of
  // validation (validateEmail stays 100% pure/client-side). Empty on
  // mount, on any fetch failure, and until this user has recorded enough
  // signals — every one of those cases reproduces the exact pre-Sub-
  // phase-8 issue order, since rankWithinTiers no-ops on an empty map.
  const [ranking, setRanking] = useState<RepairRanking>({});

  function refreshRanking() {
    fetchRepairRanking().then(setRanking);
  }

  useEffect(() => {
    refreshRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on mount only
  }, []);

  // Rendering/validating a corrupted document (e.g. a module missing its
  // props after a partial write) must not crash the whole Email Builder —
  // contained here, at this panel's own boundary, rather than by touching
  // the shared renderer Code Editor/Preview Studio also depend on.
  const rawHtml = useMemo(() => {
    try {
      return renderEmailDocument({ width, content, title: emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss, outlookVml });
    } catch {
      return null;
    }
  }, [width, content, emailTitle, faviconUrl, resetCssEnabled, customCssEnabled, customCss, outlookVml]);

  // Re-evaluated on every relevant change automatically (rawHtml/platform
  // are already reactive); revalidateNonce exists only so the explicit
  // "Revalidate" button gives visible feedback even when content happens
  // not to have changed since the last run.
  const report = useMemo(() => {
    if (rawHtml === null) return null;
    try {
      return validateEmail(rawHtml, content, platform, {
        emailSubject: emailSubject ?? '',
        faviconUrl: faviconUrl ?? '',
        resetCssEnabled: resetCssEnabled ?? true,
        customCssEnabled: customCssEnabled ?? false,
        customCss: customCss ?? '',
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revalidateNonce intentionally forces recompute on manual Revalidate
  }, [rawHtml, content, platform, emailSubject, faviconUrl, resetCssEnabled, customCssEnabled, customCss, revalidateNonce]);

  // Auto-revalidate whenever the document changes while this tab is open —
  // same convention as Preview Studio's Email Clients auto-run-on-change.
  useEffect(() => {
    setRevalidateNonce((n) => n + 1);
  }, [rawHtml]);

  const safeIssues = report?.issues.filter((issue) => issue.fixType === 'safe') ?? [];
  // E8 — bucket B candidates: issues with no deterministic safe fix but
  // which trace to a real module, so the AI Engineer has something
  // concrete to propose a change against. Never counted/labeled as
  // "will be fixed" here — only as "may be fixable with AI assistance",
  // since whether the AI can actually help is only known once asked.
  const aiAssistableIssues = report?.issues.filter((issue) => issue.fixType === 'manual' && issue.moduleId) ?? [];

  // Advisory reordering only: issues never move across a severity+fixType
  // tier (an error never displaces above/below where errors sort, a
  // manual-fix issue never jumps ahead of a safe-fix one) — ranking only
  // decides order AMONG issues that were already adjacent candidates.
  const rankedIssues = useMemo(() => {
    if (!report) return [];
    return rankWithinTiers(
      report.issues,
      ranking,
      (issue) => `${issue.severity}:${issue.fixType}`,
      (issue) => signatureForIssueId(issue.id),
    );
  }, [report, ranking]);

  // Phase E1 (Export -> Validation nav) — scrolls + briefly highlights
  // the requested finding once per distinct highlightIssueId (not on
  // every re-render/revalidate), and only if that id still exists in the
  // current report. Self-clears after a short delay so returning to this
  // tab later doesn't re-trigger a stale highlight.
  useEffect(() => {
    if (!highlightIssueId || !report) return;
    if (!report.issues.some((issue) => issue.id === highlightIssueId)) return;
    issueCardRefs.current[highlightIssueId]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setHighlightedId(highlightIssueId);
    const timer = setTimeout(() => setHighlightedId(null), 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the REQUESTED id changes, not on every revalidate
  }, [highlightIssueId]);

  function applySafeFix(safeFix: NonNullable<ValidationIssue['safeFix']>) {
    if ('documentPatch' in safeFix) {
      onApplyDocumentFix(safeFix.documentPatch);
    } else if ('settingsPatch' in safeFix) {
      onApplySettingsFix(safeFix.moduleId, safeFix.settingsPatch);
    } else {
      onApplySafeFix(safeFix.moduleId, safeFix.propPatch);
    }
  }

  async function handleFixOne(issue: ValidationIssue) {
    if (issue.fixType === 'safe' && issue.safeFix) {
      setApplyingFixId(issue.id);
      applySafeFix(issue.safeFix);
      // Explicit accept: the user clicked "Fix" on this exact issue — the
      // one genuine outcome-recording gesture this panel has (there is no
      // reject affordance here; "Go to module" below is navigation, not a
      // decision, so it records nothing).
      await recordRepairSignal({
        eventId: newLearningEventId(), signature: signatureForIssueId(issue.id),
        outcome: 'accepted', source: 'validation_center_single',
      });
      refreshRanking();
      setTimeout(() => setApplyingFixId(null), 300);
    } else if (issue.fixType === 'manual' && issue.moduleId) {
      onNavigateToModule(issue.moduleId);
    }
  }

  // E8 — the ONE unified remediation CTA. Bucket A (deterministic safe
  // fixes) applies immediately, same mechanism/history/undo as before.
  // Bucket B (AI-proposed) is never silently auto-applied here — if any
  // AI-assistable issues remain after the safe fixes, this hands off to
  // the AI Engineer (onAskAiEngineer), which proposes one real, reviewable
  // change at a time through its existing Apply/Cancel confirmation flow.
  // Bucket C (manual/non-fixable, no module) just stays visible+explained.
  async function handleFixIssues() {
    setApplyingAll(true);
    for (const issue of safeIssues) {
      if (issue.safeFix) {
        applySafeFix(issue.safeFix);
        // Each issue in the batch is its own decision with its own
        // event_id — "Fix Issues" is N accepts, not one, so evidence
        // counts accumulate the same way N individual Fix clicks would.
        await recordRepairSignal({
          eventId: newLearningEventId(), signature: signatureForIssueId(issue.id),
          outcome: 'accepted', source: 'validation_center_bulk',
        });
      }
    }
    refreshRanking();
    setTimeout(() => setApplyingAll(false), 300);
  }

  function handleReviewAiAssistable() {
    if (aiAssistableIssues.length === 0 || !onAskAiEngineer) return;
    const lines = aiAssistableIssues.map((issue) => `- ${issue.title}: ${issue.detail}`).join('\n');
    onAskAiEngineer(
      `Review and, where safe, propose fixes for these ${aiAssistableIssues.length} issue${aiAssistableIssues.length === 1 ? '' : 's'}:\n${lines}`,
    );
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
          onClick={handleFixIssues}
          disabled={safeIssues.length === 0 || applyingAll}
          title={safeIssues.length === 0 ? 'No safely auto-fixable issues right now' : undefined}
        >
          {applyingAll ? 'Fixing…' : `Fix Issues (${safeIssues.length})`}
        </button>
        {aiAssistableIssues.length > 0 && onAskAiEngineer && (
          <button type="button" className="button button--outline" onClick={handleReviewAiAssistable}>
            <span className="mdaiw-icon mdaiw-icon--ai-assistants" aria-hidden="true" />
            {`Review ${aiAssistableIssues.length} more with AI Engineer`}
          </button>
        )}
      </div>

      <div className="validation-center-panel__body">
        <div className="validation-center-panel__score-column">
          <h3>Email Health Score</h3>
          {/* Health Score gauge alignment fix — heading stays left-aligned
              (untouched above); the gauge itself is centered by a
              dedicated full-width flex wrapper, never by a hard-coded
              margin/offset on the gauge itself, so centering stays
              correct regardless of the card's actual width. */}
          <div className="validation-center-panel__gauge-wrapper">
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
              {rankedIssues.map((issue) => (
                <li
                  key={issue.id}
                  ref={(element) => { issueCardRefs.current[issue.id] = element; }}
                  className={
                    issue.id === highlightedId
                      ? 'validation-center-panel__issue-card validation-center-panel__issue-card--highlighted'
                      : 'validation-center-panel__issue-card'
                  }
                >
                  <span
                    className={`mdaiw-icon mdaiw-icon--${issue.severity === 'error' ? 'error-circle' : 'warning'} validation-center-panel__issue-icon validation-center-panel__issue-icon--${issue.severity}`}
                    aria-hidden="true"
                  />
                  <div className="validation-center-panel__issue-text">
                    <p className="validation-center-panel__issue-title">{issue.title}</p>
                    <p className="validation-center-panel__issue-detail">{issue.detail}</p>
                    {ranking[signatureForIssueId(issue.id)] && (
                      <p className="validation-center-panel__issue-ranked-note">
                        Ranked using your past decisions on this type of fix.
                      </p>
                    )}
                  </div>
                  <div className="validation-center-panel__issue-actions">
                    <button
                      type="button"
                      className="button button--outline validation-center-panel__issue-explain"
                      onClick={() => setExplainingIssue(issue)}
                    >
                      Explain
                    </button>
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {explainingIssue && (
        <ValidationExplanationModal
          issue={explainingIssue}
          modules={content.modules}
          onClose={() => setExplainingIssue(null)}
          onGoToModule={onNavigateToModule}
          onAskAiEngineer={onAskAiEngineer}
        />
      )}
    </div>
  );
}

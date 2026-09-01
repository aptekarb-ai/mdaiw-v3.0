import { useEffect, useState } from 'react';
import type { FidelityCategoryResult, FidelityReport, FidelityStatus } from './htmlImportFidelity';
import './PreviewStudioPanel.css';
import './ImportReviewWorkspace.css';

// R3 (Import HTML AI Reconstruction) — the professional reconstruction
// review workspace. Renders already-existing HTML strings (the sanitized
// source, from htmlImportSanitize.ts's renderSanitizedSourceHtml; the
// reconstructed EDM, from htmlRenderer.ts's renderEmailDocument; and,
// R4-C6, an OPTIONAL third "Proposed Improvement" string — a PURE
// PROJECTION rendered the exact same way, through the SAME
// renderEmailDocument call, over reconstructionCorrectionLoop.ts's
// projectModulesWithCandidates output — never a second render path, never
// a mutation of the real document. All computed ONCE by the caller, never
// here) through the SAME sandboxed-iframe pattern PreviewStudioPanel.tsx
// already uses (srcDoc + sandbox="", tablist/tab ARIA pattern, wrapping
// side-by-side compare — the existing flex-wrap layout already stacks
// panes at narrow viewport widths without a separate narrow-width code
// path). This file never parses, sanitizes, maps, or renders email HTML
// itself — it is a pure presentation layer over artifacts the caller
// already built.

export type ReviewMode = 'original' | 'reconstructed' | 'proposed' | 'compare';

const STATUS_LABEL: Record<FidelityStatus, string> = {
  preserved: 'Preserved', normalized: 'Normalized', approximated: 'Approximated',
  removed: 'Removed', unsupported: 'Unsupported',
};

const STATUS_BADGE_CLASS: Record<FidelityStatus, string> = {
  preserved: 'import-review-workspace__badge--preserved',
  normalized: 'import-review-workspace__badge--normalized',
  approximated: 'import-review-workspace__badge--approximated',
  removed: 'import-review-workspace__badge--removed',
  unsupported: 'import-review-workspace__badge--unsupported',
};

interface ReconstructionSummaryProps {
  moduleCount: number;
  fidelity: FidelityReport;
}

// Derived entirely from FidelityReport — never a hard-coded number. Each
// category contributes its ONE rolled-up status (never double-counted
// per finding) to the top-line count, matching what the panel below
// shows per category.
function ReconstructionSummary({ moduleCount, fidelity }: ReconstructionSummaryProps) {
  const counts: Record<FidelityStatus, number> = {
    preserved: 0, normalized: 0, approximated: 0, removed: 0, unsupported: 0,
  };
  for (const category of fidelity.categories) counts[category.status] += 1;

  const parts = [
    `${moduleCount} module${moduleCount === 1 ? '' : 's'} reconstructed`,
    `${counts.preserved} preserved`,
    `${counts.normalized} normalized`,
    `${counts.approximated} approximated`,
    `${counts.removed} removed`,
  ];
  if (counts.unsupported > 0) parts.push(`${counts.unsupported} unsupported`);

  return (
    <p className="import-review-workspace__summary" role="status">
      {parts.join(' · ')}
    </p>
  );
}

interface FidelityCategoryRowProps {
  category: FidelityCategoryResult;
}

function FidelityCategoryRow({ category }: FidelityCategoryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = category.findings.length > 0;

  return (
    <li className="import-review-workspace__fidelity-row">
      <div className="import-review-workspace__fidelity-header">
        <span className="import-review-workspace__fidelity-label">{category.label}</span>
        <span className={`import-review-workspace__badge ${STATUS_BADGE_CLASS[category.status]}`}>
          {STATUS_LABEL[category.status]}
        </span>
      </div>
      <p className="import-review-workspace__fidelity-summary">{category.summary}</p>
      {hasDetail && (
        <>
          <button
            type="button"
            className="import-review-workspace__fidelity-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Hide details' : `Show ${category.findings.length} detail${category.findings.length === 1 ? '' : 's'}`}
          </button>
          {expanded && (
            <ul className="import-review-workspace__fidelity-findings" aria-label={`${category.label} findings`}>
              {category.findings.map((finding, index) => (
                <li key={index}>
                  <strong>{finding.source}</strong> ({finding.location}): {finding.reason} {finding.outcome}
                  {finding.recommendation && ` ${finding.recommendation}`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

interface FidelityPanelProps {
  fidelity: FidelityReport;
}

function FidelityPanel({ fidelity }: FidelityPanelProps) {
  return (
    <ul className="import-review-workspace__fidelity-list" aria-label="Reconstruction fidelity by category">
      {fidelity.categories.map((category) => (
        <FidelityCategoryRow key={category.id} category={category} />
      ))}
    </ul>
  );
}

export interface ImportReviewWorkspaceProps {
  originalHtml: string;
  reconstructedHtml: string;
  width: number;
  moduleCount: number;
  fidelity: FidelityReport;
  // R4-C6 — present only while a reconstruction repair proposal is
  // pending (see AIEngineerPanel.tsx's own pendingReconstructionPassRef
  // gate). A PURE PROJECTION string — the SAME renderEmailDocument call
  // used for `reconstructedHtml`, just fed reconstructionCorrectionLoop.
  // ts's projectModulesWithCandidates output instead of the real
  // document's modules. Never mutates anything; the caller recomputes
  // (or clears) this on every render, so it naturally disappears the
  // instant the caller's own pending-proposal state does (Cancel/Apply/
  // superseded by a new command) — this component holds no proposal
  // state of its own.
  projectedHtml?: string | null;
  // Optional context line under the Proposed Improvement label (e.g. "2
  // repairable differences") — purely descriptive, never required.
  projectedSummary?: string | null;
}

const BASE_REVIEW_MODES: { id: Extract<ReviewMode, 'original' | 'reconstructed'>; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'reconstructed', label: 'Reconstructed' },
];

const MODE_LABEL: Record<ReviewMode, string> = {
  original: 'Original', reconstructed: 'Reconstructed', proposed: 'Proposed Improvement', compare: 'Compare',
};

const MODE_SUBLABEL: Record<Exclude<ReviewMode, 'compare'>, string> = {
  original: 'Original imported HTML — sanitized for safe preview',
  reconstructed: 'Builder reconstruction — editable email-builder version',
  proposed: 'Proposed Improvement — a preview only, nothing is changed until you Apply',
};

const MODE_FRAME_TITLE: Record<Exclude<ReviewMode, 'compare'>, string> = {
  original: 'Original source preview', reconstructed: 'Reconstructed builder preview', proposed: 'Proposed improvement preview',
};

// The Compare-mode pane heading — deliberately NOT the same string as
// MODE_LABEL (the short tab name): this is the original, pre-R4-C6
// wording exactly (ImportHtmlPage.test.tsx's own "Compare shows Original
// and Reconstructed simultaneously" test asserts this exact text), kept
// unchanged for 'original'/'reconstructed' so R4-C6 never regresses it;
// 'proposed' is new this pass, worded to match the same "what is this
// pane" register.
const COMPARE_PANE_HEADING: Record<Exclude<ReviewMode, 'compare'>, string> = {
  original: 'Original imported HTML', reconstructed: 'Builder reconstruction', proposed: 'Proposed Improvement',
};

// Import Review's primary experience — "did the builder recreate my
// email correctly, and (R4-C6) would this proposed repair make it
// better?" — answered visually. Every HTML string is rendered through
// the exact iframe contract PreviewStudioPanel.tsx already uses (srcDoc
// + sandbox="") so this is never a second rendering surface, just a
// second/third CALLER of the same one.
export function ImportReviewWorkspace({
  originalHtml, reconstructedHtml, width, moduleCount, fidelity, projectedHtml, projectedSummary,
}: ImportReviewWorkspaceProps) {
  const [mode, setMode] = useState<ReviewMode>('reconstructed');
  const hasProposed = Boolean(projectedHtml);

  // R4-C6 — "must disappear/update when the proposal is Cancelled,
  // Applied, superseded, or invalidated": if the caller's projectedHtml
  // goes away (any of those four cases) while the user is looking at the
  // now-gone Proposed pane, fall back to Reconstructed rather than
  // leaving the tablist on a mode that no longer exists.
  useEffect(() => {
    if (mode === 'proposed' && !hasProposed) setMode('reconstructed');
  }, [mode, hasProposed]);

  const panes: { id: Exclude<ReviewMode, 'compare'>; html: string }[] = [
    { id: 'original', html: originalHtml },
    { id: 'reconstructed', html: reconstructedHtml },
    ...(hasProposed ? [{ id: 'proposed' as const, html: projectedHtml! }] : []),
  ];

  const reviewModes: { id: ReviewMode; label: string }[] = [
    ...BASE_REVIEW_MODES,
    ...(hasProposed ? [{ id: 'proposed' as const, label: MODE_LABEL.proposed }] : []),
    { id: 'compare', label: 'Compare' },
  ];

  return (
    <div className="import-review-workspace">
      <ReconstructionSummary moduleCount={moduleCount} fidelity={fidelity} />

      <div className="import-review-workspace__preview">
        <div className="preview-studio-panel__toolbar">
          <div className="preview-studio-panel__tabs" role="tablist" aria-label="Import review mode">
            {reviewModes.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={mode === option.id}
                className={mode === option.id ? 'preview-studio-panel__tab preview-studio-panel__tab--active' : 'preview-studio-panel__tab'}
                onClick={() => setMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="preview-studio-panel__body">
          {mode === 'compare' ? (
            // Wide viewports: every available pane (2 or 3) side by
            // side, all rendered at the SAME `width` — "display the same
            // document width for comparable panes." Narrow viewports:
            // the EXISTING flex-wrap on .preview-studio-panel__compare
            // (PreviewStudioPanel.css) already stacks these vertically
            // once they no longer fit a row — the required "tabs/stacked
            // comparison at narrower widths" behavior, without a second
            // layout implementation.
            <div className="preview-studio-panel__compare">
              {panes.map((pane) => (
                <div className="preview-studio-panel__frame-column" key={pane.id}>
                  <p className="preview-studio-panel__frame-label">
                    {COMPARE_PANE_HEADING[pane.id]} ({width}px)
                    <span className="import-review-workspace__frame-sublabel">
                      {pane.id === 'original' ? 'Sanitized for safe preview'
                        : pane.id === 'proposed' ? (projectedSummary || 'Preview only — not yet applied')
                          : 'Editable email-builder version'}
                    </span>
                  </p>
                  <iframe
                    title={MODE_FRAME_TITLE[pane.id]}
                    className={pane.id === 'proposed' ? 'preview-studio-panel__frame import-review-workspace__frame--proposed' : 'preview-studio-panel__frame'}
                    style={{ width: `${width}px` }}
                    srcDoc={pane.html}
                    sandbox=""
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="preview-studio-panel__frame-wrap">
              <p className="import-review-workspace__single-frame-sublabel">
                {MODE_SUBLABEL[mode]}
                {mode === 'proposed' && projectedSummary ? ` — ${projectedSummary}` : ''}
              </p>
              <iframe
                title={MODE_FRAME_TITLE[mode]}
                className={mode === 'proposed' ? 'preview-studio-panel__frame import-review-workspace__frame--proposed' : 'preview-studio-panel__frame'}
                style={{ width: `${width}px` }}
                srcDoc={mode === 'original' ? originalHtml : mode === 'proposed' ? (projectedHtml ?? reconstructedHtml) : reconstructedHtml}
                sandbox=""
              />
            </div>
          )}
        </div>
      </div>

      <div className="import-review-workspace__fidelity">
        <h3>Reconstruction Fidelity</h3>
        <FidelityPanel fidelity={fidelity} />
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { FidelityCategoryResult, FidelityReport, FidelityStatus } from './htmlImportFidelity';
import './PreviewStudioPanel.css';
import './ImportReviewWorkspace.css';

// R3 (Import HTML AI Reconstruction) — the professional reconstruction
// review workspace. Renders TWO already-existing HTML strings (the
// sanitized source, from htmlImportSanitize.ts's renderSanitizedSourceHtml,
// and the reconstructed EDM, from htmlRenderer.ts's renderEmailDocument —
// both computed ONCE by the caller at parse time, never here) through the
// SAME sandboxed-iframe pattern PreviewStudioPanel.tsx already uses
// (srcDoc + sandbox="", tablist/tab ARIA pattern, side-by-side compare).
// This file never parses, sanitizes, maps, or renders email HTML itself —
// it is a pure presentation layer over artifacts the caller already built.

export type ReviewMode = 'original' | 'reconstructed' | 'compare';

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
}

const REVIEW_MODES: { id: ReviewMode; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'reconstructed', label: 'Reconstructed' },
  { id: 'compare', label: 'Compare' },
];

// Import Review's primary experience — "did the builder recreate my
// email correctly?" — answered visually, before Create Email. The two
// HTML strings are rendered through the exact iframe contract
// PreviewStudioPanel.tsx already uses (srcDoc + sandbox="") so this is
// never a second rendering surface, just a second CALLER of the same one.
export function ImportReviewWorkspace({
  originalHtml, reconstructedHtml, width, moduleCount, fidelity,
}: ImportReviewWorkspaceProps) {
  const [mode, setMode] = useState<ReviewMode>('reconstructed');

  return (
    <div className="import-review-workspace">
      <ReconstructionSummary moduleCount={moduleCount} fidelity={fidelity} />

      <div className="import-review-workspace__preview">
        <div className="preview-studio-panel__toolbar">
          <div className="preview-studio-panel__tabs" role="tablist" aria-label="Import review mode">
            {REVIEW_MODES.map((option) => (
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
            <div className="preview-studio-panel__compare">
              <div className="preview-studio-panel__frame-column">
                <p className="preview-studio-panel__frame-label">
                  Original imported HTML ({width}px)
                  <span className="import-review-workspace__frame-sublabel">Sanitized for safe preview</span>
                </p>
                <iframe
                  title="Original source preview"
                  className="preview-studio-panel__frame"
                  style={{ width: `${width}px` }}
                  srcDoc={originalHtml}
                  sandbox=""
                />
              </div>
              <div className="preview-studio-panel__frame-column">
                <p className="preview-studio-panel__frame-label">
                  Builder reconstruction ({width}px)
                  <span className="import-review-workspace__frame-sublabel">Editable email-builder version</span>
                </p>
                <iframe
                  title="Reconstructed builder preview"
                  className="preview-studio-panel__frame"
                  style={{ width: `${width}px` }}
                  srcDoc={reconstructedHtml}
                  sandbox=""
                />
              </div>
            </div>
          ) : (
            <div className="preview-studio-panel__frame-wrap">
              <p className="import-review-workspace__single-frame-sublabel">
                {mode === 'original' ? 'Original imported HTML — sanitized for safe preview' : 'Builder reconstruction — editable email-builder version'}
              </p>
              <iframe
                title={mode === 'original' ? 'Original source preview' : 'Reconstructed builder preview'}
                className="preview-studio-panel__frame"
                style={{ width: `${width}px` }}
                srcDoc={mode === 'original' ? originalHtml : reconstructedHtml}
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

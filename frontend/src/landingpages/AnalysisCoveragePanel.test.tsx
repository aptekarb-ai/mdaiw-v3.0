import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalysisCoveragePanel } from './AnalysisCoveragePanel';
import type { AnalysisCoverage } from '../types/landingpages';

describe('AnalysisCoveragePanel', () => {
  it('renders nothing when coverage is undefined', () => {
    const { container } = render(<AnalysisCoveragePanel coverage={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when coverage is an empty object (AI Engineer not configured)', () => {
    const { container } = render(<AnalysisCoveragePanel coverage={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Analysis Complete" when every populated language is complete', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 20, engine: 'complete', ai: 'complete', chunks: 1 },
      css: { source_lines: 0, engine: 'not-applicable', ai: 'skipped-empty', chunks: 0 },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.getByText('Analysis Complete')).toBeInTheDocument();
  });

  it('shows "Analysis Details" (not "Complete") when a language is partial', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 500, engine: 'complete', ai: 'partial', chunks: 4, failure_reason: 'AI request budget exhausted for this validation.' },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.getByText('Analysis Details')).toBeInTheDocument();
    expect(screen.queryByText('Analysis Complete')).not.toBeInTheDocument();
  });

  it('lists per-language rows with lines/engine/AI coverage when expanded', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 184, engine: 'complete', ai: 'complete', chunks: 2 },
      javascript: { source_lines: 40, engine: 'complete', ai: 'unavailable', chunks: 1 },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.getByText('HTML')).toBeInTheDocument();
    expect(screen.getByText('184')).toBeInTheDocument();
    expect(screen.getByText('JavaScript')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('omits languages that were not applicable to the scope', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 20, engine: 'complete', ai: 'complete', chunks: 1 },
      css: { source_lines: 0, engine: 'not-applicable', ai: 'skipped-empty', chunks: 0 },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.queryByText('CSS')).not.toBeInTheDocument();
  });

  it('shows the failure reason for a partial or unavailable entry', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 900, engine: 'complete', ai: 'partial', chunks: 5, failure_reason: 'Source required more structural chunks than the configured maximum.' },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.getByText(/Source required more structural chunks/)).toBeInTheDocument();
  });

  it('shows a cross-language row when present', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 20, engine: 'complete', ai: 'complete', chunks: 1 },
      javascript: { source_lines: 10, engine: 'complete', ai: 'complete', chunks: 1 },
      cross_language: { status: 'complete' },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.getByText('Cross-language')).toBeInTheDocument();
  });

  it('shows the explicit "AI Engineer — Unavailable" notice when a language\'s AI pass failed', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 20, engine: 'complete', ai: 'unavailable', chunks: 1 },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.getByText(/AI Engineer — Unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Deterministic validation findings above are unaffected/)).toBeInTheDocument();
  });

  it('does not show the unavailable notice when everything is complete', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 20, engine: 'complete', ai: 'complete', chunks: 1 },
    };
    render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(screen.queryByText(/AI Engineer — Unavailable/)).not.toBeInTheDocument();
  });

  it('renders nothing when every entry is skipped-empty and there is no cross-language entry', () => {
    const coverage: AnalysisCoverage = {
      html: { source_lines: 0, engine: 'not-applicable', ai: 'skipped-empty', chunks: 0 },
    };
    const { container } = render(<AnalysisCoveragePanel coverage={coverage} />);
    expect(container).toBeEmptyDOMElement();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ValidateProgressPanel } from './ValidateProgressPanel';
import type { ValidateOperationStatus } from '../types/landingpages';

function operation(overrides: Partial<ValidateOperationStatus> = {}): ValidateOperationStatus {
  return {
    operation_id: 'op-1', status: 'running', stage: 'validating_html',
    stage_label: 'Validating HTML…', percent: 25,
    total_stages: 8, completed_stages: 2,
    stage_checklist: {
      preparing: 'done', validating_html: 'active', validating_css: 'pending', validating_js: 'pending',
      validating_ampscript: 'pending', ai_analysis: 'pending', normalizing: 'pending', finalizing: 'pending',
    },
    response_body: null, response_status: null, failure_reason: null,
    ...overrides,
  };
}

describe('ValidateProgressPanel', () => {
  it('renders an indeterminate progressbar with no aria-valuenow before the first status arrives', () => {
    render(<ValidateProgressPanel operation={null} />);
    const bar = screen.getByRole('progressbar', { name: 'AI Validate Code progress' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('reflects the real percent once an operation status is known', () => {
    render(<ValidateProgressPanel operation={operation({ percent: 25 })} />);
    const bar = screen.getByRole('progressbar', { name: 'AI Validate Code progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('shows only the languages actually present in the checklist', () => {
    render(<ValidateProgressPanel operation={operation({
      stage_checklist: { preparing: 'done', validating_html: 'done', ai_analysis: 'active', normalizing: 'pending', finalizing: 'pending' } as never,
    })} />);
    expect(screen.getByText('HTML')).toBeInTheDocument();
    expect(screen.getByText('Cross-language')).toBeInTheDocument();
    expect(screen.queryByText('CSS')).not.toBeInTheDocument();
    expect(screen.queryByText('JavaScript')).not.toBeInTheDocument();
    expect(screen.queryByText('AMPscript')).not.toBeInTheDocument();
  });

  it('renders check/active/pending glyphs matching each checklist entry state', () => {
    render(<ValidateProgressPanel operation={operation({
      stage_checklist: {
        preparing: 'done', validating_html: 'done', validating_css: 'active', validating_js: 'pending',
        validating_ampscript: 'pending', ai_analysis: 'pending', normalizing: 'pending', finalizing: 'pending',
      },
    })} />);
    const items = screen.getAllByRole('listitem', { hidden: true });
    const htmlItem = items.find((item) => item.textContent?.includes('HTML'));
    const cssItem = items.find((item) => item.textContent?.includes('CSS'));
    const jsItem = items.find((item) => item.textContent?.includes('JavaScript'));
    expect(htmlItem).toHaveTextContent('✓');
    expect(cssItem).toHaveTextContent('●');
    expect(jsItem).toHaveTextContent('○');
  });

  it('shows the current stage label as the visible heading and as the live-region announcement', () => {
    render(<ValidateProgressPanel operation={operation({ stage_label: 'Validating JavaScript…' })} />);
    expect(screen.getByText('Current: Validating JavaScript…')).toBeInTheDocument();
    const status = document.querySelector('[role="status"]');
    expect(status).toHaveTextContent('Validating JavaScript…');
  });

  it('never renders a percent above 100 even if the operation somehow reports more', () => {
    render(<ValidateProgressPanel operation={operation({ percent: 100 })} />);
    const bar = screen.getByRole('progressbar', { name: 'AI Validate Code progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });
});

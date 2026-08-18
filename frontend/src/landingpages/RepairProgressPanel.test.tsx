import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairProgressPanel } from './RepairProgressPanel';
import type { RepairOperationStatus } from '../types/landingpages';

function operation(overrides: Partial<RepairOperationStatus> = {}): RepairOperationStatus {
  return {
    operation_id: 'op-1', status: 'running', stage: 'repairing',
    stage_label: 'AI Engineer is repairing your code…', percent: 40,
    current_language: null, current_iteration: 1,
    issues_initial: 10, issues_resolved: 4, issues_remaining: 6, issues_new: 0,
    issue_updates: {},
    started_at: 0, updated_at: 0, failure_reason: null,
    response_body: null, response_status: null,
    ...overrides,
  };
}

describe('RepairProgressPanel', () => {
  it('renders an indeterminate progressbar with no aria-valuenow before the first status arrives', () => {
    render(<RepairProgressPanel operation={null} />);
    const bar = screen.getByRole('progressbar', { name: 'AI Engineer repair progress' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getAllByText('Analyzing your complete landing page…').length).toBeGreaterThanOrEqual(1);
  });

  it('reflects the real percent and counts once an operation status is known', () => {
    render(<RepairProgressPanel operation={operation({ percent: 40, issues_resolved: 4, issues_remaining: 6 })} />);
    const bar = screen.getByRole('progressbar', { name: 'AI Engineer repair progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('Resolved: 4')).toBeInTheDocument();
    expect(screen.getByText('Remaining: 6')).toBeInTheDocument();
  });

  it('shows newly-exposed issue count only when there are any', () => {
    const { rerender } = render(<RepairProgressPanel operation={operation({ issues_new: 0 })} />);
    expect(screen.queryByText(/New:/)).not.toBeInTheDocument();
    rerender(<RepairProgressPanel operation={operation({ issues_new: 3 })} />);
    expect(screen.getByText('New: 3')).toBeInTheDocument();
  });

  it('never renders a percent above 100 even if the operation somehow reports more', () => {
    render(<RepairProgressPanel operation={operation({ percent: 100 })} />);
    const bar = screen.getByRole('progressbar', { name: 'AI Engineer repair progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows the current stage label as the visible heading and as the live-region announcement', () => {
    render(<RepairProgressPanel operation={operation({ stage_label: 'Revalidating repaired code…' })} />);
    expect(screen.getAllByText('Revalidating repaired code…').length).toBeGreaterThanOrEqual(1);
    const status = document.querySelector('[role="status"]');
    expect(status).toHaveTextContent('Revalidating repaired code…');
  });
});

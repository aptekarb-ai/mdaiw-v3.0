import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { YuktiExplainPrompt } from './YuktiExplainPrompt';

describe('YuktiExplainPrompt', () => {
  it('renders nothing when closed', () => {
    render(<YuktiExplainPrompt open={false} issueCount={13} onNotNow={vi.fn()} onExplainIssues={vi.fn()} />);
    expect(screen.queryByText('Yukti')).not.toBeInTheDocument();
  });

  it('shows the issue count and both actions when open', () => {
    render(<YuktiExplainPrompt open issueCount={13} onNotNow={vi.fn()} onExplainIssues={vi.fn()} />);
    expect(screen.getByText(/I found 13 validation issues\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not Now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explain Issues' })).toBeInTheDocument();
  });

  it('uses singular phrasing for exactly one issue', () => {
    render(<YuktiExplainPrompt open issueCount={1} onNotNow={vi.fn()} onExplainIssues={vi.fn()} />);
    expect(screen.getByText(/I found 1 validation issue\./)).toBeInTheDocument();
  });

  it('calls onNotNow when Not Now is clicked', async () => {
    const user = userEvent.setup();
    const onNotNow = vi.fn();
    render(<YuktiExplainPrompt open issueCount={13} onNotNow={onNotNow} onExplainIssues={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Not Now' }));
    expect(onNotNow).toHaveBeenCalled();
  });

  it('calls onExplainIssues when Explain Issues is clicked', async () => {
    const user = userEvent.setup();
    const onExplainIssues = vi.fn();
    render(<YuktiExplainPrompt open issueCount={13} onNotNow={vi.fn()} onExplainIssues={onExplainIssues} />);
    await user.click(screen.getByRole('button', { name: 'Explain Issues' }));
    expect(onExplainIssues).toHaveBeenCalled();
  });

  it('is not a modal — no dialog role, so the page underneath stays usable', () => {
    render(<YuktiExplainPrompt open issueCount={13} onNotNow={vi.fn()} onExplainIssues={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

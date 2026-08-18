import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IssueFixDialog } from './IssueFixDialog';
import { candidateFromPatch, candidateFromProposal, groupIssueStates } from './fixCandidates';
import type { AIProposal, FixPatch, ValidationIssue } from '../types/landingpages';

function patch(overrides: Partial<FixPatch> = {}): FixPatch {
  return {
    fix_id: 'det-1', issue_id: 1, fingerprint: 'fp', language: 'html', source_context: '',
    file: 'html', start_offset: 0, end_offset: 0, start_line: 1, start_column: 1, end_line: 1, end_column: 1,
    original_text: '', replacement_text: '<meta charset="utf-8">', description: 'Add charset.',
    risk: 'low', confidence: 'definite', status: 'safe',
    ...overrides,
  };
}

function proposal(overrides: Partial<AIProposal> = {}): AIProposal {
  return {
    fix_id: 'ai-1', issue_id: 1, language: 'html', source_context: '', file: 'html',
    start_line: 1, start_column: 1, end_line: 1, end_column: 1,
    original_text: '<img src="a.jpg">', replacement_text: '<img src="a.jpg" alt="">',
    explanation: 'Adds alt text.', risk: 'low', confidence: 'possible',
    assumptions: [], requires_configuration: false, status: 'safe', rejection_reason: '',
    ...overrides,
  };
}

function issue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    id: 1, fingerprint: 'fp', severity: 'error', category: 'syntax', rule_id: 'missing-charset',
    message: 'Document is missing a character-encoding declaration.', file: 'html', language: 'html',
    line: 1, column: 1, suggestion: '', auto_fixable: true, risk: 'low',
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  const state = groupIssueStates([candidateFromPatch(patch())], [1])[0];
  return {
    open: true, issue: issue(), loading: false, error: null, aiUnavailable: false,
    state, applying: false, applyPhase: null, applyError: null, onApply: vi.fn(), onCancel: vi.fn(),
    ...overrides,
  };
}

describe('IssueFixDialog', () => {
  it('renders nothing when closed', () => {
    render(<IssueFixDialog {...baseProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a loading state', () => {
    render(<IssueFixDialog {...baseProps({ loading: true })} />);
    expect(screen.getByText('Checking for a fix…')).toBeInTheDocument();
  });

  it('shows an error state', () => {
    render(<IssueFixDialog {...baseProps({ error: { message: 'Could not check for a fix.' } })} />);
    expect(screen.getByText('Could not check for a fix.')).toBeInTheDocument();
  });

  it('shows the deterministic recommendation and applies without extra selection', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<IssueFixDialog {...baseProps({ onApply })} />);

    expect(screen.getByText('Recommended fix')).toBeInTheDocument();
    expect(screen.getByText('Fix method: Deterministic')).toBeInTheDocument();
    expect(screen.getByText('Add charset.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply Fix' }));
    expect(onApply).toHaveBeenCalledWith('det-1');
  });

  it('shows the AI-assisted recommendation for a single safe AI proposal', () => {
    const state = groupIssueStates([candidateFromProposal(proposal())], [1])[0];
    render(<IssueFixDialog {...baseProps({ state })} />);
    expect(screen.getByText('AI-assisted recommendation')).toBeInTheDocument();
    expect(screen.getByText('Fix method: AI-assisted')).toBeInTheDocument();
  });

  it('presents radio alternatives for two safe AI proposals and requires a selection before Apply enables', async () => {
    const user = userEvent.setup();
    const state = groupIssueStates([
      candidateFromProposal(proposal({ fix_id: 'ai-a' })),
      candidateFromProposal(proposal({ fix_id: 'ai-b', replacement_text: '<img src="a.jpg" alt="A photo">' })),
    ], [1])[0];
    render(<IssueFixDialog {...baseProps({ state })} />);

    const applyButton = screen.getByRole('button', { name: 'Apply Fix' });
    expect(applyButton).toBeDisabled();
    await user.click(screen.getAllByRole('radio')[1]);
    expect(applyButton).toBeEnabled();
  });

  it('shows "AI fixing is currently unavailable." with no Apply Fix button', () => {
    const state = groupIssueStates([], [1])[0];
    render(<IssueFixDialog {...baseProps({ state, aiUnavailable: true })} />);
    expect(screen.getByText('AI fixing is currently unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply Fix' })).not.toBeInTheDocument();
  });

  it('shows a review-manually notice with no Apply Fix button when nothing is selectable', () => {
    const state = groupIssueStates([candidateFromPatch(patch({ status: 'conflict' }))], [1])[0];
    render(<IssueFixDialog {...baseProps({ state })} />);
    expect(screen.getByText(/same source range/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply Fix' })).not.toBeInTheDocument();
  });

  it('Cancel calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<IssueFixDialog {...baseProps({ onCancel })} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Escape calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<IssueFixDialog {...baseProps({ onCancel })} />);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the applying label and disables Apply Fix while applying', () => {
    render(<IssueFixDialog {...baseProps({ applying: true })} />);
    expect(screen.getByRole('button', { name: 'Applying fix…' })).toBeDisabled();
  });

  it('shows "Revalidating…" during the post-apply revalidation phase', () => {
    render(<IssueFixDialog {...baseProps({ applying: true, applyPhase: 'revalidating' })} />);
    expect(screen.getByRole('button', { name: 'Revalidating…' })).toBeDisabled();
    expect(screen.getByText('Revalidating…', { selector: 'p' })).toBeInTheDocument();
  });

  // Fix-Application Correctness sprint (spec section 5/19) — an apply
  // failure (candidate rejected, selected issue still present, stale
  // proposal, revalidation itself failed) must show inside the modal
  // with a way to retry, never a silent close.
  it('shows an in-modal apply error with a Try Again action and keeps Cancel available', () => {
    const onApply = vi.fn();
    render(<IssueFixDialog {...baseProps({
      onApply,
      applyError: { message: 'The proposed fix did not resolve this issue. No successful fix was applied.' },
    })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The proposed fix did not resolve this issue. No successful fix was applied.',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
  });
});

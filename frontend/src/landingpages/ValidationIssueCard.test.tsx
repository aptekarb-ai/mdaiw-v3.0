import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidationIssueCard } from './ValidationIssueCard';
import type { ValidationIssue } from '../types/landingpages';

function issue(overrides: Partial<ValidationIssue>): ValidationIssue {
  return {
    id: 1, fingerprint: 'fp', severity: 'error', category: 'syntax', rule_id: 'scss:compile-error',
    message: 'Undefined variable.', file: 'css', language: 'css', line: 1, column: 1,
    suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'scss', engine_version: '',
    ...overrides,
  };
}

describe('ValidationIssueCard', () => {
  it('labels a failed SCSS compiler diagnostic as "SCSS compiler", never "Generated from SCSS"', () => {
    render(<ValidationIssueCard issue={issue({
      source_engine: 'scss', source_context: 'standalone-scss', rule_id: 'scss:compile-error',
    })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);

    expect(screen.getByText('SCSS Error')).toBeInTheDocument();
    expect(screen.getByText(/SCSS compiler/)).toBeInTheDocument();
    expect(screen.queryByText(/Generated from SCSS/)).not.toBeInTheDocument();
  });

  it('labels a failed Sass compiler diagnostic as "Sass compiler", never "Generated from Sass"', () => {
    render(<ValidationIssueCard issue={issue({
      source_engine: 'sass', source_context: 'standalone-sass', rule_id: 'sass:compile-error',
    })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);

    expect(screen.getByText('Sass Error')).toBeInTheDocument();
    expect(screen.getByText(/Sass compiler/)).toBeInTheDocument();
    expect(screen.queryByText(/Generated from Sass/)).not.toBeInTheDocument();
  });

  it('labels a failed LESS compiler diagnostic as "LESS compiler", never "Generated from LESS"', () => {
    render(<ValidationIssueCard issue={issue({
      source_engine: 'less', source_context: 'standalone-less', rule_id: 'less:compile-error',
    })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);

    expect(screen.getByText('LESS Error')).toBeInTheDocument();
    expect(screen.getByText(/LESS compiler/)).toBeInTheDocument();
    expect(screen.queryByText(/Generated from LESS/)).not.toBeInTheDocument();
  });

  it('keeps "Generated from SCSS" for a CSS-pipeline finding against genuinely generated CSS', () => {
    render(<ValidationIssueCard issue={issue({
      source_engine: 'stylelint', source_context: 'standalone-scss', rule_id: 'no-duplicate-selectors',
    })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);

    expect(screen.getByText('CSS Error')).toBeInTheDocument();
    expect(screen.getByText(/Generated from SCSS/)).toBeInTheDocument();
  });

  it('renders Go to Line and AI Fix This Issue for an actionable issue', () => {
    render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Go to Line' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'AI Fix This Issue' })).toBeEnabled();
  });

  it('calls onFixThisIssue with the issue when AI Fix This Issue is clicked', async () => {
    const user = userEvent.setup();
    const onFixThisIssue = vi.fn();
    const targetIssue = issue({ file: 'html', id: 42 });
    render(<ValidationIssueCard issue={targetIssue} onGoToLine={vi.fn()} onFixThisIssue={onFixThisIssue} onAskYukti={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));
    expect(onFixThisIssue).toHaveBeenCalledWith(targetIssue);
  });

  it('disables AI Fix This Issue for a non-actionable file (cdn) with a Review manually tooltip', () => {
    render(<ValidationIssueCard issue={issue({ file: 'cdn' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'AI Fix This Issue' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Review manually.');
  });

  // Correctness-pass sprint — an 'info'-severity finding (e.g.
  // mdaiw-lp/optional-selector-target: a JS selector safely guarded
  // against a missing DOM element) is always advisory-only. Offering AI
  // Fix This Issue would only ever open a "review manually" dialog for
  // something that isn't actually broken.
  it('disables AI Fix This Issue for an info-severity advisory finding', () => {
    render(
      <ValidationIssueCard
        issue={issue({ severity: 'info', rule_id: 'mdaiw-lp/optional-selector-target', language: 'javascript', file: 'javascript' })}
        onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'AI Fix This Issue' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Review manually.');
  });

  it('still enables Ask Yukti to Explain for an info-severity advisory finding', () => {
    render(
      <ValidationIssueCard
        issue={issue({ severity: 'info', rule_id: 'mdaiw-lp/optional-selector-target', language: 'javascript', file: 'javascript' })}
        onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ask Yukti to Explain' })).toBeEnabled();
  });

  describe('AI Engineer full-source-analysis sprint', () => {
    it('labels a pure AI-only finding "Detected by: AI Engineer"', () => {
      render(<ValidationIssueCard issue={issue({
        file: 'html', language: 'html', source_engine: 'ai-engineer', engine_version: 'gpt-4o-mini',
        rule_id: 'ai-engineer:maintainability',
      })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.getByText('Detected by: AI Engineer gpt-4o-mini')).toBeInTheDocument();
    });

    it('labels a cross-language finding distinctly', () => {
      render(<ValidationIssueCard issue={issue({
        file: 'javascript', language: 'javascript', source_engine: 'ai-engineer-cross-language',
      })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.getByText(/AI Engineer — Cross-Language Analysis/)).toBeInTheDocument();
    });

    it('labels a merged deterministic+AI finding with a composite "Detected by"', () => {
      render(<ValidationIssueCard issue={issue({
        file: 'html', language: 'html', source_engine: 'html-structure+ai-engineer',
      })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.getByText(/Detected by: HTML Structure Checker \+ AI Engineer/)).toBeInTheDocument();
    });

    it('shows the AI Engineer reasoning for a standalone AI-only finding', () => {
      render(<ValidationIssueCard issue={issue({
        file: 'html', language: 'html', source_engine: 'ai-engineer',
        ai_metadata: {
          reasoning: 'The label has no matching form control.', evidence: '<label>Name</label>',
          cross_language: false, verifiable: false, chunk_index: 0, total_chunks: 1,
          ai_fix_pipeline_eligible: true,
        },
      })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.getByText('The label has no matching form control.')).toBeInTheDocument();
    });

    it('frames a merged finding\'s AI corroboration as supplementary, not the authoritative message', () => {
      render(<ValidationIssueCard issue={issue({
        file: 'html', language: 'html', source_engine: 'html-structure+ai-engineer',
        message: '"<a>" is never closed.',
        ai_metadata: {
          reasoning: 'The anchor is left open before the section ends.', evidence: '<a href="x">',
          cross_language: false, verifiable: false, chunk_index: 0, total_chunks: 1,
          ai_message: 'Anchor appears unclosed.', ai_confidence: 'likely', ai_fix_pipeline_eligible: true,
        },
      })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.getByText('"<a>" is never closed.')).toBeInTheDocument();
      expect(screen.getByText(/The AI Engineer also flagged this:/)).toBeInTheDocument();
    });

    it('renders no AI reasoning line for a purely deterministic finding', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html', language: 'html', source_engine: 'html-structure' })}
        onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.queryByText(/AI Engineer/)).not.toBeInTheDocument();
    });

    it('keeps AI Fix This Issue enabled for an AI-only (fixable=false) finding — fixable=false is not "unfixable"', () => {
      render(<ValidationIssueCard issue={issue({
        file: 'html', language: 'html', source_engine: 'ai-engineer', auto_fixable: false,
        ai_metadata: {
          reasoning: 'x', evidence: 'y', cross_language: false, verifiable: false,
          chunk_index: 0, total_chunks: 1, ai_fix_pipeline_eligible: true,
        },
      })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'AI Fix This Issue' })).toBeEnabled();
    });
  });

  describe('Live validation/fix progress sprint — per-card status', () => {
    it('renders no status text and full actions when cardStatus is absent', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} />);
      expect(screen.queryByText('✓ Fixed')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'AI Fix This Issue' })).toBeEnabled();
    });

    it('shows "Fixing…" and disables AI Fix This Issue while a repair is being attempted on this card', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="fixing" />);
      expect(screen.getByText('Fixing…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'AI Fix This Issue' })).toBeDisabled();
    });

    it('shows "Revalidating…" while the applied candidate is being authoritatively re-checked', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="revalidating" />);
      expect(screen.getByText('Revalidating…')).toBeInTheDocument();
    });

    // Verified-green rule (mega-spec section 6) — this component trusts
    // whatever cardStatus it is given; the actual guarantee that
    // 'resolved' is never set except after a real before/after diff lives
    // upstream in fixes/iterative.py's _fingerprint_status_diff. This test
    // only verifies the PRESENTATION contract: resolved must show
    // "✓ Fixed" (never color-only) and hide the now-pointless action row.
    it('shows "✓ Fixed" and hides the action row once a card is verified resolved', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="resolved" />);
      expect(screen.getByText('✓ Fixed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'AI Fix This Issue' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Go to Line' })).not.toBeInTheDocument();
    });

    it('shows "Needs input" for a card that is blocked pending external information', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="requires_input" />);
      expect(screen.getByText('Needs input')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'AI Fix This Issue' })).toBeEnabled();
    });

    it('shows "Could not safely repair" for a failed/rejected candidate', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="failed" />);
      expect(screen.getByText('Could not safely repair')).toBeInTheDocument();
    });

    it('shows "Newly detected after repair" for an issue exposed by the current repair pass', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="newly_exposed" />);
      expect(screen.getByText('Newly detected after repair')).toBeInTheDocument();
    });
  });

  describe('Secure JavaScript DOM Repair closure spec — security-specific status wording', () => {
    it('shows "Building secure DOM replacement…" while fixing a dangerous-sink finding', () => {
      render(<ValidationIssueCard
        issue={issue({ file: 'javascript', language: 'javascript', rule_id: 'mdaiw-security/innerhtml-assignment' })}
        onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="fixing"
      />);
      expect(screen.getByText('Building secure DOM replacement…')).toBeInTheDocument();
    });

    it('shows "Revalidating JavaScript security…" while revalidating a dangerous-sink finding', () => {
      render(<ValidationIssueCard
        issue={issue({ file: 'javascript', language: 'javascript', rule_id: 'mdaiw-security/innerhtml-assignment' })}
        onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="revalidating"
      />);
      expect(screen.getByText('Revalidating JavaScript security…')).toBeInTheDocument();
    });

    it('shows "✓ Securely fixed" once a dangerous-sink finding is verified resolved', () => {
      render(<ValidationIssueCard
        issue={issue({ file: 'javascript', language: 'javascript', rule_id: 'mdaiw-security/innerhtml-assignment' })}
        onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="resolved"
      />);
      expect(screen.getByText('✓ Securely fixed')).toBeInTheDocument();
    });

    it('keeps generic wording for a non-security finding', () => {
      render(<ValidationIssueCard issue={issue({ file: 'html', rule_id: 'missing-alt' })} onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="fixing" />);
      expect(screen.getByText('Fixing…')).toBeInTheDocument();
    });

    it('keeps generic wording for a security-rule card blocked on requires_input', () => {
      render(<ValidationIssueCard
        issue={issue({ file: 'javascript', language: 'javascript', rule_id: 'mdaiw-security/innerhtml-assignment' })}
        onGoToLine={vi.fn()} onFixThisIssue={vi.fn()} onAskYukti={vi.fn()} cardStatus="requires_input"
      />);
      expect(screen.getByText('Needs input')).toBeInTheDocument();
    });
  });
});

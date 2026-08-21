import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidationIssuesPanel } from './ValidationIssuesPanel';
import type { ValidationIssue } from '../types/landingpages';

const HTML_ISSUES: ValidationIssue[] = [
  {
    id: 1, fingerprint: 'fp1', severity: 'error', category: 'syntax', rule_id: 'unclosed-tag',
    message: '"<div>" is never closed.', file: 'html', language: 'html', line: 4, column: 1,
    suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-structure', engine_version: '',
  },
  {
    id: 2, fingerprint: 'fp2', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
    message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 10, column: 3,
    suggestion: 'Add alt text.', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
  },
];

const CSS_ISSUE: ValidationIssue = {
  id: 3, fingerprint: 'fp3', severity: 'error', category: 'syntax', rule_id: 'postcss:css-syntax-error',
  message: 'Unknown word color', file: 'css', language: 'css', line: 2, column: 3,
  suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'postcss', engine_version: '8.5.25',
};

const COUNTS = { error: 1, warning: 1, info: 0 };

describe('ValidationIssuesPanel', () => {
  it('renders the total issue count and all issues by default', () => {
    render(<ValidationIssuesPanel issues={HTML_ISSUES} counts={COUNTS} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}} />);
    expect(screen.getByText('Validation Issues (2)')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('maps issueStatuses to the matching card by fingerprint, not list position', () => {
    render(<ValidationIssuesPanel
      issues={HTML_ISSUES} counts={COUNTS} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}}
      issueStatuses={{ fp2: 'resolved' }}
    />);
    // fp2 (second issue, "missing alt") is resolved; fp1 (first issue,
    // "never closed") has no status — proving the lookup is keyed by
    // fingerprint, not array index.
    expect(screen.getByText('✓ Fixed')).toBeInTheDocument();
    expect(screen.getByText('"<div>" is never closed.').closest('li')).not.toHaveClass('validation-issue-card--status-resolved');
    expect(screen.getByText('Image is missing an alt attribute.').closest('li')).toHaveClass('validation-issue-card--status-resolved');
  });

  it('filters issues by severity', async () => {
    const user = userEvent.setup();
    render(<ValidationIssuesPanel issues={HTML_ISSUES} counts={COUNTS} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}} />);

    await user.click(screen.getByRole('tab', { name: 'Errors (1)' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('"<div>" is never closed.')).toBeInTheDocument();
  });

  it('shows the no-issues empty state when total is zero', () => {
    render(<ValidationIssuesPanel issues={[]} counts={{ error: 0, warning: 0, info: 0 }} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}} />);
    expect(screen.getByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
  });

  it('calls onGoToLine with the selected issue', async () => {
    const user = userEvent.setup();
    const onGoToLine = vi.fn();
    render(<ValidationIssuesPanel issues={HTML_ISSUES} counts={COUNTS} onGoToLine={onGoToLine} onFixThisIssue={() => {}} onAskYukti={() => {}} />);

    await user.click(screen.getAllByRole('button', { name: 'Go to Line' })[0]);
    expect(onGoToLine).toHaveBeenCalledWith(HTML_ISSUES[0]);
  });

  it('calls onFixThisIssue with the selected issue', async () => {
    const user = userEvent.setup();
    const onFixThisIssue = vi.fn();
    render(<ValidationIssuesPanel issues={HTML_ISSUES} counts={COUNTS} onGoToLine={() => {}} onFixThisIssue={onFixThisIssue} onAskYukti={() => {}} />);

    await user.click(screen.getAllByRole('button', { name: 'AI Fix This Issue' })[0]);
    expect(onFixThisIssue).toHaveBeenCalledWith(HTML_ISSUES[0]);
  });

  it('supports arrow-key navigation between severity filter tabs', async () => {
    const user = userEvent.setup();
    render(<ValidationIssuesPanel issues={HTML_ISSUES} counts={COUNTS} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}} />);

    screen.getByRole('tab', { name: 'All (2)' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Errors (1)' })).toHaveAttribute('aria-selected', 'true');
  });

  describe('language and severity labels', () => {
    it('displays "HTML Error" for an HTML error issue', () => {
      render(<ValidationIssuesPanel issues={HTML_ISSUES} counts={COUNTS} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}} />);
      expect(screen.getByText('HTML Error')).toBeInTheDocument();
    });

    it('displays "CSS Error" for a CSS error issue, distinct from HTML', () => {
      render(
        <ValidationIssuesPanel
          issues={[HTML_ISSUES[0], CSS_ISSUE]}
          counts={{ error: 2, warning: 0, info: 0 }}
          onGoToLine={() => {}}
          onFixThisIssue={() => {}}
          onAskYukti={() => {}}
        />,
      );
      expect(screen.getByText('HTML Error')).toBeInTheDocument();
      expect(screen.getByText('CSS Error')).toBeInTheDocument();
    });

    it('never shows raw internal engine codes as the primary label', () => {
      render(<ValidationIssuesPanel issues={[CSS_ISSUE]} counts={{ error: 1, warning: 0, info: 0 }} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}} />);
      expect(screen.queryByText('css', { selector: '.validation-issue-card__severity' })).not.toBeInTheDocument();
      // Technical engine metadata is allowed as *secondary* detail.
      expect(screen.getByText('Detected by: PostCSS 8.5.25')).toBeInTheDocument();
    });
  });

  describe('language filter', () => {
    it('is hidden when only one language is present in the report', () => {
      render(<ValidationIssuesPanel issues={HTML_ISSUES} counts={COUNTS} onGoToLine={() => {}} onFixThisIssue={() => {}} onAskYukti={() => {}} />);
      expect(screen.queryByRole('tablist', { name: 'Filter issues by language' })).not.toBeInTheDocument();
    });

    it('appears and filters when multiple languages are present', async () => {
      const user = userEvent.setup();
      render(
        <ValidationIssuesPanel
          issues={[...HTML_ISSUES, CSS_ISSUE]}
          counts={{ error: 2, warning: 1, info: 0 }}
          onGoToLine={() => {}}
          onFixThisIssue={() => {}}
          onAskYukti={() => {}}
        />,
      );

      const languageFilter = screen.getByRole('tablist', { name: 'Filter issues by language' });
      expect(languageFilter).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'CSS' })).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('Unknown word color')).toBeInTheDocument();
      // Severity counts now reflect the language-filtered scope (1 error, 0 warnings).
      expect(screen.getByRole('tab', { name: 'Errors (1)' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Warnings (0)' })).toBeInTheDocument();
    });

    it('keeps language-filter counts reflecting the complete report regardless of severity filter', async () => {
      const user = userEvent.setup();
      render(
        <ValidationIssuesPanel
          issues={[...HTML_ISSUES, CSS_ISSUE]}
          counts={{ error: 2, warning: 1, info: 0 }}
          onGoToLine={() => {}}
          onFixThisIssue={() => {}}
          onAskYukti={() => {}}
        />,
      );
      await user.click(screen.getByRole('tab', { name: 'Errors (2)' }));
      // Language filter row itself is unaffected by the severity filter.
      expect(screen.getByRole('tab', { name: 'CSS' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'HTML' })).toBeInTheDocument();
    });
  });
});

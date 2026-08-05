import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPageValidatorPage } from './LandingPageValidatorPage';
import { validateCode } from '../api/landingpages';
import type { ValidationReport } from '../types/landingpages';

vi.mock('../api/landingpages', () => ({
  validateCode: vi.fn(),
}));
vi.mock('@monaco-editor/react', async () => {
  const { buildMonacoEditorReactMock } = await import('../testUtils/monacoEditorMock');
  return buildMonacoEditorReactMock();
});
vi.mock('../landingpages/monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/module-3/validator']}>
      <LandingPageValidatorPage />
    </MemoryRouter>,
  );
}

function report(overrides: Partial<ValidationReport>): ValidationReport {
  return {
    id: 1, project: null, version: null, duration_ms: 12,
    profile: 'standard', validation_scope: 'complete', engine_status: [],
    error_count: 0, warning_count: 0, info_count: 0,
    created_at: '2026-01-01T00:00:00Z', issues: [],
    ...overrides,
  };
}

const REPORT_WITH_ISSUES = report({
  error_count: 1, warning_count: 1, info_count: 0,
  issues: [
    {
      id: 1, fingerprint: 'fp-unclosed', severity: 'error', category: 'syntax', rule_id: 'unclosed-tag',
      message: '"<div>" is never closed.', file: 'html', language: 'html', line: 3, column: 1,
      suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-structure', engine_version: '',
    },
    {
      id: 2, fingerprint: 'fp-alt', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
      message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 5, column: 2,
      suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
    },
  ],
});

const REPORT_NO_ISSUES = report({});

async function mockValidate(result: ValidationReport) {
  vi.mocked(validateCode).mockResolvedValue(result);
}

describe('LandingPageValidatorPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the initial empty state before any code is entered', async () => {
    renderPage();
    await screen.findByLabelText('HTML code');
    expect(
      screen.getByText('Add HTML to begin complete landing-page validation.'),
    ).toBeInTheDocument();
  });

  it('shows a ready-to-validate message once code has been entered', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
    expect(screen.getByText('Ready to validate — select Validate Code.')).toBeInTheDocument();
  });

  it('shows the future-sprint toolbar actions as disabled', async () => {
    renderPage();
    await screen.findByLabelText('HTML code');
    expect(screen.getByRole('button', { name: 'Fix These Errors — not available yet' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ask AI to Review and Fix — not available yet' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview — not available yet' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save — not available yet' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download — not available yet' })).toBeDisabled();
  });

  it('submits the current code and shows a loading state while validating', async () => {
    const user = userEvent.setup();
    let resolveValidate: (value: ValidationReport) => void = () => {};
    vi.mocked(validateCode).mockReturnValue(new Promise((resolve) => { resolveValidate = resolve; }));
    renderPage();

    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
    await user.click(screen.getByRole('button', { name: 'Validate Code' }));

    expect(screen.getAllByText('Validating code…').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Validating…' })).toBeDisabled();

    resolveValidate(REPORT_NO_ISSUES);
    await waitFor(() => expect(screen.getByText('No issues found. This code passed all current checks.')).toBeInTheDocument());
  });

  it('renders issues and correct counts on a successful validation with issues', async () => {
    const user = userEvent.setup();
    await mockValidate(REPORT_WITH_ISSUES);
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'Validate Code' }));

    expect(await screen.findByText('Validation Issues (2)')).toBeInTheDocument();
    expect(screen.getByText('"<div>" is never closed.')).toBeInTheDocument();
    expect(screen.getByText('Image is missing an alt attribute.')).toBeInTheDocument();
  });

  it('shows the no-issues success state', async () => {
    const user = userEvent.setup();
    await mockValidate(REPORT_NO_ISSUES);
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'Validate Code' }));

    expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
  });

  it('shows an API error state with a retry action', async () => {
    const user = userEvent.setup();
    vi.mocked(validateCode).mockRejectedValue({
      message: 'Please correct the highlighted fields.', code: 'VALIDATION_ERROR', status: 400,
    });
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'Validate Code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted fields.');
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('Try Again resubmits the validate request', async () => {
    const user = userEvent.setup();
    vi.mocked(validateCode).mockRejectedValue({ message: 'Something went wrong. Please try again.' });
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'Validate Code' }));
    await screen.findByRole('alert');
    expect(validateCode).toHaveBeenCalledTimes(1);

    await mockValidate(REPORT_NO_ISSUES);
    await user.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(validateCode).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
  });

  it('Go to Line switches to the issue language tab', async () => {
    const user = userEvent.setup();
    await mockValidate(REPORT_WITH_ISSUES);
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'Validate Code' }));
    await screen.findByText('Validation Issues (2)');

    await user.click(screen.getAllByRole('button', { name: 'Go to Line' })[0]);

    expect(screen.getByRole('tab', { name: 'HTML' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders a dedicated workspace container with independent editor and results panels', async () => {
    const { container } = renderPage();
    await screen.findByLabelText('HTML code');
    expect(container.querySelector('.validator-page__workspace')).toBeInTheDocument();
    expect(container.querySelector('.validator-page__editor')).toBeInTheDocument();
    expect(container.querySelector('.validator-page__results')).toBeInTheDocument();
  });

  describe('validation scope', () => {
    it('defaults to Complete LP', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.getByRole('radio', { name: 'Complete LP' })).toBeChecked();
    });

    it('lets the user select HTML Only and CSS Only', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('radio', { name: 'HTML' }));
      expect(screen.getByRole('radio', { name: 'HTML' })).toBeChecked();

      await user.click(screen.getByRole('radio', { name: 'CSS' }));
      expect(screen.getByRole('radio', { name: 'CSS' })).toBeChecked();
    });

    it('disables JavaScript and TypeScript scope options when their engines are unavailable', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.getByRole('radio', { name: 'JavaScript' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'TypeScript' })).toBeDisabled();
    });

    it('sends validation_scope: css when CSS Only is selected', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('radio', { name: 'CSS' }));
      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      await user.type(screen.getByLabelText('CSS code'), '.a{{color:red}}');
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));

      expect(validateCode).toHaveBeenCalledWith(
        expect.objectContaining({ validation_scope: 'css' }),
        expect.anything(),
      );
    });

    it('sends validation_scope: complete by default', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));

      expect(validateCode).toHaveBeenCalledWith(
        expect.objectContaining({ validation_scope: 'complete' }),
        expect.anything(),
      );
    });

    it('disables Validate when the scope-relevant source is empty', async () => {
      const user = userEvent.setup();
      renderPage();
      // HTML has content but CSS (the selected scope) does not.
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

      await user.click(screen.getByRole('radio', { name: 'CSS' }));
      const validateButton = screen.getByRole('button', { name: 'Validate Code' });
      expect(validateButton).toBeDisabled();
      expect(validateButton).toHaveAttribute('title', 'Enter CSS code before validating CSS.');
    });

    it('shows the exact per-scope disabled reason for HTML and Complete LP', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');

      expect(screen.getByRole('button', { name: 'Validate Code' })).toHaveAttribute(
        'title', 'Add HTML to begin complete landing-page validation.',
      );

      await user.click(screen.getByRole('radio', { name: 'HTML' }));
      expect(screen.getByRole('button', { name: 'Validate Code' })).toHaveAttribute(
        'title', 'Enter HTML code before validating HTML.',
      );
    });

    it('clears a previous report when only the scope selector changes (no source edited)', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      // Switching scope must not carry the previous scope's results (or
      // an unrelated language's issues) forward into the new selection.
      await user.click(screen.getByRole('radio', { name: 'CSS' }));

      expect(screen.queryByText('Validation Issues (2)')).not.toBeInTheDocument();
      expect(screen.queryByText('"<div>" is never closed.')).not.toBeInTheDocument();
    });

    it('clears a previous error banner when the scope selector changes', async () => {
      const user = userEvent.setup();
      vi.mocked(validateCode).mockRejectedValue({ message: 'Something went wrong. Please try again.' });
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));
      await screen.findByRole('alert');

      await user.click(screen.getByRole('radio', { name: 'HTML' }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows only the tab for the selected single-language scope', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('radio', { name: 'CSS' }));

      expect(screen.getAllByRole('tab')).toHaveLength(1);
      expect(screen.getByRole('tab', { name: 'CSS' })).toBeInTheDocument();
      expect(screen.queryByLabelText('HTML code')).not.toBeInTheDocument();
    });

    it('restores all four tabs when scope returns to Complete LP', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('radio', { name: 'CSS' }));
      await user.click(screen.getByRole('radio', { name: 'Complete LP' }));

      expect(screen.getAllByRole('tab')).toHaveLength(4);
    });
  });

  describe('stale results', () => {
    it('marks results stale and shows the stale message after editing following a report', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      await user.type(screen.getByLabelText('HTML code'), '!');

      expect(screen.getAllByText('Code changed. Validate again to update the results.').length).toBeGreaterThan(0);
      expect(screen.queryByText('Validation Issues (2)')).not.toBeInTheDocument();
    });

    it('clears staleness once a new validation completes', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      await user.type(screen.getByLabelText('HTML code'), '!');
      expect(screen.getAllByText('Code changed. Validate again to update the results.').length).toBeGreaterThan(0);

      await mockValidate(REPORT_NO_ISSUES);
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));

      expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
      expect(screen.queryAllByText('Code changed. Validate again to update the results.')).toHaveLength(0);
    });
  });

  describe('Clear Active Tab integration', () => {
    it('clears only the active tab and preserves the others', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');

      await user.type(screen.getByLabelText('HTML code'), '<p>html</p>');
      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      await user.type(screen.getByLabelText('CSS code'), '.a{{color:red}}');

      await user.click(screen.getByRole('button', { name: 'Clear CSS' }));
      await user.click(screen.getByRole('button', { name: 'Clear Code' }));

      expect(screen.getByLabelText('CSS code')).toHaveValue('');
      await user.click(screen.getByRole('tab', { name: 'HTML' }));
      expect(screen.getByLabelText('HTML code')).toHaveValue('<p>html</p>');
    });

    it('marks the current report stale after clearing a language it covered', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      await user.click(screen.getByRole('button', { name: 'Clear HTML' }));
      await user.click(screen.getByRole('button', { name: 'Clear Code' }));

      expect(screen.getAllByText('Code changed. Validate again to update the results.').length).toBeGreaterThan(0);
    });
  });
});

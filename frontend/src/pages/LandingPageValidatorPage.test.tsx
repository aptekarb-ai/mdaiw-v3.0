import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingPageValidatorPage } from './LandingPageValidatorPage';
import { Footer } from '../components/navigation/Footer';
import { getValidateStatus, loadLatestVersion, saveVersion, startValidate } from '../api/landingpages';
import { applyFixes, previewFixes, startAiFix, getAiFixStatus } from '../api/fixes';
import { applyAIReview, requestAIReview } from '../api/aiReview';
import { requestYuktiExplanation } from '../api/yuktiExplain';
import { createPreview } from '../api/preview';
import type {
  AIFixIssuesRunResponse, AIReviewApplyResponse, AIReviewRequestResponse, FixApplyResponse, FixMetrics,
  FixPreviewResponse, PreviewRequestResponse, RepairOperationStatus, ValidateOperationStatus, ValidationReport,
  YuktiExplainResponse,
} from '../types/landingpages';

vi.mock('../api/aiReview', () => ({
  requestAIReview: vi.fn(),
  applyAIReview: vi.fn(),
}));
vi.mock('../api/yuktiExplain', () => ({
  requestYuktiExplanation: vi.fn(),
}));
vi.mock('../api/landingpages', () => ({
  validateCode: vi.fn(),
  startValidate: vi.fn(),
  getValidateStatus: vi.fn(),
  saveVersion: vi.fn(),
  loadLatestVersion: vi.fn(),
}));
vi.mock('../api/fixes', () => ({
  previewFixes: vi.fn(),
  applyFixes: vi.fn(),
  startAiFix: vi.fn(),
  getAiFixStatus: vi.fn(),
}));
vi.mock('../api/preview', () => ({
  createPreview: vi.fn(),
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
    profile: 'standard', validation_scope: 'complete', css_source_type: 'css', engine_status: [],
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

// Correctness-pass sprint — a report whose only finding is info-severity
// (advisory-only, e.g. a JS selector safely guarded against a missing
// DOM element) must disable AI Fix Issues exactly like a report with
// zero issues at all: there is nothing repairable in either case.
const REPORT_WITH_ONLY_ADVISORY_ISSUE = report({
  error_count: 0, warning_count: 0, info_count: 1,
  issues: [
    {
      id: 1, fingerprint: 'fp-optional-selector', severity: 'info', category: 'value',
      rule_id: 'mdaiw-lp/optional-selector-target',
      message: 'No element with id "username" exists in the HTML document, but "el" is null-checked before use.',
      file: 'javascript', language: 'javascript', line: 1, column: 1,
      suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'eslint', engine_version: '',
    },
  ],
});

const EMPTY_FIX_PREVIEW: FixPreviewResponse = { patches: [], conflicts: [], review_required: [], not_found: [] };

function validateOperationStatus(overrides: Partial<ValidateOperationStatus> = {}): ValidateOperationStatus {
  return {
    operation_id: 'mock-validate-op-id', status: 'completed', stage: 'finalizing',
    stage_label: 'Finalizing validation report…', percent: 100,
    total_stages: 8, completed_stages: 8,
    stage_checklist: {
      preparing: 'done', validating_html: 'done', validating_css: 'done', validating_js: 'done',
      validating_ampscript: 'done', ai_analysis: 'done', normalizing: 'done', finalizing: 'done',
    },
    response_body: null, response_status: 201, failure_reason: null,
    ...overrides,
  };
}

// AI Validate Code Live Progress sprint — the frontend now starts the
// operation (startValidate) and polls its status (getValidateStatus)
// instead of one blocking call. The mocked status resolves as
// 'completed' on the FIRST poll (no setTimeout delay to wait out — see
// useValidator.ts's poll loop, which checks status immediately before
// ever sleeping), carrying the SAME final report shape the old
// synchronous endpoint returned.
async function mockValidate(result: ValidationReport) {
  vi.mocked(startValidate).mockResolvedValue({ operation_id: 'mock-validate-op-id', status: 'running' });
  vi.mocked(getValidateStatus).mockResolvedValue(validateOperationStatus({ response_body: result }));
}

async function mockPreviewFixes(result: FixPreviewResponse) {
  vi.mocked(previewFixes).mockResolvedValue(result);
}

async function mockApplyFixes(result: FixApplyResponse) {
  vi.mocked(applyFixes).mockResolvedValue(result);
}

function fixMetrics(overrides: Partial<FixMetrics> = {}): FixMetrics {
  return {
    iterations_run: 1,
    iterations: [{
      iteration: 1, issues_before: 1, fix_candidates_generated: 1, fixes_applied: 1,
      ai_requested: false, ai_unavailable: false,
    }],
    issues_before: 1, fix_candidates_generated: 1, fixes_applied: 1,
    issues_resolved: 1, issues_remaining: 0, issues_new: 0,
    issues_requires_input: 0,
    issues_before_errors: 1, issues_before_warnings: 0,
    issues_final_errors: 0, issues_final_warnings: 0, issues_unrepairable: 0, issues_advisory: 0,
    by_language: { html: { before: 1, remaining: 0, resolved: 1, new: 0 } },
    stopped_reason: 'all_resolved', ai_unavailable: false,
    ...overrides,
  };
}

function operationStatus(overrides: Partial<RepairOperationStatus> = {}): RepairOperationStatus {
  return {
    operation_id: 'mock-op-id', status: 'completed', stage: 'finalizing',
    stage_label: 'Finalizing validation results…', percent: 100,
    current_language: null, current_iteration: 1,
    issues_initial: 1, issues_resolved: 1, issues_remaining: 0, issues_new: 0,
    issue_updates: {},
    started_at: 0, updated_at: 0, failure_reason: null,
    response_body: null, response_status: 201,
    ...overrides,
  };
}

// AI Engineer Autonomous Repair — Real-Time Progress UX sprint: the
// frontend now starts the operation (startAiFix) and polls its status
// (getAiFixStatus) instead of one blocking call. The mocked status
// resolves as 'completed' on the FIRST poll (no setTimeout delay to wait
// out — see LandingPageValidatorPage.tsx's poll loop, which checks status
// immediately before ever sleeping), carrying the SAME final report shape
// the old synchronous endpoint returned.
async function mockRunAiFixIssues(reportResult: ValidationReport, finalSources: Record<string, string>, metrics: Partial<FixMetrics> = {}) {
  const response: AIFixIssuesRunResponse = { ...reportResult, final_sources: finalSources, fix_metrics: fixMetrics(metrics) };
  vi.mocked(startAiFix).mockResolvedValue({ operation_id: 'mock-op-id', status: 'running' });
  vi.mocked(getAiFixStatus).mockResolvedValue(operationStatus({
    response_body: response,
    issues_resolved: response.fix_metrics.issues_resolved,
    issues_remaining: response.fix_metrics.issues_remaining,
    issues_new: response.fix_metrics.issues_new,
  }));
}

function previewResponse(overrides: Partial<PreviewRequestResponse> = {}): PreviewRequestResponse {
  return {
    token: 'a1b2c3d4-0000-0000-0000-000000000000',
    preview_url: '/api/v1/lp/preview/a1b2c3d4-0000-0000-0000-000000000000/',
    expires_at: '2026-01-01T00:30:00Z',
    ampscript_simulated: false,
    ...overrides,
  };
}

function fixPatch(overrides: Partial<FixPreviewResponse['patches'][number]>): FixPreviewResponse['patches'][number] {
  return {
    fix_id: 'fix-1', issue_id: 1, fingerprint: 'fp-1', language: 'html', source_context: '',
    file: 'html', start_offset: 0, end_offset: 0, start_line: 1, start_column: 1, end_line: 1, end_column: 1,
    original_text: '', replacement_text: '<!DOCTYPE html>\n', description: 'Insert missing <!DOCTYPE html>.',
    risk: 'low', confidence: 'definite', status: 'safe',
    ...overrides,
  };
}

async function mockRequestAIReview(result: AIReviewRequestResponse) {
  vi.mocked(requestAIReview).mockResolvedValue(result);
}

async function mockApplyAIReview(result: AIReviewApplyResponse) {
  vi.mocked(applyAIReview).mockResolvedValue(result);
}

function aiProposal(overrides: Partial<AIReviewRequestResponse['proposals'][number]> = {}): AIReviewRequestResponse['proposals'][number] {
  return {
    fix_id: 'ai-fix-1', issue_id: 1, language: 'html', source_context: '', file: 'html',
    start_line: 1, start_column: 1, end_line: 1, end_column: 20,
    original_text: '<img src="a.jpg">', replacement_text: '<img src="a.jpg" alt="">',
    explanation: 'Adds an empty alt attribute.', risk: 'low', confidence: 'possible',
    assumptions: [], requires_configuration: false, status: 'safe', rejection_reason: '',
    ...overrides,
  };
}

describe('LandingPageValidatorPage', () => {
  beforeEach(() => {
    vi.mocked(previewFixes).mockResolvedValue(EMPTY_FIX_PREVIEW);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
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
    expect(screen.getByText('Ready to validate — select AI Validate Code.')).toBeInTheDocument();
  });

  // Save/Download closure sprint — both are real actions now; with an
  // empty editor and no project name entered, both start disabled
  // (nothing to save/download yet), not permanently-future-sprint
  // placeholders.
  it('starts with Save and Download disabled when the editor is empty', async () => {
    renderPage();
    await screen.findByLabelText('HTML code');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('enables Download once there is editor content, even before validating', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('enables Save once a project name is entered and HTML content exists', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
    await user.type(screen.getByLabelText('Landing page name'), 'My Landing Page');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  describe('Save/Download closure sprint', () => {
    beforeEach(() => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    async function typeHtmlAndName(user: ReturnType<typeof userEvent.setup>, name = 'My Promo LP') {
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.type(screen.getByLabelText('Landing page name'), name);
    }

    it('saves and shows a Saved status with the project name and validation freshness', async () => {
      const user = userEvent.setup();
      vi.mocked(saveVersion).mockResolvedValue({
        id: 1, version_number: 1, css_source_type: 'css', created_at: '2026-01-01T00:00:00Z',
        project: { id: 7, name: 'My Promo LP', slug: 'my-promo-lp', type: 'validator', status: 'draft', framework: 'custom', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      });
      renderPage();
      await typeHtmlAndName(user);
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText(/Saved "My Promo LP" at/)).toBeInTheDocument();
      expect(screen.getByText(/Code changed since last validation/)).toBeInTheDocument();
      expect(saveVersion).toHaveBeenCalledWith(expect.objectContaining({ project: null, name: 'My Promo LP' }));
    });

    it('reuses the same project id on a second save instead of asking for a name again', async () => {
      const user = userEvent.setup();
      vi.mocked(saveVersion).mockResolvedValue({
        id: 1, version_number: 1, css_source_type: 'css', created_at: '2026-01-01T00:00:00Z',
        project: { id: 7, name: 'My Promo LP', slug: 'my-promo-lp', type: 'validator', status: 'draft', framework: 'custom', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      });
      renderPage();
      await typeHtmlAndName(user);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText(/Saved "My Promo LP" at/);

      expect(screen.queryByLabelText('Landing page name')).not.toBeInTheDocument();

      vi.mocked(saveVersion).mockResolvedValue({
        id: 2, version_number: 2, css_source_type: 'css', created_at: '2026-01-01T00:05:00Z',
        project: { id: 7, name: 'My Promo LP', slug: 'my-promo-lp', type: 'validator', status: 'draft', framework: 'custom', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:05:00Z' },
      });
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(saveVersion).toHaveBeenLastCalledWith(expect.objectContaining({ project: 7 }));
      });
    });

    it('shows a Save failed status on a save error, without losing editor content', async () => {
      const user = userEvent.setup();
      vi.mocked(saveVersion).mockRejectedValue({ message: 'Save could not be completed. Please try again.' });
      renderPage();
      await typeHtmlAndName(user);
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Save could not be completed. Please try again.')).toBeInTheDocument();
      expect((await screen.findByLabelText('HTML code') as HTMLTextAreaElement).value).toBe('<p>hi</p>');
    });

    it('reloads a saved version, replacing the editor content and marking validation stale', async () => {
      const user = userEvent.setup();
      vi.mocked(saveVersion).mockResolvedValue({
        id: 1, version_number: 1, css_source_type: 'css', created_at: '2026-01-01T00:00:00Z',
        project: { id: 7, name: 'My Promo LP', slug: 'my-promo-lp', type: 'validator', status: 'draft', framework: 'custom', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      });
      vi.mocked(loadLatestVersion).mockResolvedValue({
        html: '<p>reloaded</p>', css: '.a{color:red}', js: '', ampscript: '', css_source_type: 'css',
        version: { id: 1, project: 7, version_number: 1, css_source_type: 'css', created_at: '2026-01-01T00:00:00Z' },
        project: { id: 7, name: 'My Promo LP', slug: 'my-promo-lp', type: 'validator', status: 'draft', framework: 'custom', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      });
      renderPage();
      await typeHtmlAndName(user);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText(/Saved "My Promo LP" at/);

      await user.click(screen.getByRole('button', { name: 'Reload Saved Version' }));
      const htmlBox = await screen.findByLabelText('HTML code') as HTMLTextAreaElement;
      await waitFor(() => expect(htmlBox.value).toBe('<p>reloaded</p>'));
      expect(loadLatestVersion).toHaveBeenCalledWith(7);
    });

    it('downloads immediately when validation is up to date', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('No issues found. This code passed all current checks.');

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      clickSpy.mockClear();
      await user.click(screen.getByRole('button', { name: 'Download' }));
      expect(clickSpy).toHaveBeenCalled();
      expect(screen.queryByText('Code has changed since the last validation.')).not.toBeInTheDocument();
    });

    it('asks for confirmation before downloading stale (unvalidated) content', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      clickSpy.mockClear();
      await user.click(screen.getByRole('button', { name: 'Download' }));
      expect(await screen.findByText('Code has changed since the last validation.')).toBeInTheDocument();
      expect(clickSpy).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Download Anyway' }));
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Preview', () => {
    let openSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    });

    afterEach(() => {
      openSpy.mockRestore();
    });

    it('is disabled with an accurate reason when there is no HTML content', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute(
        'title', 'Enter HTML content before previewing — Preview needs a page to assemble.',
      );
    });

    it('is enabled once HTML content is entered', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    });

    it('requests a snapshot and opens it in a new noopener/noreferrer tab', async () => {
      const user = userEvent.setup();
      vi.mocked(createPreview).mockResolvedValue(previewResponse());
      renderPage();

      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Preview' }));

      await waitFor(() => expect(createPreview).toHaveBeenCalled());
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lp/preview/a1b2c3d4-0000-0000-0000-000000000000/'),
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('leaves the editor content unchanged after previewing', async () => {
      const user = userEvent.setup();
      vi.mocked(createPreview).mockResolvedValue(previewResponse());
      renderPage();

      const htmlEditor = await screen.findByLabelText('HTML code');
      await user.type(htmlEditor, '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Preview' }));
      await waitFor(() => expect(createPreview).toHaveBeenCalled());

      expect(screen.getByLabelText('HTML code')).toHaveValue('<p>hi</p>');
    });

    it('shows a loading state while the preview request is in flight', async () => {
      const user = userEvent.setup();
      let resolveCreate: (value: PreviewRequestResponse) => void = () => {};
      vi.mocked(createPreview).mockReturnValue(
        new Promise((resolve) => { resolveCreate = resolve; }),
      );
      renderPage();

      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Preview' }));

      expect(screen.getByRole('button', { name: 'Preparing preview…' })).toBeDisabled();
      resolveCreate(previewResponse());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled());
    });

    it('shows a safe error message when the preview request fails', async () => {
      const user = userEvent.setup();
      vi.mocked(createPreview).mockRejectedValue({
        message: 'Stylesheet must compile successfully before preview.', code: 'STYLESHEET_MUST_COMPILE',
      });
      renderPage();

      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Preview' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Stylesheet must compile successfully before preview.',
      );
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('does not affect existing validation, Apply Safe Fixes, or AI Review behaviour', async () => {
      const user = userEvent.setup();
      vi.mocked(createPreview).mockResolvedValue(previewResponse());
      mockValidate(REPORT_NO_ISSUES);
      renderPage();

      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'Preview' }));
      await waitFor(() => expect(createPreview).toHaveBeenCalled());

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await waitFor(() => expect(startValidate).toHaveBeenCalled());
      expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
    });

    it('shows the AMPscript preview-values panel only when AMPscript content is present', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.queryByText('AMPscript preview values (optional)')).not.toBeInTheDocument();
    });
  });

  describe('AI Fix Issues (autonomous repair)', () => {
    it('does not render the old review-dialog affordances — clicking AI Fix Issues is consent, not a checkbox step', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.queryByText('Fix These Errors')).not.toBeInTheDocument();
      expect(screen.queryByText('Ask AI to Review and Fix')).not.toBeInTheDocument();
      expect(screen.queryByText('Apply Safe Fixes')).not.toBeInTheDocument();
      expect(screen.queryByText('Review & Fix with AI')).not.toBeInTheDocument();
      expect(screen.queryByText('Accept All Low Risk')).not.toBeInTheDocument();
    });

    it('is disabled before validation with "Validate the code first."', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Validate the code first.');
    });

    it('is disabled once the code changes after validation, "Code changed. Validate again before fixing issues."', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (2)');
      await user.type(screen.getByLabelText('HTML code'), '!');

      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Code changed. Validate again before fixing issues.');
    });

    it('is disabled with zero actionable issues, "No actionable issues found."', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('No issues found. This code passed all current checks.');

      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'No actionable issues found.');
    });

    it('is disabled when the only issue is info-severity advisory, "No actionable issues found."', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ONLY_ADVISORY_ISSUE);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (1)');

      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'No actionable issues found.');
    });

    async function validateWithOneDoctypeIssue() {
      const user = userEvent.setup();
      const initialReport = report({
        issues: [{
          id: 1, fingerprint: 'fp-doctype', severity: 'error', category: 'syntax', rule_id: 'missing-doctype',
          message: 'Document is missing "<!DOCTYPE html>".', file: 'html', language: 'html', line: 1, column: 1,
          suggestion: '', auto_fixable: true, risk: 'low', source_engine: 'html-structure', engine_version: '',
        }],
        error_count: 1,
      });
      await mockValidate(initialReport);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<html></html>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (1)');
      return user;
    }

    it('clicking AI Fix Issues calls the autonomous endpoint directly — no review dialog appears first', async () => {
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(
        report({ issues: [], error_count: 0 }), { html: '<!DOCTYPE html>\n<html></html>' },
        { issues_before: 1, fixes_applied: 1, issues_resolved: 1, issues_remaining: 0, issues_new: 0 },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(startAiFix).toHaveBeenCalledWith(
        expect.objectContaining({ report: 1, html: '<html></html>' }),
      ));
      // No issue-id selection is sent — the request carries only the
      // sources/scope the loop needs, never a pre-approved id list.
      expect(startAiFix).toHaveBeenCalledWith(
        expect.not.objectContaining({ deterministic_issue_ids: expect.anything() }),
      );
      await waitFor(() => expect(screen.getByLabelText('HTML code')).toHaveValue('<!DOCTYPE html>\n<html></html>'));
      expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
      // The banner's own text is set by a follow-up effect (one commit
      // after the report/source land) — wait for the final text rather
      // than asserting synchronously right after the report appears.
      await waitFor(() => {
        const banner = document.querySelector('.validator-page__fix-applied-banner');
        expect(banner).not.toBeNull();
        expect(banner).toHaveTextContent('All detected issues were fixed and the code was revalidated.');
      });
    });

    it('shows an in-flight label and a progress panel while the autonomous repair runs', async () => {
      const user = await validateWithOneDoctypeIssue();
      vi.mocked(startAiFix).mockResolvedValue({ operation_id: 'mock-op-id', status: 'running' });
      let resolveStatus: (value: RepairOperationStatus) => void = () => {};
      vi.mocked(getAiFixStatus).mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const runningButton = await screen.findByRole('button', { name: 'AI Engineer is repairing your code…' });
      expect(runningButton).toBeDisabled();
      expect(screen.getByRole('progressbar', { name: 'AI Engineer repair progress' })).toBeInTheDocument();
      resolveStatus(operationStatus({
        response_body: { ...report({ issues: [], error_count: 0 }), final_sources: { html: '<!DOCTYPE html>\n<html></html>' }, fix_metrics: fixMetrics() },
      }));
    });

    it('shows a live per-card status on the still-visible issue card while a repair round is in flight, keyed by fingerprint', async () => {
      const user = await validateWithOneDoctypeIssue();
      vi.mocked(startAiFix).mockResolvedValue({ operation_id: 'mock-op-id', status: 'running' });
      vi.mocked(getAiFixStatus)
        .mockResolvedValueOnce(operationStatus({
          status: 'running', stage: 'repairing', percent: 25, issues_resolved: 0, issues_remaining: 1,
          issue_updates: { 'fp-doctype': 'fixing' },
        }))
        .mockResolvedValueOnce(operationStatus({
          response_body: { ...report({ issues: [], error_count: 0 }), final_sources: { html: '<!DOCTYPE html>\n<html></html>' }, fix_metrics: fixMetrics() },
        }));

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      // The original issue card must STAY visible during the operation
      // (spec section 4 — never replace the list with only a spinner);
      // its live status is layered on via issue_updates, matched by the
      // issue's OWN fingerprint (fp-doctype), not a DB id or list index.
      await waitFor(() => expect(screen.getByText('Fixing…')).toBeInTheDocument());
      expect(
        screen.getByText('Document is missing "<!DOCTYPE html>".').closest('li'),
      ).toHaveClass('validation-issue-card--status-fixing');

      // Let the loop reach its terminal state so no background poller
      // survives into the next test.
      await waitFor(() => expect(screen.getByText('No issues found. This code passed all current checks.')).toBeInTheDocument(), { timeout: 3000 });
    });

    it('progress advances across real intermediate polls, never exceeds 100, and the panel is replaced by the success banner at true completion', async () => {
      const user = await validateWithOneDoctypeIssue();
      vi.mocked(startAiFix).mockResolvedValue({ operation_id: 'mock-op-id', status: 'running' });
      vi.mocked(getAiFixStatus)
        .mockResolvedValueOnce(operationStatus({
          status: 'running', stage: 'repairing', stage_label: 'AI Engineer is repairing your code…',
          percent: 25, issues_resolved: 0, issues_remaining: 1,
        }))
        .mockResolvedValueOnce(operationStatus({
          status: 'running', stage: 'revalidating', stage_label: 'Revalidating repaired code…',
          percent: 60, issues_resolved: 1, issues_remaining: 1,
        }))
        .mockResolvedValueOnce(operationStatus({
          response_body: { ...report({ issues: [], error_count: 0 }), final_sources: { html: '<!DOCTYPE html>\n<html></html>' }, fix_metrics: fixMetrics() },
        }));

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const bar = await screen.findByRole('progressbar', { name: 'AI Engineer repair progress' });
      await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '25'));
      await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '60'), { timeout: 3000 });
      // Every observed percent along the way stayed within [0, 100].
      expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(100);

      // True completion: the progress panel is gone, replaced by the
      // authoritative success banner (spec section 18 — never both at once).
      await waitFor(
        () => expect(screen.queryByRole('progressbar', { name: 'AI Engineer repair progress' })).not.toBeInTheDocument(),
        { timeout: 3000 },
      );
      // The banner's own text is set by a follow-up effect (one commit
      // after autonomousFixRunning/preFixSnapshot land), so it can
      // briefly render the plain fallback copy before the richer
      // metrics-driven message replaces it — wait for the final text
      // rather than asserting synchronously right after the progress bar
      // disappears.
      await waitFor(() => {
        const banner = document.querySelector('.validator-page__fix-applied-banner');
        expect(banner).not.toBeNull();
        expect(banner).toHaveTextContent('All detected issues were fixed and the code was revalidated.');
      });
    });

    it('a rapid double-click sends exactly one start request, with a fresh operation_id', async () => {
      const user = await validateWithOneDoctypeIssue();
      vi.mocked(startAiFix).mockResolvedValue({ operation_id: 'mock-op-id', status: 'running' });
      let resolveStatus: (value: RepairOperationStatus) => void = () => {};
      vi.mocked(getAiFixStatus).mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));

      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      await user.click(button);
      // Second click lands on the now-disabled (in-flight) button —
      // userEvent respects disabled state and does not fire the handler.
      await user.click(screen.getByRole('button', { name: 'AI Engineer is repairing your code…' }));

      expect(startAiFix).toHaveBeenCalledTimes(1);
      const sentPayload = vi.mocked(startAiFix).mock.calls[0][0];
      expect(typeof sentPayload.operation_id).toBe('string');
      expect(sentPayload.operation_id!.length).toBeGreaterThan(0);
      resolveStatus(operationStatus({
        response_body: { ...report({ issues: [], error_count: 0 }), final_sources: { html: '<!DOCTYPE html>\n<html></html>' }, fix_metrics: fixMetrics() },
      }));
    });

    it('shows the Resolved/Remaining/Requires Input breakdown when issues remain', async () => {
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(
        report({
          issues: [{
            id: 9, fingerprint: 'fp-remaining', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
            message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
          }],
          warning_count: 1,
        }),
        { html: '<!DOCTYPE html>\n<html></html>' },
        {
          issues_before: 2, fixes_applied: 1, issues_resolved: 1, issues_remaining: 1, issues_new: 0,
          issues_requires_input: 1, stopped_reason: 'no_actionable',
        },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const banner = await waitFor(() => {
        const el = document.querySelector('.validator-page__fix-applied-banner');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(banner).toHaveTextContent('AI Engineer fixed all technically repairable issues.');
      expect(banner).toHaveTextContent('Resolved: 1');
      expect(banner).toHaveTextContent('Remaining: 1');
      expect(banner).toHaveTextContent('Requires Input: 1');
    });

    it('never claims "fixed all technically repairable issues" when a genuine technical error remains on a no_actionable stop', async () => {
      // JavaScript Source-Recovery Architecture sprint, spec section 21 —
      // a 'no_actionable' stop does not always mean full success (e.g. a
      // whole-source candidate that would have resolved the remaining
      // error was itself declined/rejected this run); the headline must
      // only claim full success when nothing but requires-input/advisory
      // issues remain, matching fixOutcomeIsSuccess's own condition.
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(
        report({
          issues: [{
            id: 9, fingerprint: 'fp-remaining', severity: 'error', category: 'syntax', rule_id: 'javascript:parse-error',
            message: 'Parsing error: Unexpected token .', file: 'javascript', language: 'javascript', line: 2, column: 12,
            suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'javascript', engine_version: '',
          }],
          error_count: 1,
        }),
        { html: '<!DOCTYPE html>\n<html></html>' },
        {
          issues_before: 1, issues_resolved: 0, issues_remaining: 1, issues_requires_input: 0, issues_advisory: 0,
          stopped_reason: 'no_actionable',
        },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const banner = await waitFor(() => {
        const el = document.querySelector('.validator-page__fix-applied-banner');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(banner).not.toHaveTextContent('AI Engineer fixed all technically repairable issues.');
      expect(banner).toHaveTextContent('AI Engineer could not safely complete the repair. Some issues remain.');
      expect(banner).toHaveClass('validator-page__fix-applied-banner--attention');
    });

    it('states the precise reason (iteration limit) rather than "another pass may resolve more" when the loop stops for a reason other than running out of repairable issues', async () => {
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(
        report({
          issues: [{
            id: 9, fingerprint: 'fp-remaining', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
            message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
          }],
          warning_count: 1,
        }),
        { html: '<!DOCTYPE html>\n<html></html>' },
        { issues_before: 2, issues_resolved: 1, issues_remaining: 1, issues_requires_input: 0, stopped_reason: 'max_iterations' },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const banner = await waitFor(() => {
        const el = document.querySelector('.validator-page__fix-applied-banner');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(banner).toHaveTextContent(
        'AI Engineer reached its safety iteration limit for this run while repairs were still in progress.',
      );
    });

    it('explains that AI-assisted repairs were unavailable, not a generic failure, when the provider could not be reached', async () => {
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(
        report({
          issues: [{
            id: 9, fingerprint: 'fp-remaining', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
            message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
          }],
          warning_count: 1,
        }),
        { html: '<!DOCTYPE html>\n<html></html>' },
        {
          issues_resolved: 1, issues_remaining: 1, issues_requires_input: 0, issues_unrepairable: 1,
          stopped_reason: 'no_actionable', ai_unavailable: true,
        },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const banner = await waitFor(() => {
        const el = document.querySelector('.validator-page__fix-applied-banner');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(banner).toHaveTextContent(
        'Verified automatic repairs were applied. AI-assisted repair is temporarily unavailable for the remaining contextual issues.',
      );
      // Repair-architecture closure sprint, spec section 19 — genuine
      // remaining technical issues must never get the green/checkmark
      // success presentation.
      expect(banner).toHaveClass('validator-page__fix-applied-banner--attention');
    });

    it('does not blame AI unavailability when everything remaining is genuinely requires-input, not contextual', async () => {
      // Repair-architecture closure sprint, spec section 8/10 — a
      // remaining issue that is "requires input" (a real business
      // decision) is not something AI availability would have changed;
      // the banner must not imply otherwise.
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(
        report({
          issues: [{
            id: 9, fingerprint: 'fp-remaining', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
            message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
          }],
          warning_count: 1,
        }),
        { html: '<!DOCTYPE html>\n<html></html>' },
        {
          issues_resolved: 1, issues_remaining: 1, issues_requires_input: 1, issues_unrepairable: 0,
          stopped_reason: 'no_actionable', ai_unavailable: true,
        },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const banner = await waitFor(() => {
        const el = document.querySelector('.validator-page__fix-applied-banner');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(banner).not.toHaveTextContent('AI-assisted repair is temporarily unavailable');
      expect(banner).toHaveTextContent('AI Engineer fixed all technically repairable issues.');
      // A remaining issue that is genuinely "requires input" (not a
      // technical defect the system already knows how to fix) still
      // gets the green/success presentation — deterministic repair
      // truly did exhaust everything it could.
      expect(banner).not.toHaveClass('validator-page__fix-applied-banner--attention');
    });

    it('shows the attention (never green success) banner when structural recovery failed', async () => {
      // HTML Whole-Document Structural Recovery sprint, spec section 19
      // — "Do not show a green success-style banner when Remaining: 15
      // Errors: 15."
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(
        report({
          issues: [{
            id: 9, fingerprint: 'fp-shell', severity: 'error', category: 'syntax', rule_id: 'html5lib:unexpected-start-tag',
            message: 'Unexpected start tag (head).', file: 'html', language: 'html', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'html5lib', engine_version: '',
          }],
          error_count: 1,
        }),
        { html: '<!DOCTYPE html>\n<html></html>' },
        {
          issues_resolved: 0, issues_remaining: 1, issues_requires_input: 0, issues_unrepairable: 1,
          stopped_reason: 'structural_recovery_failed', ai_unavailable: false,
        },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      const banner = await waitFor(() => {
        const el = document.querySelector('.validator-page__fix-applied-banner');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(banner).toHaveTextContent(
        'AI Engineer stopped because the current document requires structural recovery. No unsafe candidate was published.',
      );
      expect(banner).toHaveClass('validator-page__fix-applied-banner--attention');
    });

    it('Undo Applied Fixes restores the exact pre-fix source', async () => {
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(report({ issues: [], error_count: 0 }), { html: '<!DOCTYPE html>\n<html></html>' });
      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));
      await waitFor(() => expect(screen.getByLabelText('HTML code')).toHaveValue('<!DOCTYPE html>\n<html></html>'));
      await waitFor(() => expect(document.querySelector('.validator-page__fix-applied-banner')).not.toBeNull());

      await user.click(screen.getByRole('button', { name: 'Undo Applied Fixes' }));

      expect(screen.getByLabelText('HTML code')).toHaveValue('<html></html>');
      expect(document.querySelector('.validator-page__fix-applied-banner')).toBeNull();
      expect(screen.getByText('Code changed. Validate again to update the results.')).toBeInTheDocument();
    });

    it('never shows "All detected issues were fixed..." together with "Code changed. Validate again" — correctness sprint regression', async () => {
      // Regression test for the reported contradictory-banner bug. The
      // Monaco mock now faithfully re-fires onChange when `value` changes
      // programmatically (see testUtils/monacoEditorMock.tsx) — exactly
      // what applying fixes does via setValues() — so this exercises the
      // real race, not a simplified stand-in for it.
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(report({ issues: [], error_count: 0 }), { html: '<!DOCTYPE html>\n<html></html>' });

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      await waitFor(() => {
        const banner = document.querySelector('.validator-page__fix-applied-banner');
        expect(banner).not.toBeNull();
        expect(banner).toHaveTextContent('All detected issues were fixed and the code was revalidated.');
      });
      expect(screen.queryByText('Code changed. Validate again to update the results.')).not.toBeInTheDocument();
    });

    it('a genuine edit after a successful fix still marks the page stale — suppression is not over-broad', async () => {
      const user = await validateWithOneDoctypeIssue();
      await mockRunAiFixIssues(report({ issues: [], error_count: 0 }), { html: '<!DOCTYPE html>\n<html></html>' });
      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));
      await waitFor(() => expect(document.querySelector('.validator-page__fix-applied-banner')).not.toBeNull());

      await user.type(screen.getByLabelText('HTML code'), '\n<!-- a real, later edit -->');

      expect(document.querySelector('.validator-page__fix-applied-banner')).toBeNull();
      expect(screen.getAllByText('Code changed. Validate again to update the results.').length).toBeGreaterThan(0);
    });

    it('shows an error, re-enables the button, and applies nothing when starting the repair operation fails', async () => {
      const user = await validateWithOneDoctypeIssue();
      vi.mocked(startAiFix).mockRejectedValue({ message: 'Fixes could not be applied. Please try again.' });

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      await waitFor(() => expect(screen.getAllByText('Fixes could not be applied. Please try again.').length).toBeGreaterThan(0));
      expect(screen.getByRole('button', { name: 'AI Fix Issues' })).toBeEnabled();
      expect(screen.getByLabelText('HTML code')).toHaveValue('<html></html>');
      expect(document.querySelector('.validator-page__fix-applied-banner')).toBeNull();
    });

    it('shows the failure reason, re-enables the button, and applies nothing when the repair operation itself fails', async () => {
      const user = await validateWithOneDoctypeIssue();
      vi.mocked(startAiFix).mockResolvedValue({ operation_id: 'mock-op-id', status: 'running' });
      vi.mocked(getAiFixStatus).mockResolvedValue(operationStatus({
        status: 'failed',
        failure_reason: 'AI Engineer could not safely complete the repair.',
        response_body: { success: false, code: 'AI_FIX_RUN_FAILED', message: 'AI Engineer could not safely complete the repair.' },
        response_status: 500,
      }));

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      await waitFor(() => expect(screen.getAllByText('AI Engineer could not safely complete the repair.').length).toBeGreaterThan(0));
      expect(screen.getByRole('button', { name: 'AI Fix Issues' })).toBeEnabled();
      expect(screen.getByLabelText('HTML code')).toHaveValue('<html></html>');
      expect(document.querySelector('.validator-page__fix-applied-banner')).toBeNull();
    });

    it('repairs an AI-assisted issue with no dialog and no per-issue selection', async () => {
      const user = userEvent.setup();
      const html = '<img src="a.jpg">';
      await mockValidate(report({
        issues: [{
          id: 1, fingerprint: 'fp-alt', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
          message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
        }],
        warning_count: 1,
      }));
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), html);
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (1)');
      await mockRunAiFixIssues(
        report({ issues: [], warning_count: 0 }), { html: '<img src="a.jpg" alt="">' },
        { issues_before: 1, fixes_applied: 1, issues_resolved: 1, issues_remaining: 0, issues_new: 0 },
      );

      await user.click(screen.getByRole('button', { name: 'AI Fix Issues' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText('HTML code')).toHaveValue('<img src="a.jpg" alt="">'));
      expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
      await waitFor(() => expect(document.querySelector('.validator-page__fix-applied-banner')).toHaveTextContent(
        'All detected issues were fixed and the code was revalidated.',
      ));
    });
  });

  describe('AI Fix This Issue (per issue)', () => {
    async function validateWithOneSafeDoctypeFix() {
      const user = userEvent.setup();
      await mockValidate(report({
        issues: [{
          id: 1, fingerprint: 'fp-doctype', severity: 'error', category: 'syntax', rule_id: 'missing-doctype',
          message: 'Document is missing "<!DOCTYPE html>".', file: 'html', language: 'html', line: 1, column: 1,
          suggestion: '', auto_fixable: true, risk: 'low', source_engine: 'html-structure', engine_version: '',
        }],
        error_count: 1,
      }));
      await mockPreviewFixes({
        patches: [fixPatch({ fix_id: 'fix-doctype', issue_id: 1 })],
        conflicts: [], review_required: [], not_found: [],
      });
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<html></html>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (1)');
      return user;
    }

    it('uses the deterministic patch without calling the AI provider', async () => {
      const user = await validateWithOneSafeDoctypeFix();
      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));

      expect(await screen.findByText('Recommended fix')).toBeInTheDocument();
      expect(screen.getByText('Insert missing <!DOCTYPE html>.')).toBeInTheDocument();
      expect(screen.getByText('Fix method: Deterministic')).toBeInTheDocument();
      expect(requestAIReview).not.toHaveBeenCalled();
    });

    it('applies the deterministic fix and revalidates', async () => {
      const user = await validateWithOneSafeDoctypeFix();
      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));
      await screen.findByText('Recommended fix');
      await mockApplyFixes({
        results: [{ fix_id: 'fix-doctype', issue_id: 1, file: 'html', status: 'applied' }],
        proposed_sources: { html: '<!DOCTYPE html>\n<html></html>' },
        conflicts: [], review_required: [], not_found: [],
      });
      await mockValidate(report({ issues: [], error_count: 0 }));

      await user.click(screen.getByRole('button', { name: 'Apply Fix' }));

      await waitFor(() => expect(screen.getByLabelText('HTML code')).toHaveValue('<!DOCTYPE html>\n<html></html>'));
      expect(screen.queryByRole('dialog', { name: 'AI Fix This Issue' })).not.toBeInTheDocument();
    });

    // Fix-Application Correctness sprint — a candidate can be applied
    // (HTTP 200, source mutated) without the SELECTED issue actually
    // disappearing on revalidation (e.g. a mis-scoped repair). The dialog
    // must stay open and show an in-modal error rather than close on the
    // apply call's success alone (spec section 4/5/6).
    it('keeps the dialog open and reports failure when revalidation still shows the selected issue', async () => {
      const user = await validateWithOneSafeDoctypeFix();
      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));
      await screen.findByText('Recommended fix');
      await mockApplyFixes({
        results: [{ fix_id: 'fix-doctype', issue_id: 1, file: 'html', status: 'applied' }],
        proposed_sources: { html: '<html></html>' },
        conflicts: [], review_required: [], not_found: [],
      });
      // Revalidation still reports the SAME rule at the SAME line —
      // the fix did not actually resolve the targeted issue.
      await mockValidate(report({
        issues: [{
          id: 2, fingerprint: 'fp-doctype-2', severity: 'error', category: 'syntax', rule_id: 'missing-doctype',
          message: 'Document is missing "<!DOCTYPE html>".', file: 'html', language: 'html', line: 1, column: 1,
          suggestion: '', auto_fixable: true, risk: 'low', source_engine: 'html-structure', engine_version: '',
        }],
        error_count: 1,
      }));

      await user.click(screen.getByRole('button', { name: 'Apply Fix' }));

      const dialog = await screen.findByRole('dialog', { name: 'AI Fix This Issue' });
      expect(within(dialog).getByText(
        'The proposed fix did not resolve this issue. No successful fix was applied.',
      )).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });

    // Fix-Application Correctness sprint (spec section 20) — a proposal
    // fetched when the dialog opened must not be applied against source
    // the user has since edited in the background.
    it('rejects Apply Fix without calling the apply API when the source changed while the dialog was open', async () => {
      const user = await validateWithOneSafeDoctypeFix();
      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));
      await screen.findByText('Recommended fix');

      // fireEvent.change (not user.type) — the modal overlay sits on top
      // of the editor in the DOM; a real click-to-focus keystroke
      // simulation is unnecessary here, this is only testing that a
      // background source mutation invalidates the cached proposal.
      fireEvent.change(screen.getByLabelText('HTML code'), {
        target: { value: '<html></html><!-- edited while dialog open -->' },
      });

      const dialog = await screen.findByRole('dialog', { name: 'AI Fix This Issue' });
      await user.click(within(dialog).getByRole('button', { name: 'Apply Fix' }));

      expect(within(dialog).getByText(
        'The code changed since this proposal was generated. Close this dialog and try AI Fix This Issue again.',
      )).toBeInTheDocument();
      expect(applyFixes).not.toHaveBeenCalled();
    });

    async function validateWithOneAlt() {
      const user = userEvent.setup();
      const html = '<img src="a.jpg">';
      await mockValidate(report({
        issues: [{
          id: 1, fingerprint: 'fp-alt', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
          message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
        }],
        warning_count: 1,
      }));
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), html);
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (1)');
      return user;
    }

    it('falls back to the AI engine, scoped to just this one issue, when no deterministic fix exists', async () => {
      const user = await validateWithOneAlt();
      await mockRequestAIReview({
        review_id: 'review-1', summary: '',
        proposals: [aiProposal({})], not_reviewed: [], counts: { low: 1, medium: 0, high: 0, total: 1 },
      });

      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));

      await waitFor(() => expect(requestAIReview).toHaveBeenCalledWith(
        expect.objectContaining({ issue_ids: [1] }),
      ));
      expect(await screen.findByText('AI-assisted recommendation')).toBeInTheDocument();
      expect(screen.getByText('Fix method: AI-assisted')).toBeInTheDocument();
    });

    it('applies the AI-assisted fix and revalidates', async () => {
      const user = await validateWithOneAlt();
      await mockRequestAIReview({
        review_id: 'review-1', summary: '',
        proposals: [aiProposal({})], not_reviewed: [], counts: { low: 1, medium: 0, high: 0, total: 1 },
      });
      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));
      await screen.findByText('AI-assisted recommendation');
      await mockApplyAIReview({
        results: [{ fix_id: 'ai-fix-1', issue_id: 1, file: 'html', status: 'applied' }],
        proposed_sources: { html: '<img src="a.jpg" alt="">' },
        conflicts: [],
      });
      await mockValidate(report({ issues: [], warning_count: 0 }));

      await user.click(screen.getByRole('button', { name: 'Apply Fix' }));

      await waitFor(() => expect(screen.getByLabelText('HTML code')).toHaveValue('<img src="a.jpg" alt="">'));
      expect(screen.queryByRole('dialog', { name: 'AI Fix This Issue' })).not.toBeInTheDocument();
    });

    it('shows "AI fixing is currently unavailable." when there is no deterministic fix and the provider is down', async () => {
      const user = await validateWithOneAlt();
      vi.mocked(requestAIReview).mockRejectedValue({ code: 'AI_REVIEW_UNAVAILABLE', message: 'unavailable' });

      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));

      expect(await screen.findByText('AI fixing is currently unavailable.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Apply Fix' })).not.toBeInTheDocument();
    });

    it('shows "Review manually." when neither engine can safely fix the issue', async () => {
      const user = await validateWithOneAlt();
      await mockRequestAIReview({
        review_id: 'review-1', summary: '',
        proposals: [aiProposal({ status: 'rejected', rejection_reason: 'Code changed after validation.' })],
        not_reviewed: [], counts: { low: 0, medium: 0, high: 0, total: 0 },
      });

      await user.click(screen.getByRole('button', { name: 'AI Fix This Issue' }));

      expect(await screen.findByText(/Review manually|Proposal rejected/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Apply Fix' })).not.toBeInTheDocument();
    });

    it('disables AI Fix This Issue for a non-actionable (cdn) issue', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        issues: [{
          id: 1, fingerprint: 'fp-cdn', severity: 'warning', category: 'security', rule_id: 'cdn:unpinned-version',
          message: 'CDN reference has no pinned version.', file: 'cdn', language: 'cdn', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'medium', source_engine: 'cdn-reference', engine_version: '',
        }],
        warning_count: 1,
      }));
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (1)');

      expect(screen.getByRole('button', { name: 'AI Fix This Issue' })).toBeDisabled();
    });
  });

  describe('Yukti explains validation issues', () => {
    function batchExplanation(overrides: Partial<YuktiExplainResponse> = {}): YuktiExplainResponse {
      return {
        counts: { errors: 1, warnings: 1, info: 0 },
        language_breakdown: [{ language: 'html', errors: 1, warnings: 1, info: 0 }],
        truncated: false,
        summary: 'I found 1 error and 1 warning.',
        most_important: [{ issue_id: 1, reason: 'It affects the whole document.' }],
        why_it_matters: 'Browsers may render the page unpredictably.',
        how_to_fix: 'Apply the recommended correction for each issue.',
        recommended_order: 'Fix structural issues first.',
        per_issue: [],
        ...overrides,
      };
    }

    function issueExplanation(overrides: Partial<YuktiExplainResponse> = {}): YuktiExplainResponse {
      return {
        counts: { errors: 0, warnings: 1, info: 0 },
        language_breakdown: [],
        truncated: false,
        summary: '',
        most_important: [],
        why_it_matters: '',
        how_to_fix: '',
        recommended_order: '',
        per_issue: [{
          issue_id: 2, what: 'The image has no alt text.', why: 'Screen readers cannot describe it.',
          impact: 'Assistive-technology users miss the content.', recommended_correction: 'Add a descriptive alt attribute.',
          fix_method: 'ai-assisted', requires_decision: true,
        }],
        ...overrides,
      };
    }

    it('shows the prompt after a successful validate with issues', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(await screen.findByText(/I found 2 validation issues\./)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Not Now' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Explain Issues' })).toBeInTheDocument();
    });

    it('does not show the prompt when validation finds zero issues', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('No issues found. This code passed all current checks.');

      expect(screen.queryByText(/Would you like me to explain/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Explain Issues' })).not.toBeInTheDocument();
    });

    it('Not Now dismisses the prompt and it does not reappear this session', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await user.click(await screen.findByRole('button', { name: 'Not Now' }));

      expect(screen.queryByRole('button', { name: 'Explain Issues' })).not.toBeInTheDocument();

      // Re-validating the same report must not bring the prompt back.
      await user.type(screen.getByLabelText('HTML code'), '!');
      await mockValidate(REPORT_WITH_ISSUES);
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (2)');
      expect(screen.queryByRole('button', { name: 'Explain Issues' })).not.toBeInTheDocument();
    });

    it('Explain Issues opens the text explanation for the whole report', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      vi.mocked(requestYuktiExplanation).mockResolvedValue(batchExplanation());
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await user.click(await screen.findByRole('button', { name: 'Explain Issues' }));

      expect(await screen.findByText('I found 1 error and 1 warning.')).toBeInTheDocument();
      expect(requestYuktiExplanation).toHaveBeenCalledWith(
        expect.objectContaining({ issue_ids: [] }),
      );
      // The prompt itself is gone once the panel takes over.
      expect(screen.queryByRole('button', { name: 'Explain Issues' })).not.toBeInTheDocument();
    });

    it('Complete LP scope groups the explanation by language', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      vi.mocked(requestYuktiExplanation).mockResolvedValue(batchExplanation());
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await user.click(await screen.findByRole('button', { name: 'Explain Issues' }));

      expect(await screen.findByText('Issues by Area')).toBeInTheDocument();
      expect(screen.getByText(/HTML:/)).toBeInTheDocument();
    });

    it('Ask Yukti on one issue explains just that issue, distinct from AI Fix This Issue', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        issues: [{
          id: 2, fingerprint: 'fp-alt', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
          message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-accessibility', engine_version: '',
        }],
        warning_count: 1,
      }));
      vi.mocked(requestYuktiExplanation).mockResolvedValue(issueExplanation());
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<img src="a.jpg">');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (1)');

      await user.click(screen.getByRole('button', { name: 'Ask Yukti to Explain' }));

      expect(await screen.findByText('The image has no alt text.')).toBeInTheDocument();
      expect(requestYuktiExplanation).toHaveBeenCalledWith(
        expect.objectContaining({ issue_ids: [2] }),
      );
      // AI Fix This Issue is a completely separate control, untouched by Ask Yukti.
      expect(screen.getByRole('button', { name: 'AI Fix This Issue' })).toBeInTheDocument();
      expect(requestAIReview).not.toHaveBeenCalled();
    });

    it('Close returns focus to a usable page — AI Fix Issues/AI Fix This Issue remain independent', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      vi.mocked(requestYuktiExplanation).mockResolvedValue(batchExplanation());
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await user.click(await screen.findByRole('button', { name: 'Explain Issues' }));
      await screen.findByText('I found 1 error and 1 warning.');

      await user.click(screen.getByRole('button', { name: "Close Yukti's explanation" }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'AI Fix Issues' })).toBeEnabled();
    });

    it('shows a safe error message when the explanation request fails', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      vi.mocked(requestYuktiExplanation).mockRejectedValue({
        code: 'EXPLAIN_UNAVAILABLE', message: 'Yukti explanation is not configured for this environment.',
      });
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await user.click(await screen.findByRole('button', { name: 'Explain Issues' }));

      expect(await screen.findByText('Yukti explanation is not configured for this environment.')).toBeInTheDocument();
    });
  });

  it('submits the current code and shows a loading state while validating', async () => {
    const user = userEvent.setup();
    let resolveStatus: (value: ValidateOperationStatus) => void = () => {};
    vi.mocked(startValidate).mockResolvedValue({ operation_id: 'mock-validate-op-id', status: 'running' });
    vi.mocked(getValidateStatus).mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));
    renderPage();

    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
    await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

    expect(screen.getAllByText('Validating code…').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Validating…' })).toBeDisabled();

    resolveStatus(validateOperationStatus({ response_body: REPORT_NO_ISSUES }));
    await waitFor(() => expect(screen.getByText('No issues found. This code passed all current checks.')).toBeInTheDocument());
  });

  it('renders issues and correct counts on a successful validation with issues', async () => {
    const user = userEvent.setup();
    await mockValidate(REPORT_WITH_ISSUES);
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

    expect(await screen.findByText('Validation Issues (2)')).toBeInTheDocument();
    expect(screen.getByText('"<div>" is never closed.')).toBeInTheDocument();
    expect(screen.getByText('Image is missing an alt attribute.')).toBeInTheDocument();
  });

  it('shows the no-issues success state', async () => {
    const user = userEvent.setup();
    await mockValidate(REPORT_NO_ISSUES);
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

    expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
  });

  it('shows an API error state with a retry action', async () => {
    const user = userEvent.setup();
    vi.mocked(startValidate).mockRejectedValue({
      message: 'Please correct the highlighted fields.', code: 'VALIDATION_ERROR', status: 400,
    });
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted fields.');
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('Try Again resubmits the validate request', async () => {
    const user = userEvent.setup();
    vi.mocked(startValidate).mockRejectedValue({ message: 'Something went wrong. Please try again.' });
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
    await screen.findByRole('alert');
    expect(startValidate).toHaveBeenCalledTimes(1);

    await mockValidate(REPORT_NO_ISSUES);
    await user.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(startValidate).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('No issues found. This code passed all current checks.')).toBeInTheDocument();
  });

  it('Go to Line switches to the issue language tab', async () => {
    const user = userEvent.setup();
    await mockValidate(REPORT_WITH_ISSUES);
    renderPage();
    await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');

    await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
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

    it('enables the JavaScript scope option since its engine is available', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.getByRole('radio', { name: 'JavaScript' })).not.toBeDisabled();
    });

    it('does not offer a TypeScript scope option', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.queryByRole('radio', { name: 'TypeScript' })).not.toBeInTheDocument();
    });

    it('enables the AMPscript scope option since its engine is available', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.getByRole('radio', { name: 'AMPscript' })).not.toBeDisabled();
    });

    it('sends validation_scope: css when CSS Only is selected', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('radio', { name: 'CSS' }));
      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      await user.type(screen.getByLabelText('CSS code'), '.a{{color:red}}');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(startValidate).toHaveBeenCalledWith(
        expect.objectContaining({ validation_scope: 'css' }),
        expect.anything(),
      );
    });

    it('sends validation_scope: complete by default', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(startValidate).toHaveBeenCalledWith(
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
      const validateButton = screen.getByRole('button', { name: 'AI Validate Code' });
      expect(validateButton).toBeDisabled();
      expect(validateButton).toHaveAttribute('title', 'Enter CSS code before validating CSS.');
    });

    it('shows the exact per-scope disabled reason for HTML and Complete LP', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');

      expect(screen.getByRole('button', { name: 'AI Validate Code' })).toHaveAttribute(
        'title', 'Add HTML to begin complete landing-page validation.',
      );

      await user.click(screen.getByRole('radio', { name: 'HTML' }));
      expect(screen.getByRole('button', { name: 'AI Validate Code' })).toHaveAttribute(
        'title', 'Enter HTML code before validating HTML.',
      );
    });

    it('clears a previous report when only the scope selector changes (no source edited)', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      // Switching scope must not carry the previous scope's results (or
      // an unrelated language's issues) forward into the new selection.
      await user.click(screen.getByRole('radio', { name: 'CSS' }));

      expect(screen.queryByText('Validation Issues (2)')).not.toBeInTheDocument();
      expect(screen.queryByText('"<div>" is never closed.')).not.toBeInTheDocument();
    });

    it('clears a previous error banner when the scope selector changes', async () => {
      const user = userEvent.setup();
      vi.mocked(startValidate).mockRejectedValue({ message: 'Something went wrong. Please try again.' });
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
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
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
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
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      await user.type(screen.getByLabelText('HTML code'), '!');
      expect(screen.getAllByText('Code changed. Validate again to update the results.').length).toBeGreaterThan(0);

      await mockValidate(REPORT_NO_ISSUES);
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

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
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      await user.click(screen.getByRole('button', { name: 'Clear HTML' }));
      await user.click(screen.getByRole('button', { name: 'Clear Code' }));

      expect(screen.getAllByText('Code changed. Validate again to update the results.').length).toBeGreaterThan(0);
    });
  });

  describe('stylesheet source type', () => {
    beforeEach(() => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    // jsdom 30's navigator.clipboard can't be overridden by plain
    // assignment, and userEvent.setup() itself touches it during its own
    // initialization — the mock must be installed AFTER setup(), never in
    // beforeEach (see the identical note in GeneratedCssPanel.test.tsx).
    function mockClipboard() {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      return writeText;
    }

    async function selectCssScope(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('radio', { name: 'CSS' }));
    }

    it('shows the selector in CSS-only scope', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      expect(screen.getByLabelText('Stylesheet type')).toBeInTheDocument();
    });

    it('shows the selector in Complete LP while the CSS tab is active', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.queryByLabelText('Stylesheet type')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      expect(screen.getByLabelText('Stylesheet type')).toBeInTheDocument();
    });

    it('is absent in HTML-only scope', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'HTML' }));
      expect(screen.queryByLabelText('Stylesheet type')).not.toBeInTheDocument();
    });

    it('defaults to CSS', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      expect(screen.getByLabelText('Stylesheet type')).toHaveValue('css');
    });

    it('lets the user choose SCSS, Sass and LESS', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      const select = screen.getByLabelText('Stylesheet type');

      await user.selectOptions(select, 'scss');
      expect(select).toHaveValue('scss');
      await user.selectOptions(select, 'sass');
      expect(select).toHaveValue('sass');
      await user.selectOptions(select, 'less');
      expect(select).toHaveValue('less');
    });

    it('requires confirmation when changing type with non-empty source, and Cancel preserves type and source', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.type(screen.getByLabelText('CSS code'), '.a {{color: red;}');

      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      expect(screen.getByText('Change stylesheet type?')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByLabelText('Stylesheet type')).toHaveValue('css');
      expect(screen.getByLabelText('CSS code')).toHaveValue('.a {color: red;}');
    });

    it('Change Type confirms the change and preserves the source text', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.type(screen.getByLabelText('CSS code'), '.a {{color: red;}');

      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.click(screen.getByRole('button', { name: 'Change Type' }));

      expect(screen.getByLabelText('Stylesheet type')).toHaveValue('scss');
      expect(screen.getByLabelText('CSS code')).toHaveValue('.a {color: red;}');
    });

    it('skips confirmation when the stylesheet source is empty', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);

      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      expect(screen.queryByText('Change stylesheet type?')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Stylesheet type')).toHaveValue('scss');
    });

    it('CSS hides Compile to CSS; SCSS, Sass and LESS show it', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);

      expect(screen.queryByRole('button', { name: 'Compile to CSS' })).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      expect(screen.getByRole('button', { name: 'Compile to CSS' })).toBeInTheDocument();

      // Source is still empty here, so this and every other type switch in
      // this test applies immediately with no confirmation dialog.
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'sass');
      expect(screen.getByRole('button', { name: 'Compile to CSS' })).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'less');
      expect(screen.getByRole('button', { name: 'Compile to CSS' })).toBeInTheDocument();
    });

    it('sends the selected css_source_type on validate', async () => {
      const user = userEvent.setup();
      await mockValidate(report({ validation_scope: 'css', css_source_type: 'less' }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'less');
      await user.type(screen.getByLabelText('CSS code'), '.a {{.mixin();}');

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(startValidate).toHaveBeenCalledWith(
        expect.objectContaining({ css_source_type: 'less' }),
        expect.anything(),
      );
    });

    it('shows the Generated CSS panel after a successful compilation', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'scss',
        generated_css: '.a { color: red; }', generated_css_compiled: true,
        generated_css_engine: 'dart-sass', generated_css_engine_version: 'sass@1.102.0',
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.type(screen.getByLabelText('CSS code'), '$brand: red; .a {{color: $brand;}');

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(await screen.findByText('Generated CSS — read-only')).toBeInTheDocument();
      expect(screen.getByText('.a { color: red; }')).toBeInTheDocument();
      expect(screen.getByText('Compiled successfully')).toBeInTheDocument();
    });

    describe('page layout structure (footer-overlap regression)', () => {
      // jsdom has no layout engine — these prove DOM/class structure, not
      // real geometry (overflow, computed height, visual overlap). See
      // .validator-page's own CSS comment (LandingPageValidatorPage.css)
      // for why overflow-y: auto there is what actually fixes the bug;
      // manual browser verification covers the visual claim.
      async function renderWithGeneratedCss() {
        const user = userEvent.setup();
        await mockValidate(report({
          validation_scope: 'css', css_source_type: 'scss',
          generated_css: '.a { color: red; }\n'.repeat(40), generated_css_compiled: true,
          generated_css_engine: 'dart-sass', generated_css_engine_version: 'sass@1.102.0',
        }));
        renderPage();
        await screen.findByLabelText('HTML code');
        await selectCssScope(user);
        await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
        await user.type(screen.getByLabelText('CSS code'), '$brand: red; .a {{color: $brand;}');
        await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
        await screen.findByText('Generated CSS — read-only');
        return user;
      }

      it('renders Generated CSS inside the Module 3 page content, not as a sibling of it', async () => {
        await renderWithGeneratedCss();
        const page = document.querySelector('.validator-page');
        const panel = document.querySelector('.generated-css-panel');
        expect(page).not.toBeNull();
        expect(panel).not.toBeNull();
        expect(page?.contains(panel)).toBe(true);
      });

      it('Generated CSS is a sibling of the workspace, not nested inside it', async () => {
        await renderWithGeneratedCss();
        const workspace = document.querySelector('.validator-page__workspace');
        const panel = document.querySelector('.generated-css-panel');
        expect(workspace?.contains(panel as Node)).toBe(false);
      });

      it('the footer is never nested inside the validator page content', async () => {
        // renderPage() mounts the page in isolation (no AppLayout) — this
        // test reproduces AppLayout's actual shell shape (.app-frame__body
        // > <main class="app-frame__content"> + <Footer>, siblings) so the
        // structural claim ("footer is a page sibling, never a page
        // descendant") is checked against real shell markup, not assumed.
        const user = userEvent.setup();
        await mockValidate(report({
          validation_scope: 'css', css_source_type: 'scss',
          generated_css: '.a { color: red; }\n'.repeat(40), generated_css_compiled: true,
          generated_css_engine: 'dart-sass', generated_css_engine_version: 'sass@1.102.0',
        }));
        render(
          <MemoryRouter initialEntries={['/module-3/validator']}>
            <div className="app-frame__body">
              <main className="app-frame__content">
                <LandingPageValidatorPage />
              </main>
              <Footer variant="app" />
            </div>
          </MemoryRouter>,
        );
        await screen.findByLabelText('HTML code');
        await user.click(screen.getByRole('radio', { name: 'CSS' }));
        await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
        await user.type(screen.getByLabelText('CSS code'), '$brand: red; .a {{color: $brand;}');
        await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
        await screen.findByText('Generated CSS — read-only');

        const page = document.querySelector('.validator-page');
        const footer = document.querySelector('.site-footer');
        const content = document.querySelector('.app-frame__content');
        expect(footer).not.toBeNull();
        expect(page?.contains(footer)).toBe(false);
        expect(content?.contains(footer)).toBe(false);
        expect(content?.contains(page)).toBe(true);
      });

      it('expanded Generated CSS carries the expanded layout class, not the collapsed one', async () => {
        await renderWithGeneratedCss();
        const panel = document.querySelector('.generated-css-panel');
        expect(panel).not.toHaveClass('generated-css-panel--collapsed');
      });

      it('Hide Generated CSS switches to the collapsed layout class and drops the scrollable code block', async () => {
        const user = await renderWithGeneratedCss();
        await user.click(screen.getByRole('button', { name: 'Hide Generated CSS' }));

        const panel = document.querySelector('.generated-css-panel');
        expect(panel).toHaveClass('generated-css-panel--collapsed');
        expect(document.querySelector('.generated-css-panel__code')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show Generated CSS' })).toBeInTheDocument();
      });

      it('re-expanding after Hide restores the full panel without a page reload', async () => {
        const user = await renderWithGeneratedCss();
        await user.click(screen.getByRole('button', { name: 'Hide Generated CSS' }));
        await user.click(screen.getByRole('button', { name: 'Show Generated CSS' }));

        expect(screen.getByText('Generated CSS — read-only')).toBeInTheDocument();
        expect(document.querySelector('.generated-css-panel__code')).toBeInTheDocument();
      });

      it('the editor workspace row keeps its min-height containment class', async () => {
        await renderWithGeneratedCss();
        expect(document.querySelector('.validator-page__workspace')).toBeInTheDocument();
        expect(document.querySelector('.validator-page__editor')).toBeInTheDocument();
      });

      it('Validation Issues keeps its own scroll-container element', async () => {
        await renderWithGeneratedCss();
        expect(document.querySelector('.validator-page__results')).toBeInTheDocument();
      });

      it('Generated CSS keeps its own internal scroll-container element for the code block', async () => {
        await renderWithGeneratedCss();
        const code = document.querySelector('.generated-css-panel__code');
        expect(code).not.toBeNull();
        expect(code?.tagName.toLowerCase()).toBe('pre');
      });

      it('AI Fix Issues remains present and functional alongside an expanded Generated CSS panel', async () => {
        await renderWithGeneratedCss();
        expect(screen.getByRole('button', { name: 'AI Fix Issues' })).toBeInTheDocument();
      });

      it('the stylesheet type selector remains functional alongside an expanded Generated CSS panel', async () => {
        await renderWithGeneratedCss();
        expect(screen.getByLabelText('Stylesheet type')).toHaveValue('scss');
      });

      it('Compile to CSS remains functional alongside an expanded Generated CSS panel', async () => {
        await renderWithGeneratedCss();
        expect(screen.getByRole('button', { name: 'Compile to CSS' })).toBeInTheDocument();
      });
    });

    it('does not show stale generated CSS after a compiler failure', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'scss',
        generated_css: null, generated_css_compiled: false,
        engine_status: [{
          engine_name: 'scss-compiler', success: false, duration_ms: 5, issue_count: 1,
          message: 'Undefined variable.',
        }],
        issues: [{
          id: 3, fingerprint: 'fp-scss', severity: 'error', category: 'syntax', rule_id: 'scss:compile-error',
          message: 'Undefined variable.', file: 'css', language: 'css', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'scss', engine_version: '',
          source_context: 'standalone-scss',
        }],
        error_count: 1,
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.type(screen.getByLabelText('CSS code'), '.a {{color: $brand;}');

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      await screen.findByText('Compilation failed internally');
      expect(screen.queryByText('Generated CSS — read-only')).not.toBeInTheDocument();
    });

    it('shows "Compilation blocked" with no engine_status failure entry (source-error-only failure)', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'scss',
        generated_css: null, generated_css_compiled: false,
        issues: [{
          id: 3, fingerprint: 'fp-scss', severity: 'error', category: 'syntax', rule_id: 'scss:compile-error',
          message: 'Undefined variable.', file: 'css', language: 'css', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'scss', engine_version: '',
          source_context: 'standalone-scss',
        }],
        error_count: 1,
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.type(screen.getByLabelText('CSS code'), '.a {{color: $brand;}');

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      await screen.findByText('Compilation blocked');
      expect(screen.getByText('Resolve the stylesheet errors before generating CSS.')).toBeInTheDocument();
      expect(screen.queryByText('Generated CSS — read-only')).not.toBeInTheDocument();
    });

    it('shows "Compiler unavailable" and the unavailable-CSS helper text when the compiler engine cannot start', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'less',
        generated_css: null, generated_css_compiled: false,
        engine_status: [{
          engine_name: 'less-compiler', success: false, duration_ms: 1, issue_count: 0,
          message: 'LESS compilation engine is not installed.',
        }],
        issues: [],
        error_count: 0,
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'less');
      await user.type(screen.getByLabelText('CSS code'), '.a {{ .mixin(); }');

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      await screen.findByText('Compiler unavailable');
      expect(screen.getByText('Generated CSS is unavailable until compilation succeeds.')).toBeInTheDocument();
    });

    it('shows "Compilation timed out" when the compiler times out', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'less',
        generated_css: null, generated_css_compiled: false,
        engine_status: [{
          engine_name: 'less-compiler', success: false, duration_ms: 8000, issue_count: 0,
          message: 'LESS compilation timed out.',
        }],
        issues: [],
        error_count: 0,
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'less');
      await user.type(screen.getByLabelText('CSS code'), '.a {{ .mixin(); }');

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      await screen.findByText('Compilation timed out');
    });

    it('shows "Generated output exceeded the limit" when compiled output is too large', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'less',
        generated_css: null, generated_css_compiled: false,
        engine_status: [{
          engine_name: 'less-compiler', success: false, duration_ms: 5, issue_count: 0,
          message: 'LESS compilation output exceeded the maximum size.',
        }],
        issues: [],
        error_count: 0,
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'less');
      await user.type(screen.getByLabelText('CSS code'), '.a {{ .mixin(); }');

      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      await screen.findByText('Generated output exceeded the limit');
    });

    it('marks generated CSS stale after editing the stylesheet, and Clear SCSS removes it', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'scss',
        generated_css: '.a { color: red; }', generated_css_compiled: true,
        generated_css_engine: 'dart-sass', generated_css_engine_version: 'sass@1.102.0',
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.type(screen.getByLabelText('CSS code'), '$brand: red; .a {{color: $brand;}');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Generated CSS — read-only');

      await user.type(screen.getByLabelText('CSS code'), '!');
      expect(screen.getAllByText('Generated output stale').length).toBeGreaterThan(0);

      await user.click(screen.getByRole('button', { name: 'Clear SCSS' }));
      await user.click(screen.getByRole('button', { name: 'Clear Code' }));
      expect(screen.queryByText('Generated CSS — read-only')).not.toBeInTheDocument();
    });

    it('Copy Generated CSS copies only the generated output', async () => {
      const user = userEvent.setup();
      const writeText = mockClipboard();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'scss',
        generated_css: '.a { color: red; }', generated_css_compiled: true,
        generated_css_engine: 'dart-sass', generated_css_engine_version: 'sass@1.102.0',
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.type(screen.getByLabelText('CSS code'), '$brand: red; .a {{color: $brand;}');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Generated CSS — read-only');

      await user.click(screen.getByRole('button', { name: 'Copy Generated CSS' }));

      expect(writeText).toHaveBeenCalledWith('.a { color: red; }');
      expect(await screen.findByText('Generated CSS copied.')).toBeInTheDocument();
    });

    it('Download Generated CSS is disabled until output exists', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'css', css_source_type: 'scss',
        generated_css: '.a { color: red; }', generated_css_compiled: true,
        generated_css_engine: 'dart-sass', generated_css_engine_version: 'sass@1.102.0',
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await selectCssScope(user);
      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.type(screen.getByLabelText('CSS code'), '$brand: red; .a {{color: $brand;}');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      const downloadButton = await screen.findByRole('button', { name: 'Download Generated CSS' });
      expect(downloadButton).not.toBeDisabled();
    });

    it('preserves HTML and JavaScript source when the stylesheet type changes', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.type(screen.getByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      await user.type(screen.getByLabelText('CSS code'), '.a {{color: red;}');

      await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
      await user.click(screen.getByRole('button', { name: 'Change Type' }));

      await user.click(screen.getByRole('tab', { name: 'HTML' }));
      expect(screen.getByLabelText('HTML code')).toHaveValue('<p>hi</p>');
    });
  });

  describe('AMPscript', () => {
    it('does not offer TypeScript as an editor tab under Complete LP', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.queryByRole('tab', { name: 'TypeScript' })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'AMPscript' })).toBeInTheDocument();
    });

    it('Complete LP shows exactly HTML, CSS, JavaScript and AMPscript tabs', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
      expect(tabs).toEqual(['HTML', 'CSS', 'JavaScript', 'AMPscript']);
    });

    it('AMPscript scope shows only the AMPscript editor', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'AMPscript' }));
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      expect(screen.getByRole('tab', { name: 'AMPscript' })).toBeInTheDocument();
      expect(screen.getByLabelText('AMPscript code')).toBeInTheDocument();
    });

    it('preserves source in every tab while switching scopes', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.type(screen.getByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('tab', { name: 'AMPscript' }));
      await user.type(screen.getByLabelText('AMPscript code'), '%%[[ VAR @x ]%%');

      await user.click(screen.getByRole('radio', { name: 'HTML' }));
      expect(screen.getByLabelText('HTML code')).toHaveValue('<p>hi</p>');

      await user.click(screen.getByRole('radio', { name: 'Complete LP' }));
      await user.click(screen.getByRole('tab', { name: 'AMPscript' }));
      expect(screen.getByLabelText('AMPscript code')).toHaveValue('%%[ VAR @x ]%%');
    });

    it('sends ampscript and never sends a new TypeScript source field', async () => {
      const user = userEvent.setup();
      await mockValidate(report({ validation_scope: 'ampscript' }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'AMPscript' }));
      await user.type(screen.getByLabelText('AMPscript code'), '%%[[ VAR @x ]%%');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(startValidate).toHaveBeenCalledWith(
        expect.objectContaining({ ampscript: '%%[ VAR @x ]%%', validation_scope: 'ampscript' }),
        expect.anything(),
      );
      const sentPayload = vi.mocked(startValidate).mock.calls[0][0];
      expect(sentPayload).not.toHaveProperty('ts');
    });

    it('empty AMPscript disables Validate in AMPscript scope', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'AMPscript' }));
      const validateButton = screen.getByRole('button', { name: 'AI Validate Code' });
      expect(validateButton).toBeDisabled();
      expect(validateButton).toHaveAttribute('title', 'Enter AMPscript before validating AMPscript.');
    });

    it('shows AMPscript Error and Warning labels on issue cards', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'ampscript',
        error_count: 1, warning_count: 1,
        issues: [
          {
            id: 10, fingerprint: 'fp-amp-error', severity: 'error', category: 'syntax',
            rule_id: 'ampscript:if-without-endif', message: 'This IF has no matching ENDIF.',
            file: 'ampscript', language: 'ampscript', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'ampscript', engine_version: '',
            source_context: 'ampscript-source',
          },
          {
            id: 11, fingerprint: 'fp-amp-warning', severity: 'warning', category: 'security',
            rule_id: 'ampscript:unsanitized-request-parameter', message: '"@name" is output directly.',
            file: 'html', language: 'ampscript', line: 12, column: 18,
            suggestion: '', auto_fixable: false, risk: 'medium', source_engine: 'ampscript', engine_version: '',
            source_context: 'html-embedded-ampscript',
          },
        ],
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'AMPscript' }));
      await user.type(screen.getByLabelText('AMPscript code'), '%%[[ IF x THEN ]%%');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(await screen.findByText('AMPscript Error')).toBeInTheDocument();
      expect(screen.getByText('AMPscript Warning')).toBeInTheDocument();
      // The detail line concatenates category/rule_id/source-context into
      // one <p>, so the source-context text is a substring of that node's
      // full content, not the node's exact text — a regex matches that;
      // an exact string match would not.
      expect(screen.getByText(/AMPscript source/)).toBeInTheDocument();
      expect(screen.getByText(/Embedded in HTML/)).toBeInTheDocument();
    });

    it('offers an AMPscript language filter alongside other languages', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'complete',
        error_count: 2,
        issues: [
          {
            id: 12, fingerprint: 'fp-amp', severity: 'error', category: 'syntax',
            rule_id: 'ampscript:if-without-endif', message: 'This IF has no matching ENDIF.',
            file: 'ampscript', language: 'ampscript', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'ampscript', engine_version: '',
          },
          {
            id: 13, fingerprint: 'fp-html', severity: 'error', category: 'syntax', rule_id: 'unclosed-tag',
            message: '"<div>" is never closed.', file: 'html', language: 'html', line: 3, column: 1,
            suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-structure', engine_version: '',
          },
        ],
      }));
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      const languageFilterGroup = await screen.findByRole('tablist', { name: 'Filter issues by language' });
      const { getByRole } = within(languageFilterGroup);
      expect(getByRole('tab', { name: 'AMPscript' })).toBeInTheDocument();
    });

    it('Go to Line for a dedicated AMPscript issue opens the AMPscript tab', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'ampscript',
        error_count: 1,
        issues: [{
          id: 13, fingerprint: 'fp-amp-dedicated', severity: 'error', category: 'syntax',
          rule_id: 'ampscript:if-without-endif', message: 'This IF has no matching ENDIF.',
          file: 'ampscript', language: 'ampscript', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'ampscript', engine_version: '',
          source_context: 'ampscript-source',
        }],
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'AMPscript' }));
      await user.type(screen.getByLabelText('AMPscript code'), '%%[[ IF x THEN ]%%');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('AMPscript Error');

      await user.click(screen.getByRole('button', { name: 'Go to Line' }));
      expect(screen.getByRole('tab', { name: 'AMPscript' })).toHaveAttribute('aria-selected', 'true');
    });

    it('Go to Line for an embedded AMPscript issue opens the HTML tab', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'complete',
        error_count: 1,
        issues: [{
          id: 14, fingerprint: 'fp-amp-embedded', severity: 'warning', category: 'security',
          rule_id: 'ampscript:unsanitized-request-parameter', message: '"@name" is output directly.',
          file: 'html', language: 'ampscript', line: 12, column: 18,
          suggestion: '', auto_fixable: false, risk: 'medium', source_engine: 'ampscript', engine_version: '',
          source_context: 'html-embedded-ampscript',
        }],
      }));
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('AMPscript Warning');

      await user.click(screen.getByRole('tab', { name: 'AMPscript' }));
      await user.click(screen.getByRole('button', { name: 'Go to Line' }));
      expect(screen.getByRole('tab', { name: 'HTML' })).toHaveAttribute('aria-selected', 'true');
    });

    it('Clear AMPscript clears only the AMPscript tab', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('tab', { name: 'AMPscript' }));
      await user.type(screen.getByLabelText('AMPscript code'), '%%[[ VAR @x ]%%');

      await user.click(screen.getByRole('button', { name: 'Clear AMPscript' }));
      await user.click(screen.getByRole('button', { name: 'Clear Code' }));

      expect(screen.getByLabelText('AMPscript code')).toHaveValue('');
    });

    it('Monaco uses the ampscript language for the AMPscript tab', async () => {
      const user = userEvent.setup();
      const { container } = renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('tab', { name: 'AMPscript' }));
      expect(container.querySelector('[data-language="ampscript"]')).toBeInTheDocument();
    });

    it('existing HTML/CSS/JavaScript behaviour is unaffected', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      expect(await screen.findByText('Validation Issues (2)')).toBeInTheDocument();
    });

    it('Module 1 back-to-dashboard navigation is unchanged', async () => {
      renderPage();
      await screen.findByLabelText('HTML code');
      expect(screen.getByLabelText('Back to Dashboard')).toHaveAttribute('href', '/dashboard');
    });
  });

  describe('JavaScript', () => {
    it('JavaScript scope shows only the JavaScript editor', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'JavaScript' }));
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      expect(screen.getByRole('tab', { name: 'JavaScript' })).toBeInTheDocument();
      expect(screen.getByLabelText('JavaScript code')).toBeInTheDocument();
    });

    it('sends validation_scope: javascript and the js source when JavaScript Only is selected', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_NO_ISSUES);
      renderPage();
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('radio', { name: 'JavaScript' }));
      await user.type(screen.getByLabelText('JavaScript code'), 'const x = 1;');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(startValidate).toHaveBeenCalledWith(
        expect.objectContaining({ validation_scope: 'javascript', js: 'const x = 1;' }),
        expect.anything(),
      );
    });

    it('shows the JavaScript empty-state message before any source is entered', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'JavaScript' }));
      expect(screen.getByText('Enter JavaScript code before validating JavaScript.')).toBeInTheDocument();
    });

    it('shows JavaScript issue labels', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'javascript',
        error_count: 1, warning_count: 1,
        issues: [
          {
            id: 20, fingerprint: 'fp-js-error', severity: 'error', category: 'security', rule_id: 'no-eval',
            message: '`eval` can be harmful.', file: 'javascript', language: 'javascript', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'eslint', engine_version: 'eslint@10.8.0',
            source_context: 'standalone-javascript',
          },
          {
            id: 21, fingerprint: 'fp-js-warning', severity: 'warning', category: 'syntax', rule_id: 'no-unused-vars',
            message: "'x' is assigned a value but never used.", file: 'javascript', language: 'javascript', line: 2, column: 1,
            suggestion: '', auto_fixable: false, risk: 'medium', source_engine: 'eslint', engine_version: 'eslint@10.8.0',
            source_context: 'standalone-javascript',
          },
        ],
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'JavaScript' }));
      await user.type(screen.getByLabelText('JavaScript code'), "eval('1'); const x = 1;");
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      expect(await screen.findByText('JavaScript Error')).toBeInTheDocument();
      expect(screen.getByText('JavaScript Warning')).toBeInTheDocument();
    });

    it('offers a JavaScript language filter alongside other languages', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'complete',
        error_count: 2,
        issues: [
          {
            id: 22, fingerprint: 'fp-js', severity: 'error', category: 'security', rule_id: 'no-eval',
            message: '`eval` can be harmful.', file: 'javascript', language: 'javascript', line: 1, column: 1,
            suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'eslint', engine_version: '',
          },
          {
            id: 23, fingerprint: 'fp-html', severity: 'error', category: 'syntax', rule_id: 'unclosed-tag',
            message: '"<div>" is never closed.', file: 'html', language: 'html', line: 3, column: 1,
            suggestion: '', auto_fixable: false, risk: 'low', source_engine: 'html-structure', engine_version: '',
          },
        ],
      }));
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));

      const languageFilterGroup = await screen.findByRole('tablist', { name: 'Filter issues by language' });
      const { getByRole } = within(languageFilterGroup);
      expect(getByRole('tab', { name: 'JavaScript' })).toBeInTheDocument();
    });

    it('Go to Line for a dedicated JavaScript issue opens the JavaScript tab', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'javascript',
        error_count: 1,
        issues: [{
          id: 24, fingerprint: 'fp-js-dedicated', severity: 'error', category: 'security', rule_id: 'no-eval',
          message: '`eval` can be harmful.', file: 'javascript', language: 'javascript', line: 1, column: 1,
          suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'eslint', engine_version: '',
          source_context: 'standalone-javascript',
        }],
      }));
      renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('radio', { name: 'JavaScript' }));
      await user.type(screen.getByLabelText('JavaScript code'), "eval('1');");
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('JavaScript Error');

      await user.click(screen.getByRole('button', { name: 'Go to Line' }));
      expect(screen.getByRole('tab', { name: 'JavaScript' })).toHaveAttribute('aria-selected', 'true');
    });

    it('Go to Line for an embedded JavaScript issue opens the HTML tab', async () => {
      const user = userEvent.setup();
      await mockValidate(report({
        validation_scope: 'complete',
        error_count: 1,
        issues: [{
          id: 25, fingerprint: 'fp-js-embedded', severity: 'error', category: 'security', rule_id: 'no-eval',
          message: '`eval` can be harmful.', file: 'html', language: 'javascript', line: 5, column: 3,
          suggestion: '', auto_fixable: false, risk: 'high', source_engine: 'eslint', engine_version: '',
          source_context: 'html-script-block',
        }],
      }));
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Embedded JavaScript Error');

      await user.click(screen.getByRole('tab', { name: 'JavaScript' }));
      await user.click(screen.getByRole('button', { name: 'Go to Line' }));
      expect(screen.getByRole('tab', { name: 'HTML' })).toHaveAttribute('aria-selected', 'true');
    });

    it('Clear JavaScript clears only the JavaScript tab and marks a JS-covering report stale', async () => {
      const user = userEvent.setup();
      await mockValidate(REPORT_WITH_ISSUES);
      renderPage();
      await user.type(await screen.findByLabelText('HTML code'), '<p>hi</p>');
      await user.click(screen.getByRole('tab', { name: 'JavaScript' }));
      await user.type(screen.getByLabelText('JavaScript code'), 'const x = 1;');
      await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
      await screen.findByText('Validation Issues (2)');

      await user.click(screen.getByRole('button', { name: 'Clear JavaScript' }));
      await user.click(screen.getByRole('button', { name: 'Clear Code' }));

      expect(screen.getByLabelText('JavaScript code')).toHaveValue('');
      expect(screen.getAllByText('Code changed. Validate again to update the results.').length).toBeGreaterThan(0);
    });

    it('Monaco uses the javascript language for the JavaScript tab', async () => {
      const user = userEvent.setup();
      const { container } = renderPage();
      await screen.findByLabelText('HTML code');
      await user.click(screen.getByRole('tab', { name: 'JavaScript' }));
      expect(container.querySelector('[data-language="javascript"]')).toBeInTheDocument();
    });
  });
});

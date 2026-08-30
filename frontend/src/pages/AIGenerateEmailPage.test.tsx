import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIGenerateEmailPage, BRIEF_MAX_LENGTH, COMPOSE_INTENT_PREFIX } from './AIGenerateEmailPage';
import * as client from '../api/client';
import { buildComposedModule } from '../emailbuilder/moduleFactory';
import { renderEmailDocument } from '../emailbuilder/htmlRenderer';
import { buildExportSummary, buildHandoffManifest, extractImageAssetUrls } from '../emailbuilder/exportDeploy';
import type { AICommandResponse } from '../emailbuilder/aiCommand';
import type { EmailDocument } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    requestAICommand: vi.fn(),
    createEmailDocument: vi.fn(),
    updateEmailDocument: vi.fn(),
    deleteEmailDocument: vi.fn(),
  };
});

afterEach(() => {
  vi.resetAllMocks();
});

function BuilderProbe() {
  const { id } = useParams<{ id: string }>();
  return <div>Builder for {id}</div>;
}

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 42, name: 'Generated', platform: 'generic', width: 700, start_type: 'ai', status: 'draft',
    content: { version: 1, modules: [] }, email_title: '', email_subject: '', favicon_url: '',
    reset_css_enabled: true, custom_css_enabled: false, custom_css: '', outlook_vml_enabled: false,
    created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function composeResponse(overrides: Partial<AICommandResponse> = {}): AICommandResponse {
  return {
    success: true,
    reply: 'Here is a starting point.',
    action: {
      type: 'COMPOSE_EMAIL',
      items: [
        { module_type: 'header-logo-center', patch: {} },
        { module_type: 'hero-image-cta', patch: { headline: 'Summer Sale' } },
        { module_type: 'cta-centered', patch: {} },
      ],
    },
    requires_confirmation: true,
    requires_strong_confirmation: false,
    confidence: 0.8,
    provider: 'deterministic',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/ai-generate']}>
      <Routes>
        <Route path="/email-builder/ai-generate" element={<AIGenerateEmailPage />} />
        <Route path="/email-builder" element={<div>Email Dashboard</div>} />
        <Route path="/email-builder/builder/:id" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function typeBrief(text: string) {
  const textarea = screen.getByLabelText('What should this email be?');
  fireEvent.change(textarea, { target: { value: text } });
}

describe('AIGenerateEmailPage — entry and brief validation', () => {
  it('does not call createEmailDocument merely by loading the page', () => {
    renderPage();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
    expect(client.requestAICommand).not.toHaveBeenCalled();
  });

  it('rejects an empty brief without calling requestAICommand', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    expect(client.requestAICommand).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only brief', async () => {
    renderPage();
    await typeBrief('   ');
    // The submit button itself stays disabled for whitespace-only input
    // (mirrors CreateEmailPage/ImportHtmlPage's own `!value.trim()` gate).
    expect(screen.getByRole('button', { name: 'Generate →' })).toBeDisabled();
    expect(client.requestAICommand).not.toHaveBeenCalled();
  });

  it('rejects a brief exceeding the allowed length, surfaced as a client-side error', async () => {
    const user = userEvent.setup();
    renderPage();
    const textarea = screen.getByLabelText('What should this email be?') as HTMLTextAreaElement;
    // maxLength on the textarea itself caps typed/pasted length in a real
    // browser; fireEvent.change bypasses that here to exercise the
    // component's own length guard directly.
    fireEvent.change(textarea, { target: { value: 'x'.repeat(BRIEF_MAX_LENGTH + 1) } });
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    expect(await screen.findByText(new RegExp(`${BRIEF_MAX_LENGTH} characters or fewer`))).toBeInTheDocument();
    expect(client.requestAICommand).not.toHaveBeenCalled();
  });
});

describe('AIGenerateEmailPage — generation and provider disclosure', () => {
  it('deterministic fallback (no external AI provider configured) works and is disclosed honestly', async () => {
    vi.mocked(client.requestAICommand).mockResolvedValue(composeResponse({ provider: 'deterministic' }));
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));

    expect(await screen.findByText(/Built-in template fallback/)).toBeInTheDocument();
    expect(screen.queryByText('Generated with AI')).not.toBeInTheDocument();
    expect(screen.getByText(/3 modules generated/)).toBeInTheDocument();
  });

  it('a real configured AI provider response uses the same response contract and is disclosed as AI-generated', async () => {
    vi.mocked(client.requestAICommand).mockResolvedValue(composeResponse({ provider: 'openai' }));
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));

    expect(await screen.findByText('Generated with AI')).toBeInTheDocument();
    expect(screen.queryByText(/Built-in template fallback/)).not.toBeInTheDocument();
  });

  it('composition renders through the EXISTING renderer as a live preview iframe', async () => {
    vi.mocked(client.requestAICommand).mockResolvedValue(composeResponse());
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));

    const iframe = await screen.findByTitle('Generated email preview');
    expect(iframe).toHaveAttribute('sandbox', '');
    expect((iframe as HTMLIFrameElement).srcdoc).toContain('<!doctype html>');
  });

  it('a non-COMPOSE_EMAIL / empty-items response surfaces a clean error, not a crash', async () => {
    vi.mocked(client.requestAICommand).mockResolvedValue(composeResponse({ action: { type: 'NONE' } }));
    const user = userEvent.setup();
    renderPage();
    await typeBrief('asdf');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    expect(await screen.findByText(/couldn.t generate an email/i)).toBeInTheDocument();
  });

  it('a request failure surfaces an inline error and preserves the typed brief', async () => {
    vi.mocked(client.requestAICommand).mockRejectedValue({ message: 'AI provider timed out.' });
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    expect(await screen.findByText('AI provider timed out.')).toBeInTheDocument();
    expect(screen.getByLabelText('What should this email be?')).toHaveValue('A promotional summer sale email');
  });
});

describe('AIGenerateEmailPage — Regenerate, races, double-submit', () => {
  it('Regenerate uses the latest (edited) brief, not the original', async () => {
    vi.mocked(client.requestAICommand).mockResolvedValue(composeResponse());
    const user = userEvent.setup();
    renderPage();
    await typeBrief('First brief');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    await screen.findByText(/modules generated/);

    await typeBrief('Second, edited brief');
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    await waitFor(() => expect(client.requestAICommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: `${COMPOSE_INTENT_PREFIX}Second, edited brief` }),
    ));
  });

  it('a newer composition always replaces an older one cleanly — no leftover/stale state survives a regenerate', async () => {
    // Genuine concurrent-request overlap is structurally impossible
    // through this UI (the Generate/Regenerate button is disabled for the
    // whole lifetime of an in-flight request — see the double-click test
    // below), so the requestSeqRef staleness guard is defense-in-depth
    // rather than something reachable via realistic user interaction
    // here. This proves the observable guarantee that matters: after any
    // successful (re)generate, the displayed composition is always
    // exactly the latest response — never a mix of old and new.
    vi.mocked(client.requestAICommand)
      .mockResolvedValueOnce(composeResponse({
        action: { type: 'COMPOSE_EMAIL', items: [{ module_type: 'text', patch: { text: 'First composition' } }] },
      }))
      .mockResolvedValueOnce(composeResponse({
        action: { type: 'COMPOSE_EMAIL', items: [
          { module_type: 'text', patch: { text: 'Second composition' } },
          { module_type: 'button', patch: {} },
        ] },
      }));

    const user = userEvent.setup();
    renderPage();
    await typeBrief('First brief');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    await screen.findByText('1 module generated: text');

    await typeBrief('Second brief');
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    await screen.findByText('2 modules generated: text, button');
    expect(screen.queryByText('1 module generated: text')).not.toBeInTheDocument();
  });

  it('double-clicking Generate cannot fire two effective requests', async () => {
    let resolveRequest: (value: AICommandResponse) => void = () => {};
    vi.mocked(client.requestAICommand).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    const button = screen.getByRole('button', { name: 'Generate →' });
    await user.click(button);
    // The button is disabled the instant a request starts — a second
    // click while disabled cannot dispatch a second request.
    expect(button).toBeDisabled();
    fireEvent.click(button);
    resolveRequest(composeResponse());
    await screen.findByText(/modules generated/);
    expect(client.requestAICommand).toHaveBeenCalledTimes(1);
  });

  it('navigating away while a generate request is in flight does not act on the stale response after it resolves', async () => {
    let resolveRequest: (value: AICommandResponse) => void = () => {};
    vi.mocked(client.requestAICommand).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));

    // Leave the page while the request is still pending — this unmounts
    // AIGenerateEmailPage. (Cancel itself is disabled while generating,
    // matching every other in-flight-submit lock on this page, so use
    // the always-available header link instead.)
    await user.click(screen.getByRole('link', { name: 'Back to Email Dashboard' }));
    expect(await screen.findByText('Email Dashboard')).toBeInTheDocument();

    // The stale request resolves only AFTER navigation. It must not
    // throw, and must not resurrect the AI Generate page or navigate
    // anywhere on its own.
    expect(() => resolveRequest(composeResponse())).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('Email Dashboard')).toBeInTheDocument();
    expect(screen.queryByText(/modules generated/)).not.toBeInTheDocument();
  });

  it('retrying after a provider/network error behaves normally — same brief, one clean new request', async () => {
    vi.mocked(client.requestAICommand)
      .mockRejectedValueOnce(new Error('AI provider timed out.'))
      .mockResolvedValueOnce(composeResponse());
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    await screen.findByText('AI provider timed out.');

    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    await screen.findByText(/modules generated/);
    expect(client.requestAICommand).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('AI provider timed out.')).not.toBeInTheDocument();
  });
});

describe('AIGenerateEmailPage — naming, creation, rollback', () => {
  async function generateThenReachNameStep(user: ReturnType<typeof userEvent.setup>) {
    vi.mocked(client.requestAICommand).mockResolvedValue(composeResponse());
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    await screen.findByText(/modules generated/);
  }

  it('creates the document exactly once via create+PATCH and navigates to the builder', async () => {
    const user = userEvent.setup();
    renderPage();
    await generateThenReachNameStep(user);

    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 77 }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 77 }));

    fireEvent.change(screen.getByLabelText(/Email Name/), { target: { value: 'Summer Sale Announcement' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledTimes(1));
    expect(client.createEmailDocument).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Summer Sale Announcement', start_type: 'ai',
    }));
    expect(client.updateEmailDocument).toHaveBeenCalledWith(77, expect.objectContaining({
      content: expect.objectContaining({ modules: expect.any(Array) }),
    }));
    expect(await screen.findByText('Builder for 77')).toBeInTheDocument();
  });

  it('double-clicking Create cannot create two documents', async () => {
    let resolveCreate: (value: EmailDocument) => void = () => {};
    vi.mocked(client.createEmailDocument).mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 77 }));
    const user = userEvent.setup();
    renderPage();
    await generateThenReachNameStep(user);

    fireEvent.change(screen.getByLabelText(/Email Name/), { target: { value: 'Summer Sale' } });
    const createButton = screen.getByRole('button', { name: 'Create Email →' });
    await user.click(createButton);
    expect(createButton).toBeDisabled();
    fireEvent.click(createButton);
    resolveCreate(doc({ id: 77 }));
    await screen.findByText('Builder for 77');
    expect(client.createEmailDocument).toHaveBeenCalledTimes(1);
  });

  it('a duplicate-name failure preserves the brief, the composition, and the preview — does not re-compose', async () => {
    vi.mocked(client.createEmailDocument).mockRejectedValue({
      message: 'Please correct the highlighted fields.',
      errors: { name: ['An email with this name already exists. Choose a different name.'] },
    });
    const user = userEvent.setup();
    renderPage();
    await generateThenReachNameStep(user);
    expect(client.requestAICommand).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/Email Name/), { target: { value: 'Existing Name' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    expect(await screen.findByText('An email with this name already exists. Choose a different name.')).toBeInTheDocument();
    // Composition/preview survive the failed Create.
    expect(screen.getByText(/modules generated/)).toBeInTheDocument();
    expect(screen.getByTitle('Generated email preview')).toBeInTheDocument();
    expect(screen.getByLabelText('What should this email be?')).toHaveValue('A promotional summer sale email');
    // Retrying does not re-run composition.
    expect(client.requestAICommand).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('a PATCH failure after create rolls back (deletes) the newly created document — no orphan', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 99 }));
    vi.mocked(client.updateEmailDocument).mockRejectedValue(new Error('patch failed'));
    vi.mocked(client.deleteEmailDocument).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await generateThenReachNameStep(user);

    fireEvent.change(screen.getByLabelText(/Email Name/), { target: { value: 'Summer Sale' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.deleteEmailDocument).toHaveBeenCalledWith(99));
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('a failed compose request creates no document at all', async () => {
    vi.mocked(client.requestAICommand).mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    renderPage();
    await typeBrief('A promotional summer sale email');
    await user.click(screen.getByRole('button', { name: 'Generate →' }));
    await screen.findByText('network error');
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });
});

describe('AIGenerateEmailPage — Export path on the generated document', () => {
  // Phase D reconciliation, item 4 — the strongest verification available
  // in this test environment (an actual browser file-download cannot be
  // triggered/observed here — see the Live Chrome re-check for the UI
  // level): exercises the EXACT existing export handlers
  // (buildExportSummary / buildHandoffManifest / extractImageAssetUrls,
  // from exportDeploy.ts — the same functions ExportDeployDialog.tsx
  // calls) directly on an AI-composed document, using the identical
  // item -> module construction path AIGenerateEmailPage itself uses
  // (buildComposedModule), proving the export path produces a valid,
  // non-empty artifact for AI-generated content — not a new/second
  // export implementation.
  it('the export handlers produce a valid, non-empty artifact for an AI-composed document', () => {
    const response = composeResponse();
    const items = response.action.type === 'COMPOSE_EMAIL' ? response.action.items : [];
    const modules = items.map((item, index) => buildComposedModule({ type: item.module_type, patch: item.patch }, index));
    const content = { version: 1 as const, modules };
    const html = renderEmailDocument({ width: 700, content });

    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!doctype html>');

    const summary = buildExportSummary(html, content, 'generic', 'Summer Sale Announcement', 700);
    expect(summary.emailName).toBe('Summer Sale Announcement');
    expect(summary.platform).toBe('generic');
    expect(summary.width).toBe(700);
    expect(typeof summary.score).toBe('number');

    const manifest = buildHandoffManifest(summary, extractImageAssetUrls(html), '2026-08-25T00:00:00.000Z');
    expect(manifest.length).toBeGreaterThan(0);
    const parsed = JSON.parse(manifest);
    expect(parsed.emailName).toBe('Summer Sale Announcement');
    expect(parsed.validation.score).toBe(summary.score);
  });
});

describe('AIGenerateEmailPage — cancel/navigation', () => {
  it('Cancel returns to the dashboard without generating or creating anything', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Email Dashboard')).toBeInTheDocument();
    expect(client.requestAICommand).not.toHaveBeenCalled();
  });

  it('Back to Email Dashboard link returns to the dashboard', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: 'Back to Email Dashboard' }));
    expect(await screen.findByText('Email Dashboard')).toBeInTheDocument();
  });
});

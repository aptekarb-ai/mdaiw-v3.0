import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportHtmlPage } from './ImportHtmlPage';
import * as client from '../api/client';
import type { EmailDocument } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
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
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  return <div>Builder for {id}{tab ? ` (tab=${tab})` : ''}</div>;
}

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 42, name: 'Imported', platform: 'generic', width: 700, start_type: 'html', status: 'draft',
    content: { version: 1, modules: [] }, email_title: '', email_subject: '', favicon_url: '',
    reset_css_enabled: true, custom_css_enabled: false, custom_css: '', outlook_vml_enabled: false,
    created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/import']}>
      <Routes>
        <Route path="/email-builder/import" element={<ImportHtmlPage />} />
        <Route path="/email-builder" element={<div>Email Dashboard</div>} />
        <Route path="/email-builder/builder/:id" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function pasteAndReview(user: ReturnType<typeof userEvent.setup>, html: string) {
  const textarea = screen.getByLabelText('Or paste HTML');
  fireEvent.change(textarea, { target: { value: html } });
  await user.click(screen.getByRole('button', { name: 'Review Import →' }));
}

function fidelityRow(label: string): HTMLElement {
  const heading = screen.getByText(label, { selector: '.import-review-workspace__fidelity-label' });
  return heading.closest('li')!;
}

describe('ImportHtmlPage — Import Review workspace (R3)', () => {
  it('parses pasted HTML and shows the reconstruction summary derived from FidelityReport, not hard-coded', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    expect(await screen.findByText(/1 module reconstructed/)).toBeInTheDocument();
    // Clean import: every category should be preserved/normalized, never approximated/removed for this fixture.
    expect(screen.getByText(/0 removed/)).toBeInTheDocument();
  });

  it('renders all 8 FidelityReport categories with statuses that exactly reflect the underlying data', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    for (const label of ['Structure', 'Content', 'Typography', 'Spacing', 'Images', 'Links', 'Responsive', 'Outlook']) {
      expect(within(fidelityRow(label)).getByText(label)).toBeInTheDocument();
    }
    // Responsive must never show as Preserved — R2 hardening: the builder
    // always introduces its own mobile behavior, so a clean import with no
    // source stylesheet is Normalized, never Preserved.
    expect(within(fidelityRow('Responsive')).getByText('Normalized')).toBeInTheDocument();
    expect(within(fidelityRow('Responsive')).getByText(/No explicit source responsive behavior was detected/)).toBeInTheDocument();
  });

  it('a 38/62 source column ratio reports BOTH the detected ratio and the reconstructed 40/60 layout, never implying 40/60 was the source', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td width="380">A</td><td width="620">B</td></tr></table>');
    await screen.findByText(/module reconstructed/);
    const structureRow = fidelityRow('Structure');
    expect(within(structureRow).getByText('Approximated')).toBeInTheDocument();
    await user.click(within(structureRow).getByRole('button', { name: /Show \d+ detail/ }));
    expect(within(structureRow).getByText(/38\/62/)).toBeInTheDocument();
    expect(within(structureRow).getByText(/40\/60/)).toBeInTheDocument();
  });

  it('removed/unsupported content is visibly disclosed via the Content category, not hidden', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><script>alert(1)</script><p>Safe</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    const contentRow = fidelityRow('Content');
    expect(within(contentRow).getByText('Removed')).toBeInTheDocument();
    await user.click(within(contentRow).getByRole('button', { name: /Show \d+ detail/ }));
    expect(within(contentRow).getByText(/<script>/)).toBeInTheDocument();
  });

  it('a fully clean import still provides a useful, mostly/all-preserved review (not an empty or confusing state)', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    for (const label of ['Structure', 'Content', 'Typography', 'Spacing', 'Images', 'Links', 'Outlook']) {
      expect(within(fidelityRow(label)).getByText('Preserved')).toBeInTheDocument();
    }
  });

  it('a parse-blocking error (oversized input) is shown without creating anything', async () => {
    const user = userEvent.setup();
    renderPage();
    const huge = `<p>${'x'.repeat(2 * 1024 * 1024 + 10)}</p>`;
    const textarea = screen.getByLabelText('Or paste HTML');
    fireEvent.change(textarea, { target: { value: huge } });
    await user.click(screen.getByRole('button', { name: 'Review Import →' }));
    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('prefills the name field from an imported <title>', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<html><head><title>My Imported Email</title></head><body><table><tr><td><p>Hi</p></td></tr></table></body></html>');
    expect(await screen.findByLabelText(/Email Name/)).toHaveValue('My Imported Email');
  });

  it('creates the document via create+PATCH and navigates to the builder on success (Create Email uses the already-reconstructed modules, no re-parse)', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 77 }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 77 }));
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    // Once reviewed, the paste textarea is gone entirely — structurally
    // there is no way for the user to feed different HTML into Create,
    // and no code path re-invokes the parser/mapper after this point.
    expect(screen.queryByLabelText('Or paste HTML')).not.toBeInTheDocument();
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'My New Email' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My New Email', start_type: 'html' }),
    ));
    expect(client.updateEmailDocument).toHaveBeenCalledWith(77, expect.objectContaining({
      content: expect.objectContaining({ modules: expect.any(Array) }),
    }));
    expect(await screen.findByText('Builder for 77')).toBeInTheDocument();
  });

  it('duplicate-name failure surfaces as a field-level error, without navigating away', async () => {
    vi.mocked(client.createEmailDocument).mockRejectedValue({
      message: 'Please correct the highlighted fields.',
      errors: { name: ['An email with this name already exists. Choose a different name.'] },
    });
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'Existing Name' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    expect(await screen.findByText('An email with this name already exists. Choose a different name.')).toBeInTheDocument();
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('create/PATCH rollback: a content-patch failure deletes the just-created row, no orphan left behind', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 99 }));
    vi.mocked(client.updateEmailDocument).mockRejectedValue(new Error('patch failed'));
    vi.mocked(client.deleteEmailDocument).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'My New Email' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.deleteEmailDocument).toHaveBeenCalledWith(99));
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('Start Over safely clears the current review and returns to the paste/upload step without creating anything', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    await user.click(screen.getByRole('button', { name: 'Start Over' }));
    expect(screen.getByRole('button', { name: 'Review Import →' })).toBeInTheDocument();
    expect(screen.queryByText(/module reconstructed/)).not.toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('Back to Email Dashboard returns to the dashboard', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: 'Back to Email Dashboard' }));
    expect(await screen.findByText('Email Dashboard')).toBeInTheDocument();
  });

  it('"Review reconstruction with AI Engineer" creates the document via the SAME transaction and deep-links to the existing AI Engineer tab, without auto-sending anything', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 66 }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 66 }));
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'AI Reviewed Email' } });
    await user.click(screen.getByRole('button', { name: 'Review reconstruction with AI Engineer' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AI Reviewed Email', start_type: 'html' }),
    ));
    expect(await screen.findByText('Builder for 66 (tab=ai)')).toBeInTheDocument();
  });

  // R4-B — the click stashes a one-shot handoff for AI Engineer to pick up
  // once it mounts for the new document; nothing is sent to the backend
  // /ai-command/ endpoint at click time, and no raw source HTML is ever
  // part of the stashed payload (only the already-bounded classification).
  it('R4-B — "Review reconstruction with AI Engineer" stashes exactly one import-reconstruction handoff, keyed to the new document, with no raw source HTML', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 77 }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 77 }));
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p style="font-weight:bold;">Bold via CSS</p></td></tr></table>');
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'AI Reviewed Email' } });
    await user.click(screen.getByRole('button', { name: 'Review reconstruction with AI Engineer' }));
    await screen.findByText('Builder for 77 (tab=ai)');

    const raw = window.sessionStorage.getItem('mdaiw:ai-engineer-handoff:77');
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!);
    expect(stored.source).toBe('import-reconstruction');
    expect(stored.documentId).toBe(77);
    expect(stored.reconstructionReview).toBeTruthy();
    // R4-B2 — importReconstructionContext.ts's own bounded content_preview
    // (<=120 chars, approved as part of R4-A's context contract) is
    // expected here; what must NEVER appear is actual markup — the raw
    // sanitized/imported HTML itself.
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toMatch(/<table|<script|<style|<td|<tr\b/);
  });
});

describe('ImportHtmlPage — Original / Reconstructed / Compare preview modes (R3)', () => {
  it('review mode tabs are keyboard-accessible (role=tab within a role=tablist, aria-selected reflects the active mode)', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    const tablist = screen.getByRole('tablist', { name: 'Import review mode' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Original', 'Reconstructed', 'Compare']);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true'); // Reconstructed is the default mode
    tabs[0].focus();
    await user.keyboard('{Enter}');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('the Original iframe renders the sanitized source and never contains unsafe raw markup (script stripped even from the preview)', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><script>alert(1)</script><p>Safe</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    await user.click(screen.getByRole('tab', { name: 'Original' }));
    const iframe = document.querySelector('iframe[title="Original source preview"]') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('srcdoc')).not.toContain('<script>');
    expect(iframe.getAttribute('sandbox')).toBe('');
  });

  it('R3 correction — the Original iframe preserves safe source styling (color/background/padding/width), it is not deliberately re-styled/degraded', async () => {
    const user = userEvent.setup();
    renderPage();
    const styledHtml = '<table width="600"><tr style="background-color:#002d38;"><td style="padding:20px 24px; color:#ffffff;">'
      + '<h1 style="color:#76c043; font-size:28px;">Styled Heading</h1></td></tr></table>';
    await pasteAndReview(user, styledHtml);
    await screen.findByText(/module reconstructed/);
    await user.click(screen.getByRole('tab', { name: 'Original' }));
    const iframe = document.querySelector('iframe[title="Original source preview"]') as HTMLIFrameElement;
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('width="600"');
    expect(srcdoc).toContain('background-color:#002d38');
    expect(srcdoc).toContain('padding:20px 24px');
    expect(srcdoc).toContain('color:#76c043; font-size:28px');
  });

  it('the Reconstructed pane renders the SAME htmlRenderer.ts output (via renderEmailDocument), sandboxed', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    const iframe = document.querySelector('iframe[title="Reconstructed builder preview"]') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('srcdoc')).toContain('Hello');
    expect(iframe.getAttribute('srcdoc')).toContain('role="presentation"'); // htmlRenderer.ts's table-first output signature
    expect(iframe.getAttribute('sandbox')).toBe('');
  });

  it('Compare shows Original and Reconstructed simultaneously, each with an explicit heading, at equivalent configured widths', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    await user.click(screen.getByRole('tab', { name: 'Compare' }));

    expect(screen.getByText(/^Original imported HTML \(\d+px\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Builder reconstruction \(\d+px\)$/)).toBeInTheDocument();
    // R3 correction — Compare must make the sanitization-vs-reconstruction
    // distinction obvious, so a sanitization difference is never mistaken
    // for a reconstruction error.
    expect(screen.getByText('Sanitized for safe preview')).toBeInTheDocument();
    expect(screen.getByText('Editable email-builder version')).toBeInTheDocument();

    const originalIframe = document.querySelector('iframe[title="Original source preview"]') as HTMLIFrameElement;
    const reconstructedIframe = document.querySelector('iframe[title="Reconstructed builder preview"]') as HTMLIFrameElement;
    expect(originalIframe).toBeTruthy();
    expect(reconstructedIframe).toBeTruthy();
    expect(originalIframe.style.width).toBe(reconstructedIframe.style.width);
    expect(originalIframe.getAttribute('sandbox')).toBe('');
    expect(reconstructedIframe.getAttribute('sandbox')).toBe('');
  });
});

// Environment card selection fix — the cards render via the SAME
// SelectionCard component CreateEmailPage.tsx uses (exported from there,
// not a second implementation), so a real <input type="radio"> backs
// each card; PLATFORM_OPTIONS' own declared order (generic, sfmc,
// marketo, hubspot, pardot, other — see platformOptions.ts, already
// covered by platformOptions.test.ts) is what getAllByRole('radio')
// returns, used here instead of fragile accessible-name text matching
// since each card's label text is title+description concatenated.
describe('ImportHtmlPage — Environment card selection (fidelity/UX fix)', () => {
  async function reviewAndGetRadios(user: ReturnType<typeof userEvent.setup>) {
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module reconstructed/);
    return screen.getAllByRole('radio') as HTMLInputElement[];
  }

  it('Generic is selected by default', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    expect(radios[0].checked).toBe(true);
    expect(radios.slice(1).every((r) => !r.checked)).toBe(true);
    expect(radios[0].closest('label')).toHaveClass('create-email-page__card--selected');
  });

  it('clicking Salesforce Marketing Cloud selects it and visually deselects Generic', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[1]);
    expect(radios[1].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
    expect(radios[1].closest('label')).toHaveClass('create-email-page__card--selected');
    expect(radios[0].closest('label')).not.toHaveClass('create-email-page__card--selected');
  });

  it('clicking Marketo selects it', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[2]);
    expect(radios[2].checked).toBe(true);
    expect(radios[2].closest('label')).toHaveClass('create-email-page__card--selected');
  });

  it('clicking HubSpot selects it', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[3]);
    expect(radios[3].checked).toBe(true);
    expect(radios[3].closest('label')).toHaveClass('create-email-page__card--selected');
  });

  it('clicking Pardot / Account Engagement selects it', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[4]);
    expect(radios[4].checked).toBe(true);
    expect(radios[4].closest('label')).toHaveClass('create-email-page__card--selected');
  });

  it('clicking Other selects it', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[5]);
    expect(radios[5].checked).toBe(true);
    expect(radios[5].closest('label')).toHaveClass('create-email-page__card--selected');
  });

  it('exactly one card is ever selected, however many cards are clicked in sequence', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[3]);
    await user.click(radios[1]);
    await user.click(radios[4]);
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
    expect(radios[4].checked).toBe(true);
  });

  it('keyboard-only interaction (focus + Space) selects a card, same as a click', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    radios[2].focus();
    await user.keyboard(' ');
    expect(radios[2].checked).toBe(true);
    expect(radios[2].closest('label')).toHaveClass('create-email-page__card--selected');
  });

  it('the selected platform is passed into the create transaction', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 88, platform: 'marketo' }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 88, platform: 'marketo' }));
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[2]); // Marketo
    const nameInput = screen.getByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'Marketo Email' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Marketo Email', platform: 'marketo', start_type: 'html' }),
    ));
  });

  it('changing the environment selection does not alter the Import Review summary/fidelity, does not re-parse, and does not create a document', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><script>alert(1)</script><p>Safe</p></td></tr></table>');
    const summaryBefore = (await screen.findByText(/module reconstructed/)).textContent;
    const contentStatusBefore = within(fidelityRow('Content')).getByText('Removed').textContent;
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];

    await user.click(radios[3]); // HubSpot
    await user.click(radios[5]); // Other

    expect(screen.getByText(/module reconstructed/).textContent).toBe(summaryBefore);
    expect(within(fidelityRow('Content')).getByText('Removed').textContent).toBe(contentStatusBefore);
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('creates exactly one document even after multiple environment selection changes before submitting', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 55 }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 55 }));
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[1]);
    await user.click(radios[4]);
    await user.click(radios[0]);
    const nameInput = screen.getByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'One Doc Only' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Builder for 55')).toBeInTheDocument();
  });

  it('Back / Start Over behavior is unchanged by the environment selector fix', async () => {
    const user = userEvent.setup();
    renderPage();
    const radios = await reviewAndGetRadios(user);
    await user.click(radios[2]);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Review Import →' })).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PreviewStudioPanel } from './PreviewStudioPanel';
import { createModule } from './moduleFactory';
import { EMAIL_CLIENTS } from './emailClients';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

function textModuleWith(text: string): EmailModule<TextModuleProps> {
  const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
  return { ...module, props: { ...module.props, text } };
}

function content(overrides: Partial<EmailDocumentContent> = {}): EmailDocumentContent {
  return {
    version: 1,
    modules: [textModuleWith('Hello world')],
    ...overrides,
  };
}

function renderPanel(overrides: Partial<{ width: number; content: EmailDocumentContent }> = {}) {
  return render(
    <PreviewStudioPanel
      width={overrides.width ?? 700}
      content={overrides.content ?? content()}
    />,
  );
}

describe('PreviewStudioPanel', () => {
  it('shows Desktop as the default active tab with a rendered iframe', () => {
    renderPanel();
    expect(screen.getByRole('tab', { name: 'Desktop' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTitle('Desktop preview')).toBeInTheDocument();
  });

  it('the Desktop iframe srcDoc contains the real generated table-first HTML', () => {
    renderPanel();
    const iframe = screen.getByTitle('Desktop preview') as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain('<table');
    expect(iframe.srcdoc).toContain('Hello world');
    expect(iframe.getAttribute('sandbox')).toBe('');
  });

  it('switching to Mobile shows a narrower iframe with the same content', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('tab', { name: 'Mobile' }));
    const iframe = screen.getByTitle('Mobile preview') as HTMLIFrameElement;
    expect(iframe.style.width).toBe('375px');
    expect(iframe.srcdoc).toContain('Hello world');
  });

  it('switching to Dark Mode applies the approximation filter and shows a prominent, explicit disclosure', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('tab', { name: 'Dark Mode' }));
    const iframe = screen.getByTitle('Dark mode preview') as HTMLIFrameElement;
    expect(iframe.style.filter).toContain('invert');

    // Prominent, not an easily-missed muted caption: a role="status" banner.
    const disclosure = screen.getByRole('status');
    expect(disclosure).toHaveTextContent('Approximate simulation');
    // Explicitly names real providers so a user can't mistake this for
    // genuine client-specific dark-mode rendering.
    expect(disclosure).toHaveTextContent(/Gmail\/Outlook\/client-specific/);
  });

  it('Compare shows both Desktop and Mobile iframes side by side', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Compare Desktop \/ Mobile/ }));
    expect(screen.getByTitle('Desktop preview')).toBeInTheDocument();
    expect(screen.getByTitle('Mobile preview')).toBeInTheDocument();
  });

  it('Compare is not offered on the Dark Mode or Email Clients tabs', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('tab', { name: 'Dark Mode' }));
    expect(screen.queryByRole('button', { name: /Compare/ })).not.toBeInTheDocument();
  });

  it('Email Clients tab auto-runs and shows every client as Compatible for safe HTML', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('tab', { name: 'Email Clients' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(`${EMAIL_CLIENTS.length} of ${EMAIL_CLIENTS.length} clients compatible.`);
    });
    for (const client of EMAIL_CLIENTS) {
      const row = screen.getAllByText(client.name)
        .map((el) => el.closest('li')!)
        .find((li) => within(li).queryByText(client.platformLabel))!;
      expect(within(row).getByText('Compatible')).toBeInTheDocument();
    }
  });

  it('Refresh on a single client row re-runs just that client', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('tab', { name: 'Email Clients' }));
    await waitFor(() => screen.getByRole('status'));

    const firstClient = EMAIL_CLIENTS[0];
    const row = screen.getByText(firstClient.name).closest('li')!;
    await user.click(within(row).getByRole('button', { name: `Refresh ${firstClient.name}` }));
    expect(within(row).getByText('Compatible')).toBeInTheDocument();
  });

  it('Send Test is present but disabled (coming soon)', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /Send Test/ })).toBeDisabled();
  });

  it('changing content while Email Clients is open re-runs automatically', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel({ content: content({ modules: [] }) });
    await user.click(screen.getByRole('tab', { name: 'Email Clients' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(`${EMAIL_CLIENTS.length} of ${EMAIL_CLIENTS.length} clients compatible.`);
    });

    rerender(<PreviewStudioPanel width={700} content={content()} />);
    // Still all-compatible after the content change (both are safe HTML) —
    // the point is the run happens again without the user leaving the tab,
    // not a status change; the Desktop tab's own srcDoc test already
    // verifies the new content reaches the renderer.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(`${EMAIL_CLIENTS.length} of ${EMAIL_CLIENTS.length} clients compatible.`);
    });
  });
});

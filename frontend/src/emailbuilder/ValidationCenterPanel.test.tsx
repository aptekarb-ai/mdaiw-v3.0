import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidationCenterPanel } from './ValidationCenterPanel';
import { createModule } from './moduleFactory';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

function textModuleWith(overrides: Partial<TextModuleProps>): EmailModule<TextModuleProps> {
  const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
  return { ...module, props: { ...module.props, ...overrides } };
}

function content(modules: EmailModule[] = []): EmailDocumentContent {
  return { version: 1, modules };
}

function renderPanel(overrides: Partial<Parameters<typeof ValidationCenterPanel>[0]> = {}) {
  const onNavigateToModule = vi.fn();
  const onApplySafeFix = vi.fn();
  const onApplySettingsFix = vi.fn();
  const onApplyDocumentFix = vi.fn();
  render(
    <ValidationCenterPanel
      width={700}
      content={content()}
      platform="generic"
      // Sub-phase 4 — a real title/subject/resetCssEnabled=true baseline,
      // so the "clean document" tests below keep their exact 100/0-issues
      // semantics; individual tests override these to exercise the new
      // 'document' category checks specifically.
      emailTitle="Test Email"
      emailSubject="Test subject"
      resetCssEnabled
      onNavigateToModule={onNavigateToModule}
      onApplySafeFix={onApplySafeFix}
      onApplySettingsFix={onApplySettingsFix}
      onApplyDocumentFix={onApplyDocumentFix}
      {...overrides}
    />,
  );
  return { onNavigateToModule, onApplySafeFix, onApplySettingsFix, onApplyDocumentFix };
}

describe('ValidationCenterPanel', () => {
  it('shows a perfect score and the empty-state message for a clean document', () => {
    renderPanel();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No issues found');
    expect(screen.getByText('Issues Found (0)')).toBeInTheDocument();
  });

  it('every category shows Good for a clean document', () => {
    renderPanel();
    const statuses = screen.getAllByText('Good');
    expect(statuses.length).toBe(9); // document, html, outlook, responsive, accessibility, links, images, dark-mode, platform
  });

  it('lists a real issue with its category, severity, and score below 100 for an unsafe document', () => {
    const image = createModule('image', 0);
    renderPanel({ content: content([image]) });
    expect(screen.getByText('Placeholder image')).toBeInTheDocument();
    expect(screen.getByText(/Issues Found \(\d+\)/)).not.toHaveTextContent('Issues Found (0)');
    const score = screen.getByRole('img', { name: /Health score/ });
    expect(score).toHaveAccessibleName(/Health score (?!100)\d+ out of 100/);
  });

  it('a safe-fixable issue (weak contrast) shows a Fix button that applies the patch', async () => {
    const user = userEvent.setup();
    const badContrast = textModuleWith({ color: '#cccccc', backgroundColor: '#ffffff' });
    const { onApplySafeFix } = renderPanel({ content: content([badContrast]) });

    const card = screen.getByText('Weak text contrast').closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Fix' }));

    expect(onApplySafeFix).toHaveBeenCalledWith(badContrast.id, { color: '#000000' });
  });

  it('a whole-document issue with no traceable module (missing alt text) has no Fix button (fixType "none")', () => {
    const image = createModule('image', 0);
    const withoutAlt: EmailModule = { ...image, props: { ...image.props, alt: '' } };
    renderPanel({ content: content([withoutAlt]) });
    const card = screen.getByText('Missing alt text').closest('li')!;
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('"Fix All Safe Issues" applies every safe fix in one click and is disabled when none exist', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole('button', { name: /Fix All Safe Issues \(0\)/ })).toBeDisabled();

    const badContrast = textModuleWith({ color: '#cccccc', backgroundColor: '#ffffff' });
    const { onApplySafeFix } = renderPanel({ content: content([badContrast]) });
    const button = screen.getByRole('button', { name: /Fix All Safe Issues \(1\)/ });
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onApplySafeFix).toHaveBeenCalledWith(badContrast.id, { color: '#000000' });
  });

  it('Sub-phase 4: a document-scope safe fix (Reset CSS disabled) shows a Fix button that calls onApplyDocumentFix, not onApplySafeFix', async () => {
    const user = userEvent.setup();
    const { onApplyDocumentFix, onApplySafeFix } = renderPanel({ resetCssEnabled: false });

    const card = screen.getByText('Email Reset CSS is disabled').closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Fix' }));

    expect(onApplyDocumentFix).toHaveBeenCalledWith({ reset_css_enabled: true });
    expect(onApplySafeFix).not.toHaveBeenCalled();
  });

  it('Sub-phase 4: an empty title/subject is flagged with no Fix button (fixType "none")', () => {
    renderPanel({ emailTitle: '', emailSubject: '' });
    expect(screen.getByText('Email title is empty')).toBeInTheDocument();
    const card = screen.getByText('Email subject is empty').closest('li')!;
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('AI-Assisted Fix is present but disabled (coming soon) — no fabricated AI call', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /AI-Assisted Fix/ })).toBeDisabled();
  });

  it('Revalidate re-runs the check pipeline without erroring', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Revalidate' }));
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('platform token mismatch is flagged as a platform-category issue', () => {
    const tokenModule = textModuleWith({ text: 'Hi %%FirstName%%' });
    renderPanel({ content: content([tokenModule]), platform: 'generic' });
    expect(screen.getByText('Platform token mismatch')).toBeInTheDocument();
  });

  it('does not crash the Email Builder when the document is corrupted (missing props breaks rendering itself) — shows an error state instead', () => {
    const image = createModule('image', 0);
    (image as unknown as { props: unknown }).props = undefined;
    expect(() => renderPanel({ content: content([image]) })).not.toThrow();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to validate this email');
  });

  it('re-validates automatically when content changes (rerender with new props)', async () => {
    const { rerender } = render(
      <ValidationCenterPanel
        width={700}
        content={content()}
        platform="generic"
        emailTitle="Test Email"
        emailSubject="Test subject"
        resetCssEnabled
        onNavigateToModule={vi.fn()}
        onApplySafeFix={vi.fn()}
        onApplySettingsFix={vi.fn()}
        onApplyDocumentFix={vi.fn()}
      />,
    );
    expect(screen.getByText('100')).toBeInTheDocument();

    const image = createModule('image', 0);
    rerender(
      <ValidationCenterPanel
        width={700}
        content={content([image])}
        platform="generic"
        emailTitle="Test Email"
        emailSubject="Test subject"
        resetCssEnabled
        onNavigateToModule={vi.fn()}
        onApplySafeFix={vi.fn()}
        onApplySettingsFix={vi.fn()}
        onApplyDocumentFix={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText('100')).not.toBeInTheDocument();
    });
  });
});

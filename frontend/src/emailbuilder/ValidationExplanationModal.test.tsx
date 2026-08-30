import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidationExplanationModal } from './ValidationExplanationModal';
import type { ValidationIssue } from './emailValidation';

function issue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    id: 'accessibility:contrast:module-1',
    category: 'accessibility',
    severity: 'warning',
    title: 'Weak text contrast',
    detail: 'Text contrast is 1.61:1 against its background — WCAG AA needs at least 4.5:1.',
    moduleId: 'module-1',
    fixType: 'safe',
    safeFix: { moduleId: 'module-1', propPatch: { color: '#000000' } },
    ...overrides,
  };
}

describe('ValidationExplanationModal — Module-4 E7', () => {
  it('renders every required explanation section', () => {
    render(
      <ValidationExplanationModal
        issue={issue()}
        modules={[]}
        onClose={vi.fn()}
        onGoToModule={vi.fn()}
        onAskAiEngineer={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Weak text contrast')).toBeInTheDocument();
    expect(screen.getByText('Why it matters')).toBeInTheDocument();
    expect(screen.getByText('Where')).toBeInTheDocument();
    expect(screen.getByText('Affected clients')).toBeInTheDocument();
    expect(screen.getByText('What can happen')).toBeInTheDocument();
    expect(screen.getByText('Can this be fixed automatically?')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('Escape closes the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ValidationExplanationModal issue={issue()} modules={[]} onClose={onClose} onGoToModule={vi.fn()} onAskAiEngineer={vi.fn()} />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focus moves into the dialog on open', () => {
    render(
      <ValidationExplanationModal issue={issue()} modules={[]} onClose={vi.fn()} onGoToModule={vi.fn()} onAskAiEngineer={vi.fn()} />,
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('"Go to module" calls onGoToModule with the real moduleId and closes', async () => {
    const user = userEvent.setup();
    const onGoToModule = vi.fn();
    const onClose = vi.fn();
    render(
      <ValidationExplanationModal issue={issue()} modules={[]} onClose={onClose} onGoToModule={onGoToModule} onAskAiEngineer={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Go to module' }));
    expect(onGoToModule).toHaveBeenCalledWith('module-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Go to module" is absent for a document-level issue with no moduleId', () => {
    render(
      <ValidationExplanationModal
        issue={issue({ moduleId: undefined, fixType: 'none', safeFix: undefined })}
        modules={[]}
        onClose={vi.fn()}
        onGoToModule={vi.fn()}
        onAskAiEngineer={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Go to module' })).not.toBeInTheDocument();
  });

  it('"Ask AI Engineer" builds a prompt from the real issue title/detail and closes', async () => {
    const user = userEvent.setup();
    const onAskAiEngineer = vi.fn();
    const onClose = vi.fn();
    render(
      <ValidationExplanationModal issue={issue()} modules={[]} onClose={onClose} onGoToModule={vi.fn()} onAskAiEngineer={onAskAiEngineer} />,
    );
    await user.click(screen.getByRole('button', { name: /Ask AI Engineer/ }));
    expect(onAskAiEngineer).toHaveBeenCalledTimes(1);
    const [prompt, issueId] = onAskAiEngineer.mock.calls[0];
    expect(prompt).toContain('Weak text contrast');
    expect(prompt).toContain('Text contrast is 1.61:1');
    expect(issueId).toBe('accessibility:contrast:module-1');
  });

  it('"Ask AI Engineer" is absent when the caller does not wire it', () => {
    render(
      <ValidationExplanationModal issue={issue()} modules={[]} onClose={vi.fn()} onGoToModule={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /Ask AI Engineer/ })).not.toBeInTheDocument();
  });

  it('closing restores focus to the previously focused element', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <ValidationExplanationModal issue={issue()} modules={[]} onClose={vi.fn()} onGoToModule={vi.fn()} onAskAiEngineer={vi.fn()} />,
    );
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

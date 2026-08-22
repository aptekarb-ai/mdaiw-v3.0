import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlatformEnvironmentDialog } from './PlatformEnvironmentDialog';

function renderDialog(overrides: Partial<Parameters<typeof PlatformEnvironmentDialog>[0]> = {}) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <PlatformEnvironmentDialog
      currentPlatform="generic"
      documentHtml="<p>Hello world</p>"
      onApply={onApply}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onApply, onClose };
}

describe('PlatformEnvironmentDialog', () => {
  it('shows all six platform options with the current one badged', () => {
    renderDialog();
    expect(screen.getByRole('radio', { name: /Generic/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Salesforce Marketing Cloud/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Marketo/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /HubSpot/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Pardot/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Other/ })).toBeInTheDocument();
  });

  it('shows the capability matrix for the currently selected platform', () => {
    renderDialog();
    expect(screen.getByText('Compatibility Mode')).toBeInTheDocument();
    expect(screen.getByText('Maximum')).toBeInTheDocument();
    expect(screen.getByText('HTML Structure')).toBeInTheDocument();
    expect(screen.getAllByText('Table based (Email safe)').length).toBeGreaterThan(0);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('updates the capability matrix and shows merge tags when a different platform is picked', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('radio', { name: /Salesforce Marketing Cloud/ }));
    expect(screen.getByText('AMPScript enabled')).toBeInTheDocument();
    expect(screen.getByText('Available merge tags')).toBeInTheDocument();
    expect(screen.getByText('%%FirstName%%')).toBeInTheDocument();
  });

  it('Apply Platform is disabled while the current platform is still selected', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Apply Platform' })).toBeDisabled();
  });

  it('Apply Platform becomes enabled after selecting a different platform', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('radio', { name: /Marketo/ }));
    expect(screen.getByRole('button', { name: 'Apply Platform' })).not.toBeDisabled();
  });

  it('applying calls onApply with the newly selected platform and closes on success', async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = renderDialog();
    await user.click(screen.getByRole('radio', { name: /HubSpot/ }));
    await user.click(screen.getByRole('button', { name: 'Apply Platform' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('hubspot'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an inline error and stays open when onApply rejects', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockRejectedValue(new Error('network'));
    const onClose = vi.fn();
    renderDialog({ onApply, onClose });
    await user.click(screen.getByRole('radio', { name: /Marketo/ }));
    await user.click(screen.getByRole('button', { name: 'Apply Platform' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not switch the platform');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without calling onApply', async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = renderDialog();
    await user.click(screen.getByRole('radio', { name: /Marketo/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes the dialog', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a non-blocking compatibility-impact warning when switching away from tokens the target does not support', async () => {
    const user = userEvent.setup();
    renderDialog({ documentHtml: '<p>Hi %%FirstName%%</p>', currentPlatform: 'sfmc' });
    await user.click(screen.getByRole('radio', { name: /^Generic/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Compatibility impact');
    expect(screen.getByRole('status')).toHaveTextContent('Generic does not natively support');
    // Non-blocking: Apply remains enabled despite the warning.
    expect(screen.getByRole('button', { name: 'Apply Platform' })).not.toBeDisabled();
  });

  it('copying a merge tag shows a "Copied" confirmation', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderDialog();
    await user.click(screen.getByRole('radio', { name: /Salesforce Marketing Cloud/ }));
    const tokenButton = screen.getByTitle('Copy: Subscriber first name');
    await user.click(tokenButton);
    expect(within(tokenButton).getByText('Copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('%%FirstName%%');
  });
});

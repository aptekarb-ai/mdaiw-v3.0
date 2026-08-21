import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';
import { useYukti } from '../../hooks/useYukti';

vi.mock('../../hooks/useYukti', () => ({
  useYukti: vi.fn(),
}));

function mockYukti() {
  vi.mocked(useYukti).mockReturnValue({ open: vi.fn() } as unknown as ReturnType<typeof useYukti>);
}

describe('AppHeader mobile menu toggle', () => {
  it('renders the toggle with the correct accessible name and aria wiring', () => {
    mockYukti();
    const onOpenMobileNav = vi.fn();
    render(
      <AppHeader mobileNavOpen={false} onOpenMobileNav={onOpenMobileNav} menuButtonRef={createRef()} />,
    );

    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar-nav');
  });

  it('reflects an open drawer via aria-expanded', () => {
    mockYukti();
    render(<AppHeader mobileNavOpen onOpenMobileNav={vi.fn()} menuButtonRef={createRef()} />);
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onOpenMobileNav when clicked', async () => {
    const user = userEvent.setup();
    mockYukti();
    const onOpenMobileNav = vi.fn();
    render(
      <AppHeader mobileNavOpen={false} onOpenMobileNav={onOpenMobileNav} menuButtonRef={createRef()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(onOpenMobileNav).toHaveBeenCalledTimes(1);
  });

  it('still renders the search field and Yukti/notification/profile controls unchanged', () => {
    mockYukti();
    render(<AppHeader mobileNavOpen={false} onOpenMobileNav={vi.fn()} menuButtonRef={createRef()} />);

    expect(screen.getByLabelText('Search or ask Yukti')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Yukti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});

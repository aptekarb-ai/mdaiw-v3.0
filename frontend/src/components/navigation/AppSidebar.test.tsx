import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './AppSidebar';
import { useAuth } from '../../hooks/useAuth';
import { useYukti } from '../../hooks/useYukti';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../hooks/useYukti', () => ({
  useYukti: vi.fn(),
}));

describe('AppSidebar logout', () => {
  it('confirms and logs the user out, navigating to /login', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { id: 1, username: 'jane', email: '', first_name: '', last_name: '' },
      error: null,
      login: vi.fn(),
      logout,
      clearError: vi.fn(),
      setAuthenticatedUser: vi.fn(),
    });
    vi.mocked(useYukti).mockReturnValue({ open: vi.fn() } as unknown as ReturnType<typeof useYukti>);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<AppSidebar />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(screen.getByText('Log out of MDAIW?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});

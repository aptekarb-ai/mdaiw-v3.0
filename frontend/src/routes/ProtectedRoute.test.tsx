import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '../hooks/useAuth';

vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

function renderWithStatus(status: 'loading' | 'authenticated' | 'unauthenticated') {
  vi.mocked(useAuth).mockReturnValue({
    status,
    user: null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    setAuthenticatedUser: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('renders nothing while auth status is loading', () => {
    const { container } = renderWithStatus('loading');
    expect(container.textContent).toBe('');
  });

  it('redirects to /login when unauthenticated', () => {
    renderWithStatus('unauthenticated');
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the protected content when authenticated', () => {
    renderWithStatus('authenticated');
    expect(screen.getByText('Dashboard content')).toBeInTheDocument();
  });
});

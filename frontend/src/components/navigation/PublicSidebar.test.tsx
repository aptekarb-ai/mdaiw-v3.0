import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { PublicSidebar } from './PublicSidebar';

vi.mock('../../hooks/useYukti', () => ({
  useYukti: () => ({ open: vi.fn() }),
}));

function renderSidebar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<PublicSidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicSidebar', () => {
  it('renders public navigation in Home, Login, Registration order', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Home', 'Login', 'Registration']);
  });

  it('Home link points to "/"', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('Login and Registration links point to the correct routes', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(nav).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
    expect(within(nav).getByRole('link', { name: 'Registration' })).toHaveAttribute('href', '/register');
  });

  it('no longer renders an "About" navigation entry', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(nav).queryByText(/about/i)).not.toBeInTheDocument();
  });

  it('the entire brand block is a single link to "/" with accessible text, not nested interactive elements', () => {
    renderSidebar();
    const brandLink = screen.getByRole('link', { name: 'Digital AI Workspace home' });
    expect(brandLink).toHaveAttribute('href', '/');
    expect(within(brandLink).queryAllByRole('link')).toHaveLength(0);
    expect(within(brandLink).queryAllByRole('button')).toHaveLength(0);
  });

  it('does not render standalone "MDAIW" branding text', () => {
    renderSidebar();
    expect(screen.queryByText(/^MDAIW$/)).not.toBeInTheDocument();
  });

  it('displays "Digital AI Workspace" text', () => {
    renderSidebar();
    expect(screen.getByText('Digital AI Workspace')).toBeInTheDocument();
  });

  it('marks the current route as active', () => {
    renderSidebar('/login');
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(nav).getByRole('link', { name: 'Login' })).toHaveClass('public-sidebar__link--active');
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveClass('public-sidebar__link--active');
  });

  it('does not mark Home active on unrelated routes (exact match only)', () => {
    renderSidebar('/register');
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveClass('public-sidebar__link--active');
    expect(within(nav).getByRole('link', { name: 'Registration' })).toHaveClass('public-sidebar__link--active');
  });

  it('marks Home active on "/"', () => {
    renderSidebar('/');
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveClass('public-sidebar__link--active');
  });
});

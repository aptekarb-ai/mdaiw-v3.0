import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ModulePlaceholderPage } from './ModulePlaceholderPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<ModulePlaceholderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ModulePlaceholderPage', () => {
  it('shows the LP Builder Coming Soon copy at /module-3/builder', () => {
    renderAt('/module-3/builder');
    expect(screen.getByRole('heading', { name: 'LP Builder' })).toBeInTheDocument();
    expect(screen.getByText('LP Builder will be implemented in Priority 2.')).toBeInTheDocument();
  });

  it('shows the AI LP Generator Coming Soon copy at /module-3/generator', () => {
    renderAt('/module-3/generator');
    expect(screen.getByRole('heading', { name: 'AI LP Generator' })).toBeInTheDocument();
    expect(screen.getByText('AI LP Generator will be implemented in Priority 3.')).toBeInTheDocument();
  });

  it('falls back to the generic copy for other module placeholders', () => {
    renderAt('/employees');
    expect(screen.getByRole('heading', { name: 'Employees' })).toBeInTheDocument();
    expect(screen.getByText('Module functionality will be implemented in a future phase.')).toBeInTheDocument();
  });

  it('links back to the dashboard', () => {
    renderAt('/module-3/builder');
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});

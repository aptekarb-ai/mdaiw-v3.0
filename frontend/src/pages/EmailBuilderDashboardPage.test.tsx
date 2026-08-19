import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { EmailBuilderDashboardPage } from './EmailBuilderDashboardPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder']}>
      <Routes>
        <Route path="/email-builder" element={<EmailBuilderDashboardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EmailBuilderDashboardPage', () => {
  it('renders the dashboard title and supporting copy', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'AI Email Builder', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Build compatible, responsive emails/)).toBeInTheDocument();
  });

  it('renders all four primary entry actions', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Create New Email/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose Template/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import HTML/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Generate Email/ })).toBeInTheDocument();
  });

  it('disables entry actions since the underlying features are not yet implemented', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Create New Email/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Choose Template/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Import HTML/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /AI Generate Email/ })).toBeDisabled();
  });

  it('shows the Recent Emails empty state when no emails exist', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Recent Emails' })).toBeInTheDocument();
    expect(screen.getByText('You have not created any emails yet.')).toBeInTheDocument();
  });

  it('shows the six-step Getting Started workflow in order', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Getting Started' })).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toEqual([
      '1Create or import an email',
      '2Add modules',
      '3Edit content and design',
      '4Preview across devices and clients',
      '5Validate compatibility',
      '6Export and deploy',
    ]);
  });
});

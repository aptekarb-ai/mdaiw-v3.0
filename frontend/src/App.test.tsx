import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App routing', () => {
  it('renders the landing page heading at /', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'MDAIW' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Digital AI Workspace' })).toBeInTheDocument();
  });

  it('renders public navigation', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(nav).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Login' }).length).toBeGreaterThan(0);
  });
});

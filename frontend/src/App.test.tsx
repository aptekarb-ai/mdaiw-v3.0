import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

// App's route tree reaches LandingPageValidatorPage -> CodeEditor, which
// imports Monaco's worker files via Vite's `?worker` syntax. None of
// these tests actually render the validator page, but the module graph
// is still resolved at collection time — mocked here purely so that
// resolution succeeds, matching the same mocks used in the validator's
// own tests.
vi.mock('@monaco-editor/react', async () => {
  const { buildMonacoEditorReactMock } = await import('./testUtils/monacoEditorMock');
  return buildMonacoEditorReactMock();
});
vi.mock('./landingpages/monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));

function renderAppAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

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

  it('redirects unauthenticated access to /module-3/validator to /login', async () => {
    renderAppAt('/module-3/validator');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in to Digital AI Workspace' })).toBeInTheDocument(),
    );

    window.history.pushState({}, '', '/');
  });

  it.each(['/module-3/builder', '/module-3/generator'])(
    'redirects unauthenticated access to %s to /login',
    async (path) => {
      renderAppAt(path);

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Sign in to Digital AI Workspace' })).toBeInTheDocument(),
      );

      window.history.pushState({}, '', '/');
    },
  );
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requestLocalAIDiagnostics } from '../api/client';
import { LocalAIDiagnosticsPanel } from './LocalAIDiagnosticsPanel';

vi.mock('../api/client', () => ({
  requestLocalAIDiagnostics: vi.fn(),
}));

function diagnosticsResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    success: true,
    diagnostics: {
      configured: true, reachable: true, runtime: 'ollama', model: 'llama3.1:8b',
      configured_model_available: true, available_models: ['llama3.1:8b'], api_key_configured: false,
      capabilities: {
        natural_language: true, multilingual: true, coding: true, tool_calling: true,
        structured_output: true, vision: false, context_window: 128000,
      },
      error: null, deterministic_fallback_ready: true,
      ...overrides,
    },
  };
}

describe('LocalAIDiagnosticsPanel', () => {
  beforeEach(() => {
    vi.mocked(requestLocalAIDiagnostics).mockReset();
  });

  it('renders collapsed by default and does not fetch until opened', () => {
    vi.mocked(requestLocalAIDiagnostics).mockResolvedValue(diagnosticsResponse());
    render(<LocalAIDiagnosticsPanel />);
    expect(screen.getByText('Local AI diagnostics')).toBeInTheDocument();
    expect(requestLocalAIDiagnostics).not.toHaveBeenCalled();
  });

  it('fetches and shows Connected/reachable state when opened', async () => {
    vi.mocked(requestLocalAIDiagnostics).mockResolvedValue(diagnosticsResponse());
    const user = userEvent.setup();
    render(<LocalAIDiagnosticsPanel />);
    await user.click(screen.getByText('Local AI diagnostics'));
    await waitFor(() => expect(requestLocalAIDiagnostics).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('ollama')).toBeInTheDocument();
    expect(screen.getByText('llama3.1:8b')).toBeInTheDocument();
  });

  it('shows Not configured when no local endpoint is set', async () => {
    vi.mocked(requestLocalAIDiagnostics).mockResolvedValue(diagnosticsResponse({ configured: false, reachable: false, runtime: null, model: null }));
    const user = userEvent.setup();
    render(<LocalAIDiagnosticsPanel />);
    await user.click(screen.getByText('Local AI diagnostics'));
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
  });

  it('shows Unavailable when configured but unreachable, never crashes', async () => {
    vi.mocked(requestLocalAIDiagnostics).mockResolvedValue(diagnosticsResponse({
      configured: true, reachable: false, capabilities: null,
    }));
    const user = userEvent.setup();
    render(<LocalAIDiagnosticsPanel />);
    await user.click(screen.getByText('Local AI diagnostics'));
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('shows a friendly message and never crashes on a failed fetch', async () => {
    vi.mocked(requestLocalAIDiagnostics).mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    render(<LocalAIDiagnosticsPanel />);
    await user.click(screen.getByText('Local AI diagnostics'));
    expect(await screen.findByText('Could not load diagnostics right now.')).toBeInTheDocument();
  });

  it('does not re-fetch on a second open once already loaded', async () => {
    vi.mocked(requestLocalAIDiagnostics).mockResolvedValue(diagnosticsResponse());
    const user = userEvent.setup();
    render(<LocalAIDiagnosticsPanel />);
    const toggle = screen.getByText('Local AI diagnostics');
    await user.click(toggle);
    await waitFor(() => expect(requestLocalAIDiagnostics).toHaveBeenCalledTimes(1));
    await user.click(toggle); // close
    await user.click(toggle); // reopen
    expect(requestLocalAIDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('never renders any secret/API-key value (backend never sends one, but the UI must not assume otherwise)', async () => {
    vi.mocked(requestLocalAIDiagnostics).mockResolvedValue(diagnosticsResponse({ api_key_configured: true }));
    const user = userEvent.setup();
    render(<LocalAIDiagnosticsPanel />);
    await user.click(screen.getByText('Local AI diagnostics'));
    await screen.findByText('Connected');
    expect(document.body.textContent).not.toMatch(/sk-|api[_-]?key\s*[:=]\s*\S+/i);
  });
});

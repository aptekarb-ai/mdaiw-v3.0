import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIEngineerPanel } from './AIEngineerPanel';
import { requestAICommand } from '../api/client';
import { isSpeechRecognitionSupported, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { createModule } from './moduleFactory';
import { clearLearnedRepairSignals, newLearningEventId, recordRepairSignal } from './learningSignals';
import type { AICommandResponse } from './aiCommand';

vi.mock('../api/client', () => ({ requestAICommand: vi.fn() }));
vi.mock('../hooks/useSpeechRecognition', () => ({
  isSpeechRecognitionSupported: vi.fn(),
  useSpeechRecognition: vi.fn(),
}));
// Sub-phase 8 — mocked at the module boundary so these UI tests assert
// WHAT gets recorded (signature/outcome/source) without depending on a
// real network call; learningSignals.ts's own unit tests separately cover
// its actual apiRequest wiring and failure-swallowing behavior.
vi.mock('./learningSignals', () => ({
  recordRepairSignal: vi.fn().mockResolvedValue(undefined),
  clearLearnedRepairSignals: vi.fn().mockResolvedValue(true),
  newLearningEventId: vi.fn(() => 'test-event-id'),
  fetchRepairRanking: vi.fn().mockResolvedValue({}),
}));

function mockSpeech(overrides: Partial<ReturnType<typeof useSpeechRecognition>> = {}) {
  vi.mocked(isSpeechRecognitionSupported).mockReturnValue(true);
  vi.mocked(useSpeechRecognition).mockReturnValue({
    status: 'idle',
    transcript: '',
    errorMessage: null,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  });
}

function response(overrides: Partial<AICommandResponse> = {}): AICommandResponse {
  return {
    success: true,
    reply: 'I will add a button module.',
    action: { type: 'INSERT_MODULE', modules: [{ module_type: 'button', patch: {} }] },
    requires_confirmation: false,
    requires_strong_confirmation: false,
    confidence: 0.9,
    provider: 'deterministic',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof AIEngineerPanel>[0]> = {}) {
  const onApplyAction = vi.fn().mockReturnValue(true);
  const onApplyDocumentSettingAction = vi.fn().mockResolvedValue(true);
  const onApplyRepairAction = vi.fn().mockReturnValue(true);
  render(
    <AIEngineerPanel
      platform="generic"
      width={700}
      selectedModule={null}
      content={{ version: 1, modules: [] }}
      emailTitle="Test Email"
      emailSubject="Test subject"
      faviconUrl=""
      resetCssEnabled
      customCssEnabled={false}
      customCss=""
      onApplyAction={onApplyAction}
      onApplyDocumentSettingAction={onApplyDocumentSettingAction}
      onApplyRepairAction={onApplyRepairAction}
      {...overrides}
    />,
  );
  return { onApplyAction, onApplyDocumentSettingAction, onApplyRepairAction };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AIEngineerPanel', () => {
  it('shows the empty-state guidance when no conversation has started', () => {
    mockSpeech();
    renderPanel();
    expect(screen.getByText(/Ask the AI Engineer to add a module/)).toBeInTheDocument();
  });

  it('mic button is disabled and shows the unsupported-browser message when speech recognition is unavailable', () => {
    vi.mocked(isSpeechRecognitionSupported).mockReturnValue(false);
    vi.mocked(useSpeechRecognition).mockReturnValue({
      status: 'unsupported', transcript: '', errorMessage: null, start: vi.fn(), stop: vi.fn(), reset: vi.fn(),
    });
    renderPanel();
    expect(screen.getByRole('button', { name: 'Talk to the AI Engineer' })).toBeDisabled();
    expect(screen.getByText(/Voice input is not supported in this browser/)).toBeInTheDocument();
  });

  it('does not request microphone access merely by rendering — start() is never called on mount', () => {
    const start = vi.fn();
    mockSpeech({ start });
    renderPanel();
    expect(start).not.toHaveBeenCalled();
  });

  it('clicking the mic button starts listening, and the transcript fills the composer', async () => {
    const start = vi.fn((onFinalTranscript?: (text: string) => void) => onFinalTranscript?.('add a button'));
    mockSpeech({ start });
    renderPanel();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Talk to the AI Engineer' }));

    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText(/Type your command/)).toHaveValue('add a button');
  });

  it('clicking the mic button while listening stops it', async () => {
    const stop = vi.fn();
    mockSpeech({ status: 'listening', stop });
    renderPanel();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stop listening' }));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a non-destructive proposal (single module insert) does not use the confirm-styled card, and Apply invokes onApplyAction', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    const { onApplyAction } = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Add a button module')).toBeInTheDocument();
    expect(document.querySelector('.ai-engineer-panel__proposal--confirm')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyAction).toHaveBeenCalledWith(
      { type: 'INSERT_MODULE', modules: [{ module_type: 'button', patch: {} }] },
      null,
    );
    expect(await screen.findByText(/Applied:/)).toBeInTheDocument();
  });

  it('a destructive/multi-module proposal renders with confirm styling', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'This will delete the selected module. Please confirm.',
      action: { type: 'DELETE_MODULE', target: 'selected' },
      requires_confirmation: true,
    }));
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'delete this');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Delete the selected module')).toBeInTheDocument();
    expect(document.querySelector('.ai-engineer-panel__proposal--confirm')).not.toBeNull();
  });

  it('Cancel discards the proposal without calling onApplyAction and records it in history', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    const { onApplyAction } = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Add a button module');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApplyAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'History (1)' }));
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('the composer is disabled while a proposal is pending, until it is resolved', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Add a button module');

    expect(screen.getByPlaceholderText(/Type your command/)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByPlaceholderText(/Type your command/)).not.toBeDisabled();
  });

  it('when onApplyAction reports failure (stale selection), shows an honest failure message instead of claiming success', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      action: { type: 'UPDATE_MODULE_PROPS', target: 'selected', module_type: 'text', patch: { color: '#76C043' } },
    }));
    const onApplyAction = vi.fn().mockReturnValue(false);
    renderPanel({ onApplyAction, selectedModule: createModule('text', 0) });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'make it green');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Update the selected text module/);

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Could not apply/)).toBeInTheDocument();
  });

  it('an unsupported command (NONE action) shows the clarifying reply with no proposal card', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: "I'm not sure how to do that yet.",
      action: { type: 'NONE' },
    }));
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'convert this to two columns');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText("I'm not sure how to do that yet.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });

  it('a rejected request shows a safe error message and records it in history as Failed', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockRejectedValue(new Error('network down'));
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('We could not reach the AI Engineer. Please try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'History (1)' }));
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('sends only type/props for a selected module in the supported AI vocabulary', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    const textModule = createModule('text', 0);
    renderPanel({ selectedModule: textModule });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'make it bigger');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(requestAICommand).toHaveBeenCalledWith(expect.objectContaining({
      selected_module: { type: 'text', props: textModule.props },
    }));
  });

  it('sends selected_module context for a layout module too (Phase A: every registered type is now a potential AI target)', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    const layoutModule = createModule('layout-2col-50-50', 0);
    renderPanel({ selectedModule: layoutModule });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(requestAICommand).toHaveBeenCalledWith(expect.objectContaining({
      selected_module: { type: 'layout-2col-50-50', props: layoutModule.props },
    }));
  });

  it('sends selected_module context as null when nothing is selected', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    renderPanel({ selectedModule: null });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(requestAICommand).toHaveBeenCalledWith(expect.objectContaining({ selected_module: null }));
  });

  it('the History tab lists an applied action with its status and summary', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Add a button module');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await user.click(screen.getByRole('tab', { name: 'History (1)' }));
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByText('"add a button"')).toBeInTheDocument();
  });
});

describe('AIEngineerPanel — Sub-phase 2 document-level CSS actions (item F)', () => {
  it('a Reset CSS proposal routes Apply through onApplyDocumentSettingAction, not onApplyAction', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'This will disable Email Reset CSS, which may reduce consistency across email clients. Please confirm.',
      action: { type: 'SET_RESET_CSS_ENABLED', enabled: false },
      requires_confirmation: true,
    }));
    const { onApplyAction, onApplyDocumentSettingAction } = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'disable reset css');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Disable Email Reset CSS');

    expect(screen.getByText(/Current/)).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText(/Proposed/)).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyDocumentSettingAction).toHaveBeenCalledWith({ type: 'SET_RESET_CSS_ENABLED', enabled: false });
    expect(onApplyAction).not.toHaveBeenCalled();
    expect(await screen.findByText(/Applied:/)).toBeInTheDocument();
  });

  it('a Custom CSS proposal shows the current/proposed CSS diff and affected clients', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'I will update your Custom CSS. Please review the proposed change.',
      action: { type: 'SET_CUSTOM_CSS', css: '.brand { color: #002D38; }' },
      requires_confirmation: true,
    }));
    renderPanel({ customCss: '.old { color: red; }' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'set custom css to: .brand {{ color: #002D38; }');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Update Custom CSS');

    expect(screen.getByText('.old { color: red; }')).toBeInTheDocument();
    expect(screen.getByText('.brand { color: #002D38; }')).toBeInTheDocument();
    expect(screen.getByText(/Affected clients:/)).toBeInTheDocument();
  });

  it('shows a structural-selector warning inside the proposal without blocking Apply', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      action: { type: 'SET_CUSTOM_CSS', css: 'table { display: none; }' },
      requires_confirmation: true,
    }));
    const { onApplyDocumentSettingAction } = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'set custom css to: table {{ display: none; }');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Update Custom CSS');

    expect(await screen.findByText(/sets "display" on every <table>/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyDocumentSettingAction).toHaveBeenCalled();
  });

  it('a substantial Custom CSS replacement requires the extra strong-confirmation checkbox before Apply is enabled', async () => {
    mockSpeech();
    const longCss = '.x{color:red}'.repeat(20);
    vi.mocked(requestAICommand).mockResolvedValue(response({
      action: { type: 'SET_CUSTOM_CSS', css: longCss },
      requires_confirmation: true,
      requires_strong_confirmation: true,
    }));
    const { onApplyDocumentSettingAction } = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'replace custom css with a lot of styles');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Update Custom CSS');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /substantial amount of Custom CSS/ }));
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyDocumentSettingAction).toHaveBeenCalledWith({ type: 'SET_CUSTOM_CSS', css: longCss });
  });

  it('Cancel on a CSS proposal never calls onApplyDocumentSettingAction', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      action: { type: 'CLEAR_CUSTOM_CSS' },
      requires_confirmation: true,
    }));
    const { onApplyDocumentSettingAction } = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'remove custom css');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Remove Custom CSS');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApplyDocumentSettingAction).not.toHaveBeenCalled();
  });

  it('a failed document-setting Apply shows an honest failure message', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      action: { type: 'SET_RESET_CSS_ENABLED', enabled: true },
      requires_confirmation: true,
    }));
    renderPanel({ onApplyDocumentSettingAction: vi.fn().mockResolvedValue(false) });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'enable reset css');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Enable Email Reset CSS');

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Could not apply — saving to the server failed/)).toBeInTheDocument();
  });
});

describe('AIEngineerPanel — Sub-phase 4, item 3: title/subject/favicon actions', () => {
  it('a SET_EMAIL_TITLE proposal shows the current/proposed title and routes Apply through onApplyDocumentSettingAction', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'I will set the email title to "Summer Sale".',
      action: { type: 'SET_EMAIL_TITLE', title: 'Summer Sale' },
      requires_confirmation: true,
    }));
    const { onApplyAction, onApplyDocumentSettingAction } = renderPanel({ emailTitle: 'Old Title' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'set the title to Summer Sale');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Set the email title to "Summer Sale"');

    expect(screen.getByText('Old Title')).toBeInTheDocument();
    expect(screen.getByText('Summer Sale')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyDocumentSettingAction).toHaveBeenCalledWith({ type: 'SET_EMAIL_TITLE', title: 'Summer Sale' });
    expect(onApplyAction).not.toHaveBeenCalled();
  });

  it('a SET_FAVICON proposal shows the current/proposed URL', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      action: { type: 'SET_FAVICON', url: 'https://example.com/favicon.png' },
      requires_confirmation: true,
    }));
    renderPanel({ faviconUrl: '' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'set favicon url to https://example.com/favicon.png');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/favicon.png')).toBeInTheDocument();
  });

  it('a CLEAR_FAVICON proposal Applies through onApplyDocumentSettingAction', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({
      action: { type: 'CLEAR_FAVICON' },
      requires_confirmation: true,
    }));
    const { onApplyDocumentSettingAction } = renderPanel({ faviconUrl: 'https://example.com/favicon.png' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'remove the favicon');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Remove the favicon');

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyDocumentSettingAction).toHaveBeenCalledWith({ type: 'CLEAR_FAVICON' });
  });
});

describe('AIEngineerPanel — Sub-phase 4, item 2/4: document diagnose/repair intents (client-side, zero network)', () => {
  it('"validate the complete email" is answered locally — requestAICommand is never called', async () => {
    mockSpeech();
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'validate the complete email');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Email Health Score: 100\/100/)).toBeInTheDocument();
    expect(requestAICommand).not.toHaveBeenCalled();
  });

  it('"check this email for classic outlook issues" reports honestly when nothing is wrong', async () => {
    mockSpeech();
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'check this email for classic outlook issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/No Classic Outlook compatibility problems/)).toBeInTheDocument();
    expect(requestAICommand).not.toHaveBeenCalled();
  });

  it('a diagnostic reply with no repair candidates records as "Reported" in history, not "Needs clarification"', async () => {
    mockSpeech();
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'validate the complete email');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Email Health Score/);

    await user.click(screen.getByRole('tab', { name: 'History (1)' }));
    expect(screen.getByText('Reported')).toBeInTheDocument();
  });

  it('"repair all safe issues" proposes a repair card (Reset CSS disabled) without calling requestAICommand', async () => {
    mockSpeech();
    renderPanel({ resetCssEnabled: false });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Repair 1 issue')).toBeInTheDocument();
    expect(screen.getByText('Email Reset CSS is disabled')).toBeInTheDocument();
    expect(requestAICommand).not.toHaveBeenCalled();
  });

  it('Cancel on a repair proposal never applies anything', async () => {
    mockSpeech();
    const { onApplyRepairAction } = renderPanel({ resetCssEnabled: false });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Repair 1 issue');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApplyRepairAction).not.toHaveBeenCalled();
    expect(await screen.findByText('Cancelled. Nothing was changed.')).toBeInTheDocument();
  });

  it('Cancel on a repair proposal records a REJECTED learning signal for the candidate', async () => {
    mockSpeech();
    renderPanel({ resetCssEnabled: false });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Repair 1 issue');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(recordRepairSignal).toHaveBeenCalledWith({
      eventId: 'test-event-id',
      signature: 'document:reset-css-disabled',
      outcome: 'rejected',
      source: 'ai_engineer_repair',
    });
  });

  it('Apply on a repair proposal calls onApplyRepairAction with the deterministic repair item', async () => {
    mockSpeech();
    const { onApplyRepairAction } = renderPanel({ resetCssEnabled: false });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Repair 1 issue');

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyRepairAction).toHaveBeenCalledWith([
      { kind: 'document', issueId: 'document:reset-css-disabled', documentPatch: { reset_css_enabled: true } },
    ]);
    expect(await screen.findByText('Repaired 1 issue.')).toBeInTheDocument();
  });

  it('Apply on a repair proposal records an ACCEPTED learning signal for the candidate, with its own event id', async () => {
    mockSpeech();
    renderPanel({ resetCssEnabled: false });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Repair 1 issue');

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(newLearningEventId).toHaveBeenCalled();
    expect(recordRepairSignal).toHaveBeenCalledWith({
      eventId: 'test-event-id',
      signature: 'document:reset-css-disabled',
      outcome: 'accepted',
      source: 'ai_engineer_repair',
    });
  });

  it('Apply that fails to apply (onApplyRepairAction returns false) records no learning signal', async () => {
    mockSpeech();
    renderPanel({ resetCssEnabled: false, onApplyRepairAction: vi.fn().mockReturnValue(false) });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Repair 1 issue');

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Could not apply the repair. Please try again.');
    expect(recordRepairSignal).not.toHaveBeenCalled();
  });

  it('"Clear learned preferences" shows the required confirmation copy and calls clearLearnedRepairSignals only after confirming', async () => {
    mockSpeech();
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.click(screen.getByRole('button', { name: 'Clear learned preferences' }));

    expect(screen.getByText(
      'Clear learned preferences? This resets recommendation ordering only and does not affect '
      + 'email content, validation rules, or safety rules.',
    )).toBeInTheDocument();
    expect(clearLearnedRepairSignals).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clearLearnedRepairSignals).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Learned preferences cleared/)).toBeInTheDocument();
  });

  it('"Clear learned preferences" confirmation Cancel does not call clearLearnedRepairSignals', async () => {
    mockSpeech();
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.click(screen.getByRole('button', { name: 'Clear learned preferences' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(clearLearnedRepairSignals).not.toHaveBeenCalled();
    expect(screen.queryByText(/This resets recommendation ordering only/)).not.toBeInTheDocument();
  });

  it('a repair-keyword request with no matching issue never fabricates a proposal', async () => {
    mockSpeech();
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix the dpi issue');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/could not find a matching problem/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });

  it('the composer stays disabled while a repair proposal is pending', async () => {
    mockSpeech();
    renderPanel({ resetCssEnabled: false });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Repair 1 issue');

    expect(screen.getByPlaceholderText(/Type your command/)).toBeDisabled();
  });
});

import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIEngineerPanel } from './AIEngineerPanel';
import { requestAICommand } from '../api/client';
import { isSpeechRecognitionSupported, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { createModule } from './moduleFactory';
import { clearLearnedRepairSignals, newLearningEventId, recordRepairSignal } from './learningSignals';
import { createAIEngineerHandoff, createConsumedHandoffTracker, createImportReconstructionHandoff } from './aiEngineerHandoff';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildFidelityReport } from './htmlImportFidelity';
import { mapImportedHtml } from './htmlImportMapper';
import { buildReconstructionReview, formatReconstructionReviewMessage } from './reconstructionReview';
import { buildImportReconstructionContext } from './importReconstructionContext';
import { loadReconstructionSession, storeReconstructionSession } from './reconstructionSessionStorage';
import { MAX_RECONSTRUCTION_PASSES } from './reconstructionCorrectionLoop';
import type { AICommandResponse, RepairActionItem } from './aiCommand';

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

// R4-B — formatReconstructionReviewMessage() output is multi-line
// (message.text is rendered as one raw text node — see AIEngineerPanel.tsx's
// `{message.text}`), but Testing Library's default text matcher collapses
// all whitespace runs, including newlines, before comparing. A plain
// getByText(theMultiLineString) would therefore never match its own
// unmangled newlines. This normalizes both sides the same way instead.
function findByMessageText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return screen.findByText((_, node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim() === normalized);
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
  const result = render(
    <AIEngineerPanel
      documentId={1}
      editorMode="ai"
      platform="generic"
      width={700}
      selectedModule={null}
      selectedColumn={null}
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
  return { onApplyAction, onApplyDocumentSettingAction, onApplyRepairAction, unmount: result.unmount };
}

afterEach(() => {
  vi.clearAllMocks();
  // E10 — every test below renders with the same default documentId={1};
  // without clearing storage between tests, one test's persisted
  // conversation would leak into the next test's initial render (real
  // documents never collide on id, but these tests all share one).
  window.localStorage.clear();
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

// Module-4 E10 — a real bug caught live: an earlier version persisted the
// conversation via a separate reactive "save whenever messages changes"
// effect, which could fire once on mount with the STALE pre-load empty
// array (before the load effect's own setMessages had applied), silently
// wiping out everything from the previous mounted instance. Fixed by
// loading via LAZY initial state and persisting only inside
// appendMessage's own functional updater (see AIEngineerPanel.tsx's
// docstrings on both). These tests reproduce the exact unmount/remount
// sequence (switching tabs away from and back to AI Engineer) that
// exposed the bug.
describe('AIEngineerPanel — E10 conversation persistence survives unmount/remount (regression)', () => {
  it('a full exchange survives switching away and back to the AI Engineer tab (simulated by unmount + fresh mount, same documentId)', async () => {
    mockSpeech();
    // action: NONE (a plain diagnostic reply, no proposal card) — keeps
    // this test isolated to message persistence, not proposal rendering
    // (an actionable response would ALSO echo the reply text into a
    // separate proposal-detail element, making text queries ambiguous).
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'Adding a button.', action: { type: 'NONE' }, requires_confirmation: false,
    }));
    const first = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Adding a button.');

    // Simulates the real EmailBuilderWorkspacePage behavior: switching
    // to another tab (Validate) unmounts AIEngineerPanel entirely; a
    // later switch back mounts a genuinely NEW component instance.
    first.unmount();

    renderPanel();
    expect(await screen.findByText('add a button')).toBeInTheDocument();
    expect(screen.getByText('Adding a button.')).toBeInTheDocument();
  });

  it('a second exchange (seeded from a NEW "Ask AI Engineer" click) is appended to, not a replacement for, the first exchange after remount', async () => {
    mockSpeech();
    // action: NONE (a plain diagnostic reply, no proposal card) — keeps
    // this test isolated to message persistence, not proposal rendering
    // (an actionable response would ALSO echo the reply text into a
    // separate proposal-detail element, making text queries ambiguous).
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'Adding a button.', action: { type: 'NONE' }, requires_confirmation: false,
    }));
    const first = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Adding a button.');
    first.unmount();

    // A second "Ask AI Engineer" seed, exactly like Validation Center's
    // Explain modal produces.
    const tracker = createConsumedHandoffTracker();
    renderPanel({
      aiEngineerHandoff: createAIEngineerHandoff(1, 'Explain this issue and, if possible, fix it: Email title is empty — The document <title> is empty.'),
      onConsumeAiEngineerHandoff: tracker.tryConsume,
    });

    expect(await screen.findByText(/Email title is empty/)).toBeInTheDocument();
    // The FIRST exchange must still be present — not silently dropped.
    expect(screen.getByText('add a button')).toBeInTheDocument();
    expect(screen.getByText('Adding a button.')).toBeInTheDocument();
  });

  it('a DIFFERENT document (different documentId) never sees another document\'s conversation on mount', async () => {
    mockSpeech();
    // action: NONE (a plain diagnostic reply, no proposal card) — keeps
    // this test isolated to message persistence, not proposal rendering
    // (an actionable response would ALSO echo the reply text into a
    // separate proposal-detail element, making text queries ambiguous).
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'Adding a button.', action: { type: 'NONE' }, requires_confirmation: false,
    }));
    const doc1 = renderPanel({ documentId: 101 });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Adding a button.');
    doc1.unmount();

    renderPanel({ documentId: 202 });
    expect(screen.getByText(/Ask the AI Engineer to add a module/)).toBeInTheDocument();
    expect(screen.queryByText('add a button')).not.toBeInTheDocument();
  });

  it('"Clear conversation" empties the transcript and a later remount of the SAME document stays empty', async () => {
    mockSpeech();
    // action: NONE (a plain diagnostic reply, no proposal card) — keeps
    // this test isolated to message persistence, not proposal rendering
    // (an actionable response would ALSO echo the reply text into a
    // separate proposal-detail element, making text queries ambiguous).
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: 'Adding a button.', action: { type: 'NONE' }, requires_confirmation: false,
    }));
    const first = renderPanel();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Adding a button.');

    await user.click(screen.getByRole('button', { name: 'Clear conversation' }));
    expect(screen.getByText(/Ask the AI Engineer to add a module/)).toBeInTheDocument();
    first.unmount();

    renderPanel();
    expect(screen.getByText(/Ask the AI Engineer to add a module/)).toBeInTheDocument();
    expect(screen.queryByText('add a button')).not.toBeInTheDocument();
  });

  // C-3 remediation — placeholder-link conversational completion. The AI
  // must never invent a destination URL; once it asks for one, a later
  // bare-URL reply must be understood as the answer to THAT specific
  // repair (targeting the real moduleId, never whatever's selected) —
  // without a second network round trip, reusing the existing
  // pendingRepair confirmation card unchanged.
  describe('placeholder-link conversational completion', () => {
    function buttonModuleWithPlaceholderLink() {
      const button = createModule('button', 0);
      return { ...button, props: { ...button.props, href: '' } };
    }

    it('a bare URL reply after the AI asks for one proposes the repair without a second network call', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(response({
        reply: "I won't guess a destination for this link. What URL should it go to?",
        action: { type: 'NONE' },
      }));
      const button = buttonModuleWithPlaceholderLink();
      renderPanel({ content: { version: 1, modules: [button] } });
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText(/Type your command/), 'review the placeholder link issue');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText(/won't guess a destination/);

      await user.type(screen.getByPlaceholderText(/Type your command/), 'https://example.com/shop');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(await screen.findByText('Repair 1 issue')).toBeInTheDocument();
      expect(screen.getByText('Placeholder link')).toBeInTheDocument();
      expect(screen.getAllByText('https://example.com/shop').length).toBeGreaterThan(0);
      expect(requestAICommand).toHaveBeenCalledTimes(1);
    });

    it('Apply on the resulting repair card patches only the correct module', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(response({
        reply: "I won't guess a destination for this link. What URL should it go to?",
        action: { type: 'NONE' },
      }));
      const button = buttonModuleWithPlaceholderLink();
      const { onApplyRepairAction } = renderPanel({ content: { version: 1, modules: [button] } });
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText(/Type your command/), 'review the placeholder link issue');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText(/won't guess a destination/);
      await user.type(screen.getByPlaceholderText(/Type your command/), 'https://example.com/shop');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText('Repair 1 issue');

      await user.click(screen.getByRole('button', { name: 'Apply' }));
      expect(onApplyRepairAction).toHaveBeenCalledWith([
        { kind: 'module', issueId: 'links:placeholder-href', moduleId: button.id, propPatch: { href: 'https://example.com/shop' } },
      ]);
    });

    it('rejects a javascript: URL and keeps the repair pending for a retry', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(response({
        reply: "I won't guess a destination for this link. What URL should it go to?",
        action: { type: 'NONE' },
      }));
      const button = buttonModuleWithPlaceholderLink();
      renderPanel({ content: { version: 1, modules: [button] } });
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText(/Type your command/), 'review the placeholder link issue');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText(/won't guess a destination/);

      await user.type(screen.getByPlaceholderText(/Type your command/), 'javascript://alert(1)');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(await screen.findByText(/isn't an allowed link type/)).toBeInTheDocument();
      expect(screen.queryByText('Repair 1 issue')).not.toBeInTheDocument();

      // Still pending — a real URL now completes it.
      await user.type(screen.getByPlaceholderText(/Type your command/), 'https://example.com/shop');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('Repair 1 issue')).toBeInTheDocument();
    });

    it('"cancel" clears the pending repair instead of demanding a URL forever', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(response({
        reply: "I won't guess a destination for this link. What URL should it go to?",
        action: { type: 'NONE' },
      }));
      const button = buttonModuleWithPlaceholderLink();
      renderPanel({ content: { version: 1, modules: [button] } });
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText(/Type your command/), 'review the placeholder link issue');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText(/won't guess a destination/);

      await user.type(screen.getByPlaceholderText(/Type your command/), 'cancel');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(await screen.findByText(/no longer pending/)).toBeInTheDocument();
      expect(screen.queryByText('Repair 1 issue')).not.toBeInTheDocument();
    });
  });

  // Bug fix — "Review N more with AI Engineer" inserted its handoff prompt
  // twice (two user messages, two /ai-command/ requests, two assistant
  // replies) from a single click. Root cause: the effect that consumed
  // the seed prompt had no idempotency guard at all, so React StrictMode's
  // dev-only double-invocation of a fresh mount's effects sent it twice
  // (both invocations run synchronously, before the parent's state-clearing
  // update from the first send could propagate as a new render). The
  // handoff is now an explicit one-shot event with a unique id, consumed
  // via a compare-and-swap tracker owned by whichever component never
  // unmounts across an AI Engineer tab switch (EmailBuilderWorkspacePage
  // in production) — see aiEngineerHandoff.ts.
  describe('AI Engineer handoff (Validation -> AI Engineer one-shot event)', () => {
    function handoffResponse(overrides: Partial<AICommandResponse> = {}): AICommandResponse {
      return response({ reply: 'Handoff acknowledged.', action: { type: 'NONE' }, requires_confirmation: false, ...overrides });
    }

    it('one click (one handoff) sends exactly one handoff message, one request, and one reply', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const tracker = createConsumedHandoffTracker();
      const handoff = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 2 issues.');
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });

      expect(await screen.findByText('Handoff acknowledged.')).toBeInTheDocument();
      expect(screen.getAllByText(handoff.prompt)).toHaveLength(1);
      expect(screen.getAllByText('Handoff acknowledged.')).toHaveLength(1);
      expect(requestAICommand).toHaveBeenCalledTimes(1);
    });

    it('React StrictMode double-invoking the mount effect still sends exactly one request', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const onApplyAction = vi.fn().mockReturnValue(true);
      const onApplyDocumentSettingAction = vi.fn().mockResolvedValue(true);
      const onApplyRepairAction = vi.fn().mockReturnValue(true);
      const tracker = createConsumedHandoffTracker();
      const handoff = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 2 issues.');

      render(
        <AIEngineerPanel
          documentId={1}
          editorMode="ai"
          platform="generic"
          width={700}
          selectedModule={null}
          selectedColumn={null}
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
          aiEngineerHandoff={handoff}
          onConsumeAiEngineerHandoff={tracker.tryConsume}
        />,
        { wrapper: StrictMode },
      );

      expect(await screen.findByText('Handoff acknowledged.')).toBeInTheDocument();
      expect(screen.getAllByText(handoff.prompt)).toHaveLength(1);
      expect(requestAICommand).toHaveBeenCalledTimes(1);
    });

    it('unmounting and remounting with the SAME still-pending handoff (tab switch before the parent cleared it) does not resend', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const tracker = createConsumedHandoffTracker();
      const handoff = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 2 issues.');

      const first = renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await screen.findByText('Handoff acknowledged.');
      expect(requestAICommand).toHaveBeenCalledTimes(1);
      first.unmount();

      // Same tracker instance (the real owner never unmounts on a tab
      // switch), same handoff object — simulates Validate -> AI Engineer
      // -> Validate -> AI Engineer without another Review click.
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });
      // Give any errant effect a tick to fire before asserting it didn't.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requestAICommand).toHaveBeenCalledTimes(1);
    });

    it('a re-render with the same handoff object does not resend', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const tracker = createConsumedHandoffTracker();
      const handoff = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 2 issues.');
      const onApplyAction = vi.fn().mockReturnValue(true);
      const onApplyDocumentSettingAction = vi.fn().mockResolvedValue(true);
      const onApplyRepairAction = vi.fn().mockReturnValue(true);

      const ui = (
        <AIEngineerPanel
          documentId={1}
          editorMode="ai"
          platform="generic"
          width={700}
          selectedModule={null}
          selectedColumn={null}
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
          aiEngineerHandoff={handoff}
          onConsumeAiEngineerHandoff={tracker.tryConsume}
        />
      );
      const { rerender } = render(ui);
      await screen.findByText('Handoff acknowledged.');
      expect(requestAICommand).toHaveBeenCalledTimes(1);

      rerender(ui);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requestAICommand).toHaveBeenCalledTimes(1);
    });

    it('clicking Review a second intentional time (a new handoff, new id) sends exactly one new request/message pair', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const tracker = createConsumedHandoffTracker();
      const handoffA = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 2 issues.');
      const handoffB = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 3 issues.');
      expect(handoffA.id).not.toBe(handoffB.id);

      const first = renderPanel({ aiEngineerHandoff: handoffA, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await screen.findByText(handoffA.prompt);
      expect(requestAICommand).toHaveBeenCalledTimes(1);
      first.unmount();

      renderPanel({ aiEngineerHandoff: handoffB, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await screen.findByText(handoffB.prompt);
      expect(requestAICommand).toHaveBeenCalledTimes(2);
    });

    it('existing multi-turn history remains intact across a handoff', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const tracker = createConsumedHandoffTracker();
      const first = renderPanel();
      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText('Handoff acknowledged.');
      first.unmount();

      const handoff = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 2 issues.');
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });

      expect(await screen.findByText(handoff.prompt)).toBeInTheDocument();
      expect(screen.getByText('add a button')).toBeInTheDocument();
    });

    it('a handoff created for a DIFFERENT document is never consumed here', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const tracker = createConsumedHandoffTracker();
      const handoff = createAIEngineerHandoff(999, 'Review and, where safe, propose fixes for these 2 issues.');
      renderPanel({ documentId: 1, aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requestAICommand).not.toHaveBeenCalled();
      expect(screen.queryByText(handoff.prompt)).not.toBeInTheDocument();
      // The id was never consumed, so the SAME handoff could still be
      // honored by the document it actually belongs to.
      expect(tracker.tryConsume(handoff.id)).toBe(true);
    });

    it('Clear Conversation empties the transcript and does not replay the just-consumed handoff', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(handoffResponse());
      const tracker = createConsumedHandoffTracker();
      const handoff = createAIEngineerHandoff(1, 'Review and, where safe, propose fixes for these 2 issues.');
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await screen.findByText('Handoff acknowledged.');
      expect(requestAICommand).toHaveBeenCalledTimes(1);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Clear conversation' }));

      expect(screen.queryByText(handoff.prompt)).not.toBeInTheDocument();
      expect(screen.queryByText('Handoff acknowledged.')).not.toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requestAICommand).toHaveBeenCalledTimes(1);
    });
  });

  // R4-B — Import Review's "Review reconstruction with AI Engineer" handoff.
  // Same one-shot id-based idempotency mechanism as the Validation describe
  // block above, but the first turn is seeded DIRECTLY from
  // formatReconstructionReviewMessage(reconstructionReview) with NO backend
  // /ai-command/ call — see §2 ("never a JSON/technical dump") and §4
  // ("deterministic facts have priority over AI judgement") of the R4-B spec.
  describe('AI Engineer handoff (Import Reconstruction -> AI Engineer, no backend call for first turn)', () => {
    function sampleReview(variant: 'repairable' | 'approximation' = 'repairable') {
      const html = variant === 'repairable'
        ? '<table><tr><td><p style="font-weight:bold;">Bold via CSS</p></td></tr></table>'
        : '<table><tr><td width="380">A</td><td width="620">B</td></tr></table>';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const structure = analyzeImportedHtml(doc, 700);
      const mapping = mapImportedHtml(doc);
      const fidelity = buildFidelityReport(doc, structure, mapping);
      return buildReconstructionReview(doc, structure, fidelity, mapping.modules);
    }

    function sampleImportContext() {
      const html = '<table><tr><td><p>Hello</p></td></tr></table>';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const structure = analyzeImportedHtml(doc, 700);
      const mapping = mapImportedHtml(doc);
      const fidelity = buildFidelityReport(doc, structure, mapping);
      return buildImportReconstructionContext(structure, fidelity, mapping.modules.length);
    }

    it('one click seeds exactly one deterministic user+assistant message pair, with no backend request', async () => {
      mockSpeech();
      const review = sampleReview();
      const expectedMessage = formatReconstructionReviewMessage(review);
      const tracker = createConsumedHandoffTracker();
      const handoff = createImportReconstructionHandoff(1, review, sampleImportContext());
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });

      expect(await findByMessageText(expectedMessage)).toBeInTheDocument();
      expect(screen.getAllByText(handoff.prompt)).toHaveLength(1);
      expect(requestAICommand).not.toHaveBeenCalled();
    });

    it('React StrictMode double-invoking the mount effect still seeds exactly one message pair', async () => {
      mockSpeech();
      const review = sampleReview();
      const expectedMessage = formatReconstructionReviewMessage(review);
      const tracker = createConsumedHandoffTracker();
      const handoff = createImportReconstructionHandoff(1, review, sampleImportContext());
      const onApplyAction = vi.fn().mockReturnValue(true);
      const onApplyDocumentSettingAction = vi.fn().mockResolvedValue(true);
      const onApplyRepairAction = vi.fn().mockReturnValue(true);

      render(
        <AIEngineerPanel
          documentId={1}
          editorMode="ai"
          platform="generic"
          width={700}
          selectedModule={null}
          selectedColumn={null}
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
          aiEngineerHandoff={handoff}
          onConsumeAiEngineerHandoff={tracker.tryConsume}
        />,
        { wrapper: StrictMode },
      );

      expect(await findByMessageText(expectedMessage)).toBeInTheDocument();
      expect(screen.getAllByText(handoff.prompt)).toHaveLength(1);
      expect(requestAICommand).not.toHaveBeenCalled();
    });

    it('unmounting and remounting with the SAME still-pending handoff does not resend', async () => {
      mockSpeech();
      const review = sampleReview();
      const expectedMessage = formatReconstructionReviewMessage(review);
      const tracker = createConsumedHandoffTracker();
      const handoff = createImportReconstructionHandoff(1, review, sampleImportContext());

      const first = renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await findByMessageText(expectedMessage);
      first.unmount();

      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.getAllByText(handoff.prompt)).toHaveLength(1);
      expect(requestAICommand).not.toHaveBeenCalled();
    });

    it('clicking Review a second intentional time (a new handoff, new id) seeds a new message pair', async () => {
      mockSpeech();
      const reviewA = sampleReview('repairable');
      const reviewB = sampleReview('approximation');
      const tracker = createConsumedHandoffTracker();
      const handoffA = createImportReconstructionHandoff(1, reviewA, sampleImportContext());
      const handoffB = createImportReconstructionHandoff(1, reviewB, sampleImportContext());
      expect(handoffA.id).not.toBe(handoffB.id);

      const first = renderPanel({ aiEngineerHandoff: handoffA, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await findByMessageText(formatReconstructionReviewMessage(reviewA));
      first.unmount();

      renderPanel({ aiEngineerHandoff: handoffB, onConsumeAiEngineerHandoff: tracker.tryConsume });
      expect(await findByMessageText(formatReconstructionReviewMessage(reviewB))).toBeInTheDocument();
      expect(requestAICommand).not.toHaveBeenCalled();
    });

    it('a handoff created for a DIFFERENT document is never consumed here', () => {
      mockSpeech();
      const review = sampleReview();
      const tracker = createConsumedHandoffTracker();
      const handoff = createImportReconstructionHandoff(999, review, sampleImportContext());
      renderPanel({ documentId: 1, aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });

      expect(screen.queryByText(handoff.prompt)).not.toBeInTheDocument();
      expect(requestAICommand).not.toHaveBeenCalled();
    });

    it('existing multi-turn history remains intact across an import-reconstruction handoff', async () => {
      mockSpeech();
      vi.mocked(requestAICommand).mockResolvedValue(response({ reply: 'Sure, added.' }));
      const { unmount } = renderPanel();
      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      // Waits for the proposal card's own title, not the reply text —
      // INSERT_MODULE also echoes 'Sure, added.' into the proposal detail,
      // so getByText('Sure, added.') here would ambiguously match twice.
      await screen.findByText('Add a button module');
      unmount();

      const review = sampleReview();
      const tracker = createConsumedHandoffTracker();
      const handoff = createImportReconstructionHandoff(1, review, sampleImportContext());
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });

      expect(await findByMessageText(formatReconstructionReviewMessage(review))).toBeInTheDocument();
      expect(screen.getByText('add a button')).toBeInTheDocument();
      expect(screen.getByText('Sure, added.')).toBeInTheDocument();
    });

    // §4/§12 — "deterministic facts have priority over AI judgement": the
    // classification embedded in the seeded first turn comes straight from
    // buildReconstructionReview() (pure, non-AI code) and is never mutated
    // by anything a later backend AI reply says. A follow-up turn appends
    // new messages; it can never rewrite or contradict the already-shown
    // classification text.
    it('a follow-up AI reply can never rewrite the deterministic classification already shown', async () => {
      mockSpeech();
      const review = sampleReview();
      const seededMessage = formatReconstructionReviewMessage(review);
      const tracker = createConsumedHandoffTracker();
      const handoff = createImportReconstructionHandoff(1, review, sampleImportContext());
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });
      expect(await findByMessageText(seededMessage)).toBeInTheDocument();
      expect(requestAICommand).not.toHaveBeenCalled();

      // A follow-up question ("why was spacing normalized?") DOES call the
      // backend — only the seeded first turn skips it — and the AI's free-
      // text reply is deliberately worded as if it disagreed with the
      // deterministic classification.
      vi.mocked(requestAICommand).mockResolvedValue(response({
        reply: 'Actually, nothing was normalized at all.',
        action: { type: 'NONE' },
      }));
      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText(/Type your command/), 'why was spacing normalized?');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      await screen.findByText('Actually, nothing was normalized at all.');
      // The original deterministic classification message is still present,
      // verbatim — the follow-up only appended new turns, it never edited
      // or replaced it.
      expect(await findByMessageText(seededMessage)).toBeInTheDocument();
      expect(requestAICommand).toHaveBeenCalledTimes(1);
    });

    // R4-B2 §12 — closes the exact gap R4-B's own live QA found: a
    // follow-up question after the seeded first turn must actually carry
    // the bounded import-reconstruction context on the backend request,
    // not just the first (never-sent-to-backend) turn.
    it('a follow-up question sends the SAME import_reconstruction context on the request, not just the seeded first turn', async () => {
      mockSpeech();
      const review = sampleReview();
      const importContext = sampleImportContext();
      const tracker = createConsumedHandoffTracker();
      const handoff = createImportReconstructionHandoff(1, review, importContext);
      renderPanel({ aiEngineerHandoff: handoff, onConsumeAiEngineerHandoff: tracker.tryConsume });
      await findByMessageText(formatReconstructionReviewMessage(review));
      expect(requestAICommand).not.toHaveBeenCalled();

      vi.mocked(requestAICommand).mockResolvedValue(response({
        reply: 'The ratio was approximated because...', action: { type: 'NONE' },
      }));
      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText(/Type your command/), 'why was the ratio approximated?');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText('The ratio was approximated because...');

      expect(requestAICommand).toHaveBeenCalledTimes(1);
      const sentPayload = vi.mocked(requestAICommand).mock.calls[0][0];
      expect(sentPayload.import_reconstruction).toEqual(importContext);
    });
  });
});

// R4-B2 §24 — "Local AI" status badge: subtle, shown only when the
// provider that ACTUALLY answered was 'local', never for 'openai' or
// 'deterministic', and never carrying model/runtime details (those
// belong in admin/settings diagnostics per the spec, not this view).
describe('AIEngineerPanel — R4-B2 Local AI status badge', () => {
  it('is absent before any response has been received', () => {
    mockSpeech();
    renderPanel();
    expect(screen.queryByText('Local AI • Private')).not.toBeInTheDocument();
  });

  it('appears after a response answered by the local provider', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({ provider: 'local' }));
    renderPanel();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Local AI • Private')).toBeInTheDocument();
  });

  it('does not appear after a response answered by the OpenAI or deterministic provider', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({ provider: 'openai' }));
    renderPanel();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Add a button module');
    expect(screen.queryByText('Local AI • Private')).not.toBeInTheDocument();
  });

  it('clears when switching to a different document', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response({ provider: 'local' }));
    const { rerender } = render(
      <AIEngineerPanel
        documentId={1}
        editorMode="ai"
        platform="generic"
        width={700}
        selectedModule={null}
        selectedColumn={null}
        content={{ version: 1, modules: [] }}
        emailTitle="Test Email"
        emailSubject="Test subject"
        faviconUrl=""
        resetCssEnabled
        customCssEnabled={false}
        customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={vi.fn().mockReturnValue(true)}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Local AI • Private');

    rerender(
      <AIEngineerPanel
        documentId={2}
        editorMode="ai"
        platform="generic"
        width={700}
        selectedModule={null}
        selectedColumn={null}
        content={{ version: 1, modules: [] }}
        emailTitle="Test Email"
        emailSubject="Test subject"
        faviconUrl=""
        resetCssEnabled
        customCssEnabled={false}
        customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={vi.fn().mockReturnValue(true)}
      />,
    );
    expect(screen.queryByText('Local AI • Private')).not.toBeInTheDocument();
  });
});

// R4-B3 §B — Referential Context Resolver, wired into AIEngineerPanel's
// handleSend as a pre-pass. Integration-level: proves the resolver
// actually intercepts/grounds real messages sent through the panel, not
// just the pure-function unit tests in referenceResolver.test.ts.
describe('AIEngineerPanel — R4-B3 Referential Context Resolver integration', () => {
  it('a genuinely ambiguous reference (2 buttons, nothing selected) is answered locally, with no backend call', async () => {
    mockSpeech();
    const buttonA = createModule('button', 1);
    const buttonB = createModule('button', 2);
    renderPanel({ selectedModule: null, content: { version: 1, modules: [buttonA, buttonB] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'make that button green');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/There are 2 button modules/)).toBeInTheDocument();
    expect(requestAICommand).not.toHaveBeenCalled();
  });

  it('an unambiguous reference (the only button in the document, nothing selected) is resolved and sent as selected_module', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    const onlyButton = createModule('button', 1);
    const text = createModule('text', 2);
    renderPanel({ selectedModule: null, content: { version: 1, modules: [text, onlyButton] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'make that button green');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Add a button module');
    expect(requestAICommand).toHaveBeenCalledWith(expect.objectContaining({
      selected_module: { type: 'button', props: onlyButton.props },
    }));
  });

  it('the live canvas selection always wins over a resolved override', async () => {
    mockSpeech();
    vi.mocked(requestAICommand).mockResolvedValue(response());
    const selected = createModule('button', 1);
    const otherButton = createModule('button', 2);
    renderPanel({ selectedModule: selected, content: { version: 1, modules: [selected, otherButton] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'make this button green');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Add a button module');
    expect(requestAICommand).toHaveBeenCalledWith(expect.objectContaining({
      selected_module: { type: 'button', props: selected.props },
    }));
  });

  it('switching documents clears the resolver\'s stale referent memory (no leakage across documents)', async () => {
    mockSpeech();
    // action: NONE for the first turn — never leaves a pending
    // proposal card behind (a separate, pre-existing, non-R4-B3 concern:
    // `pending` is not itself cleared by the documentId-change effect)
    // so this test stays focused on the resolver's own referent memory.
    vi.mocked(requestAICommand).mockResolvedValue(response({ reply: 'noted', action: { type: 'NONE' } }));
    const button = createModule('button', 1);
    const { rerender } = render(
      <AIEngineerPanel
        documentId={1}
        editorMode="ai"
        platform="generic"
        width={700}
        selectedModule={button}
        selectedColumn={null}
        content={{ version: 1, modules: [button] }}
        emailTitle="Test Email"
        emailSubject="Test subject"
        faviconUrl=""
        resetCssEnabled
        customCssEnabled={false}
        customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={vi.fn().mockReturnValue(true)}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'make this button green');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('noted');
    vi.mocked(requestAICommand).mockClear();

    // Switch to a different document with NOTHING selected and no
    // matching module — a stale "lastReferent"/override from document 1
    // must never leak into document 2's requests.
    rerender(
      <AIEngineerPanel
        documentId={2}
        editorMode="ai"
        platform="generic"
        width={700}
        selectedModule={null}
        selectedColumn={null}
        content={{ version: 1, modules: [] }}
        emailTitle="Other Email"
        emailSubject="Other subject"
        faviconUrl=""
        resetCssEnabled
        customCssEnabled={false}
        customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={vi.fn().mockReturnValue(true)}
      />,
    );
    vi.mocked(requestAICommand).mockResolvedValue(response({ reply: 'ok', action: { type: 'NONE' } }));
    await user.type(screen.getByPlaceholderText(/Type your command/), 'change it to blue');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('ok');
    expect(requestAICommand).toHaveBeenCalledWith(expect.objectContaining({ selected_module: null }));
  });
});

describe('AIEngineerPanel — R4-B4 Closure §B/§C copy-source integration', () => {
  it('a resolved copy-source request sends the ALREADY-READ value as copy_source, and the returned proposal applies normally', async () => {
    mockSpeech();
    const previous = createModule('text', 1);
    previous.settings = { ...previous.settings, desktop: { paddingTop: 30, paddingRight: 30, paddingBottom: 30, paddingLeft: 30 } };
    const target = createModule('button', 2);
    vi.mocked(requestAICommand).mockResolvedValue(response({
      reply: "I will match the selected button module's padding to the previous section. Please confirm.",
      action: {
        type: 'UPDATE_MODULE_SETTINGS', target: 'selected', module_type: 'button',
        patch: { desktop: { paddingTop: 30, paddingRight: 30, paddingBottom: 30, paddingLeft: 30 } },
      },
    }));
    const { onApplyAction } = renderPanel({ selectedModule: target, content: { version: 1, modules: [previous, target] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'use the same padding as the previous section');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText("Update the selected button module's settings (desktop)");
    expect(requestAICommand).toHaveBeenCalledWith(expect.objectContaining({
      copy_source: {
        property: 'padding',
        value: { paddingTop: 30, paddingRight: 30, paddingBottom: 30, paddingLeft: 30 },
        source_label: expect.stringContaining('the previous section'),
      },
    }));

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyAction).toHaveBeenCalledWith(
      { type: 'UPDATE_MODULE_SETTINGS', target: 'selected', module_type: 'button', patch: { desktop: { paddingTop: 30, paddingRight: 30, paddingBottom: 30, paddingLeft: 30 } } },
      target.id,
    );
  });

  it('an honestly-declined copy-source request (no column-level alignment capability) never calls the backend and never mutates', async () => {
    mockSpeech();
    const { onApplyAction } = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'make this column use the same alignment as column 1');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Columns don't have their own alignment setting/)).toBeInTheDocument();
    expect(requestAICommand).not.toHaveBeenCalled();
    expect(onApplyAction).not.toHaveBeenCalled();
    // No proposal card is shown for a locally-declined request — there is
    // nothing to Apply or Cancel.
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('a copy-source request with no target selected is declined locally, not sent to the backend', async () => {
    mockSpeech();
    const previous = createModule('text', 1);
    renderPanel({ selectedModule: null, content: { version: 1, modules: [previous] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'use the same padding as the previous section');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Select the module you want to update first/)).toBeInTheDocument();
    expect(requestAICommand).not.toHaveBeenCalled();
  });
});

describe('AIEngineerPanel — R4-C reconstruction repair integration', () => {
  // A single button whose source alignment/padding is known (align:
  // right, 40px horizontal / 20px vertical) — matches
  // reconstructionReview.test.ts's own established fixture shape.
  const RECON_HTML = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:20px 40px 20px 40px;">Go</a></td></tr></table>';

  function driftedButton() {
    const button = createModule('button', 0);
    Object.assign(button.props as Record<string, unknown>, { align: 'left', paddingHorizontal: 8, href: 'https://example.com/go', text: 'Go' });
    return button;
  }

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('"fix everything you safely can" proposes the drifted button\'s alignment+padding, plus the always-present Outlook-fallback candidate, as ONE reconstruction repair batch', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const button = driftedButton();
    renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/safely repairable difference/)).toBeInTheDocument();
    expect(requestAICommand).not.toHaveBeenCalled(); // detection is entirely local/deterministic
    expect(screen.getByText(/Repair 3 issues/)).toBeInTheDocument();
  });

  it('Apply commits the reconstruction batch in one history step and updates the persisted pass counter', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const button = driftedButton();
    const { onApplyRepairAction } = renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApplyRepairAction).toHaveBeenCalledTimes(1);
    const items = onApplyRepairAction.mock.calls[0][0];
    expect(items).toHaveLength(3);
    // R4-C12 live-QA regression guard: the announced score must be the
    // TRUE post-apply value (98 — fixing all 3 candidates here improves
    // the score from 83, but the button's own text/content was never
    // part of these 3 candidates, so one category honestly stays short
    // of fully preserved), never the STALE pre-apply score (83 — what
    // the bug this guards against would have announced). Caught live:
    // onApplyRepairAction here is a mock that never actually re-renders
    // `content` with the applied changes, so this also proves the fix
    // works via the pure projection function
    // (projectModulesWithCandidates) rather than depending on a
    // re-render that — in this test, and in the one real tick right
    // after a real Apply — has not happened yet.
    expect(await screen.findByText('Reconstruction fidelity is now 98/100. Ask me to "fix everything you can" again if you\'d like me to check for more.')).toBeInTheDocument();

    const session = loadReconstructionSession(1);
    expect(session?.passesUsed).toBe(1);
    expect(session?.lastFidelityScore).toBe(98);
  });

  it('Cancel never advances the persisted pass counter', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const button = driftedButton();
    renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Cancelled. Nothing was changed.')).toBeInTheDocument();
    expect(loadReconstructionSession(1)?.passesUsed).toBe(0);
  });

  it('a category-scoped command ("fix the images") only proposes candidates from that category', async () => {
    mockSpeech();
    const imageHtml = '<table><tr><td><img src="https://example.com/hero.png" alt="Hero" width="500"></td></tr></table>';
    storeReconstructionSession({ documentId: 1, sourceHtml: imageHtml, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const image = createModule('image', 0);
    // src and alt already match the source — only width should differ,
    // keeping this test to exactly one candidate (image:width).
    Object.assign(image.props as Record<string, unknown>, { src: 'https://example.com/hero.png', alt: 'Hero' });
    renderPanel({ documentId: 1, content: { version: 1, modules: [image] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix the images');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Repair 1 issue\b/)).toBeInTheDocument();
  });

  it('reports the pass-budget-exhausted limit honestly instead of proposing another pass', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 3, lastFidelityScore: 90 });
    const button = driftedButton();
    renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/limit for automatic repair passes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Repair \d+ issue/ })).toBeNull();
  });

  it('without an active reconstruction session, a reconstruction-only phrase is never intercepted locally — it reaches the normal backend command path', async () => {
    mockSpeech();
    // No storeReconstructionSession call — this documentId has no
    // session, so reconstructionSessionRef.current is null and the
    // whole reconstruction-repair branch is skipped entirely. "use the
    // original spacing" deliberately contains neither "fix" nor "repair"
    // (aiDocumentIntelligence.ts's own patterns are keyed on those two
    // words), so — unlike "fix everything you can" — nothing else in
    // this component's local-intent chain claims it either; if the
    // reconstruction gate were broken (e.g. always-on instead of
    // session-gated), this exact phrase would be answered locally
    // instead of reaching the backend, catching that regression as the
    // "no session -> local matcher never activates" test the OTHER
    // tests in this block can't isolate on their own.
    vi.mocked(requestAICommand).mockResolvedValue(response({ reply: 'ok', action: { type: 'NONE' } }));
    renderPanel({ documentId: 999 });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'use the original spacing');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('ok');
    expect(requestAICommand).toHaveBeenCalledTimes(1);
  });

  it('R4-C11 cross-document isolation: a reconstruction session seeded for document 1 never leaks into document 2', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    // Deliberately NOT seeding a session for document 2.
    const button = driftedButton();
    const { rerender } = render(
      <AIEngineerPanel
        documentId={1} editorMode="ai" platform="generic" width={700}
        selectedModule={null} selectedColumn={null}
        content={{ version: 1, modules: [button] }}
        emailTitle="Doc 1" emailSubject="Subject" faviconUrl=""
        resetCssEnabled customCssEnabled={false} customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={vi.fn().mockReturnValue(true)}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/); // document 1's session is active
    // Resolve the pending proposal before switching documents — a
    // pending proposal (whether from document 1 or 2) blocks handleSend
    // entirely (see its own `|| pendingRepair) return` guard), which is
    // a separate, pre-existing, non-R4-C concern this test intentionally
    // avoids conflating with the actual thing under test here (session
    // isolation), matching the "switching documents clears the
    // resolver's stale referent memory" test's own established
    // precedent above.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByText('Cancelled. Nothing was changed.');

    // Switch to document 2 — no reconstruction session was ever stored
    // for it, so the SAME phrase must reach the normal backend path,
    // never a stale reconstruction batch from document 1.
    vi.mocked(requestAICommand).mockResolvedValue(response({ reply: 'ok', action: { type: 'NONE' } }));
    rerender(
      <AIEngineerPanel
        documentId={2} editorMode="ai" platform="generic" width={700}
        selectedModule={null} selectedColumn={null}
        content={{ version: 1, modules: [] }}
        emailTitle="Doc 2" emailSubject="Subject" faviconUrl=""
        resetCssEnabled customCssEnabled={false} customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={vi.fn().mockReturnValue(true)}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Type your command/), 'use the original spacing');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('ok');
    expect(requestAICommand).toHaveBeenCalledTimes(1);

    // And document 1's own session survives untouched in storage.
    expect(loadReconstructionSession(1)?.sourceHtml).toBe(RECON_HTML);
    expect(loadReconstructionSession(2)).toBeNull();
  });
});

describe('AIEngineerPanel — R4-C closure hardening: no auto-triggered repair loop', () => {
  const RECON_HTML = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:20px 40px 20px 40px;">Go</a></td></tr></table>';

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('rendering a panel with an active reconstruction session never shows a pending repair proposal on its own — only Original/Reconstructed, never Proposed, until the user sends a command', () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const button = createModule('button', 0);
    Object.assign(button.props as Record<string, unknown>, { align: 'left', href: 'https://example.com/go', text: 'Go' });
    renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });

    expect(screen.queryByRole('button', { name: /Repair \d+ issue/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Proposed Improvement' })).toBeNull();
    expect(requestAICommand).not.toHaveBeenCalled();
  });

  it('a reconstruction handoff\'s own opening message is a plain-text summary, never a repair proposal — appendMessage only, no setPendingRepair path reachable from the handoff effect', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const doc = new DOMParser().parseFromString(RECON_HTML, 'text/html');
    const structure = analyzeImportedHtml(doc, 600);
    const mapping = mapImportedHtml(doc);
    const fidelity = buildFidelityReport(doc, structure, mapping);
    const review = buildReconstructionReview(doc, structure, fidelity, mapping.modules);
    const importReconstructionContext = buildImportReconstructionContext(structure, fidelity, mapping.modules.length);
    const handoff = createImportReconstructionHandoff(1, review, importReconstructionContext);

    renderPanel({ documentId: 1, aiEngineerHandoff: handoff, content: { version: 1, modules: mapping.modules } });

    await screen.findByText(handoff.prompt);
    expect(screen.queryByRole('button', { name: /Repair \d+ issue/ })).toBeNull();
    expect(requestAICommand).not.toHaveBeenCalled();
  });

  // R4-C closure hardening — "no repair loop starts automatically...
  // merely from render/remount/navigation." The mount-only version of
  // this already exists above; this proves the SAME thing survives an
  // actual unmount + fresh remount (e.g. switching editor tabs and back,
  // or React re-mounting the panel on a key change) — never just the
  // very first mount of the test.
  it('unmounting and remounting a panel with an active reconstruction session still never auto-starts a repair proposal', () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const button = createModule('button', 0);
    Object.assign(button.props as Record<string, unknown>, { align: 'left', href: 'https://example.com/go', text: 'Go' });

    const { unmount } = renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    expect(screen.queryByRole('button', { name: /Repair \d+ issue/ })).toBeNull();
    unmount();

    renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    expect(screen.queryByRole('button', { name: /Repair \d+ issue/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Proposed Improvement' })).toBeNull();
    expect(requestAICommand).not.toHaveBeenCalled();
  });

  // R4-C closure hardening — "pass-budget/session state survives AI
  // Engineer unmount/remount." Uses the REAL sessionStorage-backed
  // session (reconstructionSessionStorage.ts), never a mock: seeds a
  // session already AT the pass budget (passesUsed === MAX_RECONSTRUCTION_
  // PASSES), unmounts, remounts fresh (a genuinely new component
  // instance reading reconstructionSessionRef.current =
  // loadReconstructionSession(...) on its own initial render), then
  // proves the ALREADY-USED pass count was never silently reset by
  // asking for one more repair pass — the panel must correctly decline
  // with the budget-exhausted message, exactly as it would if the
  // session had never been unmounted at all. (If remounting reset the
  // counter to 0, this would instead show a normal "Repair N issues"
  // proposal.)
  it('the reconstruction pass counter survives an unmount + fresh remount — not reset to 0 by remounting', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: MAX_RECONSTRUCTION_PASSES, lastFidelityScore: 70 });
    const button = createModule('button', 0);
    Object.assign(button.props as Record<string, unknown>, { align: 'left', href: 'https://example.com/go', text: 'Go' });

    const { unmount } = renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    unmount();

    renderPanel({ documentId: 1, content: { version: 1, modules: [button] } });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(new RegExp(`already run ${MAX_RECONSTRUCTION_PASSES} reconstruction correction passes`))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Repair \d+ issue/ })).toBeNull();
    expect(loadReconstructionSession(1)?.passesUsed).toBe(MAX_RECONSTRUCTION_PASSES);
  });
});

describe('AIEngineerPanel — R4-C6 Original/Reconstructed/Proposed comparison', () => {
  const RECON_HTML = '<table><tr><td align="right"><a href="https://example.com/go" style="background-color:#76c043;color:#fff;padding:20px 40px 20px 40px;">Go</a></td></tr></table>';

  function driftedButton() {
    const button = createModule('button', 0);
    Object.assign(button.props as Record<string, unknown>, { align: 'left', paddingHorizontal: 8, href: 'https://example.com/go', text: 'Go' });
    return button;
  }

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('the comparison panel never appears at all for an ordinary (non-reconstruction) document', () => {
    mockSpeech();
    renderPanel({ documentId: 999 }); // no storeReconstructionSession call
    expect(screen.queryByRole('button', { name: /Original \/ Reconstructed/ })).toBeNull();
  });

  it('Original and Reconstructed are available as soon as a reconstruction session exists, with no pending proposal', () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    renderPanel({ documentId: 1, content: { version: 1, modules: [driftedButton()] } });

    // Expanded by default.
    expect(screen.getByRole('tab', { name: 'Original' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reconstructed' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Proposed Improvement' })).toBeNull();
    expect(screen.getByText(/Hide Original \/ Reconstructed comparison/)).toBeInTheDocument();
  });

  it('Proposed Improvement becomes available while a reconstruction repair proposal is pending, at the SAME document width as the other panes', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    renderPanel({ documentId: 1, width: 600, content: { version: 1, modules: [driftedButton()] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);

    expect(screen.getByRole('tab', { name: 'Proposed Improvement' })).toBeInTheDocument();
    expect(screen.getByText(/Hide Original \/ Reconstructed \/ Proposed Improvement comparison/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Compare' }));
    expect(screen.getByText(/^Original imported HTML \(600px\)/)).toBeInTheDocument();
    expect(screen.getByText(/^Builder reconstruction \(600px\)/)).toBeInTheDocument();
    expect(screen.getByText(/^Proposed Improvement \(600px\)/)).toBeInTheDocument();
  });

  it('the Proposed pane never mutates the real document — Reconstructed still reflects the UN-repaired state while the proposal is only pending', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    renderPanel({ documentId: 1, width: 600, content: { version: 1, modules: [driftedButton()] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);
    await user.click(screen.getByRole('tab', { name: 'Compare' }));

    const reconstructedIframe = screen.getByTitle('Reconstructed builder preview') as HTMLIFrameElement;
    const proposedIframe = screen.getByTitle('Proposed improvement preview') as HTMLIFrameElement;
    // The drifted button is left-aligned in the real (unapplied)
    // reconstruction, right-aligned only in the pure-projection preview
    // — proves the projection never leaked into what Reconstructed shows.
    expect(reconstructedIframe.srcdoc).toContain('text-align:left');
    expect(proposedIframe.srcdoc).toContain('text-align:right');
    expect(reconstructedIframe.srcdoc).not.toBe(proposedIframe.srcdoc);
  });

  it('Proposed Improvement disappears when the proposal is Cancelled', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    renderPanel({ documentId: 1, content: { version: 1, modules: [driftedButton()] } });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);
    expect(screen.getByRole('tab', { name: 'Proposed Improvement' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByText('Cancelled. Nothing was changed.');

    expect(screen.queryByRole('tab', { name: 'Proposed Improvement' })).toBeNull();
    // Original/Reconstructed remain available — only Proposed disappears.
    expect(screen.getByRole('tab', { name: 'Reconstructed' })).toBeInTheDocument();
  });

  it('Proposed Improvement disappears after Apply, and Reconstructed becomes the new (post-apply) baseline', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const button = driftedButton();
    const onApplyRepairAction = vi.fn((items: RepairActionItem[]) => {
      // Simulate the real parent mutator: apply the patches into a NEW
      // module and hand it back as the next `content` prop, the same
      // way EmailBuilderWorkspacePage -> useEmailBuilderState really
      // does — proving the projected preview and the REAL post-apply
      // reconstruction converge, not just that the proposal disappears.
      for (const item of items) {
        if (item.kind === 'module') Object.assign(button.props as Record<string, unknown>, item.propPatch);
        if (item.kind === 'module-settings') Object.assign(button.settings, item.settingsPatch);
      }
      return true;
    });
    const { rerender } = render(
      <AIEngineerPanel
        documentId={1} editorMode="ai" platform="generic" width={600}
        selectedModule={null} selectedColumn={null}
        content={{ version: 1, modules: [button] }}
        emailTitle="Recon" emailSubject="Subject" faviconUrl=""
        resetCssEnabled customCssEnabled={false} customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={onApplyRepairAction}
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Reconstruction fidelity is now/);

    expect(screen.queryByRole('tab', { name: 'Proposed Improvement' })).toBeNull();

    // Re-render with the mutated module (what the real parent would
    // pass down on its next render) — Reconstructed now reflects it.
    rerender(
      <AIEngineerPanel
        documentId={1} editorMode="ai" platform="generic" width={600}
        selectedModule={null} selectedColumn={null}
        content={{ version: 1, modules: [button] }}
        emailTitle="Recon" emailSubject="Subject" faviconUrl=""
        resetCssEnabled customCssEnabled={false} customCss=""
        onApplyAction={vi.fn().mockReturnValue(true)}
        onApplyDocumentSettingAction={vi.fn().mockResolvedValue(true)}
        onApplyRepairAction={onApplyRepairAction}
      />,
    );
    const reconstructedIframe = screen.getByTitle('Reconstructed builder preview') as HTMLIFrameElement;
    expect(reconstructedIframe.srcdoc).toContain('text-align:right');
  });

  // R4-C closure hardening — "stale Proposed Improvement after Undo/Redo."
  // reconstructionProjection (AIEngineerPanel.tsx) is a useMemo keyed on
  // `content.modules` among its other deps — it is recomputed from
  // scratch on every render, never cached across a content change. If
  // the user Undoes/Redoes something ELSEWHERE while a reconstruction
  // proposal is still pending, the NEXT render must show a preview
  // derived from the NEW content, never the one frozen at the moment
  // the proposal was created. This proves that end to end: rerender
  // with a content prop an Undo could plausibly have produced (the
  // drifted button's own align field reverted to match the source
  // ALREADY, by something other than this proposal), and check the
  // Proposed pane reflects THAT starting point, not the original one.
  it('the Proposed Improvement preview re-derives from the CURRENT document if it changes while the proposal is pending (Undo/Redo elsewhere never leaves a stale preview)', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const button = driftedButton();
    const baseProps = {
      documentId: 1, editorMode: 'ai' as const, platform: 'generic' as const, width: 600,
      selectedModule: null, selectedColumn: null,
      emailTitle: 'Recon', emailSubject: 'Subject', faviconUrl: '',
      resetCssEnabled: true, customCssEnabled: false, customCss: '',
      onApplyAction: vi.fn().mockReturnValue(true),
      onApplyDocumentSettingAction: vi.fn().mockResolvedValue(true),
      onApplyRepairAction: vi.fn().mockReturnValue(true),
    };
    const { rerender } = render(<AIEngineerPanel {...baseProps} content={{ version: 1, modules: [button] }} />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);
    await user.click(screen.getByRole('tab', { name: 'Compare' }));
    expect((screen.getByTitle('Proposed improvement preview') as HTMLIFrameElement).srcdoc).toContain('text-align:right');

    // Simulate an Undo elsewhere: the button's own delete (target of the
    // pending batch disappears from the tree entirely) — never once
    // going through this proposal's own Apply/Cancel path.
    rerender(<AIEngineerPanel {...baseProps} content={{ version: 1, modules: [] }} />);

    // The proposal card itself may still be showing (this component
    // never auto-cancels on an unrelated content change — that would be
    // its own surprising behavior) but the preview MUST reflect reality:
    // no button exists to preview a fix for, so the projected HTML must
    // not still show the OLD (stale) right-aligned button markup.
    const proposedIframeAfter = screen.getByTitle('Proposed improvement preview') as HTMLIFrameElement;
    expect(proposedIframeAfter.srcdoc).not.toContain('text-align:right');
  });

  // R4-C closure hardening — "projected reconstruction never entering
  // persistence/history before Apply." The Proposed pane existing (and
  // being actively compared/viewed) must never itself call any real
  // mutator — only an explicit Apply click may. Spies on BOTH mutator
  // props the panel can call; neither may fire merely from a pending
  // reconstruction proposal being generated and displayed.
  it('a pending reconstruction proposal and its Proposed Improvement preview never call any real apply/mutation path on their own', async () => {
    mockSpeech();
    storeReconstructionSession({ documentId: 1, sourceHtml: RECON_HTML, documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    const { onApplyAction, onApplyRepairAction, onApplyDocumentSettingAction } = renderPanel({
      documentId: 1, width: 600, content: { version: 1, modules: [driftedButton()] },
    });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Type your command/), 'fix everything you safely can');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Repair 3 issues/);
    await user.click(screen.getByRole('tab', { name: 'Compare' }));
    expect(screen.getByTitle('Proposed improvement preview')).toBeInTheDocument();

    expect(onApplyAction).not.toHaveBeenCalled();
    expect(onApplyRepairAction).not.toHaveBeenCalled();
    expect(onApplyDocumentSettingAction).not.toHaveBeenCalled();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YuktiExplanationPanel } from './YuktiExplanationPanel';
import type { ValidationIssue, YuktiExplainResponse } from '../types/landingpages';

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function batchResult(overrides: Partial<YuktiExplainResponse> = {}): YuktiExplainResponse {
  return {
    counts: { errors: 9, warnings: 4, info: 0 },
    language_breakdown: [
      { language: 'html', errors: 6, warnings: 2, info: 0 },
      { language: 'css', errors: 3, warnings: 2, info: 0 },
    ],
    truncated: false,
    summary: 'I found 9 errors and 4 warnings.',
    most_important: [{ issue_id: 1, reason: 'It affects the whole document.' }],
    why_it_matters: 'Browsers may render the page unpredictably.',
    how_to_fix: 'Apply the recommended correction for each issue.',
    recommended_order: 'Fix structural issues first.',
    per_issue: [],
    ...overrides,
  };
}

function issueResult(overrides: Partial<YuktiExplainResponse> = {}): YuktiExplainResponse {
  return {
    counts: { errors: 0, warnings: 1, info: 0 },
    language_breakdown: [],
    truncated: false,
    summary: '',
    most_important: [],
    why_it_matters: '',
    how_to_fix: '',
    recommended_order: '',
    per_issue: [{
      issue_id: 2, what: 'The image has no alt text.', why: 'Screen readers cannot describe it.',
      impact: 'Users relying on assistive technology miss the content.', recommended_correction: 'Add a descriptive alt attribute.',
      fix_method: 'ai-assisted', requires_decision: true,
    }],
    ...overrides,
  };
}

const ISSUE: ValidationIssue = {
  id: 2, fingerprint: 'fp', severity: 'warning', category: 'accessibility', rule_id: 'missing-alt',
  message: 'Image is missing an alt attribute.', file: 'html', language: 'html', line: 5, column: 1,
  suggestion: '', auto_fixable: false, risk: 'low',
};

describe('YuktiExplanationPanel', () => {
  let speak: ReturnType<typeof vi.fn>;
  let cancelSpeech: ReturnType<typeof vi.fn>;
  let pauseSpeech: ReturnType<typeof vi.fn>;
  let resumeSpeech: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    speak = vi.fn((utterance: FakeUtterance) => {
      utterance.onstart?.();
    });
    cancelSpeech = vi.fn();
    pauseSpeech = vi.fn();
    resumeSpeech = vi.fn();
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: cancelSpeech,
      speak,
      pause: pauseSpeech,
      resume: resumeSpeech,
      getVoices: vi.fn().mockReturnValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    render(
      <YuktiExplanationPanel
        open={false} mode="batch" loading={false} error={null} result={null} onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a loading state', () => {
    render(
      <YuktiExplanationPanel open mode="batch" loading error={null} result={null} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Yukti is preparing an explanation…')).toBeInTheDocument();
  });

  it('shows an error state', () => {
    render(
      <YuktiExplanationPanel
        open mode="batch" loading={false} error={{ message: 'Something went wrong.' }} result={null} onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });

  it('shows the batch summary, language breakdown, and sections', () => {
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('I found 9 errors and 4 warnings.')).toBeInTheDocument();
    expect(screen.getByText(/HTML:/)).toBeInTheDocument();
    expect(screen.getByText(/CSS:/)).toBeInTheDocument();
    expect(screen.getByText('It affects the whole document.')).toBeInTheDocument();
    expect(screen.getByText('Browsers may render the page unpredictably.')).toBeInTheDocument();
    expect(screen.getByText('Apply the recommended correction for each issue.')).toBeInTheDocument();
    expect(screen.getByText('Fix structural issues first.')).toBeInTheDocument();
  });

  it('respects the current validation scope — omits language breakdown when the response has none', () => {
    render(
      <YuktiExplanationPanel
        open mode="batch" loading={false} error={null}
        result={batchResult({ language_breakdown: [] })} onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Issues by Area')).not.toBeInTheDocument();
  });

  it('shows the single-issue explanation with fix method and decision notice', () => {
    render(
      <YuktiExplanationPanel
        open mode="issue" issue={ISSUE} loading={false} error={null} result={issueResult()} onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('The image has no alt text.')).toBeInTheDocument();
    expect(screen.getByText('Screen readers cannot describe it.')).toBeInTheDocument();
    expect(screen.getByText('Users relying on assistive technology miss the content.')).toBeInTheDocument();
    expect(screen.getByText('Add a descriptive alt attribute.')).toBeInTheDocument();
    expect(screen.getByText('Fix method: AI-assisted')).toBeInTheDocument();
    expect(screen.getByText('You will need to review and choose to apply this fix.')).toBeInTheDocument();
  });

  it('does not render an AI Fix This Issue button — explanation and fixing stay separate', () => {
    render(
      <YuktiExplanationPanel
        open mode="issue" issue={ISSUE} loading={false} error={null} result={issueResult()} onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'AI Fix This Issue' })).not.toBeInTheDocument();
  });

  it('never auto-plays audio — no speak() call just from opening with a result', () => {
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    expect(speak).not.toHaveBeenCalled();
  });

  it('shows the audio opt-in prompt, not the player, before any explicit action', () => {
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Would you like me to explain these issues aloud?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause Yukti explanation' })).not.toBeInTheDocument();
  });

  it('Play Audio Explanation requires an explicit click before speak() is called', async () => {
    const user = userEvent.setup();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Play Audio Explanation/ }));
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('the full text transcript remains visible after starting audio', async () => {
    const user = userEvent.setup();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Play Audio Explanation/ }));
    expect(screen.getByText('I found 9 errors and 4 warnings.')).toBeInTheDocument();
    expect(screen.getByText('Browsers may render the page unpredictably.')).toBeInTheDocument();
  });

  it('shows Pause once speaking, and Pause calls the hook pause', async () => {
    const user = userEvent.setup();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Play Audio Explanation/ }));
    const pauseButton = await screen.findByRole('button', { name: 'Pause Yukti explanation' });
    await user.click(pauseButton);
    expect(pauseSpeech).toHaveBeenCalled();
  });

  it('Stop cancels speech and returns to the audio opt-in prompt', async () => {
    const user = userEvent.setup();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Play Audio Explanation/ }));
    await user.click(screen.getByRole('button', { name: 'Stop Yukti explanation' }));
    expect(cancelSpeech).toHaveBeenCalled();
    expect(screen.getByText('Would you like me to explain these issues aloud?')).toBeInTheDocument();
  });

  it('Replay calls speak again', async () => {
    const user = userEvent.setup();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Play Audio Explanation/ }));
    await user.click(screen.getByRole('button', { name: 'Replay Yukti explanation' }));
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('offers accessible speed options', async () => {
    const user = userEvent.setup();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Play Audio Explanation/ }));
    expect(screen.getByRole('button', { name: '0.75×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1.25×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1.5×' })).toBeInTheDocument();
  });

  it('cancels any in-flight speech when the panel closes', () => {
    const { rerender } = render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    rerender(
      <YuktiExplanationPanel open={false} mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    expect(cancelSpeech).toHaveBeenCalled();
  });

  it('Close calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={onClose} />,
    );
    await user.click(screen.getByRole('button', { name: "Close Yukti's explanation" }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={onClose} />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus to the Close button when opened, without stealing focus elsewhere on the page', () => {
    render(
      <YuktiExplanationPanel open mode="batch" loading={false} error={null} result={batchResult()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: "Close Yukti's explanation" })).toHaveFocus();
  });
});

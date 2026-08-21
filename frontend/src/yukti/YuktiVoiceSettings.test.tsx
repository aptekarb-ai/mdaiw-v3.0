import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YuktiVoiceSettings } from './YuktiVoiceSettings';
import { useYukti } from '../hooks/useYukti';

vi.mock('../hooks/useYukti', () => ({
  useYukti: vi.fn(),
}));

function fakeVoice(overrides: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return {
    voiceURI: 'voice-1',
    name: 'Test Voice',
    lang: 'en-IN',
    default: false,
    localService: true,
    ...overrides,
  } as SpeechSynthesisVoice;
}

function mockYukti(overrides: Partial<ReturnType<typeof useYukti>> = {}) {
  const base = {
    voices: [fakeVoice()],
    selectedVoiceURI: null,
    setVoiceURI: vi.fn(),
    language: 'en-IN',
    setLanguage: vi.fn(),
    rate: 0.95,
    setRate: vi.fn(),
    previewVoice: vi.fn(),
    speechOutputSupported: true,
    ...overrides,
  } as unknown as ReturnType<typeof useYukti>;
  vi.mocked(useYukti).mockReturnValue(base);
  return base;
}

describe('YuktiVoiceSettings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows an unsupported message and no controls when speech output is unsupported', () => {
    mockYukti({ speechOutputSupported: false });
    render(<YuktiVoiceSettings />);
    expect(screen.getByText(/not supported in this browser/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Spoken language')).not.toBeInTheDocument();
  });

  it('changing the language calls setLanguage', async () => {
    const mocked = mockYukti();
    const user = userEvent.setup();
    render(<YuktiVoiceSettings />);

    await user.selectOptions(screen.getByLabelText('Spoken language'), 'hi-IN');
    expect(mocked.setLanguage).toHaveBeenCalledWith('hi-IN');
  });

  it('selecting a voice calls setVoiceURI', async () => {
    const mocked = mockYukti({
      voices: [fakeVoice({ voiceURI: 'a', name: 'Voice A' }), fakeVoice({ voiceURI: 'b', name: 'Voice B' })],
    });
    const user = userEvent.setup();
    render(<YuktiVoiceSettings />);

    const select = screen.getByLabelText('Voice') as HTMLSelectElement;
    await user.selectOptions(select, 'b');
    expect(mocked.setVoiceURI).toHaveBeenCalledWith('b');
  });

  it('clicking Preview voice calls previewVoice', async () => {
    const mocked = mockYukti();
    const user = userEvent.setup();
    render(<YuktiVoiceSettings />);

    await user.click(screen.getByRole('button', { name: 'Preview voice' }));
    expect(mocked.previewVoice).toHaveBeenCalled();
  });

  it('adjusting the rate slider calls setRate', () => {
    const mocked = mockYukti();
    render(<YuktiVoiceSettings />);

    const slider = screen.getByLabelText(/Speech rate/) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1.2' } });

    expect(mocked.setRate).toHaveBeenCalledWith(1.2);
  });

  it('welcome checkbox defaults to checked and toggling persists the preference', async () => {
    mockYukti();
    const user = userEvent.setup();
    render(<YuktiVoiceSettings />);

    const checkbox = screen.getByRole('checkbox', {
      name: 'Speak a welcome message when I open the app',
    });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(window.localStorage.getItem('yukti_welcome_enabled')).toBe('false');
  });

  it('shows a helpful hint when no voices have been reported yet', () => {
    mockYukti({ voices: [] });
    render(<YuktiVoiceSettings />);
    expect(screen.getByText(/has not reported any voices yet/)).toBeInTheDocument();
  });
});

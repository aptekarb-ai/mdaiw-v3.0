import { createContext } from 'react';
import type { YuktiAction, YuktiMessage } from '../types/yukti';

export interface YuktiActionHandlers {
  onFillField?: (field: string, value: string) => void;
  onFocusField?: (field: string) => void;
  onGoToStep?: (step: number) => void;
  onReadErrors?: () => string[];
}

export interface YuktiPendingConfirmation {
  action: YuktiAction;
  spokenResponse: string;
}

export interface YuktiContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  messages: YuktiMessage[];
  sendMessage: (text: string) => Promise<void>;
  isProcessing: boolean;
  clearMessages: () => void;
  pendingConfirmation: YuktiPendingConfirmation | null;
  confirmPendingAction: () => void;
  cancelPendingAction: () => void;
  registerActionHandlers: (handlers: YuktiActionHandlers) => () => void;
  setRegistrationStep: (step: number | null) => void;
  micStatus: string;
  transcript: string;
  micError: string | null;
  startListening: () => void;
  stopListening: () => void;
  speechStatus: string;
  muted: boolean;
  toggleMuted: () => void;
  stopSpeaking: () => void;
  voiceSupported: boolean;
  speechOutputSupported: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string | null;
  setVoiceURI: (voiceURI: string | null) => void;
  language: string;
  setLanguage: (language: string) => void;
  rate: number;
  setRate: (rate: number) => void;
  previewVoice: (sampleText?: string) => void;
}

export const YuktiContext = createContext<YuktiContextValue | undefined>(undefined);

import type { EmailStartType } from './types';

export interface StartTypeOption {
  value: EmailStartType;
  label: string;
  description: string;
  // mdaiw-icon suffix (see public/assets/mdaiw/css/mdaiw-icons.css).
  icon: string;
  // Feature 02 implements Blank Email end-to-end; Phase B (Template
  // Experience), Phase C (Import HTML), and Phase D (AI Generate) each
  // implement their option by handing off to their own shared picker/
  // import/generate page (see CreateEmailPage's handleSubmit) — no
  // second engine lives inside this wizard for any of them.
  available: boolean;
}

export const START_TYPE_OPTIONS: StartTypeOption[] = [
  { value: 'blank', label: 'Blank Email', description: 'Start from scratch', icon: 'file', available: true },
  {
    value: 'template', label: 'Template', description: 'Choose a starter template',
    icon: 'landing-page', available: true,
  },
  {
    value: 'html', label: 'Existing HTML', description: 'Import your existing email',
    icon: 'edit', available: true,
  },
  {
    value: 'ai', label: 'AI Generate', description: 'Generate an email with AI',
    icon: 'ai-assistants', available: true,
  },
];

export const DEFAULT_START_TYPE: EmailStartType = 'blank';

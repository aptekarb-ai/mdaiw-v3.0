import type { EmailStartType } from './types';

export interface StartTypeOption {
  value: EmailStartType;
  label: string;
  description: string;
  // mdaiw-icon suffix (see public/assets/mdaiw/css/mdaiw-icons.css).
  icon: string;
  // Feature 02 implements Blank Email end-to-end; Phase B (Template
  // Experience) implements Template by handing off to the shared
  // /email-builder/templates picker (see CreateEmailPage's handleSubmit) —
  // no second template engine lives inside this wizard. HTML/AI remain
  // not selectable yet — no route exists for them to navigate to.
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
    icon: 'edit', available: false,
  },
  {
    value: 'ai', label: 'AI Generate', description: 'Generate an email with AI',
    icon: 'ai-assistants', available: false,
  },
];

export const DEFAULT_START_TYPE: EmailStartType = 'blank';

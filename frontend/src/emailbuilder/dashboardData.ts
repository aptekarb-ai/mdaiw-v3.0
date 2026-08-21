import type { GettingStartedStep, QuickActionDefinition } from './types';

export const QUICK_ACTIONS: QuickActionDefinition[] = [
  { key: 'create', icon: 'file', title: 'Create New Email', description: 'Start from scratch' },
  { key: 'template', icon: 'landing-page', title: 'Choose Template', description: 'Browse starter templates' },
  { key: 'import', icon: 'upload', title: 'Import HTML', description: 'Import an existing email' },
  {
    key: 'ai-generate',
    icon: 'ai-assistants',
    title: 'AI Generate Email',
    description: 'Describe it and let AI generate it',
  },
];

export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  { step: 1, title: 'Create or import an email' },
  { step: 2, title: 'Add modules' },
  { step: 3, title: 'Edit content and design' },
  { step: 4, title: 'Preview across devices and clients' },
  { step: 5, title: 'Validate compatibility' },
  { step: 6, title: 'Export and deploy' },
];

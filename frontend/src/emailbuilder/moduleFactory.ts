import type { EmailModule, EmailModuleType } from './edm';
import { getModuleDefinition } from './moduleRegistry';

let counter = 0;

// Stable, unique-enough ids without pulling in a uuid dependency —
// crypto.randomUUID() where available (all modern browsers, and jsdom in
// recent Node), a monotonic counter fallback otherwise.
export function generateModuleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  counter += 1;
  return `module-${Date.now()}-${counter}`;
}

export function createModule(type: EmailModuleType, order: number): EmailModule {
  const definition = getModuleDefinition(type);
  return {
    id: generateModuleId(),
    type,
    order,
    props: definition.createDefaultProps(),
    settings: definition.createDefaultSettings(),
  };
}

export function cloneModuleWithNewId(module: EmailModule, order: number): EmailModule {
  return {
    ...module,
    id: generateModuleId(),
    order,
    props: { ...module.props },
    settings: { ...module.settings },
  };
}

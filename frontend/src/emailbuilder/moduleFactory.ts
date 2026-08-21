import type { EmailModule, EmailModuleType } from './edm';
import { getModuleDefinition } from './moduleRegistry';
import { normalizeModule } from './edmMigration';
import type { SavedEmailModule } from './types';

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

// Feature 04 — insert a Saved Module. Unlike createModule() (fresh
// default props from the registry), this clones the saved instance's own
// captured props/settings — only the EDM instance id is fresh, so two
// insertions of the same saved module never collide. Normalized on the
// way in too — a module saved before the Desktop/Mobile + outer-spacing
// architecture must upgrade cleanly, same as loading an old document.
export function createModuleFromSaved(saved: SavedEmailModule, order: number): EmailModule {
  const normalized = normalizeModule({
    id: '',
    type: saved.module_type as EmailModuleType,
    order,
    props: { ...saved.props },
    settings: { ...saved.settings },
  });
  return { ...normalized, id: generateModuleId(), order };
}

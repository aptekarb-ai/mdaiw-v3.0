import type { EmailModule, EmailModuleType } from './edm';
import { getModuleDefinition } from './moduleRegistry';
import { normalizeModule } from './edmMigration';
import { generateId } from './idGenerator';
import { cloneColumnsWithNewIds } from './layoutModel';
import type { SavedEmailModule } from './types';

export { generateId as generateModuleId } from './idGenerator';

export function createModule(type: EmailModuleType, order: number): EmailModule {
  const definition = getModuleDefinition(type);
  const columns = definition.createDefaultColumns?.();
  return {
    id: generateId(),
    type,
    order,
    props: definition.createDefaultProps(),
    settings: definition.createDefaultSettings(),
    ...(columns ? { columns } : {}),
  };
}

// Deep-clones a module for duplication — instruction 36: "Duplicating a
// layout must deep-clone: layout ID, column IDs, all nested module IDs.
// Every cloned identifier must be fresh." A module with no columns (the
// overwhelming majority) clones exactly as before Feature 05.
export function cloneModuleWithNewId(module: EmailModule, order: number): EmailModule {
  return {
    ...module,
    id: generateId(),
    order,
    props: { ...module.props },
    settings: { ...module.settings },
    ...(module.columns ? { columns: cloneColumnsWithNewIds(module.columns, cloneModuleWithNewId) } : {}),
  };
}

// Feature 04 — insert a Saved Module. Unlike createModule() (fresh
// default props from the registry), this clones the saved instance's own
// captured props/settings — only the EDM instance id is fresh, so two
// insertions of the same saved module never collide. Normalized on the
// way in too — a module saved before the Desktop/Mobile + outer-spacing
// architecture must upgrade cleanly, same as loading an old document.
// Feature 05 — a saved Layout module's columns/nested modules deep-clone
// with entirely fresh column + nested-module ids (instruction 35: "Do NOT
// share child IDs between instances"), exactly like duplicating a layout.
export function createModuleFromSaved(saved: SavedEmailModule, order: number): EmailModule {
  const normalized = normalizeModule({
    id: '',
    type: saved.module_type as EmailModuleType,
    order,
    props: { ...saved.props },
    settings: { ...saved.settings },
    columns: saved.columns,
  });
  return {
    ...normalized,
    id: generateId(),
    order,
    ...(normalized.columns ? { columns: cloneColumnsWithNewIds(normalized.columns, cloneModuleWithNewId) } : {}),
  };
}

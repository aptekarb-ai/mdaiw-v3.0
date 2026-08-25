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

// Sub-phase 7 / Phase D (AI Generate Email) — the one shape an AI
// COMPOSE_EMAIL response's items are converted into: one top-level
// module (optionally with nested column children and/or seeded
// repeatable items) built from an already-validated composition entry.
export interface ComposedModuleEntry {
  type: EmailModuleType;
  patch: Record<string, unknown>;
  // One group per column index — only meaningful when `type` is a layout
  // module type. Each child is flat (never itself nested further), same
  // one-level-of-nesting constraint INSERT_NESTED_MODULE already enforces.
  children?: { columnIndex: number; modules: { type: EmailModuleType; patch: Record<string, unknown> }[] }[];
  // Seeds a module's own repeatableField (e.g. social-icon-row's platform
  // links) — only meaningful when `type` actually has one; silently
  // ignored (not applied) otherwise, exactly like every other composition
  // capability that only applies where the module registry supports it.
  repeatableItems?: Record<string, unknown>[];
}

// Phase D — extracted from useEmailBuilderState.ts's former private
// `buildComposedModule` closure (verbatim logic, now a plain pure
// function with no hook dependency) so it is callable from BOTH the
// in-builder AI Engineer (an already-mounted useEmailBuilderState
// instance, via addComposedModules below) AND the pre-document AI
// Generate Email flow (no builder mounted yet — see
// duplicateEmailDocument.ts's createEmailDocumentFromAI). Reuses the
// EXACT SAME createModule/createDefaultColumns/repeatableField
// primitives every other insert path already uses — never a second
// module-construction system.
export function buildComposedModule(entry: ComposedModuleEntry, order: number): EmailModule {
  const created = createModule(entry.type, order);
  let module = Object.keys(entry.patch).length ? { ...created, props: { ...created.props, ...entry.patch } } : created;

  if (entry.children && entry.children.length > 0 && module.columns) {
    const columns = module.columns.map((column, columnIndex) => {
      const group = entry.children!.find((g) => g.columnIndex === columnIndex);
      if (!group) return column;
      const nestedModules = group.modules.map((child, childIndex) => {
        const createdChild = createModule(child.type, childIndex);
        return Object.keys(child.patch).length
          ? { ...createdChild, props: { ...createdChild.props, ...child.patch } }
          : createdChild;
      });
      return { ...column, modules: nestedModules };
    });
    module = { ...module, columns };
  }

  if (entry.repeatableItems && entry.repeatableItems.length > 0) {
    const definition = getModuleDefinition(entry.type);
    const repeatable = definition.repeatableField;
    if (repeatable) {
      const bounded = entry.repeatableItems.slice(0, repeatable.maxItems ?? 20);
      const items = bounded.map((item) => ({ ...repeatable.createItem(), ...item }));
      if (items.length >= (repeatable.minItems ?? 0)) {
        module = { ...module, props: { ...module.props, [repeatable.path]: items } };
      }
    }
  }

  return module;
}

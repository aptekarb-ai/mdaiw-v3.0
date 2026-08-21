// Leaf module (zero local imports) — stable, unique-enough ids without a
// uuid dependency. Both moduleFactory.ts (top-level/nested module ids)
// and layoutModel.ts (column ids) depend on this; keeping it dependency-
// free avoids a moduleFactory <-> layoutModel import cycle (moduleFactory
// already depends on moduleRegistry, which layoutModel must never import).
let counter = 0;

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  counter += 1;
  return `id-${Date.now()}-${counter}`;
}

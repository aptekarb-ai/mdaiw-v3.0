import { describe, expect, it } from 'vitest';
import { buildModuleCapabilityManifest } from './moduleCapabilities';
import generatedManifest from '../../../shared/module-capabilities.generated.json';

// Feature 14 V2 — Phase A drift check. Builds the manifest LIVE from the
// current registry and diffs it against the committed
// shared/module-capabilities.generated.json. If a catalog file changes
// (a module type/label/editableFields/valueType edit) without running
// `npm run generate:module-capabilities`, this fails — the ONLY
// enforcement mechanism keeping the committed artifact from silently
// going stale relative to the real registry.
describe('moduleCapabilities — manifest drift check', () => {
  it('the committed generated manifest exactly matches what the live registry produces right now', () => {
    const live = buildModuleCapabilityManifest();
    expect(live).toEqual(generatedManifest);
  });

  it('covers all 53 registered module types', () => {
    const live = buildModuleCapabilityManifest();
    expect(live.moduleCount).toBe(53);
    expect(live.modules).toHaveLength(53);
  });

  it('every layout-* type has isLayout true and an empty editableFields array', () => {
    const live = buildModuleCapabilityManifest();
    const layoutModules = live.modules.filter((m) => m.type.startsWith('layout-'));
    expect(layoutModules).toHaveLength(10);
    for (const module of layoutModules) {
      expect(module.isLayout).toBe(true);
      expect(module.editableFields).toEqual([]);
    }
  });

  it('every field the manifest calls image_asset was hand-tagged, not inferred', () => {
    const live = buildModuleCapabilityManifest();
    const imageField = live.modules.find((m) => m.type === 'image')!.editableFields.find((f) => f.key === 'src');
    expect(imageField?.valueType).toBe('image_asset');
    const heroField = live.modules.find((m) => m.type === 'hero-image-cta')!.editableFields.find((f) => f.key === 'imageSrc');
    expect(heroField?.valueType).toBe('image_asset');
  });

  it('output is deterministically sorted by type (stable diffs across regenerations)', () => {
    const live = buildModuleCapabilityManifest();
    const types = live.modules.map((m) => m.type);
    const sorted = [...types].sort((a, b) => a.localeCompare(b));
    expect(types).toEqual(sorted);
  });
});

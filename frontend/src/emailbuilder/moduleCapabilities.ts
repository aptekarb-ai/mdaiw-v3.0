// Feature 14 V2 — Phase A. The Email AI Engineer's module-capability
// manifest, built ENTIRELY from moduleRegistry.tsx (the one source of
// truth — see registryCore.tsx's SchemaField docstring). This function is
// consumed two ways:
//   1. scripts/generateModuleCapabilities.ts calls it to write the
//      committed shared/module-capabilities.generated.json artifact the
//      Python backend reads.
//   2. moduleCapabilities.test.ts calls it AGAIN at test time and diffs
//      the result against that same committed JSON — if a catalog file
//      changes without regenerating, the test fails. This is the drift
//      check; there is no other mechanism enforcing manifest freshness.
//
// Only safe, JSON-serializable metadata is included — no functions
// (createDefaultProps/renderPreview/renderEmailHtml never leave the
// frontend), matching the module docstring's "safe metadata needed by
// AI" requirement.
import { getAllModuleDefinitions } from './moduleRegistry';
import type { EmailModuleType, ModuleCategory } from './edm';
import type { SchemaField, SchemaFieldValueType } from './registryCore';
import { isLayoutModuleType } from './layoutModel';

export const MODULE_CAPABILITY_MANIFEST_VERSION = 1;

export interface ModuleCapabilityField {
  key: string;
  label: string;
  valueType: SchemaFieldValueType;
  group: 'content' | 'style';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export interface ModuleCapability {
  type: EmailModuleType;
  label: string;
  category: ModuleCategory;
  // True for the 10 layout-family types (layout-1col, layout-2col-*,
  // etc.) — see layoutModel.ts::isLayoutModuleType. Layout modules carry
  // no flat AI-editable scalar prop (editableFields is always [] for
  // them); their one prop, columnWidths, is an array edited through the
  // dedicated Column Widths editor, deliberately out of Phase A's scope
  // (see editableFields: [] comment in catalog/layoutCatalog.tsx).
  isLayout: boolean;
  columnCount: number | null;
  editableFields: ModuleCapabilityField[];
  // True when the module has a repeatable list field (nav links, product
  // items, social platform links, feature/icon-text rows). Feature 14 V2
  // Phase A deliberately does NOT expose item-level editing through
  // editableFields for these — see the approved Phase A decision to defer
  // composite/repeatable-field AI editing rather than approximate it.
  hasRepeatableField: boolean;
}

export interface ModuleCapabilityManifest {
  version: number;
  generatedFrom: string;
  moduleCount: number;
  modules: ModuleCapability[];
}

// kind -> valueType fallback for any SchemaField that doesn't set
// `valueType` explicitly. Every 'url' field EXCEPT the ones hand-tagged
// `valueType: 'image_asset'` in the catalog files infers to plain 'url'
// here — deliberately, since inferring 'image_asset' from the field key
// or kind would be exactly the fragile name-based guessing the Phase A
// plan rejected. If a future catalog field is a real image URL, it MUST
// be tagged explicitly at the source, not detected here.
const KIND_TO_VALUE_TYPE: Record<SchemaField['kind'], SchemaFieldValueType> = {
  text: 'text',
  textarea: 'text',
  url: 'url',
  color: 'color',
  number: 'number',
  select: 'select',
  align: 'align',
  toggle: 'boolean',
  font: 'font',
};

export function inferValueType(kind: SchemaField['kind']): SchemaFieldValueType {
  return KIND_TO_VALUE_TYPE[kind];
}

function toCapabilityField(field: SchemaField): ModuleCapabilityField {
  const capabilityField: ModuleCapabilityField = {
    key: field.key,
    label: field.label,
    valueType: field.valueType ?? inferValueType(field.kind),
    group: field.group,
  };
  if (field.options) capabilityField.options = field.options;
  if (field.min !== undefined) capabilityField.min = field.min;
  if (field.max !== undefined) capabilityField.max = field.max;
  return capabilityField;
}

// Sorted by type — deterministic output regardless of catalog import
// order, so the committed JSON and any future regeneration produce a
// byte-stable diff (or none, when nothing actually changed).
export function buildModuleCapabilityManifest(): ModuleCapabilityManifest {
  const modules: ModuleCapability[] = getAllModuleDefinitions()
    .map((definition) => ({
      type: definition.type,
      label: definition.label,
      category: definition.category,
      isLayout: isLayoutModuleType(definition.type),
      columnCount: definition.columnCount,
      editableFields: (definition.editableFields ?? []).map(toCapabilityField),
      hasRepeatableField: Boolean(definition.repeatableField),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));

  return {
    version: MODULE_CAPABILITY_MANIFEST_VERSION,
    generatedFrom: 'frontend/src/emailbuilder/moduleRegistry.tsx',
    moduleCount: modules.length,
    modules,
  };
}

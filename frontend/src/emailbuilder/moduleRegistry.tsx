// The module registry aggregates every built-in module family into one
// lookup table. Each family's definitions/render logic live in
// ./catalog/*.tsx — this file only merges them and exposes the public
// API (MODULE_REGISTRY / MODULE_PANEL_ORDER / getModuleDefinition) that
// the rest of the builder (canvas, properties panel, module panel,
// renderer, factory) already depends on. Feature 04's module library
// adds hundreds more entries by adding to a catalog file — it never
// needs to touch the canvas/renderer/properties-panel code itself.
import type { EmailModuleType } from './edm';
import type { AnyModuleDefinition } from './registryCore';
import { BASIC_DEFINITIONS, BASIC_TYPES_ORDER } from './catalog/basicCatalog';
import { LAYOUT_DEFINITIONS, LAYOUT_TYPES_ORDER } from './catalog/layoutCatalog';
import { HEADER_DEFINITIONS, HEADER_TYPES_ORDER } from './catalog/headerCatalog';
import { HERO_DEFINITIONS, HERO_TYPES_ORDER } from './catalog/heroCatalog';
import { CONTENT_DEFINITIONS, CONTENT_TYPES_ORDER } from './catalog/contentCatalog';
import { PRODUCT_DEFINITIONS, PRODUCT_TYPES_ORDER } from './catalog/productCatalog';
import { CTA_DEFINITIONS, CTA_TYPES_ORDER } from './catalog/ctaCatalog';
import { SOCIAL_DEFINITIONS, SOCIAL_TYPES_ORDER } from './catalog/socialCatalog';
import { FOOTER_DEFINITIONS, FOOTER_TYPES_ORDER } from './catalog/footerCatalog';

export type { ModuleDefinition, AnyModuleDefinition, ModuleImagePosition, ModulePlatform, SchemaField } from './registryCore';

const ALL_DEFINITIONS: AnyModuleDefinition[] = [
  ...LAYOUT_DEFINITIONS,
  ...HEADER_DEFINITIONS,
  ...HERO_DEFINITIONS,
  ...CONTENT_DEFINITIONS,
  ...PRODUCT_DEFINITIONS,
  ...CTA_DEFINITIONS,
  ...SOCIAL_DEFINITIONS,
  ...FOOTER_DEFINITIONS,
  ...BASIC_DEFINITIONS,
];

export const MODULE_REGISTRY: Record<EmailModuleType, AnyModuleDefinition> = Object.fromEntries(
  ALL_DEFINITIONS.map((definition) => [definition.type, definition]),
) as Record<EmailModuleType, AnyModuleDefinition>;

// Curated browse order — layout structure first, then the content
// families roughly in the order a builder reaches for them, utility
// modules (divider/spacer/basic image/button/text) last.
export const MODULE_PANEL_ORDER: EmailModuleType[] = [
  ...LAYOUT_TYPES_ORDER,
  ...HEADER_TYPES_ORDER,
  ...HERO_TYPES_ORDER,
  ...CONTENT_TYPES_ORDER,
  ...PRODUCT_TYPES_ORDER,
  ...CTA_TYPES_ORDER,
  ...SOCIAL_TYPES_ORDER,
  ...FOOTER_TYPES_ORDER,
  ...BASIC_TYPES_ORDER,
];

export function getModuleDefinition(type: EmailModuleType): AnyModuleDefinition {
  return MODULE_REGISTRY[type];
}

export function getAllModuleDefinitions(): AnyModuleDefinition[] {
  return ALL_DEFINITIONS;
}

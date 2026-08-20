import type { ModuleCategory } from './edm';

// Every category the eventual Feature 04 Module Library ships (per the
// reference PNG/spec) is listed here now so the left panel's structure
// doesn't change shape later — only categories with modules today
// (layout/content/images/cta) render anything under them.
export const MODULE_CATEGORIES: { key: ModuleCategory; label: string }[] = [
  { key: 'layout', label: 'Layout' },
  { key: 'header', label: 'Header' },
  { key: 'hero', label: 'Hero' },
  { key: 'content', label: 'Content' },
  { key: 'images', label: 'Images' },
  { key: 'products', label: 'Products' },
  { key: 'cta', label: 'CTA' },
  { key: 'social', label: 'Social' },
  { key: 'footer', label: 'Footer' },
];

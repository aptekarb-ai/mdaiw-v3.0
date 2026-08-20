// The Email Document Model (EDM) — a structured, versioned module tree.
// Never raw DOM/HTML. This is the single persisted shape
// (EmailDocument.content on the backend); the table-first HTML renderer
// (htmlRenderer.ts) is a pure function OF this data, never stored itself.

export type EmailModuleType =
  | 'layout-1col'
  | 'layout-2col-50-50'
  | 'layout-2col-40-60'
  | 'layout-2col-60-40'
  | 'layout-3col'
  | 'text'
  | 'image'
  | 'image-text'
  | 'text-image'
  | 'button'
  | 'divider'
  | 'spacer';

export type ModuleCategory = 'layout' | 'header' | 'hero' | 'content' | 'images' | 'products' | 'cta' | 'social' | 'footer';

export type HorizontalAlign = 'left' | 'center' | 'right';

export interface ModulePadding {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}

export const DEFAULT_PADDING: ModulePadding = {
  paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
};

export const ZERO_PADDING: ModulePadding = {
  paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
};

export const MIN_PADDING = 0;
export const MAX_PADDING = 200;

export interface EmailModuleSettings extends ModulePadding {
  // Composite (image-text/text-image) modules only — which side leads on
  // a narrow/mobile client. Full responsive editing is Feature 07; this
  // just carries the intent so that feature has somewhere to read it from.
  mobileOrder?: 'image-first' | 'content-first';
}

export interface EmailModule<Props = Record<string, unknown>> {
  id: string;
  type: EmailModuleType;
  order: number;
  props: Props;
  settings: EmailModuleSettings;
}

export interface EmailDocumentContent {
  version: 1;
  modules: EmailModule[];
}

export function createEmptyContent(): EmailDocumentContent {
  return { version: 1, modules: [] };
}

// --- Per-module prop shapes --------------------------------------------

export interface TextModuleProps {
  text: string;
  align: HorizontalAlign;
  fontSize: number;
  fontWeight: 400 | 700;
  color: string;
  lineHeight: number;
}

export interface ImageModuleProps {
  src: string;
  alt: string;
  width: number;
  align: HorizontalAlign;
  href: string;
}

export interface ButtonModuleProps {
  text: string;
  href: string;
  align: HorizontalAlign;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  borderRadius: number;
}

export interface LayoutModuleProps {
  // Percentages, one per column — visual/structural only in Feature 03.
  // Nested per-column content lands with Feature 05 (Layout Builder).
  columnWidths: number[];
}

export interface CompositeModuleProps {
  image: Pick<ImageModuleProps, 'src' | 'alt' | 'width'>;
  text: Pick<TextModuleProps, 'text' | 'align'>;
}

export interface DividerModuleProps {
  color: string;
  thickness: number;
}

export interface SpacerModuleProps {
  height: number;
}

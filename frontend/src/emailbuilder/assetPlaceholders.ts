import type { EmailAssetCategory } from './types';

// Feature 08, operation 9 ("use placeholder assets") — built-in, non-
// persisted picks available in the Asset Manager without uploading or
// linking anything first. Real static files (not data: URIs) — a
// data: src would fail edm.py's unsafe-URL-scheme check the moment the
// document tries to save.
export interface AssetPlaceholder {
  id: string;
  name: string;
  category: EmailAssetCategory;
  url: string;
  alt_text: string;
}

export const ASSET_PLACEHOLDERS: AssetPlaceholder[] = [
  {
    id: 'placeholder-image',
    name: 'Placeholder image',
    category: 'image',
    url: '/assets/mdaiw/images/email-image-placeholder.svg',
    alt_text: 'Placeholder image',
  },
  {
    id: 'placeholder-logo',
    name: 'Placeholder logo',
    category: 'logo',
    url: '/assets/mdaiw/images/email-logo-placeholder.svg',
    alt_text: 'Placeholder logo',
  },
  {
    id: 'placeholder-icon',
    name: 'Placeholder icon',
    category: 'icon',
    url: '/assets/mdaiw/images/email-icon-placeholder.svg',
    alt_text: 'Placeholder icon',
  },
];

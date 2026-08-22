import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createEmailAssetExternal, createEmailAssetUpload, deleteEmailAsset, listEmailAssets, updateEmailAsset,
} from '../api/client';
import { ASSET_PLACEHOLDERS, type AssetPlaceholder } from './assetPlaceholders';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ApiError } from '../types/auth';
import type { EmailAsset, EmailAssetCategory } from './types';
import './AssetManagerDialog.css';

export interface AssetSelection {
  url: string;
  alt_text: string;
}

interface AssetManagerDialogProps {
  onSelect: (selection: AssetSelection) => void;
  onClose: () => void;
}

type Tab = 'browse' | 'upload' | 'external';
type CategoryFilter = 'all' | EmailAssetCategory;

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'logo', label: 'Logos' },
  { value: 'icon', label: 'Icons' },
  { value: 'other', label: 'Others' },
];

function apiErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const fieldErrors = apiError?.errors ? Object.values(apiError.errors).flat() : [];
  return fieldErrors[0] ?? apiError?.message ?? fallback;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatDetail(asset: EmailAsset): string {
  const parts: string[] = [];
  if (asset.content_type) parts.push(asset.content_type.replace('image/', '').toUpperCase());
  if (asset.width && asset.height) parts.push(`${asset.width} × ${asset.height}`);
  const size = formatFileSize(asset.file_size);
  if (size) parts.push(size);
  if (parts.length === 0) return asset.source_type === 'external' ? 'External URL' : '';
  return parts.join(' · ');
}

// Feature 08 — Asset Manager. A self-contained picker: browse/search/
// filter a user's uploaded + external assets (plus a few built-in
// placeholders), upload a new one, or link an external URL, then hand
// the chosen {url, alt_text} back to whichever PropertiesPanel field
// opened it. No portal — same centered-backdrop shape as
// SaveModuleDialog/RenameEmailDialog, just a wider dialog to fit the
// grid+detail layout.
export function AssetManagerDialog({ onSelect, onClose }: AssetManagerDialogProps) {
  const [tab, setTab] = useState<Tab>('browse');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [assets, setAssets] = useState<EmailAsset[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmailAsset | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [altDraft, setAltDraft] = useState('');
  const [altSaving, setAltSaving] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusables.length === 0) return;
      const active = document.activeElement as HTMLElement;
      const index = focusables.indexOf(active);
      const forward = !event.shiftKey;
      let nextIndex: number;
      if (index === -1) {
        nextIndex = forward ? 0 : focusables.length - 1;
      } else {
        nextIndex = forward ? (index + 1) % focusables.length : (index - 1 + focusables.length) % focusables.length;
      }
      event.preventDefault();
      focusables[nextIndex]?.focus();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function loadAssets() {
    setStatus('loading');
    try {
      const list = await listEmailAssets();
      setAssets(list);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (category !== 'all' && asset.category !== category) return false;
      if (term && !asset.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [assets, search, category]);

  const filteredPlaceholders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ASSET_PLACEHOLDERS.filter((placeholder) => {
      if (category !== 'all' && placeholder.category !== category) return false;
      if (term && !placeholder.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [search, category]);

  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;
  const selectedPlaceholder = filteredPlaceholders.find((p) => p.id === selectedId)
    ?? ASSET_PLACEHOLDERS.find((p) => p.id === selectedId) ?? null;

  function selectRealAsset(asset: EmailAsset) {
    setSelectedId(asset.id);
    setAltDraft(asset.alt_text);
    setCopyState('idle');
    setReplaceError(null);
  }

  function selectPlaceholder(placeholder: AssetPlaceholder) {
    setSelectedId(placeholder.id);
    setAltDraft(placeholder.alt_text);
    setCopyState('idle');
    setReplaceError(null);
  }

  async function handleCopyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      // Clipboard access can fail (permissions, insecure context); the
      // URL is still visible/selectable in the detail panel either way.
    }
  }

  async function handleSaveAltText() {
    if (!selectedAsset) return;
    setAltSaving(true);
    try {
      const updated = await updateEmailAsset(selectedAsset.id, { alt_text: altDraft });
      setAssets((current) => current.map((asset) => (asset.id === updated.id ? updated : asset)));
    } finally {
      setAltSaving(false);
    }
  }

  async function handleReplaceFile(file: File) {
    if (!selectedAsset) return;
    setReplaceError(null);
    try {
      const updated = await updateEmailAsset(selectedAsset.id, { file });
      setAssets((current) => current.map((asset) => (asset.id === updated.id ? updated : asset)));
    } catch (error) {
      setReplaceError(apiErrorMessage(error, 'Could not replace this file. Please try again.'));
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    await deleteEmailAsset(deleteTarget.id);
    setAssets((current) => current.filter((asset) => asset.id !== deleteTarget.id));
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setDeleteTarget(null);
  }

  function handleUseAsset() {
    if (selectedAsset) {
      onSelect({ url: selectedAsset.url, alt_text: selectedAsset.alt_text });
      onClose();
    } else if (selectedPlaceholder) {
      onSelect({ url: selectedPlaceholder.url, alt_text: selectedPlaceholder.alt_text });
      onClose();
    }
  }

  return (
    <div className="asset-manager-dialog__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="asset-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-manager-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="asset-manager-dialog__header">
          <h2 id="asset-manager-heading">Assets Manager</h2>
          <button type="button" className="asset-manager-dialog__close" aria-label="Close" onClick={onClose}>
            <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
          </button>
        </div>

        <div className="asset-manager-dialog__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'browse'}
            className={tab === 'browse' ? 'asset-manager-dialog__tab asset-manager-dialog__tab--active' : 'asset-manager-dialog__tab'}
            onClick={() => setTab('browse')}
          >
            My Assets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            className={tab === 'upload' ? 'asset-manager-dialog__tab asset-manager-dialog__tab--active' : 'asset-manager-dialog__tab'}
            onClick={() => setTab('upload')}
          >
            Upload
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'external'}
            className={tab === 'external' ? 'asset-manager-dialog__tab asset-manager-dialog__tab--active' : 'asset-manager-dialog__tab'}
            onClick={() => setTab('external')}
          >
            External URL
          </button>
        </div>

        <div className="asset-manager-dialog__body">
          {tab === 'browse' && (
            <>
              <div className="asset-manager-dialog__toolbar">
                <label className="asset-manager-dialog__search">
                  <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
                  <span className="visually-hidden">Search assets</span>
                  <input
                    type="search"
                    placeholder="Search assets…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="asset-manager-dialog__chips" role="group" aria-label="Filter by category">
                  {CATEGORY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={
                        category === option.value
                          ? 'asset-manager-dialog__chip asset-manager-dialog__chip--active'
                          : 'asset-manager-dialog__chip'
                      }
                      aria-pressed={category === option.value}
                      onClick={() => setCategory(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="asset-manager-dialog__grid-wrap">
                {status === 'loading' && <p className="asset-manager-dialog__empty">Loading assets…</p>}
                {status === 'error' && <p className="asset-manager-dialog__empty">Couldn&rsquo;t load your assets.</p>}
                {status === 'success' && (
                  <>
                    {filteredPlaceholders.length > 0 && (
                      <>
                        <p className="asset-manager-dialog__section-label">Placeholders</p>
                        <div className="asset-manager-dialog__grid">
                          {filteredPlaceholders.map((placeholder) => (
                            <button
                              key={placeholder.id}
                              type="button"
                              className={
                                selectedId === placeholder.id
                                  ? 'asset-manager-dialog__card asset-manager-dialog__card--selected'
                                  : 'asset-manager-dialog__card'
                              }
                              onClick={() => selectPlaceholder(placeholder)}
                              onDoubleClick={() => { selectPlaceholder(placeholder); onSelect({ url: placeholder.url, alt_text: placeholder.alt_text }); onClose(); }}
                            >
                              <img className="asset-manager-dialog__thumb" src={placeholder.url} alt="" />
                              <span className="asset-manager-dialog__card-name">{placeholder.name}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {filteredAssets.length > 0 ? (
                      <div className="asset-manager-dialog__grid">
                        {filteredAssets.map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
                            className={
                              selectedId === asset.id
                                ? 'asset-manager-dialog__card asset-manager-dialog__card--selected'
                                : 'asset-manager-dialog__card'
                            }
                            onClick={() => selectRealAsset(asset)}
                            onDoubleClick={() => { onSelect({ url: asset.url, alt_text: asset.alt_text }); onClose(); }}
                          >
                            <img className="asset-manager-dialog__thumb" src={asset.url} alt="" />
                            <span className="asset-manager-dialog__card-name">{asset.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      assets.length === 0 && filteredPlaceholders.length === ASSET_PLACEHOLDERS.length && (
                        <p className="asset-manager-dialog__empty">
                          No assets yet — upload one, link an external image, or use a placeholder above.
                        </p>
                      )
                    )}
                    {assets.length > 0 && filteredAssets.length === 0 && (
                      <p className="asset-manager-dialog__empty">No assets match your search.</p>
                    )}
                  </>
                )}
              </div>

              {(selectedAsset || selectedPlaceholder) && (
                <div className="asset-manager-dialog__detail">
                  <img
                    className="asset-manager-dialog__detail-thumb"
                    src={selectedAsset ? selectedAsset.url : selectedPlaceholder!.url}
                    alt=""
                  />
                  <div className="asset-manager-dialog__detail-info">
                    <span className="asset-manager-dialog__detail-name">
                      {selectedAsset ? selectedAsset.name : selectedPlaceholder!.name}
                    </span>
                    {selectedAsset && (
                      <span className="asset-manager-dialog__detail-meta">{formatDetail(selectedAsset)}</span>
                    )}
                    {selectedAsset && (
                      <label className="asset-manager-dialog__detail-alt">
                        <span className="visually-hidden">Alt text</span>
                        <input
                          type="text"
                          placeholder="Alt text"
                          value={altDraft}
                          onChange={(event) => setAltDraft(event.target.value)}
                          onBlur={() => { if (altDraft !== selectedAsset.alt_text) handleSaveAltText(); }}
                        />
                        {altSaving && <span className="asset-manager-dialog__detail-meta">Saving…</span>}
                      </label>
                    )}
                    {replaceError && <p className="asset-manager-dialog__error">{replaceError}</p>}
                  </div>
                  <div className="asset-manager-dialog__detail-actions">
                    <button type="button" className="button button--primary" onClick={handleUseAsset}>
                      Use this asset
                    </button>
                    <div className="asset-manager-dialog__detail-actions-row">
                      <button
                        type="button"
                        className="asset-manager-dialog__icon-button"
                        onClick={() => handleCopyUrl(selectedAsset ? selectedAsset.url : selectedPlaceholder!.url)}
                      >
                        <span className="mdaiw-icon mdaiw-icon--file" aria-hidden="true" />
                        {copyState === 'copied' ? 'Copied' : 'Copy URL'}
                      </button>
                      {selectedAsset && selectedAsset.source_type === 'upload' && (
                        <>
                          <button
                            type="button"
                            className="asset-manager-dialog__icon-button"
                            onClick={() => replaceInputRef.current?.click()}
                          >
                            <span className="mdaiw-icon mdaiw-icon--refresh" aria-hidden="true" />
                            Replace
                          </button>
                          <input
                            ref={replaceInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="visually-hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) handleReplaceFile(file);
                              event.target.value = '';
                            }}
                          />
                        </>
                      )}
                      {selectedAsset && (
                        <button
                          type="button"
                          className="asset-manager-dialog__icon-button asset-manager-dialog__icon-button--destructive"
                          onClick={() => setDeleteTarget(selectedAsset)}
                        >
                          <span className="mdaiw-icon mdaiw-icon--delete" aria-hidden="true" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'upload' && (
            <UploadTab
              onCreated={(asset) => {
                setAssets((current) => [asset, ...current]);
                setTab('browse');
                selectRealAsset(asset);
              }}
            />
          )}

          {tab === 'external' && (
            <ExternalUrlTab
              onCreated={(asset) => {
                setAssets((current) => [asset, ...current]);
                setTab('browse');
                selectRealAsset(asset);
              }}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        heading="Delete asset?"
        body={deleteTarget ? `"${deleteTarget.name}" will be permanently deleted. This cannot be undone.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function UploadTab({ onCreated }: { onCreated: (asset: EmailAsset) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<EmailAssetCategory>('image');
  const [altText, setAltText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const asset = await createEmailAssetUpload({ name: name.trim() || file.name, category, alt_text: altText, file });
      onCreated(asset);
    } catch (submitError) {
      setError(apiErrorMessage(submitError, 'Could not upload this asset. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="asset-manager-dialog__form">
      <div className="asset-manager-dialog__dropzone">
        <p>JPEG, PNG, WebP, or GIF — up to 5 MB.</p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected);
            if (selected && !name) setName(selected.name.replace(/\.[^.]+$/, ''));
          }}
        />
      </div>
      <label className="asset-manager-dialog__field">
        <span>Name</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Asset name" />
      </label>
      <label className="asset-manager-dialog__field">
        <span>Category</span>
        <select value={category} onChange={(event) => setCategory(event.target.value as EmailAssetCategory)}>
          <option value="image">Image</option>
          <option value="logo">Logo</option>
          <option value="icon">Icon</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="asset-manager-dialog__field">
        <span>Alt text</span>
        <input type="text" value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Describe this image" />
      </label>
      {error && <p role="alert" className="asset-manager-dialog__error">{error}</p>}
      <div className="asset-manager-dialog__form-actions">
        <button type="button" className="button button--primary" disabled={saving} onClick={handleSubmit}>
          {saving ? 'Uploading…' : 'Upload asset'}
        </button>
      </div>
    </div>
  );
}

function ExternalUrlTab({ onCreated }: { onCreated: (asset: EmailAsset) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<EmailAssetCategory>('image');
  const [altText, setAltText] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!url.trim()) {
      setError('Enter an image URL.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const asset = await createEmailAssetExternal({
        name: name.trim() || 'External image', category, alt_text: altText, external_url: url.trim(),
      });
      onCreated(asset);
    } catch (submitError) {
      setError(apiErrorMessage(submitError, 'Could not add this URL. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="asset-manager-dialog__form">
      <label className="asset-manager-dialog__field">
        <span>Image URL</span>
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
        />
      </label>
      <label className="asset-manager-dialog__field">
        <span>Name</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Asset name" />
      </label>
      <label className="asset-manager-dialog__field">
        <span>Category</span>
        <select value={category} onChange={(event) => setCategory(event.target.value as EmailAssetCategory)}>
          <option value="image">Image</option>
          <option value="logo">Logo</option>
          <option value="icon">Icon</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="asset-manager-dialog__field">
        <span>Alt text</span>
        <input type="text" value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Describe this image" />
      </label>
      {error && <p role="alert" className="asset-manager-dialog__error">{error}</p>}
      <div className="asset-manager-dialog__form-actions">
        <button type="button" className="button button--primary" disabled={saving} onClick={handleSubmit}>
          {saving ? 'Adding…' : 'Add external URL'}
        </button>
      </div>
    </div>
  );
}

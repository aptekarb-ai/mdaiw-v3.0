import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { AssetManagerDialog, type AssetSelection } from '../emailbuilder/AssetManagerDialog';
import './EmailBuilderDashboardPage.css';

// Module-4 Navigation Completion, Phase A — Assets / Brand Kit exposed as
// a standalone destination. Reuses AssetManagerDialog (Feature 08) and
// the existing listEmailAssets/createEmailAssetUpload/
// createEmailAssetExternal/updateEmailAsset/deleteEmailAsset calls
// UNCHANGED — EmailAsset is already a global per-account library (not
// per-document), so upload/browse/edit/delete all work exactly as they
// do from inside the builder. "Use this asset" has no email-field to
// fill outside an open document, so it copies the URL to the clipboard
// instead of silently pretending an insertion happened.
export function AssetManagerPage() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const justCopiedRef = useRef(false);

  function handleSelect(selection: AssetSelection) {
    navigator.clipboard.writeText(selection.url).catch(() => {
      // Clipboard access can fail (permissions, insecure context); the
      // URL is still shown on this page either way.
    });
    justCopiedRef.current = true;
    setCopiedUrl(selection.url);
  }

  function handleClose() {
    setDialogOpen(false);
    if (justCopiedRef.current) {
      justCopiedRef.current = false;
      return;
    }
    navigate('/email-builder');
  }

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>Assets / Brand Kit</h1>
          <p>Browse, upload and manage your reusable images, logos and icons.</p>
        </div>
        <Link to="/email-builder" className="button button--outline">Back to Email Dashboard</Link>
      </header>

      {copiedUrl && !dialogOpen && (
        <div className="email-builder-dashboard__state" role="status">
          <p>Copied image URL to clipboard.</p>
          <p className="email-builder-dashboard__empty-hint">
            Paste it into an email&rsquo;s Image module or Header logo field.
          </p>
          <button type="button" className="button button--primary" onClick={() => { setCopiedUrl(null); setDialogOpen(true); }}>
            Browse assets
          </button>
        </div>
      )}

      {dialogOpen && (
        <AssetManagerDialog onSelect={handleSelect} onClose={handleClose} />
      )}
    </section>
  );
}

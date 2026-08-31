import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router';
import { FormField } from '../forms/FormField';
import { SelectionCard } from './CreateEmailPage';
import { PLATFORM_OPTIONS, DEFAULT_PLATFORM } from '../emailbuilder/platformOptions';
import { DEFAULT_EMAIL_WIDTH } from '../emailbuilder/widthOptions';
import { parseAndGuardImportedHtml, MAX_HTML_BYTES } from '../emailbuilder/htmlImportParser';
import { mapImportedHtml } from '../emailbuilder/htmlImportMapper';
import { createEmailDocumentFromImportedHtml } from '../emailbuilder/duplicateEmailDocument';
import type { ImportFinding } from '../emailbuilder/importFindings';
import type { EmailModule } from '../emailbuilder/edm';
import type { EmailPlatform } from '../emailbuilder/types';
import type { ApiError } from '../types/auth';
import './EmailBuilderDashboardPage.css';
import './CreateEmailPage.css';

const NAME_MAX_LENGTH = 120;

const FINDING_CATEGORY_LABELS: Record<ImportFinding['category'], string> = {
  normalized: 'Normalized',
  unsupported: 'Unsupported',
  security: 'Removed for security',
  'unresolved-resource': 'Unresolved resource',
  'structural-conversion': 'Structural conversion',
  'outlook-regeneration': 'Outlook compatibility regenerated',
};

// Phase C (Import HTML) — the ONE import experience shared by Dashboard's
// "Import HTML" quick action and Create Email's "Existing HTML" start
// type (both simply navigate('/email-builder/import')). Everything up to
// "Create Email" runs entirely client-side (htmlImportParser.ts parses
// via a detached DOMParser and enforces the size/node/depth blocking
// guards; htmlImportMapper.ts walks the sanitized tree into EDM modules +
// Import findings) — the network is only reached once, on Create, via
// the same create-then-PATCH-with-rollback path every other "create a
// document with pre-built content" flow in this app already uses
// (duplicateEmailDocument.ts's createDocumentWithContent).
export function ImportHtmlPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [html, setHtml] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const [reviewed, setReviewed] = useState<{ modules: EmailModule[]; findings: ImportFinding[]; emailTitle: string } | null>(null);

  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<EmailPlatform>(DEFAULT_PLATFORM);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then(setHtml).catch(() => setParseError('This file could not be read.'));
  }

  function handleParse(event: FormEvent) {
    event.preventDefault();
    setParseError(null);
    const guard = parseAndGuardImportedHtml(html);
    if (!guard.ok) {
      setParseError(guard.reason);
      return;
    }
    const result = mapImportedHtml(guard.document);
    setReviewed(result);
    setName(result.emailTitle || '');
  }

  function handleStartOver() {
    setReviewed(null);
    setParseError(null);
    setFormError(null);
    setNameError(undefined);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!reviewed || creating) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Email name is required.');
      return;
    }
    if (trimmedName.length > NAME_MAX_LENGTH) {
      setNameError(`Email name must be ${NAME_MAX_LENGTH} characters or fewer.`);
      return;
    }
    setNameError(undefined);
    setFormError(null);
    setCreating(true);
    try {
      const document = await createEmailDocumentFromImportedHtml(
        trimmedName, platform, DEFAULT_EMAIL_WIDTH, reviewed.modules, reviewed.emailTitle,
      );
      navigate(`/email-builder/builder/${document.id}`);
    } catch (caught) {
      const error = caught as ApiError;
      setFormError(error.message || 'We could not create this email. Please try again.');
      if (error.errors?.name) setNameError(error.errors.name[0]);
      setCreating(false);
    }
  }

  const bySeverityCount = reviewed
    ? reviewed.findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.category] = (acc[f.category] ?? 0) + 1;
      return acc;
    }, {})
    : {};

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>Import HTML</h1>
          <p>Paste or upload an existing email’s HTML to start editing it in the builder.</p>
        </div>
        <Link to="/email-builder" className="button button--outline">Back to Email Dashboard</Link>
      </header>

      {!reviewed && (
        <form className="create-email-page__form" onSubmit={handleParse} noValidate>
          <h2>Paste or upload HTML</h2>

          <div className="create-email-page__field">
            <label htmlFor="import-html-file">Upload an .html file</label>
            <input
              id="import-html-file"
              ref={fileInputRef}
              type="file"
              accept=".html,text/html"
              onChange={handleFileChange}
            />
          </div>

          <div className="create-email-page__field">
            <label htmlFor="import-html-paste">Or paste HTML</label>
            <textarea
              id="import-html-paste"
              rows={14}
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              placeholder="<html>...</html>"
              maxLength={MAX_HTML_BYTES}
            />
          </div>

          {parseError && (
            <p className="create-email-page__form-error" role="alert">
              <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
              {parseError}
            </p>
          )}

          <div className="create-email-page__actions">
            <button type="button" className="button button--outline" onClick={() => navigate('/email-builder')}>
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={!html.trim()}>
              Review Import →
            </button>
          </div>
        </form>
      )}

      {reviewed && (
        <>
          <section className="create-email-page__form" aria-labelledby="import-review-heading">
            <h2 id="import-review-heading">Import Review</h2>
            <p>
              {reviewed.modules.length} module{reviewed.modules.length === 1 ? '' : 's'} imported.
              {reviewed.findings.length > 0 && ` ${reviewed.findings.length} finding${reviewed.findings.length === 1 ? '' : 's'} below.`}
            </p>

            {reviewed.findings.length === 0 && <p>No issues found — everything imported cleanly.</p>}

            {reviewed.findings.length > 0 && (
              <p>
                {Object.entries(bySeverityCount).map(([category, count]) => (
                  <span key={category}>
                    {count} {FINDING_CATEGORY_LABELS[category as ImportFinding['category']]}
                    {'  '}
                  </span>
                ))}
              </p>
            )}

            {reviewed.findings.length > 0 && (
              <ul aria-label="Import findings">
                {reviewed.findings.map((f, index) => (
                  <li key={index}>
                    <strong>{FINDING_CATEGORY_LABELS[f.category]}</strong> — {f.source} ({f.location}): {f.reason} {f.outcome} {f.recommendation}
                  </li>
                ))}
              </ul>
            )}

            <button type="button" className="button button--outline" onClick={handleStartOver}>
              Start Over
            </button>
          </section>

          <form className="create-email-page__form" onSubmit={handleCreate} noValidate>
            <h2>Name your new email</h2>

            <div className="create-email-page__field">
              <FormField
                id="import-email-name"
                label="Email Name"
                required
                placeholder="August Product Newsletter"
                maxLength={NAME_MAX_LENGTH}
                value={name}
                onChange={(event) => setName(event.target.value)}
                error={nameError}
              />
            </div>

            <fieldset className="create-email-page__fieldset">
              <legend>Choose Environment</legend>
              <div className="create-email-page__platform-grid">
                {PLATFORM_OPTIONS.map((option) => (
                  <SelectionCard
                    key={option.value}
                    name="platform"
                    value={option.value}
                    label={option.label}
                    description={option.description}
                    icon={option.icon}
                    selected={platform === option.value}
                    footnote={option.value === 'generic' ? 'Recommended' : undefined}
                    onSelect={() => setPlatform(option.value)}
                  />
                ))}
              </div>
            </fieldset>

            {formError && (
              <p className="create-email-page__form-error" role="alert">
                <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                {formError}
              </p>
            )}

            <div className="create-email-page__actions">
              <button type="button" className="button button--outline" onClick={handleStartOver} disabled={creating}>
                Back
              </button>
              <button type="submit" className="button button--primary" disabled={creating}>
                {creating && <span className="mdaiw-icon mdaiw-icon--spinner create-email-page__spinner" aria-hidden="true" />}
                {creating ? 'Creating…' : 'Create Email →'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

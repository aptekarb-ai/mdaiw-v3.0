import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router';
import { FormField } from '../forms/FormField';
import { SelectionCard } from './CreateEmailPage';
import { PLATFORM_OPTIONS, DEFAULT_PLATFORM } from '../emailbuilder/platformOptions';
import { DEFAULT_EMAIL_WIDTH } from '../emailbuilder/widthOptions';
import { parseAndGuardImportedHtml, MAX_HTML_BYTES } from '../emailbuilder/htmlImportParser';
import { mapImportedHtml } from '../emailbuilder/htmlImportMapper';
import { analyzeImportedHtml } from '../emailbuilder/htmlImportAnalysis';
import { buildFidelityReport, type FidelityReport } from '../emailbuilder/htmlImportFidelity';
import { renderSanitizedSourceHtml } from '../emailbuilder/htmlImportSanitize';
import { renderEmailDocument } from '../emailbuilder/htmlRenderer';
import { ImportReviewWorkspace } from '../emailbuilder/ImportReviewWorkspace';
import { createEmailDocumentFromImportedHtml } from '../emailbuilder/duplicateEmailDocument';
import type { EmailModule } from '../emailbuilder/edm';
import type { EmailPlatform } from '../emailbuilder/types';
import type { ApiError } from '../types/auth';
import './EmailBuilderDashboardPage.css';
import './CreateEmailPage.css';

const NAME_MAX_LENGTH = 120;

interface ReviewState {
  modules: EmailModule[];
  emailTitle: string;
  fidelity: FidelityReport;
  originalHtml: string;
  reconstructedHtml: string;
}

// Phase C (Import HTML) — the ONE import experience shared by Dashboard's
// "Import HTML" quick action and Create Email's "Existing HTML" start
// type (both simply navigate('/email-builder/import')). Everything up to
// "Create Email" runs entirely client-side: htmlImportParser.ts parses via
// a detached DOMParser and enforces the size/node/depth blocking guards;
// htmlImportMapper.ts walks the sanitized tree into EDM modules + Import
// findings (R1's analyzeImportedHtml and R2's buildFidelityReport are pure
// ADDITIVE reads of that same sanitized document + mapping result — see
// their own file docstrings for why they can never disagree with it) — the
// network is only reached once, on Create, via the same create-then-PATCH-
// with-rollback path every other "create a document with pre-built
// content" flow in this app already uses
// (duplicateEmailDocument.ts's createDocumentWithContent).
//
// R3 — the review artifacts (originalHtml/reconstructedHtml/fidelity) are
// computed ONCE here, at parse time, and never recomputed on Create: the
// EXACT modules[] the user reviewed is what gets persisted, never a second
// parse/map pass (see submitCreate below).
export function ImportHtmlPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [html, setHtml] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const [reviewed, setReviewed] = useState<ReviewState | null>(null);

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
    const mapping = mapImportedHtml(guard.document);
    const structure = analyzeImportedHtml(guard.document, DEFAULT_EMAIL_WIDTH);
    const fidelity = buildFidelityReport(guard.document, structure, mapping);
    const originalHtml = renderSanitizedSourceHtml(guard.document);
    const reconstructedHtml = renderEmailDocument({
      width: DEFAULT_EMAIL_WIDTH,
      content: { version: 1, modules: mapping.modules },
      title: mapping.emailTitle,
    });
    setReviewed({
      modules: mapping.modules, emailTitle: mapping.emailTitle, fidelity, originalHtml, reconstructedHtml,
    });
    setName(mapping.emailTitle || '');
  }

  function handleStartOver() {
    setReviewed(null);
    setParseError(null);
    setFormError(null);
    setNameError(undefined);
  }

  // Shared by both "Create Email" and "Review reconstruction with AI
  // Engineer" — the SAME create-then-PATCH transaction either way, using
  // the modules[] already reviewed above (never re-parsed/re-mapped).
  // Returns the new document id on success, null on a validation/API
  // failure (already surfaced to the user by this function itself).
  async function submitCreate(): Promise<number | null> {
    if (!reviewed || creating) return null;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Email name is required.');
      return null;
    }
    if (trimmedName.length > NAME_MAX_LENGTH) {
      setNameError(`Email name must be ${NAME_MAX_LENGTH} characters or fewer.`);
      return null;
    }
    setNameError(undefined);
    setFormError(null);
    setCreating(true);
    try {
      const document = await createEmailDocumentFromImportedHtml(
        trimmedName, platform, DEFAULT_EMAIL_WIDTH, reviewed.modules, reviewed.emailTitle,
      );
      return document.id;
    } catch (caught) {
      const error = caught as ApiError;
      setFormError(error.message || 'We could not create this email. Please try again.');
      if (error.errors?.name) setNameError(error.errors.name[0]);
      setCreating(false);
      return null;
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const documentId = await submitCreate();
    if (documentId !== null) navigate(`/email-builder/builder/${documentId}`);
  }

  // "Review reconstruction with AI Engineer" — creates the document via
  // the IDENTICAL transaction above, then deep-links straight into the AI
  // Engineer tab using EmailBuilderWorkspacePage's EXISTING `?tab=ai` deep
  // link (already used elsewhere in this app — no new cross-page wiring).
  // Nothing is auto-sent to the AI Engineer here: the conversation opens
  // empty, exactly as if the user had clicked the AI Engineer tab
  // themselves — "must not silently modify anything yet" (R3 scope).
  // Seeding the AI Engineer's first turn with the bounded structural
  // analysis + FidelityReport is the next reconstruction-intelligence
  // checkpoint's job, not this one's.
  async function handleReviewWithAiEngineer() {
    const documentId = await submitCreate();
    if (documentId !== null) navigate(`/email-builder/builder/${documentId}?tab=ai`);
  }

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
          <section aria-labelledby="import-review-heading" className="import-html-page__review">
            <div className="import-html-page__review-header">
              <h2 id="import-review-heading">Import Review</h2>
              <div className="import-html-page__review-actions">
                <button type="button" className="button button--outline" onClick={handleStartOver} disabled={creating}>
                  Start Over
                </button>
                <button type="button" className="button button--outline" onClick={handleReviewWithAiEngineer} disabled={creating}>
                  <span className="mdaiw-icon mdaiw-icon--ai-assistants" aria-hidden="true" />
                  Review reconstruction with AI Engineer
                </button>
              </div>
            </div>

            <ImportReviewWorkspace
              originalHtml={reviewed.originalHtml}
              reconstructedHtml={reviewed.reconstructedHtml}
              width={DEFAULT_EMAIL_WIDTH}
              moduleCount={reviewed.modules.length}
              fidelity={reviewed.fidelity}
            />
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

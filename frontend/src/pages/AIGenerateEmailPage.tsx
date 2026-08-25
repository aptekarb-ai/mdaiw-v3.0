import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router';
import { FormField } from '../forms/FormField';
import { PLATFORM_OPTIONS, DEFAULT_PLATFORM } from '../emailbuilder/platformOptions';
import { DEFAULT_EMAIL_WIDTH } from '../emailbuilder/widthOptions';
import { requestAICommand } from '../api/client';
import { buildComposedModule } from '../emailbuilder/moduleFactory';
import { createEmailDocumentFromAI } from '../emailbuilder/duplicateEmailDocument';
import { renderEmailDocument } from '../emailbuilder/htmlRenderer';
import type { AICommandProviderId, AIComposeItem } from '../emailbuilder/aiCommand';
import type { EmailModule } from '../emailbuilder/edm';
import type { EmailPlatform } from '../emailbuilder/types';
import type { ApiError } from '../types/auth';
import './EmailBuilderDashboardPage.css';
import './CreateEmailPage.css';

const NAME_MAX_LENGTH = 120;

// The deterministic fallback (RuleBasedEmailCommandProvider, via
// composition.py's interpret_brief) only recognizes a message as an
// email-COMPOSE request when it both names "email" and uses an explicit
// compose verb (create/build/generate/make/compose/draft) — a
// disambiguation rule that matters when the SAME free-text message could
// also be an in-builder edit command ("update the button color"). On
// THIS page, unlike the in-builder AI Engineer, there is no such
// ambiguity: reaching AI Generate Email already means "compose an
// email" — that's the page's only function. So this prefix supplies the
// missing compose-intent framing the shared deterministic router needs,
// without touching the router itself (no second classifier, no change
// to what the in-builder AI Engineer sends). It does NOT alter the raw,
// user-editable `brief` state — only the outgoing request's `message`
// field. A real AI provider (OpenAI/local) infers compose intent from
// context via its own system prompt, not this regex, so the prefix is a
// harmless no-op there — see ai_command_openai.py's _SYSTEM_PROMPT.
export const COMPOSE_INTENT_PREFIX = 'Create an email: ';

// Mirrors backend ai_command.py's MAX_MESSAGE_LENGTH (500) on the final
// `message` sent to /ai-command/, which is COMPOSE_INTENT_PREFIX + the
// raw brief — so the visible textarea cap is reduced by the prefix's
// own length to guarantee the combined message never exceeds the
// backend's real limit (never silently truncated, never a surprise
// 400).
export const BRIEF_MAX_LENGTH = 500 - COMPOSE_INTENT_PREFIX.length;

// Decision C — honest, user-facing disclosure of which path actually
// produced the composition. Never label the deterministic fallback as
// free-form AI generation — see AICommandProviderId's own doc-comment
// ("never mislabel deterministic rule output as AI inference").
const PROVIDER_DISCLOSURE: Record<AICommandProviderId, string> = {
  openai: 'Generated with AI',
  local: 'Generated with AI',
  deterministic: 'Built-in template fallback (no AI provider configured)',
};

interface Composition {
  modules: EmailModule[];
  provider: AICommandProviderId;
}

// Phase D (AI Generate Email) — the ONE pre-document AI Generate
// experience shared by Dashboard's "AI Generate Email" quick action and
// Create Email's "AI Generate" start type (both simply
// navigate('/email-builder/ai-generate')). Composition is entirely a
// stateless requestAICommand()/COMPOSE_EMAIL round trip (the exact same
// contract the in-builder AI Engineer already uses) — no EmailDocument
// exists until AFTER the user reviews the result and confirms a unique
// name. See duplicateEmailDocument.ts's createEmailDocumentFromAI for
// the create+PATCH+rollback transaction this hands off to.
//
// Deliberately NOT a step-gated wizard: the brief stays visible and
// editable the whole time (Decision B — "keep the original brief
// editable... one Regenerate action... do not create separate Edit-brief
// versus Generate-again flows"), and the Review/Name sections simply
// appear once a composition exists, on the same page.
export function AIGenerateEmailPage() {
  const navigate = useNavigate();

  const [brief, setBrief] = useState('');
  const [platform, setPlatform] = useState<EmailPlatform>(DEFAULT_PLATFORM);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [composition, setComposition] = useState<Composition | null>(null);

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Decision B — stale/out-of-order + double-submit protection. Every
  // Generate/Regenerate click gets a fresh id; a response is only ever
  // applied if it's still the MOST RECENT request — an earlier request
  // completing after a newer one must never replace the newer
  // composition. Combined with `generating` disabling the button (the
  // same lock-boolean pattern AIEngineerPanel's own `sending` state
  // already uses — there is no AbortController anywhere in this codebase
  // for this endpoint to reuse instead), this makes an effective
  // duplicate/overlapping request structurally impossible, not just
  // unlikely.
  const requestSeqRef = useRef(0);

  function composeItemToEntry(item: AIComposeItem) {
    return {
      type: item.module_type,
      patch: item.patch,
      children: item.children?.map((group) => ({
        columnIndex: group.column_index,
        modules: group.modules.map((child) => ({ type: child.module_type, patch: child.patch })),
      })),
      repeatableItems: item.repeatable_items,
    };
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (generating) return;
    const trimmed = brief.trim();
    if (!trimmed) {
      setGenerateError('Describe the email you want to generate.');
      return;
    }
    if (trimmed.length > BRIEF_MAX_LENGTH) {
      setGenerateError(`Brief must be ${BRIEF_MAX_LENGTH} characters or fewer.`);
      return;
    }

    setGenerateError(null);
    setGenerating(true);
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    try {
      const response = await requestAICommand({
        message: `${COMPOSE_INTENT_PREFIX}${trimmed}`,
        platform,
        width: DEFAULT_EMAIL_WIDTH,
      });
      if (requestId !== requestSeqRef.current) return; // superseded by a newer request — never overwrite it

      if (response.action.type !== 'COMPOSE_EMAIL' || response.action.items.length === 0) {
        setGenerateError("We couldn't generate an email from that brief. Try describing it in more detail.");
        setGenerating(false);
        return;
      }

      const built = response.action.items.map((item, index) => buildComposedModule(composeItemToEntry(item), index));
      setComposition({ modules: built, provider: response.provider });
      setGenerating(false);
    } catch (caught) {
      if (requestId !== requestSeqRef.current) return;
      const error = caught as ApiError;
      setGenerateError(error.message || 'We could not generate an email. Please try again.');
      setGenerating(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!composition || creating) return;
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
      const document = await createEmailDocumentFromAI(trimmedName, platform, DEFAULT_EMAIL_WIDTH, composition.modules);
      navigate(`/email-builder/builder/${document.id}`);
    } catch (caught) {
      const error = caught as ApiError;
      setFormError(error.message || 'We could not create this email. Please try again.');
      if (error.errors?.name) setNameError(error.errors.name[0]);
      setCreating(false);
    }
  }

  const previewHtml = composition
    ? renderEmailDocument({ width: DEFAULT_EMAIL_WIDTH, content: { version: 1, modules: composition.modules } })
    : null;

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>AI Generate Email</h1>
          <p>Describe the email you want, and let AI (or the built-in template fallback) build a starting point.</p>
        </div>
        <Link to="/email-builder" className="button button--outline">Back to Email Dashboard</Link>
      </header>

      <form className="create-email-page__form" onSubmit={handleGenerate} noValidate>
        <h2>Describe your email</h2>

        <div className="create-email-page__field">
          <label htmlFor="ai-generate-brief">What should this email be?</label>
          <textarea
            id="ai-generate-brief"
            rows={6}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="e.g. A promotional email announcing our summer sale, with a hero banner, product highlights, and a Shop Now button."
            maxLength={BRIEF_MAX_LENGTH}
            disabled={generating}
          />
        </div>

        <fieldset className="create-email-page__fieldset">
          <legend>Choose Environment</legend>
          <div className="create-email-page__platform-grid">
            {PLATFORM_OPTIONS.map((option) => (
              <label key={option.value} className="create-email-page__card">
                <input
                  type="radio"
                  name="platform"
                  checked={platform === option.value}
                  onChange={() => setPlatform(option.value)}
                  className="create-email-page__radio-input"
                  disabled={generating}
                />
                <span className={`mdaiw-icon mdaiw-icon--${option.icon} create-email-page__card-icon`} aria-hidden="true" />
                <span className="create-email-page__card-title">{option.label}</span>
                <span className="create-email-page__card-description">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {generateError && (
          <p className="create-email-page__form-error" role="alert">
            <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
            {generateError}
          </p>
        )}

        <div className="create-email-page__actions">
          <button type="button" className="button button--outline" onClick={() => navigate('/email-builder')} disabled={generating}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={generating || !brief.trim()}>
            {generating && <span className="mdaiw-icon mdaiw-icon--spinner create-email-page__spinner" aria-hidden="true" />}
            {generating ? 'Generating…' : composition ? 'Regenerate' : 'Generate →'}
          </button>
        </div>
      </form>

      {composition && (
        <>
          <section className="create-email-page__form" aria-labelledby="ai-review-heading">
            <h2 id="ai-review-heading">Review</h2>
            <p>{PROVIDER_DISCLOSURE[composition.provider]}</p>
            <p>
              {composition.modules.length} module{composition.modules.length === 1 ? '' : 's'} generated:{' '}
              {composition.modules.map((module) => module.type).join(', ')}
            </p>

            {previewHtml && (
              <iframe
                title="Generated email preview"
                srcDoc={previewHtml}
                sandbox=""
                style={{ width: '100%', height: 480, border: '1px solid var(--color-border, #d9e2e5)' }}
              />
            )}
          </section>

          <form className="create-email-page__form" onSubmit={handleCreate} noValidate>
            <h2>Name your new email</h2>

            <div className="create-email-page__field">
              <FormField
                id="ai-generate-email-name"
                label="Email Name"
                required
                placeholder="Summer Sale Announcement"
                maxLength={NAME_MAX_LENGTH}
                value={name}
                onChange={(event) => setName(event.target.value)}
                error={nameError}
              />
            </div>

            {formError && (
              <p className="create-email-page__form-error" role="alert">
                <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
                {formError}
              </p>
            )}

            <div className="create-email-page__actions">
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

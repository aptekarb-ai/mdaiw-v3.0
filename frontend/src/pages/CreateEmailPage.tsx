import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { FormField } from '../forms/FormField';
import { PLATFORM_OPTIONS, DEFAULT_PLATFORM } from '../emailbuilder/platformOptions';
import {
  CUSTOM_WIDTH_MAX,
  CUSTOM_WIDTH_MIN,
  DEFAULT_EMAIL_WIDTH,
  EMAIL_WIDTH_PRESETS,
} from '../emailbuilder/widthOptions';
import { DEFAULT_START_TYPE, START_TYPE_OPTIONS } from '../emailbuilder/startTypeOptions';
import { createEmailDocument } from '../api/client';
import type { EmailPlatform, EmailStartType } from '../emailbuilder/types';
import type { ApiError } from '../types/auth';
import './CreateEmailPage.css';

const NAME_MAX_LENGTH = 120;

type WidthSelection = number | 'custom';

interface FieldErrors {
  name?: string;
  width?: string;
}

function cardClassName(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// Shared visual selection control for both the Environment and Start From
// grids (req: "one reusable selection-card visual system"). The native
// <input type="radio"> stays real and focusable for keyboard/native
// arrow-key semantics — only its own circle is visually hidden
// (.create-email-page__radio-input, the same clip-rect technique this
// app already uses for .visually-hidden elsewhere), never display:none.
export interface SelectionCardProps {
  name: string;
  value: string;
  label: string;
  description: string;
  icon: string;
  selected: boolean;
  disabled?: boolean;
  footnote?: string;
  onSelect: () => void;
}

// Exported so other "choose one of these cards" flows (Import HTML's own
// environment selector) reuse this exact selected-state visual contract
// (border/background/check icon, all keyed off the --selected class here)
// instead of re-implementing a second, easily-divergent copy.
export function SelectionCard({
  name, value, label, description, icon, selected, disabled, footnote, onSelect,
}: SelectionCardProps) {
  return (
    <label
      className={cardClassName(
        'create-email-page__card',
        selected && 'create-email-page__card--selected',
        disabled && 'create-email-page__card--disabled',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="create-email-page__radio-input"
      />
      {selected && (
        <span className="create-email-page__card-check" aria-hidden="true">
          <span className="mdaiw-icon mdaiw-icon--check" />
        </span>
      )}
      <span className={`mdaiw-icon mdaiw-icon--${icon} create-email-page__card-icon`} aria-hidden="true" />
      <span className="create-email-page__card-title">{label}</span>
      <span className="create-email-page__card-description">{description}</span>
      {footnote && (
        <span
          className={cardClassName(
            'create-email-page__card-footnote',
            disabled && 'create-email-page__card-footnote--muted',
          )}
        >
          {footnote}
        </span>
      )}
    </label>
  );
}

export function CreateEmailPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<EmailPlatform>(DEFAULT_PLATFORM);
  const [widthSelection, setWidthSelection] = useState<WidthSelection>(DEFAULT_EMAIL_WIDTH);
  const [customWidth, setCustomWidth] = useState('');
  const [startType, setStartType] = useState<EmailStartType>(DEFAULT_START_TYPE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    const trimmedName = name.trim();
    if (!trimmedName) {
      next.name = 'Email name is required.';
    } else if (trimmedName.length > NAME_MAX_LENGTH) {
      next.name = `Email name must be ${NAME_MAX_LENGTH} characters or fewer.`;
    }

    if (widthSelection === 'custom') {
      const trimmedWidth = customWidth.trim();
      if (!trimmedWidth) {
        next.width = 'Enter a custom width.';
      } else {
        const value = Number(trimmedWidth);
        if (!Number.isInteger(value)) {
          next.width = 'Width must be a whole number of pixels.';
        } else if (value < CUSTOM_WIDTH_MIN || value > CUSTOM_WIDTH_MAX) {
          next.width = `Width must be between ${CUSTOM_WIDTH_MIN} and ${CUSTOM_WIDTH_MAX} pixels.`;
        }
      }
    }

    return next;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (startType === 'template') {
      // Phase B (Template Experience) — Template hands off to the SAME
      // picker/create-from-template workflow Dashboard's "Choose Template"
      // uses (TemplatesPage), rather than this wizard growing a second
      // template-selection step/engine. The name/platform/width already
      // chosen above are not carried forward — the destination email's
      // name is chosen on that page (per the required uniqueness check),
      // and its platform/width are copied from the selected template.
      navigate('/email-builder/templates');
      return;
    }

    if (startType === 'html') {
      // Phase C (Import HTML) — same hand-off shape as Template: one
      // shared importer (ImportHtmlPage) used by both this wizard and
      // Dashboard's "Import HTML" card, never a second import engine
      // built into this form.
      navigate('/email-builder/import');
      return;
    }

    if (startType === 'ai') {
      // Phase D (AI Generate Email) — same hand-off shape as Template/
      // Import: one shared brief-entry/compose/create page
      // (AIGenerateEmailPage) used by both this wizard and Dashboard's
      // "AI Generate Email" card, never a second AI composition engine
      // built into this form.
      navigate('/email-builder/ai-generate');
      return;
    }

    const validation = validate();
    setErrors(validation);
    setFormError(null);
    if (Object.keys(validation).length > 0) {
      return;
    }

    const width = widthSelection === 'custom' ? Number(customWidth.trim()) : widthSelection;

    setSubmitting(true);
    try {
      const document = await createEmailDocument({
        name: name.trim(),
        platform,
        width,
        start_type: startType,
      });
      navigate(`/email-builder/builder/${document.id}`);
    } catch (caught) {
      const error = caught as ApiError;
      setFormError(error.message || 'We could not create this email. Please try again.');
      if (error.errors) {
        setErrors((current) => ({
          ...current,
          name: error.errors?.name?.[0] ?? current.name,
          width: error.errors?.width?.[0] ?? current.width,
        }));
      }
      setSubmitting(false);
    }
  }

  return (
    <section className="create-email-page">
      <header className="create-email-page__header">
        <h1>Create New Email</h1>
        <p>Configure your email environment, width, and starting point before entering the builder.</p>
      </header>

      <div className="create-email-page__body">
        <form className="create-email-page__form" onSubmit={handleSubmit} noValidate>
          <h2>Email Setup</h2>

          <div className="create-email-page__field">
            <FormField
              id="email-name"
              label="Email Name"
              required
              placeholder="August Product Newsletter"
              maxLength={NAME_MAX_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={errors.name}
            />
          </div>

          <fieldset className="create-email-page__fieldset">
            <legend>
              Choose Environment
              <span className="create-email-page__required" aria-hidden="true">
                {' '}
                *
              </span>
            </legend>
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

          <fieldset className="create-email-page__fieldset">
            <legend>Email Width</legend>
            <div className="create-email-page__width-row">
              {EMAIL_WIDTH_PRESETS.map((preset) => (
                <div key={preset} className="create-email-page__width-item">
                  <label
                    className={cardClassName(
                      'create-email-page__width-chip',
                      widthSelection === preset && 'create-email-page__width-chip--selected',
                    )}
                  >
                    <input
                      type="radio"
                      name="width"
                      value={preset}
                      checked={widthSelection === preset}
                      onChange={() => setWidthSelection(preset)}
                      className="create-email-page__radio-input"
                    />
                    {widthSelection === preset && (
                      <span className="mdaiw-icon mdaiw-icon--check create-email-page__width-check" aria-hidden="true" />
                    )}
                    {preset}px
                  </label>
                  {preset === DEFAULT_EMAIL_WIDTH && (
                    <span className="create-email-page__recommended">Recommended</span>
                  )}
                </div>
              ))}
              <div className="create-email-page__width-item">
                <label
                  className={cardClassName(
                    'create-email-page__width-chip',
                    widthSelection === 'custom' && 'create-email-page__width-chip--selected',
                  )}
                >
                  <input
                    type="radio"
                    name="width"
                    value="custom"
                    checked={widthSelection === 'custom'}
                    onChange={() => setWidthSelection('custom')}
                    className="create-email-page__radio-input"
                  />
                  {widthSelection === 'custom' && (
                    <span className="mdaiw-icon mdaiw-icon--check create-email-page__width-check" aria-hidden="true" />
                  )}
                  Custom
                </label>
              </div>
            </div>
            {widthSelection === 'custom' && (
              <div className="create-email-page__custom-width">
                <FormField
                  id="email-width-custom"
                  label="Custom width"
                  type="text"
                  inputMode="numeric"
                  placeholder="700"
                  value={customWidth}
                  onChange={(event) => setCustomWidth(event.target.value)}
                  error={errors.width}
                />
                <span className="create-email-page__custom-width-unit" aria-hidden="true">px</span>
              </div>
            )}
          </fieldset>

          <fieldset className="create-email-page__fieldset">
            <legend>Start From</legend>
            <div className="create-email-page__start-grid">
              {START_TYPE_OPTIONS.map((option) => (
                <SelectionCard
                  key={option.value}
                  name="start_type"
                  value={option.value}
                  label={option.label}
                  description={option.description}
                  icon={option.icon}
                  selected={startType === option.value}
                  disabled={!option.available}
                  footnote={option.available ? undefined : 'Coming soon'}
                  onSelect={() => setStartType(option.value)}
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
            <button
              type="button"
              className="button button--outline"
              onClick={() => navigate('/email-builder')}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={submitting}>
              {submitting && <span className="mdaiw-icon mdaiw-icon--spinner create-email-page__spinner" aria-hidden="true" />}
              {startType === 'template' ? 'Choose Template →'
                : startType === 'html' ? 'Import HTML →'
                : startType === 'ai' ? 'Generate with AI →'
                : submitting ? 'Creating…' : 'Create Blank Email →'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

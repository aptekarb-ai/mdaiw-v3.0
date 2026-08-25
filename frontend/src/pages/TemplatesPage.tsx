import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { EmailListPicker } from '../emailbuilder/EmailListPicker';
import { CreateFromTemplateDialog } from '../emailbuilder/CreateFromTemplateDialog';
import { createEmailDocumentFromTemplate } from '../emailbuilder/duplicateEmailDocument';
import type { EmailDocument } from '../emailbuilder/types';
import type { ApiError } from '../types/auth';
import './EmailBuilderDashboardPage.css';

// Phase B (Template Experience) — the ONE template-selection/create-from-
// template experience shared by all three entry points: Dashboard's
// "Choose Template" quick action routes here directly
// (EmailBuilderDashboardPage's ACTION_ROUTES), Create Email's "Template"
// start type hands off here (CreateEmailPage.handleSubmit), and the left
// nav's "Templates" item is this route. Same list infra as every other
// standalone picker (EmailListPicker/useRecentEmails/filterAndSortEmails),
// narrowed to start_type='template' via EmailListPicker's startTypeFilter
// prop — no second list-fetch/filter engine. "Use this template" creates a
// brand-new EmailDocument via createEmailDocumentFromTemplate (which never
// mutates the source template) and navigates into the existing builder,
// where the normal useEmailBuilderState mutation/history/autosave engine
// takes over — no new builder-state system.
export function TemplatesPage() {
  const navigate = useNavigate();
  const [selectedTemplate, setSelectedTemplate] = useState<EmailDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function handleUseTemplate(template: EmailDocument) {
    setSelectedTemplate(template);
    setCreateError(null);
  }

  function handleCancel() {
    if (creating) return;
    setSelectedTemplate(null);
    setCreateError(null);
  }

  async function handleCreate(name: string) {
    if (!selectedTemplate) return;
    setCreating(true);
    setCreateError(null);
    try {
      const document = await createEmailDocumentFromTemplate(selectedTemplate, name);
      navigate(`/email-builder/builder/${document.id}`);
    } catch (caught) {
      const error = caught as ApiError;
      setCreateError(
        error.errors?.name?.[0] ?? error.message ?? 'We could not create this email. Please try again.',
      );
      setCreating(false);
    }
  }

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>Templates</h1>
          <p>Start a new email from one of your saved templates.</p>
        </div>
        <Link to="/email-builder" className="button button--outline">Back to Email Dashboard</Link>
      </header>

      <EmailListPicker
        heading="Your saved templates"
        startTypeFilter="template"
        emptyStateLabel="No templates yet"
        emptyHint="Save an email as a template from the builder's Export & Deploy panel, then come back here to start a new email from it."
        renderRowActions={(email) => (
          <button type="button" className="button button--primary" onClick={() => handleUseTemplate(email)}>
            Use this template
          </button>
        )}
      />

      {selectedTemplate && (
        <CreateFromTemplateDialog
          templateName={selectedTemplate.name}
          defaultName={`Copy of ${selectedTemplate.name}`}
          creating={creating}
          error={createError}
          onCreate={handleCreate}
          onCancel={handleCancel}
        />
      )}
    </section>
  );
}

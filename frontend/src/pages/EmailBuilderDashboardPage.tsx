import { QUICK_ACTIONS, GETTING_STARTED_STEPS } from '../emailbuilder/dashboardData';
import { useRecentEmails } from '../emailbuilder/useRecentEmails';
import './EmailBuilderDashboardPage.css';

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function EmailBuilderDashboardPage() {
  const { status, emails } = useRecentEmails();

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <h1>AI Email Builder</h1>
        <p>
          Build compatible, responsive emails in minutes using reusable modules and AI —
          then preview, validate, and export with confidence.
        </p>
      </header>

      <div className="email-builder-dashboard__actions" role="group" aria-label="Quick actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            className="email-builder-dashboard__action"
            disabled
            aria-describedby={`email-builder-action-status-${action.key}`}
          >
            <span className={`mdaiw-icon mdaiw-icon--${action.icon}`} aria-hidden="true" />
            <span className="email-builder-dashboard__action-title">{action.title}</span>
            <span className="email-builder-dashboard__action-description">{action.description}</span>
            <span
              id={`email-builder-action-status-${action.key}`}
              className="email-builder-dashboard__action-status"
            >
              Coming soon
            </span>
          </button>
        ))}
      </div>

      <div className="email-builder-dashboard__body">
        <section aria-labelledby="email-builder-recent-heading" className="email-builder-dashboard__recent">
          <h2 id="email-builder-recent-heading">Recent Emails</h2>
          {status === 'loading' && <p>Loading recent emails…</p>}
          {status === 'error' && (
            <p role="alert">We could not load your recent emails. Please try again.</p>
          )}
          {status === 'success' && emails.length === 0 && (
            <div className="email-builder-dashboard__empty">
              <span className="mdaiw-icon mdaiw-icon--email" aria-hidden="true" />
              <p>You have not created any emails yet.</p>
              <p className="email-builder-dashboard__empty-hint">
                Use one of the actions above to create your first email.
              </p>
            </div>
          )}
          {status === 'success' && emails.length > 0 && (
            <ul className="email-builder-dashboard__list">
              {emails.map((email) => (
                <li key={email.id} className="email-builder-dashboard__list-item">
                  <span className="email-builder-dashboard__list-name">{email.name}</span>
                  <span className="email-builder-dashboard__list-platform">{email.platform}</span>
                  <span className="email-builder-dashboard__list-updated">
                    {formatUpdatedAt(email.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="email-builder-getting-started-heading"
          className="email-builder-dashboard__getting-started"
        >
          <h2 id="email-builder-getting-started-heading">Getting Started</h2>
          <ol className="email-builder-dashboard__steps">
            {GETTING_STARTED_STEPS.map((step) => (
              <li key={step.step} className="email-builder-dashboard__step">
                <span className="email-builder-dashboard__step-number" aria-hidden="true">
                  {step.step}
                </span>
                {step.title}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

import { useNavigate, Link } from 'react-router';
import { EmailListPicker } from '../emailbuilder/EmailListPicker';
import type { EmailDocument } from '../emailbuilder/types';
import './EmailBuilderDashboardPage.css';

// Module-4 Navigation Completion, Phase A — same architecture as
// PreviewValidationEntryPage: AIEngineerPanel requires an already-loaded
// document and its own builder mutation callbacks, so this is a picker
// that hands off into the SAME existing AI Engineer tab via a `?tab=ai`
// deep link — no second AI Engineer panel, command system, composition
// engine, or mutation path.
export function AIEngineerEntryPage() {
  const navigate = useNavigate();

  function openAiEngineer(email: EmailDocument) {
    navigate(`/email-builder/builder/${email.id}?tab=ai`);
  }

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>AI Engineer</h1>
          <p>Choose an email to edit, optimize or fix with the AI Engineer.</p>
        </div>
        <Link to="/email-builder" className="button button--outline">Back to Email Dashboard</Link>
      </header>

      <EmailListPicker
        heading="Choose an email"
        emptyHint="Create an email first, then come back here to open it with AI Engineer."
        renderRowActions={(email) => (
          <button type="button" className="button button--primary" onClick={() => openAiEngineer(email)}>
            Open in AI Engineer
          </button>
        )}
      />
    </section>
  );
}

import { useNavigate, Link } from 'react-router';
import { EmailListPicker } from '../emailbuilder/EmailListPicker';
import type { EmailDocument } from '../emailbuilder/types';
import './EmailBuilderDashboardPage.css';

// Module-4 Navigation Completion, Phase A — "Preview & Validation" is not
// a document-less destination: PreviewStudioPanel/ValidationCenterPanel
// both require an already-loaded EmailDocumentContent (ValidationCenter
// additionally needs live builder mutation callbacks), so this page is a
// picker that hands off into the SAME existing in-builder tabs via a
// `?tab=` deep link — never a second Preview/Validation implementation.
export function PreviewValidationEntryPage() {
  const navigate = useNavigate();

  function openTab(email: EmailDocument, tab: 'preview' | 'validate') {
    navigate(`/email-builder/builder/${email.id}?tab=${tab}`);
  }

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>Preview &amp; Validation</h1>
          <p>Choose an email to preview across devices or run validation checks.</p>
        </div>
        <Link to="/email-builder" className="button button--outline">Back to Email Dashboard</Link>
      </header>

      <EmailListPicker
        heading="Choose an email"
        emptyHint="Create an email first, then come back here to preview or validate it."
        renderRowActions={(email) => (
          <>
            <button type="button" className="button button--outline" onClick={() => openTab(email, 'preview')}>
              Preview
            </button>
            <button type="button" className="button button--primary" onClick={() => openTab(email, 'validate')}>
              Validate
            </button>
          </>
        )}
      />
    </section>
  );
}

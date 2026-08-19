import { useNavigate, useParams } from 'react-router';
import './EmailBuilderPendingPage.css';

// The post-create landing spot for a draft (see CreateEmailPage). Feature
// 03 (the drag/drop canvas) is not implemented yet, so this is a
// deliberate, honestly-labelled stub tied to the real created draft id —
// not a fake finished editor.
export function EmailBuilderPendingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <section className="email-builder-pending">
      <div className="email-builder-pending__card">
        <span className="mdaiw-icon mdaiw-icon--check-circle" aria-hidden="true" />
        <h1>Draft created</h1>
        <p>
          Email draft <strong>#{id}</strong> was created successfully. The drag-and-drop builder will be
          implemented in a future phase.
        </p>
        <div className="email-builder-pending__actions">
          <button type="button" className="button button--outline" onClick={() => navigate('/email-builder')}>
            Back to Dashboard
          </button>
          <button type="button" className="button button--primary" onClick={() => navigate('/email-builder/create')}>
            Create Another Email →
          </button>
        </div>
      </div>
    </section>
  );
}

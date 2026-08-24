import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { ModuleLibraryModal } from '../emailbuilder/ModuleLibraryModal';
import { ChooseEmailForInsertDialog } from '../emailbuilder/ChooseEmailForInsertDialog';
import { useSavedModules } from '../emailbuilder/useSavedModules';
import { createEmailDocument } from '../api/client';
import { DEFAULT_PLATFORM } from '../emailbuilder/platformOptions';
import { DEFAULT_EMAIL_WIDTH } from '../emailbuilder/widthOptions';
import { getModuleDefinition } from '../emailbuilder/moduleRegistry';
import type { EmailModuleType } from '../emailbuilder/edm';
import type { EmailDocument, SavedEmailModule } from '../emailbuilder/types';
import './EmailBuilderDashboardPage.css';

type PendingInsert =
  | { kind: 'module'; type: EmailModuleType }
  | { kind: 'saved'; saved: SavedEmailModule };

function pendingLabel(pending: PendingInsert): string {
  return pending.kind === 'module' ? getModuleDefinition(pending.type).label : pending.saved.name;
}

// Module-4 Navigation Completion, Phase A — Module Library exposed as a
// standalone destination. Reuses ModuleLibraryModal (Feature 04) and
// getAllModuleDefinitions()/listSavedModules() UNCHANGED — no second
// module registry. Browsing/searching/deleting saved modules works with
// no document open (all document-independent per their own API shape);
// "Add" (which means "insert into an email" in-builder) instead opens the
// choose-an-email handoff below, so it never silently no-ops.
export function ModuleLibraryPage() {
  const navigate = useNavigate();
  const savedModulesState = useSavedModules();
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const pendingInsertRef = useRef<PendingInsert | null>(null);

  function handleAddModule(type: EmailModuleType) {
    const pending: PendingInsert = { kind: 'module', type };
    pendingInsertRef.current = pending;
    setPendingInsert(pending);
  }

  function handleAddSavedModule(saved: SavedEmailModule) {
    const pending: PendingInsert = { kind: 'saved', saved };
    pendingInsertRef.current = pending;
    setPendingInsert(pending);
  }

  function handleLibraryClose() {
    // ModuleLibraryModal calls onAddModule/onAddSavedModule THEN onClose()
    // synchronously on every card click — pendingInsertRef (set
    // synchronously above, unlike state) lets this distinguish "closed
    // because a module was picked" (stay on this page, show the chooser)
    // from "closed because the user backed out" (return to the dashboard).
    if (pendingInsertRef.current) {
      pendingInsertRef.current = null;
      return;
    }
    navigate('/email-builder');
  }

  function insertParam(pending: PendingInsert): string {
    return pending.kind === 'module'
      ? `insertModuleType=${encodeURIComponent(pending.type)}`
      : `insertSavedModuleId=${pending.saved.id}`;
  }

  function handleChooseExisting(email: EmailDocument) {
    if (!pendingInsert) return;
    navigate(`/email-builder/builder/${email.id}?${insertParam(pendingInsert)}`);
  }

  async function handleCreateBlank() {
    if (!pendingInsert) return;
    setCreateError(null);
    setCreatingBlank(true);
    try {
      const doc = await createEmailDocument({
        name: 'Untitled Email', platform: DEFAULT_PLATFORM, width: DEFAULT_EMAIL_WIDTH, start_type: 'blank',
      });
      navigate(`/email-builder/builder/${doc.id}?${insertParam(pendingInsert)}`);
    } catch {
      setCreateError('Could not create a new email. Please try again.');
    } finally {
      setCreatingBlank(false);
    }
  }

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>Module Library</h1>
          <p>Browse built-in and saved modules.</p>
        </div>
        <Link to="/email-builder" className="button button--outline">Back to Email Dashboard</Link>
      </header>

      {createError && (
        <p role="alert" className="email-builder-dashboard__inline-error">{createError}</p>
      )}

      {!pendingInsert && (
        <ModuleLibraryModal
          savedModules={savedModulesState.savedModules}
          onAddModule={handleAddModule}
          onAddSavedModule={handleAddSavedModule}
          onDeleteSavedModule={savedModulesState.removeModule}
          onClose={handleLibraryClose}
        />
      )}

      {pendingInsert && (
        <ChooseEmailForInsertDialog
          itemLabel={pendingLabel(pendingInsert)}
          creating={creatingBlank}
          onChooseExisting={handleChooseExisting}
          onCreateBlank={handleCreateBlank}
          onCancel={() => setPendingInsert(null)}
        />
      )}
    </section>
  );
}

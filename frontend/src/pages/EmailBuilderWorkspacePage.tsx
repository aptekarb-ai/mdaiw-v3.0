import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { getEmailDocument, updateEmailDocument } from '../api/client';
import type { EmailDocument as EmailDocumentRecord } from '../emailbuilder/types';
import { normalizeContent } from '../emailbuilder/edmMigration';
import { useEmailBuilderState } from '../emailbuilder/useEmailBuilderState';
import { useSavedModules } from '../emailbuilder/useSavedModules';
import { BuilderToolbar, type SaveStatus } from '../emailbuilder/BuilderToolbar';
import { ModulePanel } from '../emailbuilder/ModulePanel';
import { EmailCanvas, type BuilderViewMode } from '../emailbuilder/EmailCanvas';
import { PropertiesPanel } from '../emailbuilder/PropertiesPanel';
import { SaveModuleDialog } from '../emailbuilder/SaveModuleDialog';
import { getModuleDefinition } from '../emailbuilder/moduleRegistry';
import type { ApiError } from '../types/auth';
import './EmailBuilderWorkspacePage.css';

type LoadStatus = 'loading' | 'ready' | 'not-found' | 'error';

export function EmailBuilderWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [document, setDocument] = useState<EmailDocumentRecord | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [viewMode, setViewMode] = useState<BuilderViewMode>('desktop');
  // Local/temporary — not persisted across sessions (deliberately not
  // over-engineered per the refinement brief), just extra canvas room.
  const [modulesPanelCollapsed, setModulesPanelCollapsed] = useState(false);
  const [propertiesPanelCollapsed, setPropertiesPanelCollapsed] = useState(false);
  const [saveModuleTargetId, setSaveModuleTargetId] = useState<string | null>(null);
  const [savingModule, setSavingModule] = useState(false);

  const builder = useEmailBuilderState();
  const savedModulesState = useSavedModules();

  useEffect(() => {
    let cancelled = false;
    if (!id) return undefined;

    setLoadStatus('loading');
    getEmailDocument(id)
      .then((loaded) => {
        if (cancelled) return;
        const normalizedContent = normalizeContent(loaded.content);
        setDocument({ ...loaded, content: normalizedContent });
        builder.loadModules(normalizedContent.modules);
        setLoadStatus('ready');
      })
      .catch((caught) => {
        if (cancelled) return;
        const error = caught as ApiError;
        if (error.status === 404) {
          setLoadStatus('not-found');
        } else if (error.status === 403 || error.status === 401) {
          setLoadStatus('error');
          setLoadError('You do not have access to this email.');
        } else {
          setLoadStatus('error');
          setLoadError(error.message || 'We could not load this email. Please try again.');
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per id; builder is a stable-callback hook instance
  }, [id]);

  const handleSave = useCallback(() => {
    if (!id) return;
    setSaveStatus('saving');
    updateEmailDocument(id, { content: { version: 1, modules: builder.modules } })
      .then((saved) => {
        setDocument(saved);
        builder.markSaved();
        setSaveStatus('saved');
      })
      .catch(() => {
        setSaveStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, builder.modules, builder.markSaved]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isMeta = event.ctrlKey || event.metaKey;
      if (!isMeta) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        builder.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        builder.redo();
      } else if (key === 's') {
        event.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [builder, handleSave]);

  const saveModuleTarget = saveModuleTargetId
    ? builder.modules.find((module) => module.id === saveModuleTargetId) ?? null
    : null;

  const handleConfirmSaveModule = useCallback(async (name: string) => {
    if (!saveModuleTarget) return;
    setSavingModule(true);
    try {
      await savedModulesState.saveModule(name, saveModuleTarget);
      setSaveModuleTargetId(null);
    } catch {
      // useSavedModules surfaces load errors via `error`; a save failure
      // here just leaves the dialog open so the user can retry.
    } finally {
      setSavingModule(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveModuleTarget, savedModulesState.saveModule]);

  if (loadStatus === 'loading') {
    return (
      <div className="email-builder-workspace__status">
        <p>Loading email…</p>
      </div>
    );
  }

  if (loadStatus === 'not-found') {
    return (
      <div className="email-builder-workspace__status">
        <p>Email not found.</p>
      </div>
    );
  }

  if (loadStatus === 'error' || !document) {
    return (
      <div className="email-builder-workspace__status" role="alert">
        <p>{loadError ?? 'We could not load this email. Please try again.'}</p>
      </div>
    );
  }

  return (
    <div className="email-builder-workspace">
      <BuilderToolbar
        name={document.name}
        platform={document.platform}
        width={document.width}
        dirty={builder.dirty}
        saveStatus={saveStatus}
        canUndo={builder.canUndo}
        canRedo={builder.canRedo}
        viewMode={viewMode}
        onUndo={builder.undo}
        onRedo={builder.redo}
        onSave={handleSave}
        onViewModeChange={setViewMode}
      />

      {saveStatus === 'error' && (
        <p className="email-builder-workspace__save-error" role="alert">
          <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
          We could not save your changes. Please try again.
        </p>
      )}

      <div className="email-builder-workspace__body">
        <ModulePanel
          onAddModule={builder.addModule}
          savedModules={savedModulesState.savedModules}
          onAddSavedModule={builder.addSavedModule}
          onDeleteSavedModule={savedModulesState.removeModule}
          collapsed={modulesPanelCollapsed}
          onToggleCollapsed={() => setModulesPanelCollapsed((current) => !current)}
        />
        <EmailCanvas
          modules={builder.modules}
          selectedModuleId={builder.selectedModuleId}
          width={document.width}
          viewMode={viewMode}
          savedModules={savedModulesState.savedModules}
          onSelect={builder.selectModule}
          onDelete={builder.deleteModule}
          onDuplicate={builder.duplicateModule}
          onReorder={builder.reorderModules}
          onDropNewModule={builder.insertModuleAt}
          onDropSavedModule={builder.insertSavedModuleAt}
          onSaveModule={setSaveModuleTargetId}
          onAddFirstModule={() => builder.addModule('text')}
        />
        <PropertiesPanel
          module={builder.selectedModule}
          viewport={viewMode}
          onUpdateProps={builder.updateModuleProps}
          onUpdateSettings={builder.updateModuleSettings}
          collapsed={propertiesPanelCollapsed}
          onToggleCollapsed={() => setPropertiesPanelCollapsed((current) => !current)}
        />
      </div>

      {saveModuleTarget && (
        <SaveModuleDialog
          moduleLabel={getModuleDefinition(saveModuleTarget.type).label}
          saving={savingModule}
          onSave={handleConfirmSaveModule}
          onCancel={() => setSaveModuleTargetId(null)}
        />
      )}
    </div>
  );
}

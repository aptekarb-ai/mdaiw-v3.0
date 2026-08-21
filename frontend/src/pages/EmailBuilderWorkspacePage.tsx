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
import { PropertiesPanel, type SelectedColumnContext } from '../emailbuilder/PropertiesPanel';
import { SaveModuleDialog } from '../emailbuilder/SaveModuleDialog';
import { getModuleDefinition } from '../emailbuilder/moduleRegistry';
import { findModulePath, isLayoutModuleType } from '../emailbuilder/layoutModel';
import type { EmailModuleType } from '../emailbuilder/edm';
import type { SavedEmailModule } from '../emailbuilder/types';
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

  // Feature 05 — where the current selection actually lives in the tree
  // (top-level module, or nested inside a layout's column). Drives the
  // Properties-panel breadcrumb, nested-aware prop/setting update
  // routing, and "insert into the active column" (instruction 12).
  const selectionPath = builder.selectedModuleId
    ? findModulePath(builder.modules, builder.selectedModuleId)
    : null;
  const selectedTopLevelModule = builder.selectedModule && !selectionPath?.layout ? builder.selectedModule : null;

  const activeColumn = builder.selectedColumn
    ?? (selectionPath?.layout && selectionPath?.column
      ? { layoutId: selectionPath.layout.id, columnId: selectionPath.column.id }
      : null);

  const selectedColumnContext: SelectedColumnContext | null = (() => {
    if (!builder.selectedColumn || !selectedTopLevelModule?.columns) return null;
    const columnIndex = selectedTopLevelModule.columns.findIndex((c) => c.id === builder.selectedColumn!.columnId);
    const column = selectedTopLevelModule.columns[columnIndex];
    if (!column) return null;
    return { layoutId: builder.selectedColumn.layoutId, column, columnIndex };
  })();

  const breadcrumb: string[] = (() => {
    if (selectionPath?.layout && selectionPath?.column) {
      const columnIndex = selectionPath.layout.columns?.findIndex((c) => c.id === selectionPath.column!.id) ?? -1;
      return [
        getModuleDefinition(selectionPath.layout.type).label,
        `Column ${columnIndex + 1}`,
        getModuleDefinition(selectionPath.module.type).label,
      ];
    }
    if (selectedTopLevelModule?.columns && builder.selectedColumn) {
      const columnIndex = selectedTopLevelModule.columns.findIndex((c) => c.id === builder.selectedColumn!.columnId);
      return [getModuleDefinition(selectedTopLevelModule.type).label, `Column ${columnIndex + 1}`];
    }
    if (selectedTopLevelModule) {
      return [getModuleDefinition(selectedTopLevelModule.type).label];
    }
    return [];
  })();

  const breadcrumbLayoutId = selectionPath?.layout?.id ?? (selectedTopLevelModule?.columns ? selectedTopLevelModule.id : null);

  const handleUpdateProps = useCallback((id: string, patch: Record<string, unknown>) => {
    const path = findModulePath(builder.modules, id);
    if (path?.layout && path?.column) {
      builder.updateNestedModuleProps(path.layout.id, path.column.id, id, patch);
    } else {
      builder.updateModuleProps(id, patch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder is a stable-callback hook instance
  }, [builder.modules]);

  const handleUpdateSettings = useCallback((id: string, patch: Record<string, unknown>) => {
    const path = findModulePath(builder.modules, id);
    if (path?.layout && path?.column) {
      builder.updateNestedModuleSettings(path.layout.id, path.column.id, id, patch);
    } else {
      builder.updateModuleSettings(id, patch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder.modules]);

  const handleAddModule = useCallback((type: EmailModuleType) => {
    if (activeColumn && !isLayoutModuleType(type)) {
      builder.insertNestedModule(activeColumn.layoutId, activeColumn.columnId, type);
    } else {
      builder.addModule(type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeColumn]);

  const handleAddSavedModule = useCallback((saved: SavedEmailModule) => {
    if (activeColumn && !isLayoutModuleType(saved.module_type)) {
      builder.insertNestedSavedModule(activeColumn.layoutId, activeColumn.columnId, saved);
    } else {
      builder.addSavedModule(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeColumn]);

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
          onAddModule={handleAddModule}
          savedModules={savedModulesState.savedModules}
          onAddSavedModule={handleAddSavedModule}
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
          activeColumn={activeColumn}
          onSelectColumn={builder.selectColumn}
          onSelectNestedModule={builder.selectModule}
          onInsertNestedModule={builder.insertNestedModule}
          onInsertNestedSavedModule={builder.insertNestedSavedModule}
          onReorderNested={builder.reorderNestedModule}
          onMoveNested={builder.moveNestedModule}
          onDuplicateNested={builder.duplicateNestedModule}
          onDeleteNested={builder.deleteNestedModule}
        />
        <PropertiesPanel
          module={builder.selectedModule}
          selectedColumn={selectedColumnContext}
          breadcrumb={breadcrumb}
          breadcrumbLayoutId={breadcrumbLayoutId}
          viewport={viewMode}
          onUpdateProps={handleUpdateProps}
          onUpdateSettings={handleUpdateSettings}
          onUpdateColumnWidths={builder.updateColumnWidths}
          onUpdateColumnSettings={builder.updateColumnSettings}
          onSelectColumn={builder.selectColumn}
          onSelectModule={builder.selectModule}
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

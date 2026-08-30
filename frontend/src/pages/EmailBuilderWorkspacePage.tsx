import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { getEmailDocument, updateEmailDocument } from '../api/client';
import type { EmailDocument as EmailDocumentRecord } from '../emailbuilder/types';
import { normalizeContent } from '../emailbuilder/edmMigration';
import { useEmailBuilderState } from '../emailbuilder/useEmailBuilderState';
import { useSavedModules } from '../emailbuilder/useSavedModules';
import { BuilderToolbar, type EditorMode, type SaveStatus } from '../emailbuilder/BuilderToolbar';
import { ModulePanel } from '../emailbuilder/ModulePanel';
import { EmailCanvas, type BuilderViewMode } from '../emailbuilder/EmailCanvas';
import { PropertiesPanel, type SelectedColumnContext } from '../emailbuilder/PropertiesPanel';
import { SaveModuleDialog } from '../emailbuilder/SaveModuleDialog';
import { CodeEditorPanel } from '../emailbuilder/CodeEditorPanel';
import { PreviewStudioPanel } from '../emailbuilder/PreviewStudioPanel';
import { ValidationCenterPanel } from '../emailbuilder/ValidationCenterPanel';
import { AIEngineerPanel } from '../emailbuilder/AIEngineerPanel';
import type { AICommandAction, RepairActionItem } from '../emailbuilder/aiCommand';
import { PlatformEnvironmentDialog } from '../emailbuilder/PlatformEnvironmentDialog';
import { DocumentSettingsDialog, type DocumentSettingsInput } from '../emailbuilder/DocumentSettingsDialog';
import { ExportDeployDialog } from '../emailbuilder/ExportDeployDialog';
import { saveEmailAsTemplate } from '../emailbuilder/duplicateEmailDocument';
import { getModuleDefinition } from '../emailbuilder/moduleRegistry';
import { findModulePath, isLayoutModuleType } from '../emailbuilder/layoutModel';
import { renderEmailDocument } from '../emailbuilder/htmlRenderer';
import type { EmailModuleType } from '../emailbuilder/edm';
import type { EmailPlatform, SavedEmailModule } from '../emailbuilder/types';
import type { ApiError } from '../types/auth';
import './EmailBuilderWorkspacePage.css';

type LoadStatus = 'loading' | 'ready' | 'not-found' | 'error';

// Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom) — approved
// bounds: 50%-150%, 25% steps, 100% default/reset. Visual-canvas-viewport
// concern only — see EmailCanvas.tsx's zoom transform.
const ZOOM_MIN = 50;
const ZOOM_MAX = 150;
const ZOOM_STEP = 25;
const ZOOM_DEFAULT = 100;

// Module-4 Navigation Completion, Phase A — the standalone Preview &
// Validation / AI Engineer / Module Library entry points deep-link here
// with one of `?tab=`, `?insertModuleType=`, `?insertSavedModuleId=`.
// Only these three exact values are honored for `tab` — anything else is
// ignored (falls back to the normal 'visual' default) rather than trusting
// an arbitrary query string as an EditorMode.
const DEEP_LINK_TABS: ReadonlySet<string> = new Set(['preview', 'validate', 'ai']);

export function EmailBuilderWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [document, setDocument] = useState<EmailDocumentRecord | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [viewMode, setViewMode] = useState<BuilderViewMode>('desktop');
  const [editorMode, setEditorMode] = useState<EditorMode>('visual');
  // Phase E1 (Export -> Validation nav) — set only when arriving at the
  // Validate tab via ExportDeployDialog's "View in Validation" action;
  // ValidationCenterPanel consumes it once (by id) to scroll/highlight
  // that one finding. Not persisted, not a second validation state.
  const [highlightValidationIssueId, setHighlightValidationIssueId] = useState<string | null>(null);
  // Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom) — ephemeral
  // editor-viewport state only: never sent to the backend, never stored on
  // EmailDocument/EDM, never persisted to localStorage. Reset to 100 every
  // time a document is freshly loaded (see the getEmailDocument effect
  // below) — it must not "leak" between documents or survive a reload.
  const [zoomLevel, setZoomLevel] = useState(ZOOM_DEFAULT);
  // Local/temporary — not persisted across sessions (deliberately not
  // over-engineered per the refinement brief), just extra canvas room.
  const [modulesPanelCollapsed, setModulesPanelCollapsed] = useState(false);
  const [propertiesPanelCollapsed, setPropertiesPanelCollapsed] = useState(false);
  const [saveModuleTargetId, setSaveModuleTargetId] = useState<string | null>(null);
  const [savingModule, setSavingModule] = useState(false);
  const [platformDialogOpen, setPlatformDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [documentSettingsDialogOpen, setDocumentSettingsDialogOpen] = useState(false);

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
        builder.loadModules(normalizedContent.modules, {
          email_title: loaded.email_title,
          email_subject: loaded.email_subject,
          favicon_url: loaded.favicon_url,
          reset_css_enabled: loaded.reset_css_enabled,
          custom_css_enabled: loaded.custom_css_enabled,
          custom_css: loaded.custom_css,
        });
        setZoomLevel(ZOOM_DEFAULT);
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

  // Module-4 Navigation Completion, Phase A — one-shot deep-link handling
  // for the standalone entry points. Applies at most once per page load
  // (deepLinkAppliedRef), through the SAME existing setEditorMode/
  // builder.addModule/builder.addSavedModule calls a normal in-builder
  // interaction would use — no second tab-selection or insertion path.
  // The query params are stripped immediately after being applied so a
  // refresh doesn't re-select the tab or re-insert the module.
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (loadStatus !== 'ready' || deepLinkAppliedRef.current) return;
    const tabParam = searchParams.get('tab');
    const insertModuleType = searchParams.get('insertModuleType');
    const insertSavedModuleId = searchParams.get('insertSavedModuleId');
    if (!tabParam && !insertModuleType && !insertSavedModuleId) return;

    // Saved-module insertion needs the saved-modules list loaded first —
    // wait rather than silently dropping the deep link.
    if (insertSavedModuleId && savedModulesState.loading) return;

    deepLinkAppliedRef.current = true;

    if (tabParam && DEEP_LINK_TABS.has(tabParam)) {
      setEditorMode(tabParam as EditorMode);
    }
    if (insertModuleType) {
      builder.addModule(insertModuleType as EmailModuleType);
    }
    if (insertSavedModuleId) {
      const match = savedModulesState.savedModules.find((saved) => String(saved.id) === insertSavedModuleId);
      if (match) builder.addSavedModule(match);
    }

    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.delete('insertModuleType');
    next.delete('insertSavedModuleId');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder/savedModulesState are stable-callback hook instances; searchParams/setSearchParams intentionally re-checked each render until applied
  }, [loadStatus, searchParams, savedModulesState.loading]);

  // Module-4 Final Gap Closure, Correction 3 (Feature 03 autosave) —
  // revision/snapshot-safe save orchestration. Three refs, all scoped to
  // this ONE save path (still Sub-phase 2 closure's single content+
  // document-settings PATCH below — no second persistence system):
  //   - savingRef: a PATCH is currently in flight.
  //   - inFlightRevisionRef: the builder.revision snapshot that in-flight
  //     PATCH is persisting.
  //   - pendingSaveRef: edits (or another save request) arrived while a
  //     PATCH was in flight, so exactly one follow-up save is owed once it
  //     settles.
  // performSave is called from three places — the autosave debounce
  // effect, handleSave (manual button/Ctrl+S), and its own completion
  // handler (the follow-up save) — and is safe to call from all three
  // concurrently: if nothing is in flight it starts a PATCH with the
  // CURRENT (latest) modules/documentSettings; if something is already in
  // flight it never starts a second request, it only ever records that a
  // follow-up is owed. Rapid edits therefore always collapse into the
  // single latest state instead of racing overlapping PATCHes, and a
  // stale (older-revision) response can never call markSaved() over newer
  // unsaved edits — see the revision comparison in the .then() below.
  const savingRef = useRef(false);
  const inFlightRevisionRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);

  const performSave = useCallback(() => {
    if (!id) return;
    const requestedRevision = builder.getRevision();
    if (savingRef.current) {
      if (inFlightRevisionRef.current !== requestedRevision) {
        pendingSaveRef.current = true;
      }
      return;
    }
    savingRef.current = true;
    inFlightRevisionRef.current = requestedRevision;
    pendingSaveRef.current = false;
    setSaveStatus('saving');
    const modulesSnapshot = builder.getModules();
    const documentSettingsSnapshot = builder.getDocumentSettings();
    updateEmailDocument(id, { content: { version: 1, modules: modulesSnapshot }, ...documentSettingsSnapshot })
      .then((saved) => {
        savingRef.current = false;
        setDocument(saved);
        if (builder.getRevision() === inFlightRevisionRef.current) {
          builder.markSaved();
          setSaveStatus('saved');
        } else {
          // Newer edits landed while this PATCH was in flight — leave
          // `dirty` untouched (still true) rather than clearing it over
          // content this response never actually persisted.
          pendingSaveRef.current = true;
        }
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          performSave();
        }
      })
      .catch(() => {
        savingRef.current = false;
        // Dirty stays true (never cleared here) so a later manual Save or
        // the next edit's autosave debounce can retry.
        setSaveStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder is a stable-callback hook instance
  }, [id]);

  const autosaveTimerRef = useRef<number | null>(null);

  // Trailing-edge 2-second debounce: fires exactly once, 2s after the
  // MOST RECENT commit/undo/redo (`builder.revision`) — every further
  // edit within that window clears and restarts the timer via this
  // effect's cleanup, so rapid edits never produce more than one PATCH.
  useEffect(() => {
    if (!builder.dirty) return undefined;
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      performSave();
    }, 2000);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [builder.revision, builder.dirty, performSave]);

  // Manual Save (button + Ctrl+S below) — flushes/cancels any pending
  // autosave debounce first, then calls the SAME performSave path (which
  // itself serializes behind an in-flight autosave rather than racing it).
  const handleSave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    performSave();
  }, [performSave]);

  // Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom) — pure
  // client-side viewport state, clamped to the approved 50-150 range in
  // 25-point steps. Never touches builder.modules/documentSettings, never
  // reaches the save path above.
  const handleZoomIn = useCallback(() => {
    setZoomLevel((current) => Math.min(ZOOM_MAX, current + ZOOM_STEP));
  }, []);
  const handleZoomOut = useCallback(() => {
    setZoomLevel((current) => Math.max(ZOOM_MIN, current - ZOOM_STEP));
  }, []);
  const handleZoomReset = useCallback(() => {
    setZoomLevel(ZOOM_DEFAULT);
  }, []);

  // Feature 10 — applying a platform switch PATCHes only `platform` (the
  // same endpoint/pattern as handleSave's `content`-only PATCH); it never
  // touches `content`, so an unsaved Visual edit is untouched by a platform
  // change. Throws on failure so PlatformEnvironmentDialog can show its own
  // inline error and keep itself open for a retry.
  const handleApplyPlatform = useCallback(async (platform: EmailPlatform) => {
    if (!id) return;
    const saved = await updateEmailDocument(id, { platform });
    setDocument(saved);
  }, [id]);

  // Sub-phase 2 closure, item 1 — Apply is a purely LOCAL commit into the
  // unified undo/redo history (builder.updateDocumentSettings), exactly
  // like every module mutator. No network call here at all; persistence
  // happens later via handleSave, together with module content. This
  // replaces the earlier per-field-PATCH design.
  const handleApplyDocumentSettings = useCallback((input: DocumentSettingsInput) => {
    builder.updateDocumentSettings(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder is a stable-callback hook instance
  }, []);

  // Sub-phase 2, item F — the AI Engineer's document-level (Reset/Custom
  // CSS) proposals commit through the EXACT SAME local function as
  // DocumentSettingsDialog's Apply — builder.updateDocumentSettings —
  // never a parallel mutation path, and they participate in the same
  // undo/redo history. Stays async (Promise<boolean>) only to match
  // AIEngineerPanel's existing Apply-button plumbing; a local commit
  // cannot fail, so this always resolves true.
  const handleApplyDocumentSettingAiAction = useCallback(async (action: AICommandAction): Promise<boolean> => {
    let input: Partial<DocumentSettingsInput> | null = null;
    switch (action.type) {
      case 'SET_RESET_CSS_ENABLED':
        input = { reset_css_enabled: action.enabled };
        break;
      case 'SET_CUSTOM_CSS_ENABLED':
        input = { custom_css_enabled: action.enabled };
        break;
      case 'SET_CUSTOM_CSS':
        // Only the CSS text — never silently also flips custom_css_enabled;
        // the proposal card only shows the CSS text diff, so applying it
        // must only do exactly that. If Custom CSS is currently disabled,
        // the reply/history already says "review the proposed change" —
        // enabling it is a separate, explicit action the user can ask for.
        input = { custom_css: action.css };
        break;
      case 'CLEAR_CUSTOM_CSS':
        input = { custom_css: '' };
        break;
      // Sub-phase 4, item 3 — same local-commit path, no network.
      case 'SET_EMAIL_TITLE':
        input = { email_title: action.title };
        break;
      case 'SET_EMAIL_SUBJECT':
        input = { email_subject: action.subject };
        break;
      case 'SET_FAVICON':
        input = { favicon_url: action.url };
        break;
      case 'CLEAR_FAVICON':
        input = { favicon_url: '' };
        break;
      default:
        return false;
    }
    builder.updateDocumentSettings(input);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder is a stable-callback hook instance
  }, []);

  // Sub-phase 4, item 4 — the Repair Engine's batched Apply: every item
  // (module- or document-scoped) commits through builder.applyRepairPatch
  // in ONE call/history step — see repairEngine.ts's
  // toApplyRepairPatchArgs for how the items are split. A local commit
  // cannot fail, so this always returns true (kept boolean/sync for
  // symmetry with handleApplyAiAction).
  const handleApplyRepairAction = useCallback((items: RepairActionItem[]): boolean => {
    const modulePatches = items
      .filter((item): item is Extract<RepairActionItem, { kind: 'module' }> => item.kind === 'module')
      .map((item) => ({ moduleId: item.moduleId, propPatch: item.propPatch }));
    // Sub-phase 6 — module SETTINGS repairs (e.g. enabling the VML
    // fallback) route through the same one-history-commit batch as prop
    // and document repairs, never a separate Apply.
    const settingsPatches = items
      .filter((item): item is Extract<RepairActionItem, { kind: 'module-settings' }> => item.kind === 'module-settings')
      .map((item) => ({ moduleId: item.moduleId, settingsPatch: item.settingsPatch }));
    const documentItems = items.filter((item): item is Extract<RepairActionItem, { kind: 'document' }> => item.kind === 'document');
    const documentPatch = documentItems.length > 0
      ? documentItems.reduce((acc, item) => ({ ...acc, ...item.documentPatch }), {} as Record<string, unknown>)
      : null;
    builder.applyRepairPatch(modulePatches, documentPatch, settingsPatches);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder is a stable-callback hook instance
  }, []);

  // Feature 13 — "Save as template" exports the CURRENT in-editor module
  // tree (builder.modules), not the last-saved `document.content` — so an
  // unsaved Visual edit is included in the template exactly as shown on
  // screen, same "what you see is what gets written" guarantee Save itself
  // gives for the original document.
  const handleSaveAsTemplate = useCallback(async (templateName: string) => {
    if (!document) throw new Error('No document loaded');
    return saveEmailAsTemplate(
      { ...document, content: { version: 1, modules: builder.modules }, ...builder.documentSettings },
      templateName,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder is a stable-callback hook instance
  }, [document, builder.modules, builder.documentSettings]);

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

  // Feature 14 — applies an AI Engineer-proposed action through the SAME
  // builder mutation functions every manual edit uses (no parallel
  // mutation system), so it participates in undo/redo for free. For the
  // three "target: selected" action types, the canvas selection at Apply
  // time must still be the exact module that was selected when the
  // command was sent (`capturedSelectedModuleId`) — if the user changed
  // the selection while the proposal card was showing, this safely
  // declines rather than silently mutating the wrong module.
  const handleApplyAiAction = useCallback((action: AICommandAction, capturedSelectedModuleId: string | null): boolean => {
    // Sub-phase 6 — the same "selection must not have changed since the
    // proposal was shown" safety gate UPDATE_MODULE_PROPS already uses,
    // extended to every new target:'selected' action type.
    const targetsCurrentSelection = action.type === 'UPDATE_MODULE_PROPS' || action.type === 'DELETE_MODULE'
      || action.type === 'DUPLICATE_MODULE' || action.type === 'UPDATE_MODULE_SETTINGS'
      || action.type === 'APPLY_VML_PATTERN' || action.type === 'APPLY_OUTLOOK_WRAPPER'
      || action.type === 'RESTRUCTURE_LAYOUT' || action.type === 'REPLACE_UNSUPPORTED_PROPERTY'
      || action.type === 'UPDATE_REPEATABLE_FIELD';
    if (targetsCurrentSelection && builder.selectedModuleId !== capturedSelectedModuleId) {
      return false;
    }

    switch (action.type) {
      case 'INSERT_MODULE': {
        const entries = action.modules.map((entry) => ({ type: entry.module_type, patch: entry.patch }));
        builder.addModulesWithProps(entries);
        return true;
      }
      // Sub-phase 7 — the composition engine's one action type. Maps the
      // backend's snake_case wire shape onto useEmailBuilderState.ts's
      // camelCase ComposedModuleEntry — a pure adapter, no additional
      // validation here (the backend's validate_action() already fully
      // validated every module type/patch/child/repeatable-item). One
      // call = one addComposedModules commit = one undo/redo step for the
      // entire composition, never one per module.
      case 'COMPOSE_EMAIL': {
        const entries = action.items.map((item) => ({
          type: item.module_type,
          patch: item.patch,
          children: item.children?.map((group) => ({
            columnIndex: group.column_index,
            modules: group.modules.map((child) => ({ type: child.module_type, patch: child.patch })),
          })),
          repeatableItems: item.repeatable_items,
        }));
        builder.addComposedModules(entries);
        return true;
      }
      case 'UPDATE_MODULE_PROPS': {
        if (!builder.selectedModuleId || !builder.selectedModule || builder.selectedModule.type !== action.module_type) {
          return false;
        }
        handleUpdateProps(builder.selectedModuleId, action.patch);
        return true;
      }
      case 'DELETE_MODULE': {
        if (!builder.selectedModuleId) return false;
        const path = findModulePath(builder.modules, builder.selectedModuleId);
        if (path?.layout && path?.column) {
          builder.deleteNestedModule(path.layout.id, path.column.id, builder.selectedModuleId);
        } else {
          builder.deleteModule(builder.selectedModuleId);
        }
        return true;
      }
      case 'DUPLICATE_MODULE': {
        if (!builder.selectedModuleId) return false;
        const path = findModulePath(builder.modules, builder.selectedModuleId);
        if (path?.layout && path?.column) {
          builder.duplicateNestedModule(path.layout.id, path.column.id, builder.selectedModuleId);
        } else {
          builder.duplicateModule(builder.selectedModuleId);
        }
        return true;
      }
      case 'APPLY_GLOBAL_STYLE': {
        builder.applyGlobalStyle(action.module_type, action.patch);
        return true;
      }
      // Sub-phase 6, work package D — the six previously-reserved action
      // types. Every case below routes through an EXISTING mutator
      // (handleUpdateSettings/insertNestedModuleWithProps/
      // updateColumnWidths/handleUpdateProps) — never a new mutation path.
      case 'UPDATE_MODULE_SETTINGS': {
        if (!builder.selectedModuleId || !builder.selectedModule || builder.selectedModule.type !== action.module_type) {
          return false;
        }
        handleUpdateSettings(builder.selectedModuleId, action.patch);
        return true;
      }
      case 'APPLY_VML_PATTERN':
      case 'APPLY_OUTLOOK_WRAPPER': {
        if (!builder.selectedModuleId || !builder.selectedModule || builder.selectedModule.type !== action.module_type) {
          return false;
        }
        handleUpdateSettings(builder.selectedModuleId, { outlookVml: true });
        return true;
      }
      case 'RESTRUCTURE_LAYOUT': {
        if (!builder.selectedModuleId || !builder.selectedModule || builder.selectedModule.type !== action.module_type) {
          return false;
        }
        const columnWidths = builder.selectedModule.columns;
        if (!columnWidths || columnWidths.length !== action.widths.length) {
          return false;
        }
        builder.updateColumnWidths(builder.selectedModuleId, action.widths);
        return true;
      }
      case 'INSERT_NESTED_MODULE': {
        if (!builder.selectedColumn) return false;
        // Defense-in-depth mirror of ai_command.py's own one-level-nesting
        // gate — never nest a layout module inside a layout column.
        if (isLayoutModuleType(action.module_type)) return false;
        builder.insertNestedModuleWithProps(
          builder.selectedColumn.layoutId, builder.selectedColumn.columnId, action.module_type, action.patch,
        );
        return true;
      }
      case 'REPLACE_UNSUPPORTED_PROPERTY': {
        if (!builder.selectedModuleId || !builder.selectedModule || builder.selectedModule.type !== action.module_type) {
          return false;
        }
        handleUpdateProps(builder.selectedModuleId, action.patch);
        return true;
      }
      case 'UPDATE_REPEATABLE_FIELD': {
        if (!builder.selectedModuleId || !builder.selectedModule || builder.selectedModule.type !== action.module_type) {
          return false;
        }
        const definition = getModuleDefinition(action.module_type);
        const repeatable = definition.repeatableField;
        const path = repeatable?.path;
        if (!repeatable || !path) return false;
        const currentArray = (builder.selectedModule.props as Record<string, unknown>)[path];
        if (!Array.isArray(currentArray)) return false;

        let nextArray: unknown[];
        if (action.op === 'add') {
          if (!action.item) return false;
          nextArray = [...currentArray, { ...repeatable.createItem(), ...action.item }];
        } else if (action.op === 'update') {
          if (action.index === undefined || action.index < 0 || action.index >= currentArray.length || !action.item) {
            return false;
          }
          const patchedItem = action.item;
          nextArray = currentArray.map((item, i) => (i === action.index ? { ...(item as object), ...patchedItem } : item));
        } else if (action.op === 'remove') {
          if (action.index === undefined || action.index < 0 || action.index >= currentArray.length) return false;
          if (currentArray.length <= (repeatable.minItems ?? 0)) return false;
          nextArray = currentArray.filter((_, i) => i !== action.index);
        } else {
          if (action.fromIndex === undefined || action.toIndex === undefined) return false;
          if (action.fromIndex < 0 || action.fromIndex >= currentArray.length) return false;
          nextArray = [...currentArray];
          const [moved] = nextArray.splice(action.fromIndex, 1);
          const clamped = Math.max(0, Math.min(action.toIndex, nextArray.length));
          nextArray.splice(clamped, 0, moved);
        }
        if (nextArray.length > (repeatable.maxItems ?? 20)) return false;

        handleUpdateProps(builder.selectedModuleId, { [path]: nextArray });
        return true;
      }
      case 'NONE':
      default:
        return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder is a stable-callback hook instance
  }, [builder, handleUpdateProps, handleUpdateSettings]);

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

  // Feature 10 — the compatibility-impact scan reads the same rendered
  // string Feature 09's Code Editor shows; recomputed only when the
  // dialog is actually open, same lazy-compute shape as CodeEditorPanel's
  // own rawHtml memo.
  const platformDialogHtml = useMemo(
    () => (platformDialogOpen && document
      ? renderEmailDocument({ width: document.width, content: { version: 1, modules: builder.modules } })
      : ''),
    [platformDialogOpen, document, builder.modules],
  );

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
        editorMode={editorMode}
        zoomLevel={zoomLevel}
        zoomMin={ZOOM_MIN}
        zoomMax={ZOOM_MAX}
        onUndo={builder.undo}
        onRedo={builder.redo}
        onSave={handleSave}
        onViewModeChange={setViewMode}
        onEditorModeChange={setEditorMode}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onOpenPlatformDialog={() => setPlatformDialogOpen(true)}
        onOpenExportDialog={() => setExportDialogOpen(true)}
        onOpenDocumentSettingsDialog={() => setDocumentSettingsDialogOpen(true)}
      />

      {saveStatus === 'error' && (
        <p className="email-builder-workspace__save-error" role="alert">
          <span className="mdaiw-icon mdaiw-icon--warning" aria-hidden="true" />
          We could not save your changes. Please try again.
        </p>
      )}

      <div className="email-builder-workspace__body">
        {editorMode === 'code' ? (
          <CodeEditorPanel
            documentName={document.name}
            width={document.width}
            content={{ version: 1, modules: builder.modules }}
            platform={document.platform}
            emailTitle={builder.documentSettings.email_title}
            faviconUrl={builder.documentSettings.favicon_url}
            resetCssEnabled={builder.documentSettings.reset_css_enabled}
            customCssEnabled={builder.documentSettings.custom_css_enabled}
            customCss={builder.documentSettings.custom_css}
          />
        ) : editorMode === 'preview' ? (
          <PreviewStudioPanel
            width={document.width}
            content={{ version: 1, modules: builder.modules }}
            emailTitle={builder.documentSettings.email_title}
            faviconUrl={builder.documentSettings.favicon_url}
            resetCssEnabled={builder.documentSettings.reset_css_enabled}
            customCssEnabled={builder.documentSettings.custom_css_enabled}
            customCss={builder.documentSettings.custom_css}
          />
        ) : editorMode === 'validate' ? (
          <ValidationCenterPanel
            width={document.width}
            content={{ version: 1, modules: builder.modules }}
            platform={document.platform}
            emailTitle={builder.documentSettings.email_title}
            emailSubject={builder.documentSettings.email_subject}
            faviconUrl={builder.documentSettings.favicon_url}
            resetCssEnabled={builder.documentSettings.reset_css_enabled}
            customCssEnabled={builder.documentSettings.custom_css_enabled}
            customCss={builder.documentSettings.custom_css}
            onNavigateToModule={(moduleId) => {
              setEditorMode('visual');
              builder.selectModule(moduleId);
            }}
            onApplySafeFix={handleUpdateProps}
            onApplySettingsFix={handleUpdateSettings}
            onApplyDocumentFix={builder.updateDocumentSettings}
            highlightIssueId={highlightValidationIssueId}
          />
        ) : editorMode === 'ai' ? (
          <AIEngineerPanel
            platform={document.platform}
            width={document.width}
            selectedModule={builder.selectedModule}
            content={{ version: 1, modules: builder.modules }}
            emailTitle={builder.documentSettings.email_title}
            emailSubject={builder.documentSettings.email_subject}
            faviconUrl={builder.documentSettings.favicon_url}
            resetCssEnabled={builder.documentSettings.reset_css_enabled}
            customCssEnabled={builder.documentSettings.custom_css_enabled}
            customCss={builder.documentSettings.custom_css}
            onApplyAction={handleApplyAiAction}
            onApplyDocumentSettingAction={handleApplyDocumentSettingAiAction}
            onApplyRepairAction={handleApplyRepairAction}
          />
        ) : (
        <>
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
          zoomLevel={zoomLevel}
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
          documentWidth={document.width}
          onUpdateProps={handleUpdateProps}
          onUpdateSettings={handleUpdateSettings}
          onUpdateColumnWidths={builder.updateColumnWidths}
          onUpdateColumnSettings={builder.updateColumnSettings}
          onSelectColumn={builder.selectColumn}
          onSelectModule={builder.selectModule}
          collapsed={propertiesPanelCollapsed}
          onToggleCollapsed={() => setPropertiesPanelCollapsed((current) => !current)}
        />
        </>
        )}
      </div>

      {saveModuleTarget && (
        <SaveModuleDialog
          moduleLabel={getModuleDefinition(saveModuleTarget.type).label}
          saving={savingModule}
          onSave={handleConfirmSaveModule}
          onCancel={() => setSaveModuleTargetId(null)}
        />
      )}

      {platformDialogOpen && (
        <PlatformEnvironmentDialog
          currentPlatform={document.platform}
          documentHtml={platformDialogHtml}
          onApply={handleApplyPlatform}
          onClose={() => setPlatformDialogOpen(false)}
        />
      )}

      {exportDialogOpen && (
        <ExportDeployDialog
          document={document}
          documentSettings={builder.documentSettings}
          content={{ version: 1, modules: builder.modules }}
          onSaveAsTemplate={handleSaveAsTemplate}
          onClose={() => setExportDialogOpen(false)}
          onViewValidation={(issueId) => {
            setExportDialogOpen(false);
            setHighlightValidationIssueId(issueId);
            setEditorMode('validate');
          }}
        />
      )}

      {documentSettingsDialogOpen && (
        <DocumentSettingsDialog
          documentSettings={builder.documentSettings}
          documentName={document.name}
          onApply={handleApplyDocumentSettings}
          onClose={() => setDocumentSettingsDialogOpen(false)}
        />
      )}
    </div>
  );
}

import { useNavigate } from 'react-router';
import type { EmailPlatform } from './types';
import type { BuilderViewMode } from './EmailCanvas';
import './BuilderToolbar.css';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const PLATFORM_LABELS: Record<EmailPlatform, string> = {
  generic: 'Generic',
  sfmc: 'Salesforce Marketing Cloud',
  marketo: 'Marketo',
  hubspot: 'HubSpot',
  pardot: 'Pardot / Account Engagement',
  other: 'Other',
};

export type EditorMode = 'visual' | 'code';

interface BuilderToolbarProps {
  name: string;
  platform: EmailPlatform;
  width: number;
  dirty: boolean;
  saveStatus: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  viewMode: BuilderViewMode;
  editorMode: EditorMode;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onViewModeChange: (mode: BuilderViewMode) => void;
  onEditorModeChange: (mode: EditorMode) => void;
  onOpenPlatformDialog: () => void;
}

function statusLabel(saveStatus: SaveStatus, dirty: boolean): string {
  if (saveStatus === 'saving') return 'Saving…';
  if (saveStatus === 'error') return 'Save failed';
  if (dirty) return 'Unsaved changes';
  return 'Saved';
}

function Separator() {
  return <span className="builder-toolbar__separator" aria-hidden="true" />;
}

export function BuilderToolbar({
  name, platform, width, dirty, saveStatus, canUndo, canRedo, viewMode, editorMode,
  onUndo, onRedo, onSave, onViewModeChange, onEditorModeChange, onOpenPlatformDialog,
}: BuilderToolbarProps) {
  const navigate = useNavigate();

  return (
    <div className="builder-toolbar">
      <div className="builder-toolbar__group builder-toolbar__group--left">
        <button
          type="button"
          className="builder-toolbar__back"
          onClick={() => navigate('/email-builder')}
        >
          <span className="mdaiw-icon mdaiw-icon--arrow-left" aria-hidden="true" />
          Back to Email Dashboard
        </button>

        <Separator />

        <div className="builder-toolbar__meta">
          <span className="builder-toolbar__email-name" title={name}>{name}</span>
          <button
            type="button"
            className="builder-toolbar__chip builder-toolbar__chip--button"
            onClick={onOpenPlatformDialog}
            title="Change platform / environment"
          >
            <span className="mdaiw-icon mdaiw-icon--settings" aria-hidden="true" />
            {PLATFORM_LABELS[platform]}
          </button>
          <span className="builder-toolbar__chip">{width}px</span>
        </div>
      </div>

      <div className="builder-toolbar__group builder-toolbar__group--center">
        <div className="builder-toolbar__history">
          <button type="button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={onUndo}>
            <span className="mdaiw-icon mdaiw-icon--arrow-left" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={onRedo}>
            <span className="mdaiw-icon mdaiw-icon--arrow-right" aria-hidden="true" />
          </button>
        </div>

        <Separator />

        <div className="builder-toolbar__view-switch" role="group" aria-label="Editor mode">
          <button
            type="button"
            aria-pressed={editorMode === 'visual'}
            className={editorMode === 'visual' ? 'builder-toolbar__view-btn builder-toolbar__view-btn--active' : 'builder-toolbar__view-btn'}
            onClick={() => onEditorModeChange('visual')}
          >
            Visual
          </button>
          <button
            type="button"
            aria-pressed={editorMode === 'code'}
            className={editorMode === 'code' ? 'builder-toolbar__view-btn builder-toolbar__view-btn--active' : 'builder-toolbar__view-btn'}
            onClick={() => onEditorModeChange('code')}
          >
            Code
          </button>
        </div>

        <Separator />

        <div className="builder-toolbar__view-switch" role="group" aria-label="Preview device">
          <button
            type="button"
            aria-pressed={viewMode === 'desktop'}
            disabled={editorMode === 'code'}
            className={viewMode === 'desktop' ? 'builder-toolbar__view-btn builder-toolbar__view-btn--active' : 'builder-toolbar__view-btn'}
            onClick={() => onViewModeChange('desktop')}
          >
            Desktop
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'mobile'}
            disabled={editorMode === 'code'}
            className={viewMode === 'mobile' ? 'builder-toolbar__view-btn builder-toolbar__view-btn--active' : 'builder-toolbar__view-btn'}
            onClick={() => onViewModeChange('mobile')}
          >
            Mobile
          </button>
        </div>

        <Separator />

        <div className="builder-toolbar__future-actions">
          <button type="button" className="button button--outline" disabled title="Coming soon">
            <span className="mdaiw-icon mdaiw-icon--eye" aria-hidden="true" />
            Preview
          </button>
          <button type="button" className="button button--outline" disabled title="Coming soon">
            <span className="mdaiw-icon mdaiw-icon--shield-check" aria-hidden="true" />
            Validate
          </button>
        </div>
      </div>

      <div className="builder-toolbar__group builder-toolbar__group--right">
        <span className={`builder-toolbar__status builder-toolbar__status--${saveStatus === 'error' ? 'error' : dirty ? 'dirty' : 'saved'}`}>
          {saveStatus === 'saving' && <span className="mdaiw-icon mdaiw-icon--spinner builder-toolbar__spinner" aria-hidden="true" />}
          {statusLabel(saveStatus, dirty)}
        </span>

        <button
          type="button"
          className="button button--primary"
          onClick={onSave}
          disabled={saveStatus === 'saving' || !dirty}
        >
          Save
        </button>
      </div>
    </div>
  );
}

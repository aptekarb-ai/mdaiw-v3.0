import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { CodeEditor, type CodeEditorHandle, type CodeEditorMarker } from './CodeEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  EDITOR_LANGUAGES,
  MONACO_LANGUAGE_FOR,
  SCOPE_TO_EDITOR_LANGUAGE,
  type EditorLanguage,
  type ValidationScope,
} from '../types/landingpages';
import './CodeEditorTabs.css';

export interface CodeEditorTabsHandle {
  focusLine: (
    language: EditorLanguage, line: number, column?: number, endLine?: number | null, endColumn?: number | null,
  ) => void;
  getActiveLanguage: () => EditorLanguage;
}

export interface CodeEditorTabsProps {
  values: Record<EditorLanguage, string>;
  onChange: (language: EditorLanguage, value: string) => void;
  onClear: (language: EditorLanguage) => void;
  disabled?: boolean;
  markersByLanguage?: Partial<Record<EditorLanguage, CodeEditorMarker[]>>;
  resolvedLinesByLanguage?: Partial<Record<EditorLanguage, number[]>>;
  // Which tabs are shown. Defaults to 'complete' (all four) when omitted,
  // matching every pre-existing caller/test that never had a concept of
  // scope-gated tabs.
  scope?: ValidationScope;
  // Sprint CSS-E — overrides the css tab's Monaco language (e.g. 'scss',
  // 'less') when the stylesheet source type isn't plain CSS. Falls back to
  // MONACO_LANGUAGE_FOR.css when omitted.
  cssMonacoLanguage?: string;
  // Sprint CSS-E — overrides the css tab's DISPLAY label (tab text, Clear
  // button, clear-confirmation heading) to 'SCSS'/'Sass'/'LESS' when that
  // source type is selected. Deliberately does NOT affect the editor's own
  // `aria-label` (stays "CSS code") — it is still the same tab/field,
  // just interpreting different syntax; existing Go to Line/marker wiring
  // keyed on the 'css' editor language is unaffected either way.
  cssTabLabel?: string;
  // Sprint CSS-E — the parent needs to know which tab is active (not just
  // imperatively via the ref) to decide whether to show the stylesheet
  // source-type selector, which only appears while the css tab is active
  // under Complete LP scope.
  onActiveLanguageChange?: (language: EditorLanguage) => void;
}

const ALL_LANGUAGE_KEYS = EDITOR_LANGUAGES.map((entry) => entry.key);

export const CodeEditorTabs = forwardRef<CodeEditorTabsHandle, CodeEditorTabsProps>(
  function CodeEditorTabs(
    {
      values, onChange, onClear, disabled, markersByLanguage = {}, resolvedLinesByLanguage = {}, scope = 'complete',
      cssMonacoLanguage, cssTabLabel, onActiveLanguageChange,
    },
    ref,
  ) {
    const [active, setActiveRaw] = useState<EditorLanguage>('html');
    function setActive(next: EditorLanguage | ((current: EditorLanguage) => EditorLanguage)) {
      setActiveRaw((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        if (resolved !== current) onActiveLanguageChange?.(resolved);
        return resolved;
      });
    }
    const [confirmingClear, setConfirmingClear] = useState(false);
    const editorRefs = useRef<Partial<Record<EditorLanguage, CodeEditorHandle | null>>>({});
    const tabRefs = useRef<Partial<Record<EditorLanguage, HTMLButtonElement | null>>>({});
    const clearButtonRef = useRef<HTMLButtonElement | null>(null);
    const pendingFocus = useRef<{
      language: EditorLanguage; line: number; column?: number; endLine?: number | null; endColumn?: number | null;
    } | null>(null);

    // A single-language scope shows only that one tab; 'complete' shows
    // all four. Source for hidden tabs is never deleted — it stays in the
    // parent's `values`, just not rendered while its tab is scope-hidden.
    const soleVisibleLanguage = SCOPE_TO_EDITOR_LANGUAGE[scope];
    const visibleLanguageKeys = soleVisibleLanguage ? [soleVisibleLanguage] : ALL_LANGUAGE_KEYS;
    const visibleEditorLanguages = EDITOR_LANGUAGES.filter((entry) => visibleLanguageKeys.includes(entry.key));

    useEffect(() => {
      if (soleVisibleLanguage && active !== soleVisibleLanguage) {
        setActive(soleVisibleLanguage);
      }
      // Only the narrowing case needs to force a tab switch — widening
      // back to 'complete' leaves whichever tab was already active valid.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    useEffect(() => {
      if (pendingFocus.current && pendingFocus.current.language === active) {
        const { line, column, endLine, endColumn } = pendingFocus.current;
        pendingFocus.current = null;
        editorRefs.current[active]?.focusLine(line, column, endLine, endColumn);
      }
    }, [active]);

    useImperativeHandle(ref, () => ({
      focusLine(language, line, column, endLine, endColumn) {
        pendingFocus.current = { language, line, column, endLine, endColumn };
        setActive((current) => {
          if (current === language) {
            queueMicrotask(() => {
              pendingFocus.current = null;
              editorRefs.current[language]?.focusLine(line, column, endLine, endColumn);
            });
          }
          return language;
        });
      },
      getActiveLanguage: () => active,
    }));

    function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: EditorLanguage) {
      const index = visibleLanguageKeys.indexOf(current);
      let nextIndex: number | null = null;
      if (event.key === 'ArrowRight') {
        nextIndex = (index + 1) % visibleLanguageKeys.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + visibleLanguageKeys.length) % visibleLanguageKeys.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = visibleLanguageKeys.length - 1;
      }
      if (nextIndex !== null) {
        event.preventDefault();
        const nextKey = visibleLanguageKeys[nextIndex];
        setActive(nextKey);
        tabRefs.current[nextKey]?.focus();
      }
    }

    function displayLabel(language: EditorLanguage): string {
      if (language === 'css' && cssTabLabel) return cssTabLabel;
      return EDITOR_LANGUAGES.find((entry) => entry.key === language)?.label ?? language;
    }
    const activeLabel = displayLabel(active);
    const activeIsEmpty = !values[active]?.trim();

    function handleClearConfirmed() {
      setConfirmingClear(false);
      onClear(active);
      // Reset cursor to line 1, column 1 and refocus — the parent only
      // owns the source-of-truth `values`, not the editor's own cursor.
      requestAnimationFrame(() => {
        editorRefs.current[active]?.focusLine(1, 1);
      });
    }

    function handleClearCancelled() {
      setConfirmingClear(false);
      clearButtonRef.current?.focus();
    }

    return (
      <div className="code-editor-tabs">
        <div className="code-editor-tabs__row">
          <div role="tablist" aria-label="Code language" className="code-editor-tabs__list">
            {visibleEditorLanguages.map((entry) => (
              <button
                key={entry.key}
                ref={(el) => {
                  tabRefs.current[entry.key] = el;
                }}
                type="button"
                role="tab"
                id={`code-tab-${entry.key}`}
                aria-selected={active === entry.key}
                aria-controls={`code-panel-${entry.key}`}
                tabIndex={active === entry.key ? 0 : -1}
                className={
                  active === entry.key
                    ? 'code-editor-tabs__tab code-editor-tabs__tab--active'
                    : 'code-editor-tabs__tab'
                }
                onClick={() => setActive(entry.key)}
                onKeyDown={(event) => handleTabKeyDown(event, entry.key)}
              >
                {displayLabel(entry.key)}
              </button>
            ))}
          </div>

          <button
            type="button"
            ref={clearButtonRef}
            className="button button--outline code-editor-tabs__clear"
            onClick={() => setConfirmingClear(true)}
            disabled={activeIsEmpty || disabled}
            aria-label={`Clear ${activeLabel}`}
            title={`Clear ${activeLabel}`}
          >
            <span className="mdaiw-icon mdaiw-icon--delete" aria-hidden="true" />
            <span className="code-editor-tabs__clear-text">Clear {activeLabel}</span>
          </button>
        </div>

        <div className="code-editor-tabs__panels">
          {visibleEditorLanguages.map((entry) => (
            <div
              key={entry.key}
              role="tabpanel"
              id={`code-panel-${entry.key}`}
              aria-labelledby={`code-tab-${entry.key}`}
              hidden={active !== entry.key}
              className="code-editor-tabs__panel"
            >
              <CodeEditor
                ref={(el) => {
                  editorRefs.current[entry.key] = el;
                }}
                language={entry.key === 'css' && cssMonacoLanguage ? cssMonacoLanguage : MONACO_LANGUAGE_FOR[entry.key]}
                value={values[entry.key]}
                onChange={(value) => onChange(entry.key, value)}
                ariaLabel={`${entry.label} code`}
                disabled={disabled}
                markers={markersByLanguage[entry.key]}
                resolvedLines={resolvedLinesByLanguage[entry.key]}
              />
            </div>
          ))}
        </div>

        <ConfirmDialog
          open={confirmingClear}
          heading={`Clear ${activeLabel} code?`}
          body="This removes all code from the active tab. Code in the other tabs will not be changed."
          confirmLabel="Clear Code"
          onConfirm={handleClearConfirmed}
          onCancel={handleClearCancelled}
        />
      </div>
    );
  },
);

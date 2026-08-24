import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import type * as MonacoNS from 'monaco-editor';
import { ensureMonacoConfigured } from './monacoSetup';
import './CodeEditor.css';

ensureMonacoConfigured();

// Reusable code-editor abstraction — Monaco-backed. Callers (CodeEditorTabs,
// LandingPageValidatorPage) only ever talk to this component's props/ref,
// never to the Monaco API directly, so the validator page stays decoupled
// from Monaco's own types/imports.
export interface CodeEditorHandle {
  /** Moves focus/caret to `line`:`column` (1-indexed), selecting through
   * `endLine`:`endColumn` when given, revealing the line, and briefly
   * emphasizing it. Out-of-range lines/columns are clamped to the
   * document, never thrown. */
  focusLine: (line: number, column?: number, endLine?: number | null, endColumn?: number | null) => void;
  /** Opens Monaco's own built-in Find widget (`actions.find`) — never a
   * second, hand-built search implementation. In a read-only editor
   * Monaco itself keeps the widget's Replace half inert, so this never
   * opens a mutation path. */
  openFind: () => void;
}

export interface CodeEditorMarker {
  severity: 'error' | 'warning' | 'info';
  message: string;
  startLine: number;
  startColumn: number | null;
  endLine?: number | null;
  endColumn?: number | null;
  ruleId?: string;
  suggestion?: string;
  languageLabel?: string;
}

export interface CodeEditorProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  hidden?: boolean;
  markers?: CodeEditorMarker[];
  /** 1-indexed lines to briefly highlight green as "resolved since last
   * validation" — see LandingPageValidatorPage's report-comparison logic.
   * This component only renders the decoration and auto-clears it; it
   * never decides what counts as resolved. */
  resolvedLines?: number[];
}

const RESOLVED_DECORATION_DURATION_MS = 7000;
const EMPHASIS_DURATION_MS = 1500;

function severityToMonaco(monacoNs: typeof MonacoNS, severity: CodeEditorMarker['severity']) {
  if (severity === 'error') return monacoNs.MarkerSeverity.Error;
  if (severity === 'warning') return monacoNs.MarkerSeverity.Warning;
  return monacoNs.MarkerSeverity.Info;
}

function buildMarkerTooltip(marker: CodeEditorMarker): string {
  const lines = [marker.languageLabel, marker.message].filter(Boolean) as string[];
  if (marker.ruleId) lines.push(`Rule: ${marker.ruleId}`);
  if (marker.suggestion) lines.push(marker.suggestion);
  return lines.join('\n');
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { language, value, onChange, ariaLabel, disabled, hidden, markers = [], resolvedLines = [] },
  ref,
) {
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);
  const issueDecorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null);
  const resolvedDecorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null);
  const emphasisDecorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null);
  const resolvedTimeoutRef = useRef<number | undefined>(undefined);
  const emphasisTimeoutRef = useRef<number | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    loader.init().catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => () => {
    window.clearTimeout(resolvedTimeoutRef.current);
    window.clearTimeout(emphasisTimeoutRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    focusLine(line, column = 1, endLine, endColumn) {
      const editor = editorRef.current;
      const monacoNs = monacoRef.current;
      if (!editor || !monacoNs) return;
      const model = editor.getModel();
      const lineCount = model ? model.getLineCount() : 1;
      const targetLine = Math.max(1, Math.min(line, lineCount));
      const maxColumn = model ? model.getLineMaxColumn(targetLine) : column + 1;
      const targetColumn = Math.max(1, Math.min(column, maxColumn));

      editor.revealLineInCenter(targetLine);
      if (endLine && endColumn) {
        const clampedEndLine = Math.max(1, Math.min(endLine, lineCount));
        const clampedEndColumn = Math.max(
          1, Math.min(endColumn, model ? model.getLineMaxColumn(clampedEndLine) : endColumn),
        );
        editor.setSelection({
          startLineNumber: targetLine, startColumn: targetColumn,
          endLineNumber: clampedEndLine, endColumn: clampedEndColumn,
        });
      } else {
        editor.setPosition({ lineNumber: targetLine, column: targetColumn });
      }
      editor.focus();

      window.clearTimeout(emphasisTimeoutRef.current);
      emphasisDecorationsRef.current?.clear();
      emphasisDecorationsRef.current = editor.createDecorationsCollection([{
        range: new monacoNs.Range(targetLine, 1, targetLine, 1),
        options: { isWholeLine: true, className: 'code-editor__line-emphasis' },
      }]);
      emphasisTimeoutRef.current = window.setTimeout(() => {
        emphasisDecorationsRef.current?.clear();
      }, EMPHASIS_DURATION_MS);
    },
    openFind() {
      editorRef.current?.getAction('actions.find')?.run();
    },
  }));

  const handleMount: OnMount = (editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;
  };

  // Error/warning/info markers + a light whole-line background tint per
  // severity (Monaco's marker system gives the squiggle/glyph/overview-ruler
  // mark automatically; the whole-line tint is a separate decoration).
  useEffect(() => {
    const editor = editorRef.current;
    const monacoNs = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monacoNs || !model) return;

    monacoNs.editor.setModelMarkers(
      model,
      'mdaiw-validator',
      markers.map((marker) => ({
        severity: severityToMonaco(monacoNs, marker.severity),
        message: buildMarkerTooltip(marker),
        startLineNumber: marker.startLine,
        startColumn: marker.startColumn ?? 1,
        endLineNumber: marker.endLine ?? marker.startLine,
        endColumn: marker.endColumn ?? (marker.startColumn ?? 1) + 1,
        source: marker.ruleId,
      })),
    );

    issueDecorationsRef.current?.clear();
    issueDecorationsRef.current = editor.createDecorationsCollection(
      markers.map((marker) => ({
        range: new monacoNs.Range(marker.startLine, 1, marker.startLine, 1),
        options: { isWholeLine: true, className: `code-editor__line-${marker.severity}` },
      })),
    );
  }, [markers]);

  // Temporary green "resolved after revalidation" decoration.
  useEffect(() => {
    const editor = editorRef.current;
    const monacoNs = monacoRef.current;
    if (!editor || !monacoNs) return;

    window.clearTimeout(resolvedTimeoutRef.current);
    resolvedDecorationsRef.current?.clear();
    if (resolvedLines.length === 0) return;

    resolvedDecorationsRef.current = editor.createDecorationsCollection(
      resolvedLines.map((line) => ({
        range: new monacoNs.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'code-editor__line-resolved',
          glyphMarginClassName: 'code-editor__glyph-resolved',
          overviewRuler: { color: 'rgba(34, 160, 107, 0.6)', position: monacoNs.editor.OverviewRulerLane.Full },
          hoverMessage: { value: 'Resolved after revalidation' },
        },
      })),
    );
    resolvedTimeoutRef.current = window.setTimeout(() => {
      resolvedDecorationsRef.current?.clear();
    }, RESOLVED_DECORATION_DURATION_MS);
  }, [resolvedLines]);

  if (loadFailed) {
    return (
      <div className="code-editor code-editor--load-failed" hidden={hidden} data-language={language}>
        <p role="alert">
          The code editor could not load. Check your connection and reload the page.
        </p>
      </div>
    );
  }

  return (
    <div className="code-editor" hidden={hidden} data-language={language}>
      <Editor
        language={language}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        onMount={handleMount}
        loading={<div className="code-editor__loading">Loading editor…</div>}
        options={{
          readOnly: disabled,
          ariaLabel,
          glyphMargin: true,
          minimap: { enabled: false },
          automaticLayout: true,
          folding: true,
          renderLineHighlight: 'all',
          scrollBeyondLastLine: false,
          fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
          fontSize: 13,
        }}
      />
    </div>
  );
});

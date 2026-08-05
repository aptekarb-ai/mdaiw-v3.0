// Shared test double for @monaco-editor/react. Monaco doesn't render
// meaningfully under jsdom, so tests mock the package entirely and assert
// against this fake editor's recorded calls instead of real Monaco state.
// Usage in a test file:
//
//   vi.mock('@monaco-editor/react', async () => {
//     const { buildMonacoEditorReactMock } = await import('../testUtils/monacoEditorMock');
//     return buildMonacoEditorReactMock();
//   });
//   vi.mock('../landingpages/monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));
//
// The dynamic import above (not a static outer-scope reference) is what
// keeps this safe under Vitest's mock-hoisting rules.
import { useEffect, useRef } from 'react';
import { vi } from 'vitest';

export interface FakeMonacoEditorInstance {
  getModel: () => { getLineCount: () => number; getLineMaxColumn: (line: number) => number };
  revealLineInCenter: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  createDecorationsCollection: ReturnType<typeof vi.fn>;
}

export function buildMonacoEditorReactMock() {
  const setModelMarkers = vi.fn();
  const decorationsClear = vi.fn();
  const createDecorationsCollection = vi.fn(() => ({ clear: decorationsClear }));

  class FakeRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;

    constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  }

  const fakeMonacoNamespace = {
    Range: FakeRange,
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    editor: {
      setModelMarkers,
      OverviewRulerLane: { Full: 7 },
    },
  };

  const editorInstances: FakeMonacoEditorInstance[] = [];

  function EditorMock({ value, onChange, onMount, options }: {
    value: string;
    onChange?: (value: string | undefined) => void;
    onMount?: (editor: FakeMonacoEditorInstance, monacoNs: typeof fakeMonacoNamespace) => void;
    options?: { ariaLabel?: string; readOnly?: boolean };
  }) {
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
      const fakeEditor: FakeMonacoEditorInstance = {
        getModel: () => ({
          getLineCount: () => valueRef.current.split('\n').length,
          getLineMaxColumn: (line: number) => (valueRef.current.split('\n')[line - 1]?.length ?? 0) + 1,
        }),
        revealLineInCenter: vi.fn(),
        setSelection: vi.fn(),
        setPosition: vi.fn(),
        focus: vi.fn(),
        createDecorationsCollection,
      };
      editorInstances.push(fakeEditor);
      onMount?.(fakeEditor, fakeMonacoNamespace);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <textarea
        aria-label={options?.ariaLabel}
        value={value}
        readOnly={options?.readOnly}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  return {
    default: EditorMock,
    loader: { init: vi.fn().mockResolvedValue(undefined), config: vi.fn() },
    __testHooks: { setModelMarkers, createDecorationsCollection, decorationsClear, editorInstances },
  };
}

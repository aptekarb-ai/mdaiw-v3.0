// Configures Monaco to load entirely from the locally installed
// monaco-editor package — @monaco-editor/react's default `loader` fetches
// Monaco from a CDN unless told otherwise, which the project's "no CDN
// dependency, no network requirement" rule forbids. Importing this module
// (once, before any <Editor> mounts) points the loader at the bundled
// package instead.
//
// Workers are registered via the standard `new URL(..., import.meta.url)`
// + `new Worker()` pattern rather than Vite's `?worker` import suffix —
// this project's Vite 8 uses the Rolldown bundler, which does not resolve
// `?worker` for a deep node_modules path the way classic Rollup-based Vite
// does; `new URL()` is Vite's bundler-agnostic asset-resolution mechanism
// and works under both.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

let configured = false;

function workerUrl(path: string): URL {
  return new URL(`../../node_modules/monaco-editor/esm/vs/${path}`, import.meta.url);
}

export function ensureMonacoConfigured() {
  if (configured) {
    return;
  }
  configured = true;

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'html') {
        return new Worker(workerUrl('language/html/html.worker.js'), { type: 'module' });
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new Worker(workerUrl('language/css/css.worker.js'), { type: 'module' });
      }
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(workerUrl('language/typescript/ts.worker.js'), { type: 'module' });
      }
      return new Worker(workerUrl('editor/editor.worker.js'), { type: 'module' });
    },
  };

  loader.config({ monaco });
}

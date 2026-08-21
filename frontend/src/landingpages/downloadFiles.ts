// Save/Download closure sprint — pure client-side download, no backend
// round-trip. Reads directly from the editor's in-memory state, so the
// downloaded bytes are trivially byte-equivalent to what's on screen —
// there is no compile/transform/reformat step in this path at all.
// Mirrors GeneratedCssPanel.tsx's own proven Blob-download pattern.

const FILENAME_UNSAFE_RE = /[^a-z0-9-]+/g;

// Filenames must be sanitized and deterministic — lowercased, spaces and
// anything outside [a-z0-9-] collapsed to a single '-', trimmed, and
// never empty (falls back to 'landing-page').
export function sanitizeFilename(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(FILENAME_UNSAFE_RE, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'landing-page';
}

export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const STYLESHEET_FILENAME_BY_TYPE: Record<string, string> = {
  css: 'styles.css', less: 'styles.less', scss: 'styles.scss', sass: 'styles.sass',
};

const STYLESHEET_MIME_BY_TYPE: Record<string, string> = {
  css: 'text/css;charset=utf-8', less: 'text/plain;charset=utf-8',
  scss: 'text/plain;charset=utf-8', sass: 'text/plain;charset=utf-8',
};

export interface DownloadableSources {
  html: string;
  css: string;
  js: string;
  ampscript: string;
  cssSourceType: string;
}

// Downloads every currently-populated language as its own file, using a
// short stagger between triggers — some browsers show a "this site is
// downloading multiple files" prompt on the very first multi-download
// click, which a stagger does not prevent, but does make the requests
// distinguishable to the browser rather than firing in the same tick.
export function downloadCompleteLp(sources: DownloadableSources, reportJson: string | null): void {
  const files: Array<[string, string, string]> = [];
  if (sources.html.trim()) files.push(['index.html', sources.html, 'text/html;charset=utf-8']);
  if (sources.css.trim()) {
    const filename = STYLESHEET_FILENAME_BY_TYPE[sources.cssSourceType] ?? 'styles.css';
    files.push([filename, sources.css, STYLESHEET_MIME_BY_TYPE[sources.cssSourceType] ?? 'text/plain;charset=utf-8']);
  }
  if (sources.js.trim()) files.push(['script.js', sources.js, 'text/javascript;charset=utf-8']);
  if (sources.ampscript.trim()) files.push(['ampscript.txt', sources.ampscript, 'text/plain;charset=utf-8']);
  if (reportJson) files.push(['validation-report.json', reportJson, 'application/json;charset=utf-8']);

  files.forEach(([filename, content, mimeType], index) => {
    window.setTimeout(() => downloadTextFile(content, filename, mimeType), index * 150);
  });
}

// Phase C (Import HTML) — the ONLY parser boundary. Uses the browser's
// native DOMParser, proven (empirically, via live Chrome network-log
// inspection during the architecture reconciliation — see the Phase C
// audit) to issue ZERO resource requests for a document that is never
// attached to a live/rendered browsing context: no fetch/XHR fired for
// <img src>, <img srcset>, <iframe src>, <link rel=stylesheet>,
// <link rel=preload>, <style> background:url()/@import, <video poster>,
// <source src>, <object data>, <embed src>, <script src>, or
// <svg><image href>. This holds ONLY as long as the resulting Document
// (or any node from it) is never inserted into the live DOM, never given
// a browsing context (no real <iframe srcdoc>, no "raw HTML preview"
// surface) — that invariant is enforced by convention across this whole
// htmlImport* module family: every function here only ever READS
// structural data (tag names/attributes/text) from the detached tree.
//
// No third-party parsing/sanitization library is introduced — this is
// the one deliberate, proven-safe layer the whole Import HTML feature is
// built on.

export const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_DOM_NODES = 5000;
export const MAX_NESTING_DEPTH = 40;

export type ParseGuardResult =
  | { ok: true; document: Document }
  | { ok: false; reason: string };

function utf8ByteLength(value: string): number {
  // TextEncoder is the accurate, dependency-free way to measure this —
  // value.length counts UTF-16 code units, not bytes.
  return new TextEncoder().encode(value).length;
}

function countNodesAndDepth(root: Node): { nodeCount: number; maxDepth: number } {
  let nodeCount = 0;
  let maxDepth = 0;

  function walk(node: Node, depth: number) {
    nodeCount += 1;
    if (depth > maxDepth) maxDepth = depth;
    // Bail out early once either limit is already exceeded — a
    // pathological document (deeply nested or enormous) must not force a
    // full traversal before being rejected.
    if (nodeCount > MAX_DOM_NODES || depth > MAX_NESTING_DEPTH) return;
    for (const child of Array.from(node.childNodes)) {
      walk(child, depth + 1);
      if (nodeCount > MAX_DOM_NODES || maxDepth > MAX_NESTING_DEPTH) return;
    }
  }

  walk(root, 0);
  return { nodeCount, maxDepth };
}

// Parses `html` and enforces the whole-import-blocking size/node/depth
// guards (approved: these are blocking conditions, checked BEFORE any
// document is created — never a per-subtree "dropped, reported, continue"
// finding). Returns the parsed, still-fully-untrusted, still-detached
// Document on success.
export function parseAndGuardImportedHtml(html: string): ParseGuardResult {
  const byteLength = utf8ByteLength(html);
  if (byteLength > MAX_HTML_BYTES) {
    return { ok: false, reason: `This file is too large to import (maximum ${Math.round(MAX_HTML_BYTES / 1024 / 1024)} MB).` };
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');

  const parserErrors = document.getElementsByTagName('parsererror');
  if (parserErrors.length > 0) {
    return { ok: false, reason: 'This file could not be parsed as HTML.' };
  }

  const { nodeCount, maxDepth } = countNodesAndDepth(document.documentElement ?? document);
  if (nodeCount > MAX_DOM_NODES) {
    return { ok: false, reason: 'This email has too many elements to import safely.' };
  }
  if (maxDepth > MAX_NESTING_DEPTH) {
    return { ok: false, reason: 'This email is nested too deeply to import safely.' };
  }

  return { ok: true, document };
}

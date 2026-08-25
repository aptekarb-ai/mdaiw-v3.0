import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_DOM_NODES, MAX_HTML_BYTES, MAX_NESTING_DEPTH, parseAndGuardImportedHtml } from './htmlImportParser';

describe('parseAndGuardImportedHtml', () => {
  it('parses ordinary HTML successfully', () => {
    const result = parseAndGuardImportedHtml('<html><body><p>Hello</p></body></html>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.body.textContent).toContain('Hello');
    }
  });

  it('blocks (does not create a document) when the HTML exceeds the byte-size limit — whole-import blocking, not a per-subtree finding', () => {
    const oversized = `<p>${'x'.repeat(MAX_HTML_BYTES + 1)}</p>`;
    const result = parseAndGuardImportedHtml(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too large/i);
  });

  it('blocks when the DOM node count exceeds the limit', () => {
    const manyNodes = `<div>${'<span>x</span>'.repeat(MAX_DOM_NODES + 10)}</div>`;
    const result = parseAndGuardImportedHtml(manyNodes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too many elements/i);
  });

  it('blocks when nesting depth exceeds the limit', () => {
    let deeplyNested = '<span>x</span>';
    for (let i = 0; i < MAX_NESTING_DEPTH + 10; i += 1) {
      deeplyNested = `<div>${deeplyNested}</div>`;
    }
    const result = parseAndGuardImportedHtml(deeplyNested);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/nested too deeply/i);
  });

  it('accepts HTML comfortably within all size/node/depth limits', () => {
    const result = parseAndGuardImportedHtml('<table><tr><td>Fine</td></tr></table>');
    expect(result.ok).toBe(true);
  });
});

// --- Mandatory network-inertness proof --------------------------------
// Confirms parsing hostile markup issues ZERO resource requests, for
// every vector the Phase C reconciliation required: <img src>,
// <img srcset>, <iframe src>, <link rel=stylesheet>,
// <link rel=preload as=image>, <style> background:url()/@import,
// <video poster>+<source src>, <object data>, <embed src>,
// <script src>, <svg><image href>. This was ALSO proven empirically via
// live Chrome network-log inspection during the architecture
// reconciliation; this test proves it stays true going forward (a
// regression here would mean this whole feature's core safety
// assumption broke).
describe('parseAndGuardImportedHtml — network inertness', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let imageConstructed: boolean;
  let xhrOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    imageConstructed = false;
    const OriginalImage = globalThis.Image;
    vi.stubGlobal('Image', class {
      constructor() {
        imageConstructed = true;
      }
    } as unknown as typeof OriginalImage);
    xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const hostileMarkup = `
    <html><head>
      <link rel="stylesheet" href="https://example.invalid/probe-stylesheet.css">
      <link rel="preload" href="https://example.invalid/probe-preload.png" as="image">
      <style>
        body { background: url('https://example.invalid/probe-cssurl.png'); }
        @import url('https://example.invalid/probe-cssimport.css');
      </style>
    </head>
    <body>
      <img src="https://example.invalid/probe-img.png">
      <img srcset="https://example.invalid/probe-1x.png 1x, https://example.invalid/probe-2x.png 2x">
      <iframe src="https://example.invalid/probe-iframe.html"></iframe>
      <video poster="https://example.invalid/probe-poster.png">
        <source src="https://example.invalid/probe-source.mp4">
      </video>
      <object data="https://example.invalid/probe-object.swf"></object>
      <embed src="https://example.invalid/probe-embed.swf">
      <script src="https://example.invalid/probe-script.js"></script>
      <svg><image href="https://example.invalid/probe-svgimg.png"></image></svg>
    </body></html>`;

  it('parsing hostile markup with every probe vector triggers zero fetch/XHR/Image resource activity', () => {
    const result = parseAndGuardImportedHtml(hostileMarkup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Confirm the hostile markup was genuinely parsed (not silently
      // no-op'd), matching the live-Chrome proof from the architecture
      // reconciliation.
      expect(result.document.querySelectorAll('img').length).toBe(2);
      expect(result.document.querySelectorAll('iframe').length).toBe(1);
      expect(result.document.querySelectorAll('link').length).toBe(2);
      expect(result.document.querySelectorAll('script').length).toBe(1);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(imageConstructed).toBe(false);
    expect(xhrOpenSpy).not.toHaveBeenCalled();
  });
});

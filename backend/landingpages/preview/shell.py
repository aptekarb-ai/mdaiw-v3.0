"""Builds the trusted OUTER shell document for Secure Preview — see
views.py::PreviewServeView and preview/__init__.py's module docstring for
the two-layer isolation design this serves.

Everything in this module is OUR OWN markup/script (never user content —
the untrusted assembled LP document only ever reaches the browser as the
sandboxed iframe's `srcdoc`, escaped by the caller before it ever reaches
this module). This module owns:
  - the device-preview toolbar (Part C1/C2 of the Secure Preview UX
    sprint) — resizes a wrapper element around the live-preview iframe;
    NEVER touches the iframe's `srcdoc`, so changing device/orientation
    never rebuilds or mutates the previewed source;
  - the "Live Preview — Current Browser" label, so the live iframe is
    never confused with the separate, real-engine Cross-browser Check;
  - the Cross-browser Check panel, which POSTs to this snapshot's own
    /cross-browser/ endpoint (same-origin only — see csp.py's
    connect-src 'self') and renders the returned screenshot/metrics.
"""

from django.utils.html import escape as html_escape

# (label, width, height) — the four toolbar presets from the Secure
# Preview device-preview spec's "Recommended initial sizes".
DEVICE_PRESETS = [
    ('Desktop', 1440, 900),
    ('Laptop', 1280, 800),
    ('Tablet', 768, 1024),
    ('Mobile', 390, 844),
]

# Named presets for the Cross-browser Check's own device dropdown — the
# broader set from Part C2, generic names only (never implying a specific
# physical device).
CROSS_BROWSER_DEVICE_PRESETS = [
    ('Mobile Small', 375, 667),
    ('Mobile Modern', 390, 844),
    ('Mobile Large', 430, 932),
    ('Tablet Portrait', 768, 1024),
    ('Tablet Landscape', 1024, 768),
    ('Laptop', 1280, 800),
    ('Desktop', 1440, 900),
    ('Desktop Large', 1920, 1080),
]

MIN_CUSTOM_WIDTH, MAX_CUSTOM_WIDTH = 320, 2560
MIN_CUSTOM_HEIGHT, MAX_CUSTOM_HEIGHT = 480, 1600

_TEMPLATE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Landing Page Preview</title>
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<style>
  html, body { height: 100%; margin: 0; overflow: hidden; font: 13px/1.4 -apple-system, "Segoe UI", Arial, sans-serif; color: #333; }
  body { display: flex; flex-direction: column; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; background: #002D38; color: #FFFFFF; }
  .toolbar__group { display: flex; align-items: center; gap: 4px; }
  .toolbar button { font: inherit; cursor: pointer; border: 1px solid rgba(255,255,255,0.35); background: transparent; color: #FFFFFF; border-radius: 6px; padding: 5px 10px; }
  .toolbar button[aria-pressed="true"] { background: #76C043; color: #002D38; border-color: #76C043; font-weight: 700; }
  .toolbar button:hover { background: rgba(255,255,255,0.15); }
  .toolbar button[aria-pressed="true"]:hover { background: #76C043; }
  .toolbar input[type="number"] { width: 64px; font: inherit; padding: 4px 6px; border-radius: 4px; border: 1px solid #B8C8CD; }
  .toolbar__label { font-weight: 700; opacity: 0.85; }
  .toolbar__live-label { margin-left: auto; padding: 4px 10px; background: rgba(255,255,255,0.12); border-radius: 999px; font-weight: 700; }
  .canvas { flex: 1; min-height: 0; background: #F4F6F8; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 16px; box-sizing: border-box; }
  .canvas__frame-wrap { background: #FFFFFF; box-shadow: 0 8px 24px rgba(0,45,56,0.18); flex-shrink: 0; }
  iframe.live-preview { border: 0; display: block; }
  .cross-browser { border-top: 1px solid #D9E2E5; background: #FFFFFF; }
  .cross-browser__header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; }
  .cross-browser__header h2 { margin: 0; font-size: 13px; }
  .cross-browser__body { display: none; padding: 8px 12px 14px; }
  .cross-browser.open .cross-browser__body { display: block; }
  .cross-browser__controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px; }
  .cross-browser button.engine { border: 1px solid #0082AD; background: #FFFFFF; color: #0082AD; border-radius: 999px; padding: 5px 12px; cursor: pointer; font: inherit; }
  .cross-browser button.engine[aria-pressed="true"] { background: #0082AD; color: #FFFFFF; }
  .cross-browser select { font: inherit; padding: 5px; border-radius: 4px; border: 1px solid #D9E2E5; }
  .cross-browser button.run { background: #76C043; color: #002D38; border: none; border-radius: 6px; padding: 7px 14px; font-weight: 700; cursor: pointer; }
  .cross-browser button.run:disabled { opacity: 0.6; cursor: not-allowed; }
  .cb-results { display: flex; flex-wrap: wrap; gap: 12px; }
  .cb-result { border: 1px solid #D9E2E5; border-radius: 8px; padding: 8px; width: 220px; }
  .cb-result h3 { margin: 0 0 4px; font-size: 13px; }
  .cb-result img { max-width: 100%; border: 1px solid #D9E2E5; border-radius: 4px; display: block; margin-bottom: 6px; }
  .cb-result dl { margin: 0; font-size: 11px; color: #66777D; }
  .cb-result dl div { display: flex; justify-content: space-between; }
  .cb-result a { font-size: 11px; }
  .cb-status--rendered { color: #256029; font-weight: 700; }
  .cb-status--error { color: #B54708; font-weight: 700; }
  .cb-status--failed { color: #B42318; font-weight: 700; }
  .ampscript-notice { font-size: 11px; color: #66777D; margin: 0 0 6px; }
</style>
</head>
<body>
  <div class="toolbar" role="toolbar" aria-label="Device preview">
    <span class="toolbar__label">Device</span>
    <div class="toolbar__group" id="device-presets"></div>
    <div class="toolbar__group">
      <button type="button" id="orientation-toggle" aria-pressed="false">Portrait ⇄ Landscape</button>
    </div>
    <div class="toolbar__group" id="custom-dims" hidden>
      <input type="number" id="custom-width" min="__MIN_W__" max="__MAX_W__" aria-label="Custom width">
      <span>×</span>
      <input type="number" id="custom-height" min="__MIN_H__" max="__MAX_H__" aria-label="Custom height">
    </div>
    <div class="toolbar__group">
      <button type="button" id="fit-toggle" aria-pressed="true">Fit</button>
      <button type="button" id="actual-size-toggle" aria-pressed="false">100%</button>
    </div>
    <span class="toolbar__live-label">Live Preview — Current Browser</span>
  </div>

  <div class="canvas" id="canvas">
    <div class="canvas__frame-wrap" id="frame-wrap">
      <iframe class="live-preview" sandbox="allow-scripts" title="Landing page preview" srcdoc="__SRCDOC__"></iframe>
    </div>
  </div>

  <div class="cross-browser" id="cross-browser">
    <div class="cross-browser__header" id="cross-browser-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="cross-browser-body">
      <span id="cross-browser-chevron">▸</span>
      <h2>Cross-browser Check</h2>
    </div>
    <div class="cross-browser__body" id="cross-browser-body">
      <p class="ampscript-notice">Renders this snapshot through a real Chromium, Firefox, or WebKit engine in an isolated process. Separate from Live Preview above — this is a static render check, not an interactive session.</p>
      <div class="cross-browser__controls">
        <span class="toolbar__label" style="color:#333;">Browser engine</span>
        <div id="engine-buttons"></div>
        <span class="toolbar__label" style="color:#333;">Device</span>
        <select id="cb-device"></select>
        <button type="button" class="run" id="run-cross-browser">Run Cross-browser Check</button>
      </div>
      <div class="cb-results" id="cb-results"></div>
    </div>
  </div>

<script>
(function () {
  "use strict";
  var DEVICE_PRESETS = __DEVICE_PRESETS_JSON__;
  var CB_DEVICE_PRESETS = __CB_DEVICE_PRESETS_JSON__;
  var CROSS_BROWSER_URL = __CROSS_BROWSER_URL_JSON__;
  var CSRF_TOKEN = __CSRF_TOKEN_JSON__;
  var MIN_W = __MIN_W__, MAX_W = __MAX_W__, MIN_H = __MIN_H__, MAX_H = __MAX_H__;

  var frameWrap = document.getElementById('frame-wrap');
  var canvas = document.getElementById('canvas');
  var deviceButtonsEl = document.getElementById('device-presets');
  var customDimsEl = document.getElementById('custom-dims');
  var customWidthInput = document.getElementById('custom-width');
  var customHeightInput = document.getElementById('custom-height');
  var orientationToggle = document.getElementById('orientation-toggle');
  var fitToggle = document.getElementById('fit-toggle');
  var actualSizeToggle = document.getElementById('actual-size-toggle');

  var state = { presetIndex: 0, custom: false, width: DEVICE_PRESETS[0][1], height: DEVICE_PRESETS[0][2], landscape: false, fit: true };

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function currentDims() {
    var w = state.width, h = state.height;
    return state.landscape ? { width: h, height: w } : { width: w, height: h };
  }

  function applyFrameSize() {
    var dims = currentDims();
    var scale = 1;
    if (state.fit) {
      var available = canvas.getBoundingClientRect();
      scale = Math.min(1, (available.width - 32) / dims.width, (available.height - 32) / dims.height);
      if (!isFinite(scale) || scale <= 0) scale = 1;
    }
    frameWrap.style.width = dims.width + 'px';
    frameWrap.style.height = dims.height + 'px';
    frameWrap.style.transform = 'scale(' + scale + ')';
    var iframe = frameWrap.querySelector('iframe');
    iframe.style.width = dims.width + 'px';
    iframe.style.height = dims.height + 'px';
  }

  function renderDeviceButtons() {
    deviceButtonsEl.innerHTML = '';
    DEVICE_PRESETS.forEach(function (preset, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = preset[0];
      button.setAttribute('aria-pressed', String(!state.custom && state.presetIndex === index));
      button.addEventListener('click', function () {
        state.custom = false; state.presetIndex = index; state.width = preset[1]; state.height = preset[2];
        customDimsEl.hidden = true;
        renderDeviceButtons(); applyFrameSize();
      });
      deviceButtonsEl.appendChild(button);
    });
    var customButton = document.createElement('button');
    customButton.type = 'button';
    customButton.textContent = 'Custom';
    customButton.setAttribute('aria-pressed', String(state.custom));
    customButton.addEventListener('click', function () {
      state.custom = true; customDimsEl.hidden = false;
      customWidthInput.value = state.width; customHeightInput.value = state.height;
      renderDeviceButtons(); applyFrameSize();
    });
    deviceButtonsEl.appendChild(customButton);
  }

  customWidthInput.addEventListener('change', function () {
    state.width = clamp(parseInt(customWidthInput.value, 10) || MIN_W, MIN_W, MAX_W);
    customWidthInput.value = state.width;
    applyFrameSize();
  });
  customHeightInput.addEventListener('change', function () {
    state.height = clamp(parseInt(customHeightInput.value, 10) || MIN_H, MIN_H, MAX_H);
    customHeightInput.value = state.height;
    applyFrameSize();
  });

  orientationToggle.addEventListener('click', function () {
    state.landscape = !state.landscape;
    orientationToggle.setAttribute('aria-pressed', String(state.landscape));
    applyFrameSize();
  });
  fitToggle.addEventListener('click', function () {
    state.fit = true;
    fitToggle.setAttribute('aria-pressed', 'true');
    actualSizeToggle.setAttribute('aria-pressed', 'false');
    applyFrameSize();
  });
  actualSizeToggle.addEventListener('click', function () {
    state.fit = false;
    fitToggle.setAttribute('aria-pressed', 'false');
    actualSizeToggle.setAttribute('aria-pressed', 'true');
    applyFrameSize();
  });
  window.addEventListener('resize', function () { if (state.fit) applyFrameSize(); });

  renderDeviceButtons();
  applyFrameSize();

  // --- Cross-browser Check ---
  var crossBrowserPanel = document.getElementById('cross-browser');
  var crossBrowserToggle = document.getElementById('cross-browser-toggle');
  var crossBrowserChevron = document.getElementById('cross-browser-chevron');
  var engineButtonsEl = document.getElementById('engine-buttons');
  var deviceSelect = document.getElementById('cb-device');
  var runButton = document.getElementById('run-cross-browser');
  var resultsEl = document.getElementById('cb-results');
  var ENGINES = ['chromium', 'firefox', 'webkit'];
  var cbState = { engine: 'chromium' };

  function toggleCrossBrowser() {
    var open = crossBrowserPanel.classList.toggle('open');
    crossBrowserToggle.setAttribute('aria-expanded', String(open));
    crossBrowserChevron.textContent = open ? '▾' : '▸';
  }
  crossBrowserToggle.addEventListener('click', toggleCrossBrowser);
  crossBrowserToggle.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCrossBrowser(); }
  });

  ENGINES.forEach(function (engine) {
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'engine'; button.textContent = engine;
    button.setAttribute('aria-pressed', String(engine === cbState.engine));
    button.addEventListener('click', function () {
      cbState.engine = engine;
      Array.prototype.forEach.call(engineButtonsEl.children, function (child) {
        child.setAttribute('aria-pressed', String(child === button));
      });
    });
    engineButtonsEl.appendChild(button);
  });

  CB_DEVICE_PRESETS.forEach(function (preset, index) {
    var option = document.createElement('option');
    option.value = String(index);
    option.textContent = preset[0] + ' (' + preset[1] + '×' + preset[2] + ')';
    deviceSelect.appendChild(option);
  });

  function renderResult(container, payload) {
    var card = document.createElement('div');
    card.className = 'cb-result';
    var heading = document.createElement('h3');
    heading.textContent = payload.engine;
    card.appendChild(heading);

    if (!payload.success) {
      var errorStatus = document.createElement('p');
      errorStatus.className = 'cb-status--failed';
      errorStatus.textContent = '✗ ' + (payload.message || 'Could not render.');
      card.appendChild(errorStatus);
      container.appendChild(card);
      return;
    }

    var status = document.createElement('p');
    var isRendered = payload.render_status === 'rendered';
    status.className = isRendered ? 'cb-status--rendered' : 'cb-status--error';
    status.textContent = (isRendered ? '✓ Rendered' : '⚠ Render error');
    card.appendChild(status);

    var image = document.createElement('img');
    image.src = 'data:image/png;base64,' + payload.screenshot_base64;
    image.alt = payload.engine + ' screenshot';
    card.appendChild(image);

    var dl = document.createElement('dl');
    function row(label, value) {
      var div = document.createElement('div');
      var b = document.createElement('span'); b.textContent = label;
      var v = document.createElement('span'); v.textContent = value;
      div.appendChild(b); div.appendChild(v); dl.appendChild(div);
    }
    row('Viewport', payload.viewport.width + '×' + payload.viewport.height);
    row('Load time', payload.duration_ms + ' ms');
    row('Console errors', String(payload.console_error_count));
    row('Failed resources', String(payload.failed_resource_count));
    row('Overflow', payload.overflow_px + 'px');
    card.appendChild(dl);

    var link = document.createElement('a');
    link.href = image.src; link.download = payload.engine + '-screenshot.png';
    link.textContent = 'Download screenshot';
    card.appendChild(link);

    container.appendChild(card);
  }

  runButton.addEventListener('click', function () {
    var preset = CB_DEVICE_PRESETS[parseInt(deviceSelect.value || '0', 10)];
    runButton.disabled = true;
    runButton.textContent = 'Running…';
    fetch(CROSS_BROWSER_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
      body: JSON.stringify({ engine: cbState.engine, width: preset[1], height: preset[2] }),
    }).then(function (response) {
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      var payload = result.body;
      payload.engine = payload.engine || cbState.engine;
      payload.success = result.ok && payload.success !== false;
      renderResult(resultsEl, payload);
    }).catch(function () {
      renderResult(resultsEl, { engine: cbState.engine, success: false, message: 'Network error.' });
    }).finally(function () {
      runButton.disabled = false;
      runButton.textContent = 'Run Cross-browser Check';
    });
  });
})();
</script>
</body></html>"""


def build_shell_html(*, inner_html: str, inner_csp: str, cross_browser_url: str, csrf_token: str) -> str:
    import json as _json

    from .csp import outer_shell_csp

    html = _TEMPLATE
    html = html.replace('__CSP__', outer_shell_csp())
    html = html.replace('__SRCDOC__', html_escape(inner_html))
    html = html.replace('__DEVICE_PRESETS_JSON__', _json.dumps(DEVICE_PRESETS))
    html = html.replace('__CB_DEVICE_PRESETS_JSON__', _json.dumps(CROSS_BROWSER_DEVICE_PRESETS))
    html = html.replace('__CROSS_BROWSER_URL_JSON__', _json.dumps(cross_browser_url))
    html = html.replace('__CSRF_TOKEN_JSON__', _json.dumps(csrf_token))
    html = html.replace('__MIN_W__', str(MIN_CUSTOM_WIDTH)).replace('__MAX_W__', str(MAX_CUSTOM_WIDTH))
    html = html.replace('__MIN_H__', str(MIN_CUSTOM_HEIGHT)).replace('__MAX_H__', str(MAX_CUSTOM_HEIGHT))
    # inner_csp is currently unused by the shell itself (it was already
    # baked into inner_html's own <meta> tag at assembly time — see
    # assembly.py) — accepted as a parameter anyway so the caller's
    # intent is explicit and this signature doesn't quietly drift out of
    # sync with what PreviewServeView actually has on hand.
    del inner_csp
    return html

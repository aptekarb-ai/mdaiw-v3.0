"""Fixed, standalone subprocess entry point for the Cross-browser Check —
launched exactly like validators_node/*.mjs: a fixed script path, a fixed
executable (this process's own venv Python), JSON on stdin, JSON on
stdout, no CLI arguments the caller controls, no user-suppliable path.

Deliberately self-contained (no Django import, no app settings, no
database) — this script is the one thing in the whole feature that
actually loads a real browser engine and executes the previewed page's
JavaScript, so it runs in its own OS process with its own hard wall-clock
budget (enforced by the CALLER via subprocess.run(..., timeout=...), not
by this script) and touches nothing else in the application. See
../views.py::CrossBrowserCheckView for the caller and
../../mdaiw/settings.py's LP_CROSS_BROWSER_* settings for the bounds.

Security contract, mirrored from preview/cdn_policy.py but intentionally
NOT importing it (this script must have zero dependency on the Django
app it serves — see the module docstring above):
  - A brand-new, storage-less browser context per run (no cookies, no
    localStorage/sessionStorage, no auth state) — see preview/__init__.py
    for why the sandboxed-iframe live preview already guarantees the
    same thing; this mirrors that guarantee for the separate real-engine
    render.
  - Every outgoing request is intercepted; anything that is not a plain
    http(s) request to a public host is aborted before it leaves this
    process — no localhost/private-network/link-local/metadata access,
    no file:, no javascript:, no unsafe data:.
"""

import base64
import ipaddress
import json
import sys
import time
from urllib.parse import urlsplit

_LOCALHOST_NAMES = frozenset({'localhost', '0.0.0.0'})
_ALWAYS_BLOCKED_SCHEMES = frozenset({'javascript', 'vbscript', 'file', 'about', 'blob', 'data'})
_ALLOWED_SCHEMES = frozenset({'http', 'https'})


def _is_private_or_local_host(hostname: str) -> bool:
    if not hostname:
        return True
    lowered = hostname.lower()
    if lowered in _LOCALHOST_NAMES or lowered.endswith('.localhost'):
        return True
    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved


def _request_is_blocked(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return True
    scheme = (parsed.scheme or '').lower()
    if scheme in _ALWAYS_BLOCKED_SCHEMES:
        return True
    if scheme not in _ALLOWED_SCHEMES:
        return True
    return _is_private_or_local_host(parsed.hostname or '')


def _run(payload: dict) -> dict:
    from playwright.sync_api import sync_playwright

    engine_name = payload['engine']
    width = int(payload['width'])
    height = int(payload['height'])
    html = payload['html']
    nav_timeout_ms = int(payload.get('nav_timeout_ms', 15000))

    console_error_count = 0
    failed_resource_count = 0
    page_errors: list[str] = []

    started = time.perf_counter()
    with sync_playwright() as playwright:
        engine = {'chromium': playwright.chromium, 'firefox': playwright.firefox, 'webkit': playwright.webkit}[engine_name]
        browser = engine.launch()
        try:
            # No storage_state, no extraHTTPHeaders, no cookies — a clean
            # context every run (see module docstring's security contract).
            context = browser.new_context(viewport={'width': width, 'height': height})
            page = context.new_page()
            page.set_default_timeout(nav_timeout_ms)

            def handle_route(route):
                if _request_is_blocked(route.request.url):
                    route.abort()
                else:
                    route.continue_()

            page.route('**/*', handle_route)

            def handle_console(message):
                nonlocal console_error_count
                if message.type == 'error':
                    console_error_count += 1

            def handle_request_failed(_request):
                nonlocal failed_resource_count
                failed_resource_count += 1

            def handle_page_error(error):
                page_errors.append(str(error))

            page.on('console', handle_console)
            page.on('requestfailed', handle_request_failed)
            page.on('pageerror', handle_page_error)

            page.set_content(html, wait_until='load', timeout=nav_timeout_ms)
            overflow_px = page.evaluate(
                'Math.max(0, document.documentElement.scrollWidth - window.innerWidth)'
            )
            screenshot_bytes = page.screenshot(type='png')
            context.close()
        finally:
            browser.close()

    duration_ms = int((time.perf_counter() - started) * 1000)
    return {
        'success': True,
        'engine': engine_name,
        'viewport': {'width': width, 'height': height},
        'duration_ms': duration_ms,
        'console_error_count': console_error_count,
        'failed_resource_count': failed_resource_count,
        'overflow_px': int(overflow_px),
        'render_status': 'rendered' if not page_errors else 'error',
        'page_error_count': len(page_errors),
        'screenshot_base64': base64.b64encode(screenshot_bytes).decode('ascii'),
    }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        result = _run(payload)
    except Exception as exc:  # noqa: BLE001 - this process's stdout IS the error channel; the caller never sees a traceback, only this JSON
        result = {'success': False, 'error_type': type(exc).__name__}
    sys.stdout.write(json.dumps(result))


if __name__ == '__main__':
    main()

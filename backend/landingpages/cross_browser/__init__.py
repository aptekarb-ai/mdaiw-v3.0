"""Cross-browser Check — Module 3 Secure Preview.

Renders the CURRENT preview snapshot's already-assembled document through
a real browser engine (Chromium, Firefox, or WebKit) via Playwright, in an
isolated subprocess (see runner.py) — never inside the Django request
worker itself, never with the application's cookies/auth state, never
against an arbitrary URL (only the snapshot's own stored HTML, passed as
data, matching how the sandboxed live-preview iframe never receives
application state either).

This is explicitly NOT the same thing as "Live Preview — Current Browser"
(the sandboxed iframe the user's own browser renders) — see
preview/__init__.py. It exists to answer a different question: "how does
this page render in an actual Chromium/Firefox/WebKit engine", not "let
me interact with it live".
"""

import json
import logging
import os
import subprocess
import sys
from pathlib import Path

from django.conf import settings

logger = logging.getLogger('landingpages.cross_browser')

_RUNNER_SCRIPT_PATH = Path(__file__).resolve().parent / 'runner.py'

SUPPORTED_ENGINES = ('chromium', 'firefox', 'webkit')

MIN_VIEWPORT_WIDTH = 320
MAX_VIEWPORT_WIDTH = 2560
MIN_VIEWPORT_HEIGHT = 480
MAX_VIEWPORT_HEIGHT = 1600


class CrossBrowserCheckError(Exception):
    """Raised for any condition that means the check could not be
    completed — never carries the underlying exception's raw text
    outward (see runner.py, which reports only an exception TYPE, never
    a message or traceback, across the subprocess boundary)."""


def _minimal_env() -> dict:
    # Only what a bare Python + Playwright process needs to start and
    # locate its already-downloaded browser binaries — not
    # os.environ.copy(), nothing credential-shaped, no passthrough of
    # this Django process's own settings/env.
    env = {'PATH': os.environ.get('PATH', '')}
    for name in ('SystemRoot', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'):
        value = os.environ.get(name)
        if value:
            env[name] = value
    return env


def run_cross_browser_check(html: str, engine: str, width: int, height: int) -> dict:
    """Returns the runner's parsed JSON result dict. Raises
    CrossBrowserCheckError for anything the subprocess itself could not
    report safely (never-started process, timeout, malformed output) —
    a clean engine-level render failure is still a normal `dict` result
    with `render_status: 'error'`, not an exception."""
    if engine not in SUPPORTED_ENGINES:
        raise CrossBrowserCheckError(f'Unsupported engine: {engine!r}')
    if not (MIN_VIEWPORT_WIDTH <= width <= MAX_VIEWPORT_WIDTH):
        raise CrossBrowserCheckError('Viewport width out of bounds.')
    if not (MIN_VIEWPORT_HEIGHT <= height <= MAX_VIEWPORT_HEIGHT):
        raise CrossBrowserCheckError('Viewport height out of bounds.')
    if not _RUNNER_SCRIPT_PATH.is_file():
        raise CrossBrowserCheckError('Cross-browser check engine is not installed.')

    timeout_seconds = getattr(settings, 'LP_CROSS_BROWSER_TIMEOUT_SECONDS', 30)
    max_output_bytes = getattr(settings, 'LP_CROSS_BROWSER_MAX_OUTPUT_BYTES', 8_000_000)
    nav_timeout_ms = int(getattr(settings, 'LP_CROSS_BROWSER_NAV_TIMEOUT_SECONDS', 15) * 1000)

    request_payload = json.dumps({
        'html': html, 'engine': engine, 'width': width, 'height': height,
        'nav_timeout_ms': nav_timeout_ms,
    }).encode('utf-8')

    try:
        completed = subprocess.run(
            [sys.executable, str(_RUNNER_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_RUNNER_SCRIPT_PATH.parent),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.cross_browser.timeout engine=%s timeout_seconds=%s', engine, timeout_seconds)
        raise CrossBrowserCheckError('Cross-browser check timed out.')
    except FileNotFoundError:
        raise CrossBrowserCheckError('Cross-browser check engine could not be started.')
    except OSError:
        logger.exception('landingpages.cross_browser.subprocess_os_error engine=%s', engine)
        raise CrossBrowserCheckError('Cross-browser check could not be started.')

    if len(completed.stdout) > max_output_bytes:
        logger.error('landingpages.cross_browser.output_too_large engine=%s', engine)
        raise CrossBrowserCheckError('Cross-browser check output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.cross_browser.non_zero_exit engine=%s returncode=%s stderr_len=%d',
            engine, completed.returncode, len(completed.stderr),
        )
        raise CrossBrowserCheckError('Cross-browser check engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.cross_browser.malformed_output engine=%s', engine)
        raise CrossBrowserCheckError('Cross-browser check produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.cross_browser.unexpected_response_shape engine=%s', engine)
        raise CrossBrowserCheckError('Cross-browser check produced an unexpected response.')

    if not result['success']:
        logger.warning(
            'landingpages.cross_browser.engine_failed engine=%s error_type=%s',
            engine, result.get('error_type'),
        )
        raise CrossBrowserCheckError('Cross-browser check could not render this engine.')

    return result


__all__ = [
    'run_cross_browser_check', 'CrossBrowserCheckError', 'SUPPORTED_ENGINES',
    'MIN_VIEWPORT_WIDTH', 'MAX_VIEWPORT_WIDTH', 'MIN_VIEWPORT_HEIGHT', 'MAX_VIEWPORT_HEIGHT',
]

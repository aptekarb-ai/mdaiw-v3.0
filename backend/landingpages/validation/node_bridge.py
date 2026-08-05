"""Controlled Python-to-Node subprocess bridge for CSS validation.

Every property required by Sprint 1D is enforced here:
- fixed, absolute script path (never request-derived)
- fixed working directory (validators_node/, so Node resolves its own
  node_modules rather than any ancestor's)
- shell=False
- request data passed only via stdin JSON; the child process's argv is a
  fixed two-element list (executable, script path) — no request-controlled
  arguments at all
- explicit minimal environment (no inherited os.environ passthrough)
- a real, OS-enforced timeout (subprocess.run's own `timeout=`, which
  terminates the process on expiry)
- stdout size cap enforced before any JSON parsing is attempted
- every failure mode (missing Node, missing node_modules, a genuine Node
  crash, malformed/oversized output, timeout) becomes a NodeBridgeError
  with a safe, static message — stderr and raw exception text are logged
  server-side only, never returned to a caller
"""

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

_VALIDATORS_NODE_DIR = Path(__file__).resolve().parent.parent / 'validators_node'
_CSS_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'validate_css.mjs'


class NodeBridgeError(Exception):
    """Raised for any Node-validator failure. The message is always safe
    to surface (it never contains stderr, a stack trace, or a filesystem
    path) — callers may treat it exactly like any other adapter
    exception."""


def _resolve_node_executable() -> str:
    configured = getattr(settings, 'LP_NODE_EXECUTABLE', 'node') or 'node'
    resolved = shutil.which(configured)
    if not resolved:
        raise NodeBridgeError('CSS validation engine is not available.')
    return resolved


def _minimal_env() -> dict:
    # Deliberately not os.environ.copy() — only what Node actually needs
    # to start on Windows/POSIX, nothing credential-shaped, nothing that
    # could change the script's behavior (no NODE_OPTIONS passthrough).
    env = {'PATH': os.environ.get('PATH', ''), 'NODE_ENV': 'production'}
    system_root = os.environ.get('SystemRoot')  # required by Node/OpenSSL on Windows
    if system_root:
        env['SystemRoot'] = system_root
    return env


def run_css_validation(
    css: str, profile: str, *, max_issues: int | None = None, context: str = 'stylesheet',
) -> dict:
    """Runs validate_css.mjs against `css` under `profile`. Returns the
    parsed JSON response dict (itself carrying a `success` boolean — the
    script's own controlled-failure shape) on any response the script
    managed to emit. Raises NodeBridgeError for anything the script could
    not report safely by itself (missing Node, missing dependencies,
    timeout, a non-JSON or oversized response).

    `context` is a server-owned, fixed-vocabulary hint (never arbitrary
    config) — 'stylesheet' (default) for real CSS documents, or
    'declaration-list' for a synthetic single-selector wrapper built
    around an inline `style="..."` attribute's declarations, where
    Stylelint's `declaration-block-single-line-max-declarations` rule
    would otherwise misfire on every ordinary multi-declaration inline
    style (see adapters/html_inline_style.py)."""
    node_executable = _resolve_node_executable()
    if not _CSS_SCRIPT_PATH.is_file():
        raise NodeBridgeError('CSS validation engine is not installed.')

    configured_max_issues = max_issues or getattr(settings, 'LP_CSS_VALIDATION_MAX_ISSUES', 500)
    request_payload = json.dumps({
        'css': css,
        'profile': profile,
        'context': context,
        'options': {'maxIssues': configured_max_issues},
    }).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_CSS_VALIDATION_TIMEOUT_SECONDS', 5)
    max_output_bytes = getattr(settings, 'LP_CSS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_CSS_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        # subprocess.run already terminated the process before raising this.
        logger.warning('landingpages.css_validation.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('CSS validation timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('CSS validation engine could not be started.')
    except OSError:
        logger.exception('landingpages.css_validation.subprocess_os_error')
        raise NodeBridgeError('CSS validation could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.css_validation.output_too_large')
        raise NodeBridgeError('CSS validation output exceeded the maximum size.')

    if completed.returncode != 0:
        # A non-zero exit before the script's own JSON-emitting code ran
        # (missing node_modules, an uncaught crash at import time) — stderr
        # is logged server-side only, never returned to the API caller.
        logger.error(
            'landingpages.css_validation.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('CSS validation engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.css_validation.malformed_output')
        raise NodeBridgeError('CSS validation produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.css_validation.unexpected_response_shape')
        raise NodeBridgeError('CSS validation produced an unexpected response.')

    return result

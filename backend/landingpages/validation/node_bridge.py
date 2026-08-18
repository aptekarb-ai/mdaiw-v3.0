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

from . import node_worker_pool
from .bridge_cache import cached_bridge_call

logger = logging.getLogger(__name__)

_VALIDATORS_NODE_DIR = Path(__file__).resolve().parent.parent / 'validators_node'
_CSS_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'validate_css.mjs'
_SCSS_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'compile_scss.mjs'
_LESS_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'compile_less.mjs'
_JS_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'validate_js.mjs'
_FORMAT_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'format.mjs'
_CSS_AUTOFIX_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'autofix_css.mjs'
_PREPROCESSOR_AUTOFIX_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'autofix_preprocessor.mjs'
_JS_AUTOFIX_SCRIPT_PATH = _VALIDATORS_NODE_DIR / 'autofix_js.mjs'


class NodeBridgeError(Exception):
    """Raised for any Node-validator failure. The message is always safe
    to surface (it never contains stderr, a stack trace, or a filesystem
    path) — callers may treat it exactly like any other adapter
    exception."""


def _resolve_node_executable(engine_label: str = 'CSS validation') -> str:
    # `engine_label` names the CALLING engine ('CSS validation' /
    # 'SCSS/Sass compilation' / 'LESS compilation' / 'JavaScript
    # validation') so a missing Node executable is reported as exactly
    # that engine being unavailable — never a generic "CSS validation"
    # message misattributed to a different compiler (see each
    # run_*() function below).
    configured = getattr(settings, 'LP_NODE_EXECUTABLE', 'node') or 'node'
    resolved = shutil.which(configured)
    if not resolved:
        raise NodeBridgeError(f'{engine_label} engine is not available.')
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


def _try_worker(operation: str, payload: dict) -> dict | None:
    """Validator Worker + Subprocess Latency sprint — the ONLY place any
    run_*_validation/compilation function consults the persistent worker
    pool. Returns None (never raises) for every failure shape: feature
    disabled, pool unavailable, worker crashed, request timed out, or a
    genuine protocol-level failure — the caller always falls back to the
    existing one-shot subprocess implementation in that case, so this
    optimization failing can never make validation itself unavailable
    (spec section 5). A CLEAN engine-level failure the worker's handler
    itself produced (e.g. "profile invalid") is NOT this case — that
    comes back as a normal `{success: false, ...}` result dict, handled
    identically to what the one-shot subprocess path already returns."""
    if not settings.LP_VALIDATOR_WORKER_ENABLED:
        return None
    pool = node_worker_pool.get_worker_pool()
    if pool is None:
        return None
    result = pool.submit(operation, payload, timeout=settings.LP_VALIDATOR_WORKER_REQUEST_TIMEOUT_SECONDS)
    if result is None or result.get('__worker_error__'):
        return None
    return result


@cached_bridge_call(metric_prefix='validator')
def run_css_validation(
    css: str, profile: str, *, max_issues: int | None = None, context: str = 'stylesheet',
) -> dict:
    """Runs CSS validation against `css` under `profile` — via the
    persistent worker pool when available, falling back to a one-shot
    `node validate_css.mjs` subprocess otherwise (spec section 5).
    Returns the parsed JSON response dict (itself carrying a `success`
    boolean — the script's own controlled-failure shape) on any response
    either path managed to produce. Raises NodeBridgeError only for a
    transport-level failure the SUBPROCESS fallback could not report
    safely by itself (missing Node, missing dependencies, timeout, a
    non-JSON or oversized response) — the worker path's equivalent
    failures are silently absorbed by `_try_worker` and already fell
    back to this subprocess path before this function could raise.

    `context` is a server-owned, fixed-vocabulary hint (never arbitrary
    config) — 'stylesheet' (default) for real CSS documents, or
    'declaration-list' for a synthetic single-selector wrapper built
    around an inline `style="..."` attribute's declarations, where
    Stylelint's `declaration-block-single-line-max-declarations` rule
    would otherwise misfire on every ordinary multi-declaration inline
    style (see adapters/html_inline_style.py)."""
    configured_max_issues = max_issues or getattr(settings, 'LP_CSS_VALIDATION_MAX_ISSUES', 500)
    worker_result = _try_worker('css-validate', {
        'css': css, 'profile': profile, 'context': context, 'options': {'maxIssues': configured_max_issues},
    })
    if worker_result is not None:
        return worker_result
    return _run_css_validation_subprocess(css, profile, max_issues=max_issues, context=context)


def _run_css_validation_subprocess(
    css: str, profile: str, *, max_issues: int | None = None, context: str = 'stylesheet',
) -> dict:
    node_executable = _resolve_node_executable('CSS validation')
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


@cached_bridge_call(metric_prefix='compile')
def run_scss_compilation(
    source: str, syntax: str, profile: str, *,
    partials: dict[str, str] | None = None, max_issues: int | None = None,
) -> dict:
    """Compiles `source` (SCSS or indented Sass, per `syntax`) via Dart
    Sass and validates the generated CSS — via the persistent worker pool
    when available, falling back to a one-shot `node compile_scss.mjs`
    subprocess otherwise (spec section 5/11 — `syntax` is passed through
    unchanged either way, so the worker path can never accidentally
    compile SCSS source under Sass's indented syntax or vice versa).
    Returns the parsed JSON response dict on any response either path
    managed to produce; raises NodeBridgeError only for a transport-level
    failure the subprocess fallback could not report safely by itself.

    `partials` is a plain {module_name: content} dict — the ONLY imports
    compile_scss.mjs's controlled importer can ever resolve. It must be
    built entirely from content already read via the ownership-scoped
    storage provider (see adapters/css_scss_sass.py) — never from
    caller-supplied paths, never from the request body directly."""
    configured_max_issues = max_issues or getattr(settings, 'LP_CSS_VALIDATION_MAX_ISSUES', 500)
    worker_result = _try_worker('scss-compile', {
        'source': source, 'syntax': syntax, 'profile': profile,
        'partials': partials or {}, 'options': {'maxIssues': configured_max_issues},
    })
    if worker_result is not None:
        return worker_result
    return _run_scss_compilation_subprocess(source, syntax, profile, partials=partials, max_issues=max_issues)


def _run_scss_compilation_subprocess(
    source: str, syntax: str, profile: str, *,
    partials: dict[str, str] | None = None, max_issues: int | None = None,
) -> dict:
    node_executable = _resolve_node_executable('SCSS/Sass compilation')
    if not _SCSS_SCRIPT_PATH.is_file():
        raise NodeBridgeError('SCSS/Sass compilation engine is not installed.')

    configured_max_issues = max_issues or getattr(settings, 'LP_CSS_VALIDATION_MAX_ISSUES', 500)
    request_payload = json.dumps({
        'source': source,
        'syntax': syntax,
        'profile': profile,
        'partials': partials or {},
        'options': {'maxIssues': configured_max_issues},
    }).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_SCSS_COMPILATION_TIMEOUT_SECONDS', 8)
    max_output_bytes = getattr(settings, 'LP_CSS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_SCSS_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.scss_compilation.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('SCSS/Sass compilation timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('SCSS/Sass compilation engine could not be started.')
    except OSError:
        logger.exception('landingpages.scss_compilation.subprocess_os_error')
        raise NodeBridgeError('SCSS/Sass compilation could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.scss_compilation.output_too_large')
        raise NodeBridgeError('SCSS/Sass compilation output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.scss_compilation.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('SCSS/Sass compilation engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.scss_compilation.malformed_output')
        raise NodeBridgeError('SCSS/Sass compilation produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.scss_compilation.unexpected_response_shape')
        raise NodeBridgeError('SCSS/Sass compilation produced an unexpected response.')

    return result


@cached_bridge_call(metric_prefix='compile')
def run_less_compilation(
    source: str, profile: str, *,
    partials: dict[str, str] | None = None, max_issues: int | None = None,
) -> dict:
    """Compiles `source` (LESS) via the `less` package and validates the
    generated CSS — via the persistent worker pool when available,
    falling back to a one-shot `node compile_less.mjs` subprocess
    otherwise (spec section 5/11). Returns the parsed JSON response dict
    on any response either path managed to produce; raises
    NodeBridgeError only for a transport-level failure the subprocess
    fallback could not report safely by itself.

    `partials` is a plain {module_name: content} dict — the ONLY imports
    compile_less.mjs's controlled FileManager can ever resolve. It must
    be built entirely from content already read via the ownership-scoped
    storage provider (see adapters/css_less.py) — never from caller-
    supplied paths, never from the request body directly."""
    configured_max_issues = max_issues or getattr(settings, 'LP_CSS_VALIDATION_MAX_ISSUES', 500)
    worker_result = _try_worker('less-compile', {
        'source': source, 'profile': profile,
        'partials': partials or {}, 'options': {'maxIssues': configured_max_issues},
    })
    if worker_result is not None:
        return worker_result
    return _run_less_compilation_subprocess(source, profile, partials=partials, max_issues=max_issues)


def _run_less_compilation_subprocess(
    source: str, profile: str, *,
    partials: dict[str, str] | None = None, max_issues: int | None = None,
) -> dict:
    node_executable = _resolve_node_executable('LESS compilation')
    if not _LESS_SCRIPT_PATH.is_file():
        raise NodeBridgeError('LESS compilation engine is not installed.')

    configured_max_issues = max_issues or getattr(settings, 'LP_CSS_VALIDATION_MAX_ISSUES', 500)
    request_payload = json.dumps({
        'source': source,
        'profile': profile,
        'partials': partials or {},
        'options': {'maxIssues': configured_max_issues},
    }).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_LESS_COMPILATION_TIMEOUT_SECONDS', 8)
    max_output_bytes = getattr(settings, 'LP_CSS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_LESS_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.less_compilation.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('LESS compilation timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('LESS compilation engine could not be started.')
    except OSError:
        logger.exception('landingpages.less_compilation.subprocess_os_error')
        raise NodeBridgeError('LESS compilation could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.less_compilation.output_too_large')
        raise NodeBridgeError('LESS compilation output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.less_compilation.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('LESS compilation engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.less_compilation.malformed_output')
        raise NodeBridgeError('LESS compilation produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.less_compilation.unexpected_response_shape')
        raise NodeBridgeError('LESS compilation produced an unexpected response.')

    return result


@cached_bridge_call(metric_prefix='validator')
def run_js_validation(
    js: str, profile: str, *,
    source_type: str = 'auto', known_element_ids: list[str] | None = None,
    duplicate_ids: list[str] | None = None, max_issues: int | None = None,
) -> dict:
    """Runs JavaScript validation against `js` under `profile` — via the
    persistent worker pool when available, falling back to a one-shot
    `node validate_js.mjs` subprocess otherwise (spec section 5/10 — the
    worker path calls the exact same ESLint-backed pipeline, never a
    lighter/bypassed check). Returns the parsed JSON response dict
    (itself carrying a `success` boolean) on any response either path
    managed to produce. Raises NodeBridgeError only for a transport-level
    failure the subprocess fallback could not report safely by itself.

    `known_element_ids`/`duplicate_ids` are plain lists of HTML element ids
    already extracted server-side by adapters/html_js_context.py from
    already-received request source — never resolved against the
    filesystem or network by the Node script. `source_type` is a server-
    owned, fixed-vocabulary hint ('auto' | 'script' | 'module'), never
    arbitrary caller-supplied config."""
    configured_max_issues = max_issues or getattr(settings, 'LP_JS_VALIDATION_MAX_ISSUES', 500)
    worker_result = _try_worker('js-validate', {
        'js': js, 'profile': profile, 'sourceType': source_type,
        'knownElementIds': known_element_ids, 'duplicateIds': duplicate_ids,
        'options': {'maxIssues': configured_max_issues},
    })
    if worker_result is not None:
        return worker_result
    return _run_js_validation_subprocess(
        js, profile, source_type=source_type, known_element_ids=known_element_ids,
        duplicate_ids=duplicate_ids, max_issues=max_issues,
    )


def _run_js_validation_subprocess(
    js: str, profile: str, *,
    source_type: str = 'auto', known_element_ids: list[str] | None = None,
    duplicate_ids: list[str] | None = None, max_issues: int | None = None,
) -> dict:
    node_executable = _resolve_node_executable('JavaScript validation')
    if not _JS_SCRIPT_PATH.is_file():
        raise NodeBridgeError('JavaScript validation engine is not installed.')

    configured_max_issues = max_issues or getattr(settings, 'LP_JS_VALIDATION_MAX_ISSUES', 500)
    request_payload = json.dumps({
        'js': js,
        'profile': profile,
        'sourceType': source_type,
        'knownElementIds': known_element_ids,
        'duplicateIds': duplicate_ids,
        'options': {'maxIssues': configured_max_issues},
    }).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_JS_VALIDATION_TIMEOUT_SECONDS', 5)
    max_output_bytes = getattr(settings, 'LP_JS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_JS_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.js_validation.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('JavaScript validation timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('JavaScript validation engine could not be started.')
    except OSError:
        logger.exception('landingpages.js_validation.subprocess_os_error')
        raise NodeBridgeError('JavaScript validation could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.js_validation.output_too_large')
        raise NodeBridgeError('JavaScript validation output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.js_validation.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('JavaScript validation engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.js_validation.malformed_output')
        raise NodeBridgeError('JavaScript validation produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.js_validation.unexpected_response_shape')
        raise NodeBridgeError('JavaScript validation produced an unexpected response.')

    return result


@cached_bridge_call(metric_prefix='validator')
def run_format(language: str, source: str) -> dict:
    """Runs format.mjs — whitespace/indentation/brace normalization only
    (js-beautify; never reorders declarations, never rewrites logic).
    `language` is one of 'html' | 'css' | 'scss' | 'less' | 'javascript'.
    Returns the parsed JSON response dict on any response the script
    managed to emit; raises NodeBridgeError for anything it could not
    report safely by itself. Callers must treat a `success: false`
    response as "formatting skipped, original source unchanged" — never
    as a validation failure of the source itself."""
    node_executable = _resolve_node_executable('Formatting')
    if not _FORMAT_SCRIPT_PATH.is_file():
        raise NodeBridgeError('Formatting engine is not installed.')

    request_payload = json.dumps({'language': language, 'source': source}).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_FORMAT_TIMEOUT_SECONDS', 8)
    max_output_bytes = getattr(settings, 'LP_CSS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_FORMAT_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.format.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('Formatting timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('Formatting engine could not be started.')
    except OSError:
        logger.exception('landingpages.format.subprocess_os_error')
        raise NodeBridgeError('Formatting could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.format.output_too_large')
        raise NodeBridgeError('Formatting output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.format.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('Formatting engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.format.malformed_output')
        raise NodeBridgeError('Formatting produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.format.unexpected_response_shape')
        raise NodeBridgeError('Formatting produced an unexpected response.')

    return result


@cached_bridge_call(metric_prefix='validator')
def run_css_autofix(css: str, context: str = 'stylesheet') -> dict:
    """Runs autofix_css.mjs — rule-aware CSS autofix via stylelint's own
    `fix: true` mode, using the EXACT SAME stylelint config this
    project's CSS validation already uses. Returns the parsed JSON
    response dict on any response the script managed to emit; raises
    NodeBridgeError for anything it could not report safely by itself.
    Callers must treat a `success: false` response or `fixed: null` as
    "autofix skipped, original source unchanged" — never a validation
    failure of the source itself."""
    node_executable = _resolve_node_executable('CSS autofix')
    if not _CSS_AUTOFIX_SCRIPT_PATH.is_file():
        raise NodeBridgeError('CSS autofix engine is not installed.')

    request_payload = json.dumps({'css': css, 'context': context}).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_CSS_VALIDATION_TIMEOUT_SECONDS', 5)
    max_output_bytes = getattr(settings, 'LP_CSS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_CSS_AUTOFIX_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.css_autofix.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('CSS autofix timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('CSS autofix engine could not be started.')
    except OSError:
        logger.exception('landingpages.css_autofix.subprocess_os_error')
        raise NodeBridgeError('CSS autofix could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.css_autofix.output_too_large')
        raise NodeBridgeError('CSS autofix output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.css_autofix.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('CSS autofix engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.css_autofix.malformed_output')
        raise NodeBridgeError('CSS autofix produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.css_autofix.unexpected_response_shape')
        raise NodeBridgeError('CSS autofix produced an unexpected response.')

    return result


@cached_bridge_call(metric_prefix='validator')
def run_preprocessor_autofix(source: str, language: str, context: str = 'stylesheet') -> dict:
    """Tool-Grounded AI Engineer sprint, spec section 1/6 — runs
    autofix_preprocessor.mjs, which fixes the ORIGINAL LESS/SCSS source
    directly (via postcss-less/postcss-scss custom syntax), never the
    compiled CSS. `language` must be 'less' or 'scss' — indented Sass has
    no source-level autofix path (see autofix_preprocessor.mjs's own
    comment). Callers must treat a `success: false` response or
    `fixed: null` as "autofix skipped, original source unchanged" — never
    a validation failure of the source itself."""
    if language not in ('less', 'scss'):
        raise NodeBridgeError('Preprocessor autofix only supports LESS and SCSS.')

    node_executable = _resolve_node_executable('LESS/SCSS autofix')
    if not _PREPROCESSOR_AUTOFIX_SCRIPT_PATH.is_file():
        raise NodeBridgeError('LESS/SCSS autofix engine is not installed.')

    request_payload = json.dumps({'source': source, 'language': language, 'context': context}).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_CSS_VALIDATION_TIMEOUT_SECONDS', 5)
    max_output_bytes = getattr(settings, 'LP_CSS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_PREPROCESSOR_AUTOFIX_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.preprocessor_autofix.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('LESS/SCSS autofix timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('LESS/SCSS autofix engine could not be started.')
    except OSError:
        logger.exception('landingpages.preprocessor_autofix.subprocess_os_error')
        raise NodeBridgeError('LESS/SCSS autofix could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.preprocessor_autofix.output_too_large')
        raise NodeBridgeError('LESS/SCSS autofix output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.preprocessor_autofix.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('LESS/SCSS autofix engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.preprocessor_autofix.malformed_output')
        raise NodeBridgeError('LESS/SCSS autofix produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.preprocessor_autofix.unexpected_response_shape')
        raise NodeBridgeError('LESS/SCSS autofix produced an unexpected response.')

    return result


@cached_bridge_call(metric_prefix='validator')
def run_js_autofix(js: str, profile: str = 'standard') -> dict:
    """Tool-Grounded AI Engineer sprint, spec section 3/7 — runs
    autofix_js.mjs (ESLint's own `verifyAndFix`, same config JS
    validation already uses), BEFORE any AI proposal is requested for a
    JS issue. Callers must treat a `success: false` response or
    `fixed: null` as "autofix skipped, original source unchanged" —
    never a validation failure of the source itself."""
    node_executable = _resolve_node_executable('JavaScript autofix')
    if not _JS_AUTOFIX_SCRIPT_PATH.is_file():
        raise NodeBridgeError('JavaScript autofix engine is not installed.')

    request_payload = json.dumps({'js': js, 'profile': profile}).encode('utf-8')

    timeout_seconds = getattr(settings, 'LP_JS_VALIDATION_TIMEOUT_SECONDS', 5)
    max_output_bytes = getattr(settings, 'LP_JS_VALIDATION_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [node_executable, str(_JS_AUTOFIX_SCRIPT_PATH)],
            input=request_payload,
            capture_output=True,
            cwd=str(_VALIDATORS_NODE_DIR),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.js_autofix.timeout timeout_seconds=%s', timeout_seconds)
        raise NodeBridgeError('JavaScript autofix timed out.')
    except FileNotFoundError:
        raise NodeBridgeError('JavaScript autofix engine could not be started.')
    except OSError:
        logger.exception('landingpages.js_autofix.subprocess_os_error')
        raise NodeBridgeError('JavaScript autofix could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.js_autofix.output_too_large')
        raise NodeBridgeError('JavaScript autofix output exceeded the maximum size.')

    if completed.returncode != 0:
        logger.error(
            'landingpages.js_autofix.non_zero_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise NodeBridgeError('JavaScript autofix engine exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.js_autofix.malformed_output')
        raise NodeBridgeError('JavaScript autofix produced an invalid response.')

    if not isinstance(result, dict) or 'success' not in result:
        logger.error('landingpages.js_autofix.unexpected_response_shape')
        raise NodeBridgeError('JavaScript autofix produced an unexpected response.')

    return result

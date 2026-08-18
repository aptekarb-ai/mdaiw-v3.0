"""Controlled Python-to-Java subprocess bridge for the Nu Html Checker
(«vnu.jar», the W3C/WHATWG reference HTML conformance checker) — Hybrid
Validator + AI Engineer architecture sprint, spec section 2/28. Mirrors
node_bridge.py's exact security posture: fixed absolute jar path (never
request-derived), shell=False, request data via stdin only, a fixed
two/three-element argv, an explicit minimal environment, a real OS-enforced
timeout, an output-size cap enforced before JSON parsing, and every failure
mode collapsed into a JavaBridgeError with a safe static message (stderr
and raw exception text are logged server-side only).

vnu.jar is bundled directly by the `vnu-jar` npm package (no separate
network fetch at validation time) — see validators_node/package.json. It
requires a Java 11+ runtime; the package's own postinstall would download
one via npm's allow-scripts gate, which this project leaves un-approved on
purpose (no large, unreviewed binary fetch at install time). Set
LP_JAVA_EXECUTABLE to a Java 11+ binary already present on the host if the
`java` resolved via PATH is older — this adapter reports itself cleanly
unavailable (never a crash) when no suitable Java can be found, exactly
like every other engine's missing-toolchain behavior."""

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

from django.conf import settings

from .bridge_cache import cached_bridge_call

logger = logging.getLogger(__name__)

_VNU_JAR_PATH = (
    Path(__file__).resolve().parent.parent / 'validators_node' / 'node_modules'
    / 'vnu-jar' / 'build' / 'dist' / 'vnu.jar'
)


class JavaBridgeError(Exception):
    """Raised for any Nu Html Checker failure. The message is always safe
    to surface — never stderr, a stack trace, or a filesystem path."""


def _resolve_java_executable() -> str:
    configured = getattr(settings, 'LP_JAVA_EXECUTABLE', 'java') or 'java'
    resolved = shutil.which(configured)
    if not resolved:
        raise JavaBridgeError('Nu Html Checker engine is not available.')
    return resolved


def _minimal_env() -> dict:
    env = {'PATH': os.environ.get('PATH', '')}
    system_root = os.environ.get('SystemRoot')  # required on Windows
    if system_root:
        env['SystemRoot'] = system_root
    java_home = os.environ.get('JAVA_HOME')
    if java_home:
        env['JAVA_HOME'] = java_home
    return env


@cached_bridge_call(metric_prefix='validator')
def run_nu_html_check(html: str) -> list[dict]:
    """Runs vnu.jar against `html` via stdin, returns the parsed `messages`
    list from its `--format json` output (each entry: type, subType,
    message, extract, firstLine/lastLine, firstColumn/lastColumn,
    hiliteStart/hiliteLength — see adapters/html_nu.py for the mapping).
    A non-zero exit code is EXPECTED and normal whenever the checker finds
    issues — never treated as a bridge failure by itself; only a genuine
    launch/timeout/malformed-output failure raises JavaBridgeError."""
    java_executable = _resolve_java_executable()
    if not _VNU_JAR_PATH.is_file():
        raise JavaBridgeError('Nu Html Checker engine is not installed.')

    timeout_seconds = getattr(settings, 'LP_NU_HTML_TIMEOUT_SECONDS', 10)
    max_output_bytes = getattr(settings, 'LP_NU_HTML_MAX_OUTPUT_BYTES', 2_000_000)

    try:
        completed = subprocess.run(
            [java_executable, '-jar', str(_VNU_JAR_PATH), '--format', 'json', '--stdout', '-'],
            input=html.encode('utf-8'),
            capture_output=True,
            cwd=str(_VNU_JAR_PATH.parent),
            env=_minimal_env(),
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning('landingpages.nu_html_check.timeout timeout_seconds=%s', timeout_seconds)
        raise JavaBridgeError('Nu Html Checker timed out.')
    except FileNotFoundError:
        raise JavaBridgeError('Nu Html Checker could not be started.')
    except OSError:
        logger.exception('landingpages.nu_html_check.subprocess_os_error')
        raise JavaBridgeError('Nu Html Checker could not be started.')

    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        logger.error('landingpages.nu_html_check.output_too_large')
        raise JavaBridgeError('Nu Html Checker output exceeded the maximum size.')

    # vnu.jar exits 1 whenever it reports any error-level message — that is
    # normal, successful operation, not a crash. Only an exit code outside
    # {0, 1} (a JVM launch failure, an unsupported class-file-version abort,
    # etc.) indicates the checker itself never produced a real report.
    if completed.returncode not in (0, 1):
        logger.error(
            'landingpages.nu_html_check.unexpected_exit returncode=%s stderr_len=%d',
            completed.returncode, len(completed.stderr),
        )
        raise JavaBridgeError('Nu Html Checker exited unexpectedly.')

    try:
        result = json.loads(completed.stdout.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.error('landingpages.nu_html_check.malformed_output')
        raise JavaBridgeError('Nu Html Checker produced an invalid response.')

    if not isinstance(result, dict) or 'messages' not in result or not isinstance(result['messages'], list):
        logger.error('landingpages.nu_html_check.unexpected_response_shape')
        raise JavaBridgeError('Nu Html Checker produced an unexpected response.')

    return result['messages']

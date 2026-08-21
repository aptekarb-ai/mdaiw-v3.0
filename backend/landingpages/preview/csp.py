"""Content-Security-Policy strings for LP Preview's two document layers.

See preview/__init__.py and views.py's PreviewServeView for the layering:
outer shell (our own trusted markup, real HTTP response headers) vs. inner
assembled document (the user's HTML/CSS/JS, delivered only as the sandboxed
iframe's `srcdoc`, which cannot carry its own HTTP headers — its policy is
injected as a <meta> tag instead; see assembly.py).
"""

from .cdn_policy import APPROVED_CDN_HOSTS

_APPROVED_HOSTS_CSP = ' '.join(f'https://{host}' for host in sorted(APPROVED_CDN_HOSTS))


def outer_shell_csp() -> str:
    """The shell document hosts the sandboxed live-preview iframe AND
    (see shell.py) the device-preview toolbar / Cross-browser Check
    panel — all of it OUR OWN trusted markup and script, never user
    content, so it is safe to allow inline script/style here specifically
    (the untrusted assembled document itself is still only ever reachable
    through the opaque-origin sandboxed iframe — see preview/__init__.py
    — this CSP governs the wrapper around it, not the LP content).
    `connect-src 'self'` is scoped to same-origin only, for the shell's
    own fetch() call to POST /preview/<token>/cross-browser/ — it can
    never reach any other host."""
    return (
        "default-src 'none'; "
        "script-src 'unsafe-inline'; "
        "style-src 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-src 'self'; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'none'"
    )


def inner_document_csp() -> str:
    """Governs the assembled LP document itself (delivered via a <meta>
    tag — see assembly.py). `script-src`/`style-src` allow 'unsafe-inline'
    because running the user's own inline <script>/<style> content is the
    entire point of Preview; what CSP restricts here is which EXTERNAL
    hosts may additionally be loaded from (the same approved-CDN allowlist
    the validator itself uses), not inline execution. `connect-src 'none'`
    is deliberately strict: Preview renders a static snapshot, it does not
    need to make its own network calls, and blocking fetch/XHR/WebSocket
    outright removes an entire class of exfiltration/SSRF-via-preview
    concern for free. frame-ancestors is NOT set here — meta-tag CSP
    ignores it per spec; the outer shell's real HTTP header already
    controls framing of the outer document, and this inner document has no
    HTTP response of its own to carry that directive on."""
    return (
        "default-src 'none'; "
        f"script-src 'unsafe-inline' {_APPROVED_HOSTS_CSP}; "
        f"style-src 'unsafe-inline' {_APPROVED_HOSTS_CSP}; "
        "img-src 'self' data: https:; "
        f"font-src {_APPROVED_HOSTS_CSP} data:; "
        "connect-src 'none'; "
        "frame-src 'none'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'none'"
    )


__all__ = ['outer_shell_csp', 'inner_document_csp']

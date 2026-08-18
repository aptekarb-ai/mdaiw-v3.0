"""External-resource URL classification for LP Preview.

Two independent layers of enforcement, deliberately not merged into one:
  - Browser-level: the assembled document's Content-Security-Policy (see
    csp.py) restricts which HOSTS script/style/font/img resources may
    actually load from — built from the same APPROVED_CDN_HOSTS allowlist
    the validator already uses (validation/adapters/html_external_
    stylesheet.py), so "approved" means the same thing in both places.
  - Assembly-level (this module): a small, explicit set of attribute
    VALUES is never allowed to survive into the assembled document at all,
    regardless of what CSP would otherwise permit — `javascript:`/`data:`
    (script context)/`file:` schemes, and private-network/localhost hosts.
    These are stripped outright rather than merely CSP-blocked, since a
    `javascript:` href executes in the (sandboxed, opaque-origin) preview
    context the instant it's clicked, and CSP's script-src is not the
    right tool to reason about that.

Never fetches or proxies any remote URL — classification only inspects the
URL string, exactly like the existing validator adapter it mirrors.
"""

import ipaddress
from urllib.parse import urlsplit

# Same allowlist the validator already uses and reports to the user via
# the 'reference-validated' / 'unapproved-remote-source' issues — reusing
# it (not a second list) is what keeps "approved" consistent between
# validation and preview.
from ..validation.adapters.html_external_stylesheet import APPROVED_CDN_HOSTS

_ALWAYS_BLOCKED_SCHEMES = frozenset({'javascript', 'vbscript', 'file', 'about', 'blob'})
# 'data:' is only dangerous for script/stylesheet contexts (an executable
# payload); it is routine and safe for <img src="data:...">, so it is
# handled separately, not lumped into _ALWAYS_BLOCKED_SCHEMES.

_LOCALHOST_NAMES = frozenset({'localhost', '0.0.0.0'})


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
    # Covers loopback, link-local, and RFC1918/ULA private ranges — blocks
    # SSRF-style "metadata service" / internal-network targets from ever
    # being classified as a normal remote resource.
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved


def classify_url(raw_url: str, *, allow_data: bool = False) -> str:
    """Returns one of: 'approved-cdn', 'remote', 'local-asset', 'blocked',
    'invalid'. `allow_data=True` is for <img> contexts only — every other
    context must leave it False."""
    if raw_url is None:
        return 'invalid'
    url = raw_url.strip()
    if not url:
        return 'invalid'

    try:
        parsed = urlsplit(url)
    except ValueError:
        return 'invalid'

    scheme = (parsed.scheme or '').lower()

    if not scheme:
        # No scheme at all — a relative/local reference. Never resolved or
        # fetched here; see the module docstring and preview/assembly.py.
        return 'local-asset'

    if scheme == 'data':
        return 'remote' if allow_data else 'blocked'

    if scheme in _ALWAYS_BLOCKED_SCHEMES:
        return 'blocked'

    if scheme not in ('http', 'https'):
        return 'blocked'

    if not parsed.netloc:
        return 'invalid'

    hostname = parsed.hostname or ''
    if _is_private_or_local_host(hostname):
        return 'blocked'

    if scheme == 'https' and hostname.lower() in APPROVED_CDN_HOSTS:
        return 'approved-cdn'

    return 'remote'


__all__ = ['classify_url', 'APPROVED_CDN_HOSTS']

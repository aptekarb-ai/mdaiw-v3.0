"""Secret redaction — runs over every source excerpt before it is included
in an AI review request. The excerpt is the user's OWN landing-page source
(HTML/CSS/JS/AMPscript), never server config — this exists purely as
defense in depth for the case where a user has pasted something
secret-shaped into their own code (an API key in a JS fetch call, a bearer
token in a comment, etc.), matching the "never send passwords, API keys,
environment variables" requirement literally rather than trusting that it
simply won't happen.

Never applied to anything server-controlled (settings, DB credentials) —
those are never assembled into a prompt in the first place; see
provider.py's request builder, which only ever reads from
ValidationIssue/ValidationReport/submitted-source fields.
"""

import re

_REDACTED = '[REDACTED]'

_PATTERNS = [
    # AWS-style access keys.
    re.compile(r'\bAKIA[0-9A-Z]{16}\b'),
    # Generic "key/token/secret/password = value" assignments, any language's
    # assignment syntax (=, :, =>) — deliberately broad rather than
    # per-language exact.
    re.compile(
        r'(?i)\b(api[_-]?key|secret|password|passwd|token|access[_-]?key|private[_-]?key)\b'
        r'\s*[:=]\s*["\']?[A-Za-z0-9/+_.-]{6,}["\']?',
    ),
    # Bearer / Basic auth headers.
    re.compile(r'(?i)\bBearer\s+[A-Za-z0-9._-]{10,}\b'),
    re.compile(r'(?i)\bBasic\s+[A-Za-z0-9+/=]{10,}\b'),
    # PEM private key blocks.
    re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'),
    # Long high-entropy-looking base64/hex blobs (36+ chars, no whitespace) —
    # the kind of shape a real token/hash takes; short strings are never
    # touched to avoid mangling ordinary class names/hashes/hex colors.
    re.compile(r'\b[A-Za-z0-9_-]{36,}\b'),
]


def redact(text: str) -> str:
    if not text:
        return text
    redacted = text
    for pattern in _PATTERNS:
        redacted = pattern.sub(_REDACTED, redacted)
    return redacted

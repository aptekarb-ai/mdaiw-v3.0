"""Controlled fetch of an approved online source (spec section 4/6) —
the ONLY function in this codebase permitted to make an outbound request
for AI-Engineer reference material. Every call is domain-allowlist-gated,
timeout-bounded, response-size-capped, and reduced to plain text before
anything downstream ever sees it. Network/parsing failures are swallowed
into `KnowledgeFetchError` (never a raw provider/library exception),
mirroring `AIReviewUnavailable`'s convention — online research is
strictly best-effort and must never become a hard dependency of the
repair pipeline (spec section 8: "only when genuinely needed").
"""

from __future__ import annotations

import dataclasses
import hashlib
import logging
import re

from django.conf import settings
from django.utils import timezone

from .sources import AuthoritativeSource, is_allowlisted_url

logger = logging.getLogger('landingpages.knowledge.fetch')

_TAG_RE = re.compile(r'<[^>]+>')
_WHITESPACE_RE = re.compile(r'[ \t\r\f\v]+')
_BLANK_LINES_RE = re.compile(r'\n{3,}')
_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.IGNORECASE | re.DOTALL)
_SCRIPT_STYLE_RE = re.compile(r'<(script|style)\b[^>]*>.*?</\1\s*>', re.IGNORECASE | re.DOTALL)


class KnowledgeFetchBlocked(Exception):
    """Raised when a URL is not on the approved allowlist — this must
    never be caught-and-retried with a different URL; it means the
    caller's URL construction itself is wrong."""


class KnowledgeFetchError(Exception):
    """Any network, timeout, or response-shape failure. Never carries the
    underlying exception's raw text (same convention as
    AIReviewUnavailable) — logged with the exception type only."""


@dataclasses.dataclass(frozen=True)
class FetchedContent:
    url: str
    title: str
    text: str
    content_hash: str
    fetched_at: object


def _html_to_text(html: str) -> str:
    without_scripts = _SCRIPT_STYLE_RE.sub(' ', html)
    text = _TAG_RE.sub(' ', without_scripts)
    text = _WHITESPACE_RE.sub(' ', text)
    text = _BLANK_LINES_RE.sub('\n\n', text)
    return text.strip()


def fetch_authoritative_content(source: AuthoritativeSource) -> FetchedContent:
    """Fetches `source.reference_url` and returns a bounded plain-text
    extract. Raises KnowledgeFetchBlocked if `source.reference_url` is
    somehow not allowlisted (defense in depth — sources.py should never
    produce this), KnowledgeFetchError for anything else that goes
    wrong."""
    url = source.reference_url
    if not is_allowlisted_url(url):
        raise KnowledgeFetchBlocked(f'URL not on approved allowlist: {url}')

    import requests

    try:
        response = requests.get(
            url,
            timeout=settings.LP_KNOWLEDGE_FETCH_TIMEOUT_SECONDS,
            headers={'User-Agent': 'MDAIW-LP-Validator-AI-Engineer/1.0 (+application-level reference lookup)'},
            stream=True,
        )
        response.raise_for_status()
        raw = response.raw.read(settings.LP_KNOWLEDGE_MAX_RESPONSE_BYTES + 1, decode_content=True)
    except Exception as exc:  # noqa: BLE001 — deliberately broad, see docstring
        logger.warning('landingpages.knowledge.fetch.failed source=%s exc_type=%s', source.name, type(exc).__name__)
        raise KnowledgeFetchError(f'Failed to fetch {source.name}') from exc

    if len(raw) > settings.LP_KNOWLEDGE_MAX_RESPONSE_BYTES:
        raw = raw[:settings.LP_KNOWLEDGE_MAX_RESPONSE_BYTES]
    body = raw.decode('utf-8', errors='replace')

    title_match = _TITLE_RE.search(body)
    title = _WHITESPACE_RE.sub(' ', title_match.group(1)).strip() if title_match else source.name
    text = _html_to_text(body)[:settings.LP_KNOWLEDGE_MAX_EXCERPT_CHARS]
    content_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()

    return FetchedContent(url=url, title=title, text=text, content_hash=content_hash, fetched_at=timezone.now())

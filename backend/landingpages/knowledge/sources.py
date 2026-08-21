"""Approved online technical source allowlist (spec section 3/4) — the
ONLY domains `knowledge/fetch.py` will ever issue a request to. Explicitly
excludes blogs, Stack Overflow, Reddit, SEO content, and any anonymous
snippet site, per spec: "consult approved current online technical
sources... explicitly NOT blogs/StackOverflow/Reddit/SEO articles/
anonymous snippets."

Each source has a fixed, stable `reference_url` (the authoritative page
this project will fetch) rather than an open crawl — this keeps every
fetch bounded, deterministic, and reviewable, and side-steps any need for
a search API. A source is a candidate for a language only when that
language appears in `languages`.
"""

from __future__ import annotations

import dataclasses
from urllib.parse import urlsplit


@dataclasses.dataclass(frozen=True)
class AuthoritativeSource:
    name: str
    domain: str  # exact hostname or parent domain — see is_allowlisted_url
    reference_url: str
    languages: tuple[str, ...]


AUTHORITATIVE_SOURCES: tuple[AuthoritativeSource, ...] = (
    AuthoritativeSource(
        name='WHATWG HTML Living Standard', domain='html.spec.whatwg.org',
        reference_url='https://html.spec.whatwg.org/multipage/syntax.html',
        languages=('html',),
    ),
    AuthoritativeSource(
        name='W3C CSS Specifications', domain='www.w3.org',
        reference_url='https://www.w3.org/TR/CSS/',
        languages=('css', 'scss', 'sass', 'less'),
    ),
    AuthoritativeSource(
        name='Stylelint Rules Documentation', domain='stylelint.io',
        reference_url='https://stylelint.io/user-guide/rules',
        languages=('css', 'scss', 'sass', 'less'),
    ),
    AuthoritativeSource(
        name='PostCSS Documentation', domain='postcss.org',
        reference_url='https://postcss.org/',
        languages=('css', 'scss', 'sass', 'less'),
    ),
    AuthoritativeSource(
        name='Sass Documentation', domain='sass-lang.com',
        reference_url='https://sass-lang.com/documentation/',
        languages=('scss', 'sass'),
    ),
    AuthoritativeSource(
        name='Less Documentation', domain='lesscss.org',
        reference_url='https://lesscss.org/features/',
        languages=('less',),
    ),
    AuthoritativeSource(
        name='ECMAScript Language Specification', domain='tc39.es',
        reference_url='https://tc39.es/ecma262/',
        languages=('javascript',),
    ),
    AuthoritativeSource(
        name='ESLint Rules Documentation', domain='eslint.org',
        reference_url='https://eslint.org/docs/latest/rules/',
        languages=('javascript',),
    ),
    AuthoritativeSource(
        name='Salesforce Developer Documentation (AMPscript)', domain='developer.salesforce.com',
        reference_url='https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/ampscript-language-basics.html',
        languages=('ampscript',),
    ),
)


def sources_for_language(language: str) -> list[AuthoritativeSource]:
    return [source for source in AUTHORITATIVE_SOURCES if language in source.languages]


def is_allowlisted_url(url: str) -> bool:
    """True only when `url` is `https://` and its hostname is EXACTLY one
    of the allowlisted domains (never a substring/prefix match — e.g.
    `evil-w3.org` or `www.w3.org.attacker.example` must not pass)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.scheme != 'https' or not parts.hostname:
        return False
    hostname = parts.hostname.lower()
    return any(hostname == source.domain.lower() for source in AUTHORITATIVE_SOURCES)

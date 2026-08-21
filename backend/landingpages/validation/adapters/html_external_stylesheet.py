"""Classifies and, where safely possible, validates
`<link rel="stylesheet" href="...">` references found in the HTML source.

Security contract (Sprint CSS-B):
  - Never fetches remote content. An external URL is classified (host
    allowlist, protocol, HTTPS policy) but its content is never
    downloaded, matching "Stylesheet reference validated; remote
    stylesheet content was not downloaded."
  - Never reads an arbitrary filesystem path derived from user input. A
    relative href is compared, by exact string equality, against the
    CURRENT project's own already-ownership-filtered, already-trusted
    `LandingPageVersion.css_path` (itself only ever produced by
    storage.base.build_path() — see models.py). The href string itself
    is NEVER passed to the storage provider. A href that doesn't match
    the trusted stored path is reported as a missing local asset, not
    fetched, not guessed at.
  - `project` is expected to already be scoped to the requesting user
    (see views.py::ValidateView.post, which filters
    `LandingPageProject.objects.filter(user=request.user, pk=project_id)`
    before this adapter ever runs) — this adapter adds no separate
    ownership check because it never accepts a project it wasn't handed.

This adapter is not registered in engine.py's generic `_HTML_ADAPTERS`
tuple — it needs `project` context the generic per-adapter loop doesn't
provide, so engine.run() calls it directly (see the "external stylesheets"
step there), isolated by its own try/except exactly like every other
adapter.
"""

import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

from .base import ValidatorAdapter
from ..node_bridge import run_css_validation
from ..schema import ValidationIssueData
from ...storage.registry import get_storage_provider

_ENGINE_NAME = 'html-external-stylesheet'
_LOCAL_CONTEXT = 'local-external-stylesheet'
_APPROVED_CONTEXT = 'approved-external-stylesheet'
_REFERENCE_CONTEXT = 'external-stylesheet-reference'

# Small, project-owned allowlist of well-known stylesheet CDNs. Content is
# still never downloaded for these — the allowlist only changes the
# classification/severity of the *reference*, per "Stylesheet reference
# validated; remote stylesheet content was not downloaded."
APPROVED_CDN_HOSTS = frozenset({
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'stackpath.bootstrapcdn.com',
    'maxcdn.bootstrapcdn.com',
})

_FRAMEWORK_VERSION_RE = re.compile(
    r'(bootstrap|tailwindcss|tailwind|bulma|foundation|materialize|semantic-ui)[@/]v?(\d+(?:\.\d+){0,2})',
    re.IGNORECASE,
)


class _LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found: list[dict] = []  # {href, rel, media, integrity, crossorigin, line, column}

    def handle_starttag(self, tag, attrs):
        if tag != 'link':
            return
        attr_dict = dict(attrs)
        rel = (attr_dict.get('rel') or '').strip().lower()
        if rel != 'stylesheet':
            return
        href = attr_dict.get('href')
        if href is None:
            return
        line, column0 = self.getpos()
        self.found.append({
            'href': href,
            'media': attr_dict.get('media') or '',
            'integrity': attr_dict.get('integrity'),
            'crossorigin': attr_dict.get('crossorigin'),
            'line': line,
            'column': column0 + 1,
        })


def _detect_framework_version(href: str) -> tuple[str, str] | None:
    match = _FRAMEWORK_VERSION_RE.search(href)
    if not match:
        return None
    return match.group(1).lower(), match.group(2)


def _normalize_local_href(href: str) -> str:
    # A plausible convention for a project asset reference is either a
    # bare storage-relative path or one served from /media/... — neither
    # is fetched or opened; this only prepares the string for an EXACT
    # equality comparison against a trusted, DB-stored path below.
    normalized = href.split('?', 1)[0].split('#', 1)[0].lstrip('/')
    if normalized.startswith('media/'):
        normalized = normalized[len('media/'):]
    return normalized


class HtmlExternalStylesheetAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'css'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str, *, project=None) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        extractor = _LinkExtractor()
        try:
            extractor.feed(source)
            extractor.close()
        except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
            return []
        if not extractor.found:
            return []

        trusted_css_path = self._trusted_project_css_path(project)

        issues: list[ValidationIssueData] = []
        seen_hrefs: dict[str, int] = {}
        # name -> {version: (line, column) of its first occurrence}
        framework_versions: dict[str, dict[str, tuple[int, int]]] = {}

        for index, link in enumerate(extractor.found):
            href = link['href'].strip()
            line, column = link['line'], link['column']

            if not href:
                issues.append(self._issue(
                    index, line, column, 'malformed-url', 'error', 'value',
                    'The <link> element has an empty href attribute.',
                    'Provide a valid stylesheet URL or remove the <link> element.',
                ))
                continue

            normalized = href.split('?', 1)[0].split('#', 1)[0]
            if normalized in seen_hrefs:
                issues.append(self._issue(
                    index, line, column, 'duplicate-reference', 'warning', 'performance',
                    f'The stylesheet "{href}" is referenced more than once.',
                    'Remove the duplicate <link> element.',
                ))
            else:
                seen_hrefs[normalized] = index

            framework_hit = _detect_framework_version(href)
            if framework_hit:
                name, version = framework_hit
                framework_versions.setdefault(name, {}).setdefault(version, (line, column))

            try:
                parsed = urlsplit(href)
            except ValueError:
                issues.append(self._issue(
                    index, line, column, 'malformed-url', 'error', 'value',
                    f'"{href}" is not a valid URL.',
                    'Correct the stylesheet URL.',
                ))
                continue

            if parsed.scheme and parsed.scheme not in ('http', 'https'):
                issues.append(self._issue(
                    index, line, column, 'prohibited-protocol', 'error', 'security',
                    f'"{href}" uses a prohibited protocol ("{parsed.scheme}:").',
                    'Reference the stylesheet with an https:// URL, or as a local project asset.',
                ))
                continue

            if parsed.scheme in ('http', 'https') and not parsed.netloc:
                issues.append(self._issue(
                    index, line, column, 'malformed-url', 'error', 'value',
                    f'"{href}" is missing a host.',
                    'Correct the stylesheet URL.',
                ))
                continue

            if parsed.scheme in ('http', 'https'):
                issues.extend(self._classify_remote(index, line, column, href, parsed))
                continue

            # No scheme — a relative reference. Never read via the href
            # itself; only ever compared to the trusted stored path.
            local_issues = self._resolve_local(index, line, column, href, project, trusted_css_path)
            issues.extend(local_issues)

        for name, versions in framework_versions.items():
            if len(versions) > 1:
                anchor_line, anchor_column = next(iter(versions.values()))
                issues.append(self._issue(
                    None, anchor_line, anchor_column, 'conflicting-framework-version', 'warning',
                    'compatibility',
                    f'Multiple conflicting versions of "{name}" are referenced: {", ".join(sorted(versions))}.',
                    f'Reference a single consistent version of {name}.',
                ))

        for index, link in enumerate(extractor.found):
            integrity, crossorigin = link['integrity'], link['crossorigin']
            if integrity is not None and crossorigin is None:
                issues.append(self._issue(
                    index, link['line'], link['column'], 'integrity-without-crossorigin', 'warning', 'security',
                    'This stylesheet sets "integrity" without "crossorigin" — subresource integrity checks are '
                    'ignored by browsers unless crossorigin is also set.',
                    'Add a crossorigin attribute (typically crossorigin="anonymous").',
                ))
            elif crossorigin is not None and integrity is None:
                issues.append(self._issue(
                    index, link['line'], link['column'], 'crossorigin-without-integrity', 'info', 'security',
                    'This stylesheet sets "crossorigin" without "integrity" — subresource integrity is not '
                    'being enforced for this reference.',
                    'Add an integrity attribute if this resource is expected to be immutable.',
                ))

        return issues

    def _classify_remote(self, index, line, column, href, parsed) -> list[ValidationIssueData]:
        issues: list[ValidationIssueData] = []
        host = (parsed.hostname or '').lower()
        approved = host in APPROVED_CDN_HOSTS

        if parsed.scheme == 'http':
            issues.append(self._issue(
                index, line, column, 'mixed-content', 'warning', 'security',
                f'"{href}" loads a stylesheet over an insecure http:// connection.',
                'Use an https:// URL for this stylesheet.',
                context=_APPROVED_CONTEXT if approved else _REFERENCE_CONTEXT,
            ))

        if approved:
            issues.append(self._issue(
                index, line, column, 'reference-validated', 'info', 'compatibility',
                f'Stylesheet reference validated; remote stylesheet content from "{host}" was not downloaded.',
                '',
                context=_APPROVED_CONTEXT,
            ))
        else:
            issues.append(self._issue(
                index, line, column, 'unapproved-remote-source', 'warning', 'security',
                f'"{href}" references a remote stylesheet host that is not on the approved list.',
                'Use an approved CDN, or host this stylesheet as a local project asset.',
                context=_REFERENCE_CONTEXT,
            ))
        return issues

    def _resolve_local(self, index, line, column, href, project, trusted_css_path) -> list[ValidationIssueData]:
        if trusted_css_path is None:
            return [self._issue(
                index, line, column, 'missing-local-asset', 'warning', 'value',
                f'"{href}" does not match any saved asset for this project.',
                'Save this project with a CSS asset, or correct the stylesheet path.',
            )]

        normalized_href = _normalize_local_href(href)
        if normalized_href != trusted_css_path:
            return [self._issue(
                index, line, column, 'missing-local-asset', 'warning', 'value',
                f'"{href}" does not match this project\'s saved stylesheet asset.',
                'Correct the stylesheet path, or save this project with that asset.',
            )]

        # The href matched the project's own trusted, DB-stored path —
        # `trusted_css_path` (never `href`) is what gets read.
        try:
            provider = get_storage_provider()
            content = provider.read(trusted_css_path).decode('utf-8', errors='replace')
        except FileNotFoundError:
            return [self._issue(
                index, line, column, 'missing-local-asset', 'warning', 'value',
                f'"{href}" is referenced but its stored file could not be found.',
                'Re-save this project asset.',
                asset_id=trusted_css_path,
            )]
        except Exception:  # noqa: BLE001 - a storage-layer failure is reported, not raised
            return [self._issue(
                index, line, column, 'local-asset-unreadable', 'warning', 'value',
                f'"{href}" could not be read from storage.',
                '',
                asset_id=trusted_css_path,
            )]

        if not content.strip():
            return []

        result = run_css_validation(content, 'standard')
        if not result.get('success'):
            return []

        found: list[ValidationIssueData] = []
        for raw in result.get('issues', []):
            rule_id = raw.get('ruleId') or 'css:unknown'
            severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
            found.append(ValidationIssueData(
                language='css',
                editor_target='html',
                source_context=_LOCAL_CONTEXT,
                source_block_index=index,
                source_asset_id=trusted_css_path,
                source_engine=rule_id.split(':', 1)[0] if ':' in rule_id else 'css',
                engine_version=result.get('engineVersion') or '',
                rule_id=rule_id,
                category=raw.get('category') or 'syntax',
                severity=severity,
                message=raw.get('message') or '',
                # Positions are relative to the external asset's own
                # content, not the HTML document — the asset has no
                # single "editor line" in the HTML source, so the <link>
                # tag's own position anchors navigation instead.
                start_line=line,
                start_column=column,
                confidence=raw.get('confidence') or 'definite',
                suggestion=raw.get('suggestion') or '',
                code_excerpt=raw.get('codeExcerpt') or '',
                requires_manual_review=True,
                related_element='link',
                related_attribute='href',
                risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
            ))
        return found

    @staticmethod
    def _trusted_project_css_path(project) -> str | None:
        if project is None:
            return None
        version = project.versions.order_by('-version_number').first()
        if version is None or not version.css_path:
            return None
        return version.css_path

    def _issue(
        self, index, line, column, rule_suffix, severity, category, message, suggestion,
        *, context=_REFERENCE_CONTEXT, asset_id='',
    ) -> ValidationIssueData:
        return ValidationIssueData(
            language='css',
            editor_target='html',
            source_context=context,
            source_block_index=index,
            source_asset_id=asset_id,
            source_engine=_ENGINE_NAME,
            engine_version='',
            rule_id=f'css-external:{rule_suffix}',
            category=category,
            severity=severity,
            message=message,
            start_line=line,
            start_column=column,
            confidence='definite',
            suggestion=suggestion,
            requires_manual_review=True,
            related_element='link',
            related_attribute='href',
            risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
        )

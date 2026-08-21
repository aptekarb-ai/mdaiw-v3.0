"""Classifies and, where safely possible, validates `<script src="...">`
references found in the HTML source. Mirrors
html_external_stylesheet.py's security contract exactly, for scripts
instead of stylesheets:

  - Never fetches remote content. An external URL is classified (host
    allowlist, protocol, HTTPS policy) but its content is never
    downloaded.
  - Never reads an arbitrary filesystem path derived from user input. A
    relative src is compared, by exact string equality, against the
    CURRENT project's own already-ownership-filtered, already-trusted
    `LandingPageVersion.js_path` — the src string itself is NEVER passed
    to the storage provider. A src that doesn't match the trusted stored
    path is reported as a missing local asset, not fetched, not guessed
    at.
  - `project` is expected to already be scoped to the requesting user
    (see views.py::ValidateView.post) — this adapter adds no separate
    ownership check because it never accepts a project it wasn't handed.

Not registered in engine.py's generic `_HTML_ADAPTERS` tuple — it needs
`project` context the generic per-adapter loop doesn't provide, and (like
its stylesheet counterpart) only runs under Complete LP scope; engine.py
calls it directly, isolated by its own try/except exactly like every
other adapter.
"""

import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

from .base import ValidatorAdapter
from ..node_bridge import run_js_validation
from ..schema import ValidationIssueData
from ...storage.registry import get_storage_provider

_ENGINE_NAME = 'html-external-script'
_LOCAL_CONTEXT = 'local-external-script'
_APPROVED_CONTEXT = 'approved-external-script-reference'
_REFERENCE_CONTEXT = 'external-script-reference'

# Small, project-owned allowlist of well-known script CDNs. Content is
# still never downloaded for these — the allowlist only changes the
# classification/severity of the *reference*.
APPROVED_CDN_HOSTS = frozenset({
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'code.jquery.com',
    'ajax.googleapis.com',
    'stackpath.bootstrapcdn.com',
    'maxcdn.bootstrapcdn.com',
})

_FRAMEWORK_VERSION_RE = re.compile(
    r'(jquery|react|react-dom|vue|angular|bootstrap|lodash|moment|d3|axios|alpinejs)[@/]v?(\d+(?:\.\d+){0,2})',
    re.IGNORECASE,
)


class _ScriptSrcExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found: list[dict] = []  # {src, type, integrity, crossorigin, async_, defer, module, line, column}

    def handle_starttag(self, tag, attrs):
        if tag != 'script':
            return
        attr_dict = dict(attrs)
        src = attr_dict.get('src')
        if src is None:
            return
        line, column0 = self.getpos()
        script_type = (attr_dict.get('type') or '').strip().lower()
        self.found.append({
            'src': src,
            'type': script_type,
            'integrity': attr_dict.get('integrity'),
            'crossorigin': attr_dict.get('crossorigin'),
            'async_': 'async' in attr_dict,
            'defer': 'defer' in attr_dict,
            'module': script_type == 'module',
            'line': line,
            'column': column0 + 1,
        })


def _detect_framework_version(src: str) -> tuple[str, str] | None:
    match = _FRAMEWORK_VERSION_RE.search(src)
    if not match:
        return None
    return match.group(1).lower(), match.group(2)


def _normalize_local_src(src: str) -> str:
    normalized = src.split('?', 1)[0].split('#', 1)[0].lstrip('/')
    if normalized.startswith('media/'):
        normalized = normalized[len('media/'):]
    return normalized


class HtmlExternalScriptAdapter(ValidatorAdapter):
    engine_name = _ENGINE_NAME
    engine_version = ''
    language = 'javascript'
    supported_profiles = ('standard', 'strict', 'legacy', 'experimental')

    def validate(self, source: str, profile: str, *, project=None) -> list[ValidationIssueData]:
        if not source or not source.strip():
            return []

        extractor = _ScriptSrcExtractor()
        try:
            extractor.feed(source)
            extractor.close()
        except Exception:  # noqa: BLE001 - malformed HTML is reported by other adapters, not here
            return []
        if not extractor.found:
            return []

        trusted_js_path = self._trusted_project_js_path(project)

        issues: list[ValidationIssueData] = []
        seen_srcs: dict[str, int] = {}
        framework_versions: dict[str, dict[str, tuple[int, int]]] = {}

        for index, script in enumerate(extractor.found):
            src = script['src'].strip()
            line, column = script['line'], script['column']

            if not src:
                issues.append(self._issue(
                    index, line, column, 'malformed-url', 'error', 'value',
                    'The <script> element has an empty src attribute.',
                    'Provide a valid script URL or remove the src attribute.',
                ))
                continue

            normalized = src.split('?', 1)[0].split('#', 1)[0]
            if normalized in seen_srcs:
                issues.append(self._issue(
                    index, line, column, 'duplicate-reference', 'warning', 'performance',
                    f'The script "{src}" is referenced more than once.',
                    'Remove the duplicate <script> element.',
                ))
            else:
                seen_srcs[normalized] = index

            framework_hit = _detect_framework_version(src)
            if framework_hit:
                name, version = framework_hit
                framework_versions.setdefault(name, {}).setdefault(version, (line, column))

            try:
                parsed = urlsplit(src)
            except ValueError:
                issues.append(self._issue(
                    index, line, column, 'malformed-url', 'error', 'value',
                    f'"{src}" is not a valid URL.',
                    'Correct the script URL.',
                ))
                continue

            if parsed.scheme and parsed.scheme not in ('http', 'https'):
                issues.append(self._issue(
                    index, line, column, 'prohibited-protocol', 'error', 'security',
                    f'"{src}" uses a prohibited protocol ("{parsed.scheme}:").',
                    'Reference the script with an https:// URL, or as a local project asset.',
                ))
                continue

            if parsed.scheme in ('http', 'https') and not parsed.netloc:
                issues.append(self._issue(
                    index, line, column, 'malformed-url', 'error', 'value',
                    f'"{src}" is missing a host.',
                    'Correct the script URL.',
                ))
                continue

            if parsed.scheme in ('http', 'https'):
                issues.extend(self._classify_remote(index, line, column, src, parsed))
                continue

            # No scheme — a relative reference. Never read via the src
            # itself; only ever compared to the trusted stored path.
            issues.extend(self._resolve_local(index, line, column, src, project, trusted_js_path, profile))

        for name, versions in framework_versions.items():
            if len(versions) > 1:
                anchor_line, anchor_column = next(iter(versions.values()))
                issues.append(self._issue(
                    None, anchor_line, anchor_column, 'conflicting-framework-version', 'warning', 'compatibility',
                    f'Multiple conflicting versions of "{name}" are referenced: {", ".join(sorted(versions))}.',
                    f'Reference a single consistent version of {name}.',
                ))

        for index, script in enumerate(extractor.found):
            integrity, crossorigin = script['integrity'], script['crossorigin']
            if integrity is not None and crossorigin is None:
                issues.append(self._issue(
                    index, script['line'], script['column'], 'integrity-without-crossorigin', 'warning', 'security',
                    'This script sets "integrity" without "crossorigin" — subresource integrity checks are '
                    'ignored by browsers unless crossorigin is also set.',
                    'Add a crossorigin attribute (typically crossorigin="anonymous").',
                ))
            elif crossorigin is not None and integrity is None:
                issues.append(self._issue(
                    index, script['line'], script['column'], 'crossorigin-without-integrity', 'info', 'security',
                    'This script sets "crossorigin" without "integrity" — subresource integrity is not being '
                    'enforced for this reference.',
                    'Add an integrity attribute if this resource is expected to be immutable.',
                ))

        return issues

    def _classify_remote(self, index, line, column, src, parsed) -> list[ValidationIssueData]:
        issues: list[ValidationIssueData] = []
        host = (parsed.hostname or '').lower()
        approved = host in APPROVED_CDN_HOSTS

        if parsed.scheme == 'http':
            issues.append(self._issue(
                index, line, column, 'mixed-content', 'warning', 'security',
                f'"{src}" loads a script over an insecure http:// connection.',
                'Use an https:// URL for this script.',
                context=_APPROVED_CONTEXT if approved else _REFERENCE_CONTEXT,
            ))

        if approved:
            issues.append(self._issue(
                index, line, column, 'reference-validated', 'info', 'compatibility',
                f'Script reference validated; remote script content from "{host}" was not downloaded.',
                '',
                context=_APPROVED_CONTEXT,
            ))
        else:
            issues.append(self._issue(
                index, line, column, 'unapproved-remote-source', 'warning', 'security',
                f'"{src}" references a remote script host that is not on the approved list.',
                'Use an approved CDN, or host this script as a local project asset.',
                context=_REFERENCE_CONTEXT,
            ))
        return issues

    def _resolve_local(self, index, line, column, src, project, trusted_js_path, profile) -> list[ValidationIssueData]:
        if trusted_js_path is None:
            return [self._issue(
                index, line, column, 'missing-local-asset', 'warning', 'value',
                f'"{src}" does not match any saved asset for this project.',
                'Save this project with a JavaScript asset, or correct the script path.',
            )]

        normalized_src = _normalize_local_src(src)
        if normalized_src != trusted_js_path:
            return [self._issue(
                index, line, column, 'missing-local-asset', 'warning', 'value',
                f'"{src}" does not match this project\'s saved script asset.',
                'Correct the script path, or save this project with that asset.',
            )]

        # The src matched the project's own trusted, DB-stored path —
        # `trusted_js_path` (never `src`) is what gets read.
        try:
            provider = get_storage_provider()
            content = provider.read(trusted_js_path).decode('utf-8', errors='replace')
        except FileNotFoundError:
            return [self._issue(
                index, line, column, 'missing-local-asset', 'warning', 'value',
                f'"{src}" is referenced but its stored file could not be found.',
                'Re-save this project asset.',
                asset_id=trusted_js_path,
            )]
        except Exception:  # noqa: BLE001 - a storage-layer failure is reported, not raised
            return [self._issue(
                index, line, column, 'local-asset-unreadable', 'warning', 'value',
                f'"{src}" could not be read from storage.',
                '',
                asset_id=trusted_js_path,
            )]

        if not content.strip():
            return []

        result = run_js_validation(content, profile)
        if not result.get('success'):
            return []

        found: list[ValidationIssueData] = []
        for raw in result.get('issues', []):
            rule_id = raw.get('ruleId') or 'javascript:unknown'
            source_engine = rule_id.split(':', 1)[0] if ':' in rule_id else 'eslint'
            severity = raw.get('severity') if raw.get('severity') in ('error', 'warning', 'info') else 'warning'
            found.append(ValidationIssueData(
                language='javascript',
                editor_target='html',
                source_context=_LOCAL_CONTEXT,
                source_block_index=index,
                source_asset_id=trusted_js_path,
                source_engine=source_engine,
                engine_version=result.get('engineVersion') or '',
                rule_id=rule_id,
                category=raw.get('category') or 'syntax',
                severity=severity,
                message=raw.get('message') or '',
                # Positions are relative to the external asset's own
                # content, not the HTML document — the asset has no
                # single "editor line" in the HTML source, so the
                # <script> tag's own position anchors navigation instead.
                start_line=line,
                start_column=column,
                confidence=raw.get('confidence') or 'definite',
                suggestion=raw.get('suggestion') or '',
                code_excerpt=raw.get('codeExcerpt') or '',
                requires_manual_review=True,
                related_element='script',
                related_attribute='src',
                risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
            ))
        return found

    @staticmethod
    def _trusted_project_js_path(project) -> str | None:
        if project is None:
            return None
        version = project.versions.order_by('-version_number').first()
        if version is None or not version.js_path:
            return None
        return version.js_path

    def _issue(
        self, index, line, column, rule_suffix, severity, category, message, suggestion,
        *, context=_REFERENCE_CONTEXT, asset_id='',
    ) -> ValidationIssueData:
        return ValidationIssueData(
            language='javascript',
            editor_target='html',
            source_context=context,
            source_block_index=index,
            source_asset_id=asset_id,
            source_engine=_ENGINE_NAME,
            engine_version='',
            rule_id=f'javascript-external:{rule_suffix}',
            category=category,
            severity=severity,
            message=message,
            start_line=line,
            start_column=column,
            confidence='definite',
            suggestion=suggestion,
            requires_manual_review=True,
            related_element='script',
            related_attribute='src',
            risk='high' if severity == 'error' else ('medium' if severity == 'warning' else 'low'),
        )

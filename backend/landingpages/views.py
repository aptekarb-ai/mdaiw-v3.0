import logging
import time
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse
from django.middleware.csrf import get_token
from django.urls import reverse
from django.utils import timezone
from django.utils.html import escape as html_escape
from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .ai_review import build_issue_context, validate_proposals
from .ai_review.provider import (
    AIReviewRequest as AIReviewProviderRequest,
    AIReviewUnavailable,
    get_default_ai_review_provider,
)
from .fixes import PatchResult, apply_patches_to_source, compute_patches_for_issues, detect_conflicts
from .fixes.html_invariants import check_html_structural_invariants, check_no_new_duplicate_singletons
from .fixes.iterative import run_autonomous_repair
from .models import LandingPagePreviewSnapshot, LandingPageProject, LandingPageVersion, ValidationIssue, ValidationReport
from .storage.base import UnsafeStoragePathError, build_path
from .storage.registry import get_storage_provider
from . import repair_operations, validate_operations
from .cross_browser import CrossBrowserCheckError, run_cross_browser_check
from .preview.assembly import AssemblyError, assemble_document
from .preview.csp import inner_document_csp, outer_shell_csp
from .preview.shell import build_shell_html
from .report_builder import persist_validation_report
from .validation.engine import run as run_validation
from .serializers import (
    MAX_AI_REVIEW_ISSUE_IDS,
    AIFixIssuesRunRequestSerializer,
    AIReviewApplyRequestSerializer,
    AIReviewRequestSerializer,
    CrossBrowserCheckRequestSerializer,
    FixRequestSerializer,
    LandingPageProjectSerializer,
    LandingPageVersionSerializer,
    PreviewRequestSerializer,
    SaveLandingPageVersionRequestSerializer,
    ValidateRequestSerializer,
    ValidationReportSerializer,
    YuktiExplainRequestSerializer,
)
from .yukti_explain import build_explain_issue_context
from .yukti_explain.provider import ExplainRequest, ExplainUnavailable, get_default_explain_provider

logger = logging.getLogger(__name__)

_VALIDATION_FAILED_MESSAGE = 'Validation could not be completed. Please try again.'
_FIX_STALE_MESSAGE = 'Code changed after validation. Validate again before applying fixes.'
_FIX_TRUNCATED_MESSAGE = 'Validation results were truncated. Validate with a smaller input before applying fixes.'
_FIX_ENGINE_FAILED_MESSAGE = (
    'The compiler for this stylesheet did not complete successfully. Validate again before applying fixes.'
)
_FIX_COMPILER_ENGINE_BY_SOURCE_TYPE = {'scss': 'scss-compiler', 'sass': 'sass-compiler', 'less': 'less-compiler'}

_PREVIEW_STYLESHEET_MUST_COMPILE_MESSAGE = 'Stylesheet must compile successfully before preview.'
_PREVIEW_ASSEMBLY_FAILED_MESSAGE = 'Preview could not be generated. Please try again.'
_PREVIEW_TOO_LARGE_MESSAGE = 'The assembled preview exceeds the maximum size. Reduce the page content and try again.'
_PREVIEW_RATE_LIMITED_MESSAGE = 'Too many preview requests. Please wait a moment and try again.'
_PREVIEW_INVALID_MESSAGE = 'This preview link is invalid.'
_PREVIEW_EXPIRED_MESSAGE = 'This preview link has expired. Generate a new preview.'
_CROSS_BROWSER_RATE_LIMITED_MESSAGE = 'Too many cross-browser checks. Please wait a moment and try again.'
_CROSS_BROWSER_UNAVAILABLE_MESSAGE = 'Cross-browser check could not be completed. Please try again.'


def _cross_browser_rate_limited(identifier) -> bool:
    key = f'lp-cross-browser:{identifier}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.LP_CROSS_BROWSER_WINDOW_SECONDS)
        count = 1
    return count > settings.LP_CROSS_BROWSER_MAX_REQUESTS_PER_WINDOW


def _preview_rate_limited(identifier) -> bool:
    key = f'lp-preview:{identifier}'
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=settings.LP_PREVIEW_WINDOW_SECONDS)
        count = 1
    return count > settings.LP_PREVIEW_MAX_REQUESTS_PER_WINDOW


class LandingPageProjectViewSet(viewsets.ModelViewSet):
    """CRUD for a user's own landing-page projects. `get_queryset` is the
    entire ownership boundary: a project belonging to another user is
    filtered out before Django even attempts the lookup, so a request for
    someone else's project id resolves to a plain 404 — the same "never
    reveal whether the object exists" posture faceauth/accounts already
    use for unrelated resources."""

    serializer_class = LandingPageProjectSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return LandingPageProject.objects.filter(user=self.request.user)


class ValidationReportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only — reports are only ever created by ValidateView. Same
    ownership boundary as LandingPageProjectViewSet: another user's report
    id is filtered out before lookup, so it 404s rather than 403s."""

    serializer_class = ValidationReportSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ValidationReport.objects.filter(user=self.request.user)


def _resolve_validate_project(request, data):
    """Returns (project, error_response) — exactly one is not None."""
    project_id = data['project']
    if project_id is None:
        return None, None
    project = LandingPageProject.objects.filter(user=request.user, pk=project_id).first()
    if project is None:
        return None, Response(
            {
                'success': False, 'code': 'INVALID_PROJECT', 'message': 'Invalid project.',
                'errors': {'project': ['Invalid project.']},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    return project, None


_LANGUAGE_STORAGE_SEGMENT = {'html': 'html', 'css': 'css', 'js': 'js', 'ampscript': 'ampscript'}


class SaveLandingPageVersionView(APIView):
    """POST /api/v1/lp/projects/save/ — Save/Download closure sprint.

    Persists the CURRENT editor sources exactly as submitted: never
    reformats, never recompiles a preprocessor source, never runs AI,
    never applies a fix. A save always creates a NEW LandingPageVersion
    row (never overwrites a prior one in place — same "new version, not
    an edit" rule LandingPageVersion's own docstring already states) so
    a bad save can never destroy a previously-good saved state.

    A version with `project` omitted creates a brand-new project first
    (via LandingPageProjectSerializer, reusing its own atomic
    slug-collision-safe create()); the same request always creates
    version_number 1 for it. A version with `project` given must
    resolve to a project the authenticated user owns — the identical
    ownership check ValidateView already uses."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = SaveLandingPageVersionRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        project, error = _resolve_validate_project(request, data)
        if error is not None:
            return error
        if project is None:
            project_serializer = LandingPageProjectSerializer(
                data={'name': data['name']}, context={'request': request},
            )
            project_serializer.is_valid(raise_exception=True)
            project = project_serializer.save()

        next_version_number = (
            LandingPageVersion.objects.filter(project=project).order_by('-version_number').values_list(
                'version_number', flat=True,
            ).first() or 0
        ) + 1

        provider = get_storage_provider()
        paths = {}
        try:
            for field, segment in _LANGUAGE_STORAGE_SEGMENT.items():
                content = data[field]
                if not content:
                    paths[field] = ''
                    continue
                relative_path = build_path('projects', str(project.id), 'versions', str(next_version_number), segment)
                provider.save(relative_path, content.encode('utf-8'))
                paths[field] = relative_path
        except (UnsafeStoragePathError, OSError):
            logger.exception('landingpages.save_version.storage_write_failed project_id=%s', project.id)
            return Response(
                {'success': False, 'code': 'SAVE_FAILED', 'message': 'Save could not be completed. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        version = LandingPageVersion.objects.create(
            project=project, version_number=next_version_number,
            html_path=paths['html'], css_path=paths['css'], js_path=paths['js'], ampscript_path=paths['ampscript'],
            css_source_type=data['css_source_type'],
        )
        response_data = LandingPageVersionSerializer(version).data
        response_data['project'] = LandingPageProjectSerializer(project).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class LoadLandingPageVersionView(APIView):
    """GET /api/v1/lp/projects/<pk>/latest-version/ — the read-back half
    of Save, for "refresh/reopen saved LP": reconstructs the exact
    editor sources from the most recently saved version's storage
    paths. Returns actual source TEXT (unlike LandingPageVersionSerializer,
    which only ever exposes metadata) — this is the one endpoint allowed
    to do that, and only for a project the caller owns."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        project = LandingPageProject.objects.filter(user=request.user, pk=pk).first()
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        version = LandingPageVersion.objects.filter(project=project).order_by('-version_number').first()
        if version is None:
            return Response(
                {'success': False, 'code': 'NO_SAVED_VERSION', 'message': 'This project has no saved version yet.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        provider = get_storage_provider()
        sources = {}
        path_by_field = {
            'html': version.html_path, 'css': version.css_path,
            'js': version.js_path, 'ampscript': version.ampscript_path,
        }
        try:
            for field, path in path_by_field.items():
                sources[field] = provider.read(path).decode('utf-8') if path else ''
        except (UnsafeStoragePathError, OSError, FileNotFoundError):
            logger.exception('landingpages.load_version.storage_read_failed project_id=%s version_id=%s', project.id, version.id)
            return Response(
                {'success': False, 'code': 'LOAD_FAILED', 'message': 'The saved version could not be loaded.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({
            **sources,
            'css_source_type': version.css_source_type,
            'version': LandingPageVersionSerializer(version).data,
            'project': LandingPageProjectSerializer(project).data,
        }, status=status.HTTP_200_OK)


def _build_validate_response_data(report, result):
    serializer = ValidationReportSerializer(report)
    # Sprint CSS-E — generated CSS is returned on the response only, never
    # persisted (no ValidationReport column for it; see
    # validation/schema.py::ValidationRunResult docstring).
    response_data = dict(serializer.data)
    response_data['generated_css'] = result.generated_css
    response_data['generated_css_compiled'] = result.generated_css_compiled
    response_data['generated_css_engine'] = result.generated_css_engine
    response_data['generated_css_engine_version'] = result.generated_css_engine_version
    return response_data


class ValidateView(APIView):
    """POST /api/v1/lp/validate/ — runs the validation engine against
    pasted code and persists a ValidationReport + its ValidationIssue
    rows. Does not require an existing project (ad-hoc paste-and-validate)
    — when `project` is supplied it must belong to the authenticated user,
    checked explicitly rather than via a field-level queryset (see
    serializers.ValidateRequestSerializer's docstring).

    Kept as a synchronous endpoint (AI Validate Code Live Progress sprint
    added AIValidateStartView/AIValidateStatusView alongside this, not
    instead of it — some callers, e.g. tests and any non-interactive
    caller, have no use for polling)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = ValidateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        # Everything past this point touches the database and the
        # validation engine — wrapped so any unexpected failure (e.g. a
        # migration never applied to this environment, a transient DB
        # error) returns the project's standard JSON envelope instead of
        # Django's raw HTML error page, which apiRequest on the frontend
        # cannot parse and which would otherwise risk leaking a traceback.
        try:
            project, error = _resolve_validate_project(request, data)
            if error is not None:
                return error

            profile = data['profile']
            validation_scope = data['validation_scope']
            css_source_type = data['css_source_type']
            report, result = persist_validation_report(
                user=request.user, project=project,
                html=data['html'], css=data['css'], js=data['js'], ts=data['ts'], ampscript=data['ampscript'],
                profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
            )
        except Exception:  # noqa: BLE001 - never leak an unhandled exception/traceback to the client
            request_id = uuid.uuid4().hex[:12]
            logger.exception('landingpages.validate.unexpected_error request_id=%s', request_id)
            return Response(
                {
                    'success': False,
                    'code': 'VALIDATION_FAILED',
                    'message': _VALIDATION_FAILED_MESSAGE,
                    'request_id': request_id,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(_build_validate_response_data(report, result), status=status.HTTP_201_CREATED)


class AIValidateStartView(APIView):
    """POST /api/v1/lp/validate/start/ — AI Validate Code Live Progress
    sprint. Starts the SAME read-only persist_validation_report call
    ValidateView uses, on a background thread, returning immediately with
    an operation_id the client polls via AIValidateStatusView. Strictly
    read-only exactly like ValidateView — this never applies a patch or
    mutates the submitted source; it only reports progress on the same
    validation work (spec section 2)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = ValidateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        operation_id = request.data.get('operation_id') or ''
        if not operation_id:
            return Response(
                {'success': False, 'code': 'OPERATION_ID_REQUIRED', 'message': 'operation_id is required to start a trackable validation.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        project, error = _resolve_validate_project(request, data)
        if error is not None:
            return error

        existing = validate_operations.get_operation(request.user.pk, operation_id)
        if existing is not None:
            # Double-click / duplicate submission with the SAME
            # operation_id — return the already-running (or already
            # completed) operation's current state rather than starting a
            # second background thread against the same source.
            return Response({'operation_id': operation_id, 'status': existing['status']}, status=status.HTTP_202_ACCEPTED)

        validation_scope = data['validation_scope']
        validate_operations.create_operation(request.user.pk, operation_id, validation_scope)

        user = request.user
        profile = data['profile']
        css_source_type = data['css_source_type']
        html, css, js, ts, ampscript = data['html'], data['css'], data['js'], data['ts'], data['ampscript']

        def _run():
            def on_progress(*, stage):
                validate_operations.update_operation_stage(user.pk, operation_id, stage)

            try:
                report, result = persist_validation_report(
                    user=user, project=project,
                    html=html, css=css, js=js, ts=ts, ampscript=ampscript,
                    profile=profile, validation_scope=validation_scope, css_source_type=css_source_type,
                    on_progress=on_progress,
                )
            except Exception:  # noqa: BLE001 - never let a background-thread exception go unrecorded
                request_id = uuid.uuid4().hex[:12]
                logger.exception('landingpages.ai_validate_start.unexpected_error request_id=%s', request_id)
                validate_operations.fail_operation(
                    user.pk, operation_id,
                    failure_reason=_VALIDATION_FAILED_MESSAGE,
                    response_body={
                        'success': False, 'code': 'VALIDATION_FAILED',
                        'message': _VALIDATION_FAILED_MESSAGE, 'request_id': request_id,
                    },
                    response_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
                return

            response_data = _build_validate_response_data(report, result)
            validate_operations.complete_operation(
                user.pk, operation_id, response_body=response_data, response_status=status.HTTP_201_CREATED,
            )

        validate_operations.run_in_background(_run)
        return Response({'operation_id': operation_id, 'status': 'running'}, status=status.HTTP_202_ACCEPTED)


class AIValidateStatusView(APIView):
    """GET /api/v1/lp/validate/status/<operation_id>/ — AI Validate Code
    Live Progress sprint. Polled by the frontend while an
    AIValidateStartView operation runs. Returns the current
    stage/percent/checklist; once status is 'completed' or 'failed',
    `response_body`/`response_status` carry the SAME payload the
    synchronous endpoint would have returned, so the frontend applies it
    through the exact same code path."""

    permission_classes = [IsAuthenticated]

    def get(self, request, operation_id):
        operation = validate_operations.get_operation(request.user.pk, operation_id)
        if operation is None:
            return Response(
                {'success': False, 'code': 'OPERATION_NOT_FOUND', 'message': 'This validation operation was not found or has expired.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(operation, status=status.HTTP_200_OK)


def _load_report_for_fix_request(request, data):
    """Ownership + staleness gate shared by FixPreviewView/FixApplyView.
    Returns (report, error_response) — exactly one is not None. A report
    belonging to another user is filtered out before lookup (same 404-not-
    403 convention as ValidationReportViewSet), never revealing whether it
    exists at all."""
    report = ValidationReport.objects.filter(user=request.user, pk=data['report']).first()
    if report is None:
        return None, Response(status=status.HTTP_404_NOT_FOUND)

    if (
        report.validation_scope != data['validation_scope']
        or report.profile != data['profile']
        or report.css_source_type != data['css_source_type']
    ):
        return None, Response(
            {'success': False, 'code': 'REPORT_STALE', 'message': _FIX_STALE_MESSAGE},
            status=status.HTTP_409_CONFLICT,
        )

    if any(entry.get('engine_name') == 'input-limits' for entry in report.engine_status):
        return None, Response(
            {'success': False, 'code': 'REPORT_TRUNCATED', 'message': _FIX_TRUNCATED_MESSAGE},
            status=status.HTTP_409_CONFLICT,
        )

    compiler_engine = _FIX_COMPILER_ENGINE_BY_SOURCE_TYPE.get(report.css_source_type)
    if compiler_engine and any(
        entry.get('engine_name') == compiler_engine and not entry.get('success') for entry in report.engine_status
    ):
        return None, Response(
            {'success': False, 'code': 'REPORT_ENGINE_FAILED', 'message': _FIX_ENGINE_FAILED_MESSAGE},
            status=status.HTTP_409_CONFLICT,
        )

    return report, None


def _serialize_patch(patch, conflict_ids):
    return {
        'fix_id': patch.fix_id,
        'issue_id': patch.issue_id,
        'fingerprint': patch.fingerprint,
        'language': patch.language,
        'source_context': patch.source_context,
        'file': patch.file,
        'start_offset': patch.start_offset,
        'end_offset': patch.end_offset,
        'start_line': patch.start_line,
        'start_column': patch.start_column,
        'end_line': patch.end_line,
        'end_column': patch.end_column,
        'original_text': patch.original_text,
        'replacement_text': patch.replacement_text,
        'description': patch.description,
        'risk': patch.risk,
        'confidence': patch.confidence,
        'status': 'conflict' if patch.fix_id in conflict_ids else 'safe',
    }


class FixPreviewView(APIView):
    """POST /api/v1/lp/fixes/preview/ — read-only. Regenerates every
    requested issue's patch against the CURRENT submitted source (never
    the source that was present when the report was created) and reports
    which are safe, which conflict, and which have no deterministic patch
    at all. Never writes anything."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = FixRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        report, error = _load_report_for_fix_request(request, data)
        if error is not None:
            return error

        sources = {'html': data['html'], 'css': data['css'], 'js': data['js'], 'ampscript': data['ampscript']}
        patches, conflict_ids, review_required, not_found = compute_patches_for_issues(
            list(report.issues.all()), data['issue_ids'], sources, data['css_source_type'], data['profile'],
        )

        return Response({
            'patches': [_serialize_patch(patch, conflict_ids) for patch in patches],
            'conflicts': [patch.issue_id for patch in patches if patch.fix_id in conflict_ids],
            'review_required': review_required,
            'not_found': not_found,
        }, status=status.HTTP_200_OK)


class FixApplyView(APIView):
    """POST /api/v1/lp/fixes/apply/ — recomputes patches fresh (never
    trusts a prior /preview/ response) and applies only the requested,
    non-conflicting ones, per source file, highest start_offset first.
    Never partially reports success: if any patch in a source file fails
    verification, none of that file's patches are committed, and every
    patch in that file is reported 'failed' with the reason why."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = FixRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        report, error = _load_report_for_fix_request(request, data)
        if error is not None:
            return error

        sources = {'html': data['html'], 'css': data['css'], 'js': data['js'], 'ampscript': data['ampscript']}
        patches, conflict_ids, review_required, not_found = compute_patches_for_issues(
            list(report.issues.all()), data['issue_ids'], sources, data['css_source_type'], data['profile'],
        )

        applicable = [patch for patch in patches if patch.fix_id not in conflict_ids]
        by_file: dict[str, list] = {}
        for patch in applicable:
            by_file.setdefault(patch.file, []).append(patch)

        results = []
        proposed_sources = {}
        for file_key, file_patches in by_file.items():
            new_source, file_results = apply_patches_to_source(sources[file_key], file_patches)
            results.extend(file_results)
            if new_source is not None:
                proposed_sources[file_key] = new_source

        return Response({
            'results': [
                {'fix_id': r.fix_id, 'issue_id': r.issue_id, 'file': r.file, 'status': r.status, 'reason': r.reason}
                for r in results
            ],
            'proposed_sources': proposed_sources,
            'conflicts': [patch.issue_id for patch in patches if patch.fix_id in conflict_ids],
            'review_required': review_required,
            'not_found': not_found,
        }, status=status.HTTP_200_OK)


_AI_REVIEW_UNAVAILABLE_MESSAGE = 'AI review is not configured for this environment.'
_AI_REVIEW_NO_ISSUES_MESSAGE = 'No validation issues require AI review.'
_AI_REVIEW_EXPIRED_MESSAGE = 'AI review results expired. Request another AI review.'
_AI_ALTERNATIVE_SELECTION_INVALID_MESSAGE = 'Choose only one AI fix option for each validation issue.'
# 10 minutes — long enough for a user to read through proposals and decide,
# short enough that a stale review can't be replayed long after the source
# has moved on. Keyed by a random review_id, never guessable.
_AI_REVIEW_CACHE_TTL_SECONDS = 600


def _ai_review_cache_key(review_id):
    return f'lp-ai-review-result:{review_id}'


def _serialize_ai_proposal(proposal):
    patch = proposal.patch
    return {
        'fix_id': patch.fix_id,
        'issue_id': patch.issue_id,
        'language': patch.language,
        'source_context': patch.source_context,
        'file': patch.file,
        'start_line': patch.start_line,
        'start_column': patch.start_column,
        'end_line': patch.end_line,
        'end_column': patch.end_column,
        'original_text': patch.original_text,
        'replacement_text': patch.replacement_text,
        'explanation': proposal.explanation,
        'risk': patch.risk,
        'confidence': patch.confidence,
        'assumptions': proposal.assumptions,
        'requires_configuration': proposal.requires_configuration,
        'status': proposal.status,
        'rejection_reason': proposal.rejection_reason,
    }


class AIReviewRequestView(APIView):
    """POST /api/v1/lp/ai-review/request/ — calls the configured AI
    provider (see ai_review/provider.py) for the requested issues and
    returns SERVER-VALIDATED proposals only; a proposal that fails
    verification (offset out of range, expected_text mismatch, wrong
    language, targets an unrequested/foreign issue) is returned with
    status 'rejected', never silently dropped and never shown as
    applicable. Never writes to source. Caches the validated, safe
    proposals server-side (see _AI_REVIEW_CACHE_TTL_SECONDS) so Apply
    never has to trust client-supplied replacement_text/expected_text —
    see AIReviewApplyView."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = AIReviewRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        report, error = _load_report_for_fix_request(request, data)
        if error is not None:
            return error

        provider = get_default_ai_review_provider()
        if provider is None:
            return Response(
                {'success': False, 'code': 'AI_REVIEW_UNAVAILABLE', 'message': _AI_REVIEW_UNAVAILABLE_MESSAGE},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        report_issues = list(report.issues.filter(id__in=data['issue_ids']))
        found_ids = {issue.id for issue in report_issues}
        not_found = [issue_id for issue_id in data['issue_ids'] if issue_id not in found_ids]

        sources = {'html': data['html'], 'css': data['css'], 'js': data['js'], 'ampscript': data['ampscript']}
        issue_contexts = [
            context for context in (build_issue_context(issue, sources) for issue in report_issues)
            if context is not None
        ]
        if not issue_contexts:
            return Response(
                {'success': False, 'code': 'NO_ISSUES_TO_REVIEW', 'message': _AI_REVIEW_NO_ISSUES_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_platform = 'sfmc-cloudpages' if any(context.language == 'ampscript' for context in issue_contexts) else None
        provider_request = AIReviewProviderRequest(
            issues=issue_contexts,
            css_source_type=data['css_source_type'],
            validation_scope=data['validation_scope'],
            target_platform=target_platform,
            rate_limit_identifier=str(request.user.pk),
        )

        try:
            result = provider.review(provider_request)
        except AIReviewUnavailable as exc:
            logger.warning('landingpages.ai_review.unavailable reason=%s', str(exc))
            return Response(
                {'success': False, 'code': 'AI_REVIEW_UNAVAILABLE', 'message': _AI_REVIEW_UNAVAILABLE_MESSAGE},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        proposals, not_reviewed = validate_proposals(
            result.proposals, report_issues, data['issue_ids'], sources,
            profile=data['profile'], css_source_type=data['css_source_type'],
        )
        not_reviewed = sorted(set(not_reviewed) | set(not_found))

        review_id = str(uuid.uuid4())
        cache.set(
            _ai_review_cache_key(review_id),
            {
                'user_id': request.user.pk,
                'report_id': report.id,
                'patches_by_fix_id': {
                    proposal.patch.fix_id: proposal.patch for proposal in proposals if proposal.status == 'safe'
                },
            },
            timeout=_AI_REVIEW_CACHE_TTL_SECONDS,
        )

        counts = {'low': 0, 'medium': 0, 'high': 0}
        for proposal in proposals:
            if proposal.status == 'safe':
                counts[proposal.patch.risk] += 1

        return Response({
            'review_id': review_id,
            'summary': result.summary,
            'proposals': [_serialize_ai_proposal(proposal) for proposal in proposals],
            'not_reviewed': not_reviewed,
            'counts': {**counts, 'total': sum(counts.values())},
        }, status=status.HTTP_200_OK)


class AIReviewApplyView(APIView):
    """POST /api/v1/lp/ai-review/apply/ — applies only the proposals the
    server itself validated and cached during the matching /ai-review/
    request/ call (looked up by `review_id`). The client sends back
    `accepted_fix_ids` only — never proposal content — so a tampered
    replacement_text/expected_text can never reach Apply; see
    serializers.AIReviewApplyRequestSerializer's docstring. Every accepted
    patch is still re-verified against the CURRENT submitted source
    (offsets/expected_text) exactly like the deterministic /fixes/apply/,
    since source may have changed since the review was requested."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = AIReviewApplyRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        report, error = _load_report_for_fix_request(request, data)
        if error is not None:
            return error

        cached = cache.get(_ai_review_cache_key(data['review_id']))
        if not cached or cached['user_id'] != request.user.pk or cached['report_id'] != report.id:
            return Response(
                {'success': False, 'code': 'AI_REVIEW_EXPIRED', 'message': _AI_REVIEW_EXPIRED_MESSAGE},
                status=status.HTTP_409_CONFLICT,
            )

        patches_by_fix_id = cached['patches_by_fix_id']
        accepted_fix_ids = data['accepted_fix_ids']
        selected_patches = [patches_by_fix_id[fix_id] for fix_id in accepted_fix_ids if fix_id in patches_by_fix_id]
        unknown_fix_ids = [fix_id for fix_id in accepted_fix_ids if fix_id not in patches_by_fix_id]

        # Never trust the frontend's radio-button behavior alone — a
        # tampered or buggy client could still send two accepted_fix_ids
        # that both belong to the same issue's alternatives (see
        # AIReviewDialog's grouped radio UI). Reject the whole request
        # rather than silently picking one; nothing is applied either way.
        selected_by_issue: dict[int, list] = {}
        for patch in selected_patches:
            selected_by_issue.setdefault(patch.issue_id, []).append(patch)
        if any(len(patches) > 1 for patches in selected_by_issue.values()):
            return Response(
                {
                    'success': False, 'code': 'AI_ALTERNATIVE_SELECTION_INVALID',
                    'message': _AI_ALTERNATIVE_SELECTION_INVALID_MESSAGE,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        sources = {'html': data['html'], 'css': data['css'], 'js': data['js'], 'ampscript': data['ampscript']}
        conflict_ids = detect_conflicts(selected_patches)
        applicable = [patch for patch in selected_patches if patch.fix_id not in conflict_ids]

        by_file: dict[str, list] = {}
        for patch in applicable:
            by_file.setdefault(patch.file, []).append(patch)

        results = []
        proposed_sources = {}
        for file_key, file_patches in by_file.items():
            new_source, file_results = apply_patches_to_source(sources[file_key], file_patches)
            # Source-Repair Integrity sprint — this endpoint applies
            # patches directly (no same-anchor merge, so fixes/regions.py's
            # own guard never runs here), so it needs its own structural
            # check: never hand back an HTML candidate that duplicates a
            # document-shell element or re-inserts an already-present
            # singleton (title/charset/viewport/meta description) — the
            # exact two live-reproduced corruption classes, see
            # fixes/html_invariants.py.
            if file_key == 'html' and new_source is not None:
                violations = check_html_structural_invariants(new_source)
                violations += check_no_new_duplicate_singletons(sources['html'], new_source)
                if violations:
                    logger.warning(
                        'landingpages.ai_review_apply.structural_invariant_rejected violations=%s', violations,
                    )
                    file_results = [
                        PatchResult(
                            fix_id=r.fix_id, issue_id=r.issue_id, file=r.file, status='failed',
                            reason='AI Engineer generated a repair that did not pass validation. No changes were applied.',
                        )
                        for r in file_results
                    ]
                    new_source = None
            results.extend(file_results)
            if new_source is not None:
                proposed_sources[file_key] = new_source

        for fix_id in unknown_fix_ids:
            results.append(PatchResult(
                fix_id=fix_id, issue_id=None, file='', status='failed',
                reason='Proposal not found in this review. Request another AI review.',
            ))

        return Response({
            'results': [
                {'fix_id': r.fix_id, 'issue_id': r.issue_id, 'file': r.file, 'status': r.status, 'reason': r.reason}
                for r in results
            ],
            'proposed_sources': proposed_sources,
            'conflicts': [patch.issue_id for patch in selected_patches if patch.fix_id in conflict_ids],
        }, status=status.HTTP_200_OK)


_AI_FIX_RUN_FAILED_MESSAGE = 'Fixes could not be applied. Please try again.'
_AI_FIX_OPERATION_CACHE_TTL_SECONDS = 300


def _ai_fix_operation_cache_key(user_id, operation_id):
    return f'lp-ai-fix-operation:{user_id}:{operation_id}'


class AIFixIssuesRunView(APIView):
    """POST /api/v1/lp/ai-fix/run/ — AI Engineer Autonomous Repair sprint.
    Clicking "AI Fix Issues" IS the user's consent to repair every
    currently repairable issue in scope (spec section 1/17/18) — there is
    no separate per-issue selection step; the request carries only the
    report/sources/scope, never an issue-id list. Runs the FULL
    detect-fix-revalidate loop (fixes/iterative.py::run_autonomous_repair)
    behind one request/response, revalidating for real every round, and
    returns ONE final, atomic, authoritative ValidationReport — never two
    contradictory states — plus completeness metrics proving what the loop
    actually did. `Undo Applied Fixes` (client-side, from the pre-fix
    source snapshot it already keeps) remains the rollback mechanism."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = AIFixIssuesRunRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        report, error = _load_report_for_fix_request(request, data)
        if error is not None:
            return error

        operation_id = data.get('operation_id') or ''
        operation_cache_key = _ai_fix_operation_cache_key(request.user.pk, operation_id) if operation_id else None
        if operation_cache_key is not None:
            cached_response = cache.get(operation_cache_key)
            if cached_response is not None:
                # A retried/double-submitted request with the SAME
                # operation_id for the SAME user — return the already-
                # computed result rather than mutating source again.
                return Response(cached_response['body'], status=cached_response['status'])

        try:
            fix_result = run_autonomous_repair(
                user=request.user, project=report.project,
                initial_sources={'html': data['html'], 'css': data['css'], 'js': data['js'], 'ampscript': data['ampscript']},
                css_source_type=data['css_source_type'], validation_scope=data['validation_scope'], profile=data['profile'],
                rate_limit_identifier=str(request.user.pk),
            )
        except Exception:  # noqa: BLE001 - never leak an unhandled exception/traceback to the client
            request_id = uuid.uuid4().hex[:12]
            logger.exception('landingpages.ai_fix_run.unexpected_error request_id=%s', request_id)
            return Response(
                {'success': False, 'code': 'AI_FIX_RUN_FAILED', 'message': _AI_FIX_RUN_FAILED_MESSAGE, 'request_id': request_id},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response_data = _build_ai_fix_response_data(fix_result)
        if operation_cache_key is not None:
            cache.set(
                operation_cache_key, {'body': response_data, 'status': status.HTTP_201_CREATED},
                timeout=_AI_FIX_OPERATION_CACHE_TTL_SECONDS,
            )
        return Response(response_data, status=status.HTTP_201_CREATED)


def _build_ai_fix_response_data(fix_result):
    """Shared by the synchronous AIFixIssuesRunView and the background-
    thread path behind AIFixIssuesStartView/StatusView — one authoritative
    response shape regardless of which entry point produced it."""
    serializer = ValidationReportSerializer(fix_result.report)
    response_data = dict(serializer.data)
    # The final source TEXT — the editors need this to reflect what the
    # loop actually applied; `issues` above describes the result of
    # validating it, not the text itself.
    response_data['final_sources'] = fix_result.final_sources
    response_data['generated_css'] = fix_result.result.generated_css
    response_data['generated_css_compiled'] = fix_result.result.generated_css_compiled
    response_data['generated_css_engine'] = fix_result.result.generated_css_engine
    response_data['generated_css_engine_version'] = fix_result.result.generated_css_engine_version
    response_data['fix_metrics'] = {
        'iterations_run': len(fix_result.iterations),
        'iterations': [
            {
                'iteration': record.iteration, 'issues_before': record.issues_before,
                'fix_candidates_generated': record.fix_candidates_generated, 'fixes_applied': record.fixes_applied,
                'ai_requested': record.ai_requested, 'ai_unavailable': record.ai_unavailable,
            }
            for record in fix_result.iterations
        ],
        'issues_before': fix_result.issues_before_total,
        'fix_candidates_generated': fix_result.fix_candidates_generated_total,
        'fixes_applied': fix_result.fixes_applied_total,
        'issues_resolved': fix_result.issues_resolved_total,
        'issues_remaining': fix_result.issues_remaining_total,
        'issues_new': fix_result.issues_new_total,
        'issues_requires_input': fix_result.issues_requires_input_total,
        # Consistent Validation Counts sprint, section 1/33 — explicit
        # lifecycle breakdown so a caller (or a test) can reconcile
        # FINAL == INITIAL - RESOLVED + NEW without re-deriving error/
        # warning splits from the report by hand.
        'issues_before_errors': fix_result.issues_before_error_total,
        'issues_before_warnings': fix_result.issues_before_warning_total,
        'issues_final_errors': fix_result.issues_final_error_total,
        'issues_final_warnings': fix_result.issues_final_warning_total,
        'issues_unrepairable': fix_result.issues_unrepairable_total,
        # Verified Repair Memory closure spec, section 12 — an
        # ADVISORY_ONLY finding is informational (no repair strategy
        # exists at all, by the Rule Knowledge Registry's own
        # documentation), not a repair failure; surfaced explicitly so
        # the UI never has to lump it into "unrepairable"/"failed".
        'issues_advisory': fix_result.issues_advisory_total,
        'by_language': fix_result.by_language,
        'stopped_reason': fix_result.stopped_reason,
        'ai_unavailable': fix_result.ai_unavailable_ever,
    }
    return response_data


class AIFixIssuesStartView(APIView):
    """POST /api/v1/lp/ai-fix/start/ — Real-Time Progress UX sprint.
    Starts the SAME run_autonomous_repair loop AIFixIssuesRunView uses,
    but on a background thread (see repair_operations.py — this project's
    MVP-level, non-Celery mechanism), returning immediately with an
    operation_id the client polls via AIFixIssuesStatusView. operation_id
    is REQUIRED here (unlike the synchronous endpoint's optional one) —
    it is both the idempotency key and the only handle the client has to
    find this operation again."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = AIFixIssuesRunRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        operation_id = data.get('operation_id') or ''
        if not operation_id:
            return Response(
                {'success': False, 'code': 'OPERATION_ID_REQUIRED', 'message': 'operation_id is required to start a trackable repair.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        report, error = _load_report_for_fix_request(request, data)
        if error is not None:
            return error

        existing = repair_operations.get_operation(request.user.pk, operation_id)
        if existing is not None:
            # Double-click / duplicate submission with the SAME
            # operation_id — return the already-running (or already
            # completed) operation's current state rather than starting a
            # second background thread against the same source.
            return Response({'operation_id': operation_id, 'status': existing['status']}, status=status.HTTP_202_ACCEPTED)

        issues_initial = report.issues.count()
        repair_operations.create_operation(request.user.pk, operation_id, issues_initial)

        user = request.user
        project = report.project
        sources = {'html': data['html'], 'css': data['css'], 'js': data['js'], 'ampscript': data['ampscript']}
        css_source_type = data['css_source_type']
        validation_scope = data['validation_scope']
        profile = data['profile']

        def _run():
            def on_progress(*, stage, iteration, issues_resolved, issues_remaining, issues_new, issue_updates=None):
                percent = (
                    repair_operations.compute_percent(issues_initial, issues_remaining)
                    if issues_remaining is not None else 0
                )
                repair_operations.update_operation(
                    user.pk, operation_id,
                    stage=stage, stage_label=repair_operations.STAGE_LABELS[stage],
                    percent=percent, current_iteration=iteration,
                    issues_resolved=issues_resolved,
                    issues_remaining=issues_remaining if issues_remaining is not None else issues_initial,
                    issues_new=issues_new,
                    issue_updates=issue_updates or {},
                )

            try:
                fix_result = run_autonomous_repair(
                    user=user, project=project, initial_sources=sources,
                    css_source_type=css_source_type, validation_scope=validation_scope, profile=profile,
                    rate_limit_identifier=str(user.pk), on_progress=on_progress,
                )
            except Exception:  # noqa: BLE001 - never let a background-thread exception go unrecorded
                request_id = uuid.uuid4().hex[:12]
                logger.exception('landingpages.ai_fix_start.unexpected_error request_id=%s', request_id)
                repair_operations.update_operation(
                    user.pk, operation_id, status='failed',
                    failure_reason=_AI_FIX_RUN_FAILED_MESSAGE,
                    response_body={
                        'success': False, 'code': 'AI_FIX_RUN_FAILED',
                        'message': _AI_FIX_RUN_FAILED_MESSAGE, 'request_id': request_id,
                    },
                    response_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
                return

            response_data = _build_ai_fix_response_data(fix_result)
            operation_cache_key = _ai_fix_operation_cache_key(user.pk, operation_id)
            cache.set(
                operation_cache_key, {'body': response_data, 'status': status.HTTP_201_CREATED},
                timeout=_AI_FIX_OPERATION_CACHE_TTL_SECONDS,
            )
            repair_operations.update_operation(
                user.pk, operation_id, status='completed', stage=repair_operations.STAGE_FINALIZING,
                stage_label=repair_operations.STAGE_LABELS[repair_operations.STAGE_FINALIZING],
                percent=100,
                issues_resolved=response_data['fix_metrics']['issues_resolved'],
                issues_remaining=response_data['fix_metrics']['issues_remaining'],
                issues_new=response_data['fix_metrics']['issues_new'],
                response_body=response_data, response_status=status.HTTP_201_CREATED,
            )

        repair_operations.run_in_background(_run)
        return Response({'operation_id': operation_id, 'status': 'running'}, status=status.HTTP_202_ACCEPTED)


class AIFixIssuesStatusView(APIView):
    """GET /api/v1/lp/ai-fix/status/<operation_id>/ — Real-Time Progress
    UX sprint. Polled by the frontend while an AIFixIssuesStartView
    operation runs. Returns the current stage/percent/counts; once
    status is 'completed' or 'failed', `response_body`/`response_status`
    carry the SAME payload the synchronous endpoint would have returned,
    so the frontend applies it through the exact same code path."""

    permission_classes = [IsAuthenticated]

    def get(self, request, operation_id):
        operation = repair_operations.get_operation(request.user.pk, operation_id)
        if operation is None:
            return Response(
                {'success': False, 'code': 'OPERATION_NOT_FOUND', 'message': 'This repair operation was not found or has expired.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(operation, status=status.HTTP_200_OK)


_EXPLAIN_UNAVAILABLE_MESSAGE = 'Yukti explanation is not configured for this environment.'
_EXPLAIN_NO_ISSUES_MESSAGE = 'No validation issues to explain.'


def _serialize_explain_result(result, fix_method_by_issue_id):
    return {
        'summary': result.summary,
        'most_important': [
            {'issue_id': item.issue_id, 'reason': item.reason} for item in result.most_important
        ],
        'why_it_matters': result.why_it_matters,
        'how_to_fix': result.how_to_fix,
        'recommended_order': result.recommended_order,
        'per_issue': [
            {
                'issue_id': item.issue_id,
                'what': item.what,
                'why': item.why,
                'impact': item.impact,
                'recommended_correction': item.recommended_correction,
                'fix_method': fix_method_by_issue_id.get(item.issue_id, 'ai-assisted'),
                'requires_decision': fix_method_by_issue_id.get(item.issue_id) != 'deterministic',
            }
            for item in result.per_issue
        ],
    }


class YuktiExplainView(APIView):
    """POST /api/v1/lp/yukti/explain/ — Yukti explains already-detected
    validation findings in plain language. Read-only: never writes to
    source, never proposes a patch, never calls the deterministic-fix or
    AI-Fix provider. Every numeric fact in the response (counts, language
    breakdown, and each issue's fix_method) is computed here from real
    ValidationIssue rows and the real deterministic-fix engine (fixes/) —
    never asked of or trusted from the AI provider, which only ever
    supplies free-text narration around facts it was given. See
    yukti_explain/openai_provider.py for the anti-invention filtering
    that also drops any issue_id the provider mentions that was not
    actually sent to it."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = YuktiExplainRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        report, error = _load_report_for_fix_request(request, data)
        if error is not None:
            return error

        all_issues = list(report.issues.all())
        requested_ids = data['issue_ids']
        target_issues = (
            [issue for issue in all_issues if issue.id in set(requested_ids)]
            if requested_ids
            else all_issues[:MAX_AI_REVIEW_ISSUE_IDS]
        )
        truncated = not requested_ids and len(all_issues) > MAX_AI_REVIEW_ISSUE_IDS
        if not target_issues:
            return Response(
                {'success': False, 'code': 'NO_ISSUES_TO_EXPLAIN', 'message': _EXPLAIN_NO_ISSUES_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sources = {'html': data['html'], 'css': data['css'], 'js': data['js'], 'ampscript': data['ampscript']}
        target_ids = [issue.id for issue in target_issues]

        # Real, deterministic fix-method classification — the SAME engine
        # AI Fix Issues/AI Fix This Issue use, not a guess. An issue with a
        # safe (non-conflicting) deterministic patch is 'deterministic';
        # everything else (no deterministic rule, or a conflicting patch)
        # is 'ai-assisted', matching fixCandidates.ts's own bucket logic.
        patches, conflict_ids, _review_required, _not_found = compute_patches_for_issues(
            all_issues, target_ids, sources, data['css_source_type'], data['profile'],
        )
        deterministic_ids = {patch.issue_id for patch in patches if patch.fix_id not in conflict_ids}
        fix_method_by_issue_id = {
            issue.id: ('deterministic' if issue.id in deterministic_ids else 'ai-assisted')
            for issue in target_issues
        }

        issue_contexts = [
            context for context in (
                build_explain_issue_context(issue, sources, fix_method_by_issue_id[issue.id])
                for issue in target_issues
            )
            if context is not None
        ]
        if not issue_contexts:
            return Response(
                {'success': False, 'code': 'NO_ISSUES_TO_EXPLAIN', 'message': _EXPLAIN_NO_ISSUES_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        counts = {'errors': 0, 'warnings': 0, 'info': 0}
        for issue in all_issues:
            if issue.severity == 'error':
                counts['errors'] += 1
            elif issue.severity == 'warning':
                counts['warnings'] += 1
            else:
                counts['info'] += 1

        language_breakdown = []
        languages_present = sorted({issue.language for issue in all_issues})
        if data['validation_scope'] == 'complete' or len(languages_present) > 1:
            for language in languages_present:
                language_issues = [issue for issue in all_issues if issue.language == language]
                language_breakdown.append({
                    'language': language,
                    'errors': sum(1 for issue in language_issues if issue.severity == 'error'),
                    'warnings': sum(1 for issue in language_issues if issue.severity == 'warning'),
                    'info': sum(1 for issue in language_issues if issue.severity == 'info'),
                })

        provider = get_default_explain_provider()
        if provider is None:
            return Response(
                {'success': False, 'code': 'EXPLAIN_UNAVAILABLE', 'message': _EXPLAIN_UNAVAILABLE_MESSAGE},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        provider_request = ExplainRequest(
            issues=issue_contexts,
            error_count=counts['errors'], warning_count=counts['warnings'], info_count=counts['info'],
            language_breakdown=language_breakdown,
            validation_scope=data['validation_scope'],
            rate_limit_identifier=str(request.user.pk),
        )

        try:
            result = provider.explain(provider_request)
        except ExplainUnavailable as exc:
            logger.warning('landingpages.yukti_explain.unavailable reason=%s', str(exc))
            return Response(
                {'success': False, 'code': 'EXPLAIN_UNAVAILABLE', 'message': _EXPLAIN_UNAVAILABLE_MESSAGE},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({
            'counts': counts,
            'language_breakdown': language_breakdown,
            'truncated': truncated,
            **_serialize_explain_result(result, fix_method_by_issue_id),
        }, status=status.HTTP_200_OK)


class PreviewCreateView(APIView):
    """POST /api/v1/lp/preview/ — assembles the CURRENT editor state
    (HTML + active stylesheet + JavaScript + simulated AMPscript) into one
    standalone HTML document and stores it as a short-lived, per-user
    snapshot (models.LandingPagePreviewSnapshot). Never trusts a
    client-supplied "already compiled" CSS string: a preprocessor
    stylesheet is recompiled fresh, right now, through the same validation
    engine /validate/ itself uses, so Preview can never show stale or
    unverified generated CSS. See preview/assembly.py for the document
    builder and preview/__init__.py for why the assembled content is only
    ever delivered inside a sandboxed iframe, never rendered directly by
    this app's own React tree."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        request_serializer = PreviewRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        if _preview_rate_limited(request.user.pk):
            return Response(
                {'success': False, 'code': 'PREVIEW_RATE_LIMITED', 'message': _PREVIEW_RATE_LIMITED_MESSAGE},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        css_source_type = data['css_source_type']
        css_for_preview = data['css']

        if css_source_type != 'css':
            try:
                compile_result = run_validation(
                    html='', css=data['css'], js='', ampscript='',
                    profile=data['profile'], validation_scope='css', project=None,
                    css_source_type=css_source_type,
                )
            except Exception:  # noqa: BLE001 - never leak an unhandled exception/traceback to the client
                logger.exception('landingpages.preview.compile_unexpected_error')
                return Response(
                    {
                        'success': False, 'code': 'STYLESHEET_MUST_COMPILE',
                        'message': _PREVIEW_STYLESHEET_MUST_COMPILE_MESSAGE,
                    },
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            if not compile_result.generated_css_compiled or compile_result.generated_css is None:
                return Response(
                    {
                        'success': False, 'code': 'STYLESHEET_MUST_COMPILE',
                        'message': _PREVIEW_STYLESHEET_MUST_COMPILE_MESSAGE,
                    },
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            css_for_preview = compile_result.generated_css

        try:
            assembled = assemble_document(
                html_source=data['html'],
                css_source=css_for_preview,
                js_source=data['js'],
                ampscript_source=data['ampscript'],
                ampscript_mock_values=data['ampscript_mock_values'],
                inner_csp=inner_document_csp(),
            )
        except AssemblyError as exc:
            return Response(
                {'success': False, 'code': 'PREVIEW_ASSEMBLY_FAILED', 'message': str(exc)},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except Exception:  # noqa: BLE001 - never leak an unhandled exception/traceback to the client
            request_id = uuid.uuid4().hex[:12]
            logger.exception('landingpages.preview.assembly_unexpected_error request_id=%s', request_id)
            return Response(
                {
                    'success': False, 'code': 'PREVIEW_ASSEMBLY_FAILED',
                    'message': _PREVIEW_ASSEMBLY_FAILED_MESSAGE, 'request_id': request_id,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if len(assembled.html.encode('utf-8')) > settings.LP_PREVIEW_MAX_DOCUMENT_BYTES:
            return Response(
                {'success': False, 'code': 'PREVIEW_TOO_LARGE', 'message': _PREVIEW_TOO_LARGE_MESSAGE},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        expires_at = timezone.now() + timedelta(seconds=settings.LP_PREVIEW_TTL_SECONDS)
        snapshot = LandingPagePreviewSnapshot.objects.create(
            user=request.user, html=assembled.html, expires_at=expires_at,
        )

        return Response({
            'token': str(snapshot.token),
            'preview_url': reverse('landingpage-preview-serve', args=[str(snapshot.token)]),
            'expires_at': expires_at.isoformat(),
            'ampscript_simulated': assembled.ampscript_simulated,
        }, status=status.HTTP_201_CREATED)


class PreviewServeView(APIView):
    """GET /api/v1/lp/preview/<token>/ — serves the trusted OUTER shell
    document for a snapshot (see preview/__init__.py). Requires
    authentication AND ownership AND an unexpired snapshot; the token's
    own unguessability (a random uuid4 — see models.
    LandingPagePreviewSnapshot) is defense in depth, never the sole access
    control. A wrong-owner token and a genuinely-missing token get the
    IDENTICAL response, so this endpoint never confirms to a non-owner
    that a token exists at all — the same posture LandingPageProjectViewSet
    already uses for cross-user access.

    The untrusted assembled document is embedded ONLY as the sandboxed
    iframe's srcdoc attribute, HTML-attribute-escaped — this view's own
    markup contains no script of its own, so there is nothing here for a
    previewed page's content to corrupt into script execution in this
    document's (real, cookie-bearing) origin."""

    permission_classes = [IsAuthenticated]

    def get(self, request, token):
        snapshot = LandingPagePreviewSnapshot.objects.filter(token=token).first()
        if snapshot is None or snapshot.user_id != request.user.pk:
            return self._error_response(_PREVIEW_INVALID_MESSAGE, status.HTTP_404_NOT_FOUND)
        if snapshot.is_expired():
            return self._error_response(_PREVIEW_EXPIRED_MESSAGE, status.HTTP_410_GONE)

        # get_token() both returns the current CSRF value AND ensures
        # Django sets the csrftoken cookie on THIS response if the
        # browser doesn't already have one — the shell's own fetch() to
        # /cross-browser/ (same-origin only, see csp.py) needs a real
        # token, and this snapshot page may be the first request this
        # session ever makes to the backend origin.
        csrf_token = get_token(request)
        cross_browser_url = reverse('landingpage-preview-cross-browser', args=[str(token)])
        shell_html = build_shell_html(
            inner_html=snapshot.html, inner_csp=inner_document_csp(),
            cross_browser_url=cross_browser_url, csrf_token=csrf_token,
        )
        return self._respond(shell_html, status.HTTP_200_OK)

    @classmethod
    def _error_response(cls, message, http_status):
        body = (
            '<!DOCTYPE html>\n'
            '<html><head><meta charset="utf-8"><title>Preview unavailable</title></head>'
            f'<body><p>{html_escape(message)}</p></body></html>'
        )
        return cls._respond(body, http_status)

    @staticmethod
    def _respond(body, http_status):
        response = HttpResponse(body, content_type='text/html; charset=utf-8', status=http_status)
        response['Content-Security-Policy'] = outer_shell_csp()
        response['X-Robots-Tag'] = 'noindex, nofollow'
        response['X-Content-Type-Options'] = 'nosniff'
        response['Referrer-Policy'] = 'no-referrer'
        return response


class CrossBrowserCheckView(APIView):
    """POST /api/v1/lp/preview/<token>/cross-browser/ — renders the
    snapshot's already-assembled document through a real Chromium/
    Firefox/WebKit engine (see cross_browser/runner.py) in an isolated
    subprocess. Same ownership/expiry checks as PreviewServeView; the
    snapshot's stored HTML is passed to the engine as DATA (Playwright's
    page.set_content), never as a URL it navigates to — the engine never
    makes a request back to this Django server and never carries any
    application cookie or auth state (a brand-new browser context per
    run — see runner.py's security contract)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, token):
        snapshot = LandingPagePreviewSnapshot.objects.filter(token=token).first()
        if snapshot is None or snapshot.user_id != request.user.pk:
            return Response(
                {'success': False, 'code': 'PREVIEW_INVALID', 'message': _PREVIEW_INVALID_MESSAGE},
                status=status.HTTP_404_NOT_FOUND,
            )
        if snapshot.is_expired():
            return Response(
                {'success': False, 'code': 'PREVIEW_EXPIRED', 'message': _PREVIEW_EXPIRED_MESSAGE},
                status=status.HTTP_410_GONE,
            )

        request_serializer = CrossBrowserCheckRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        data = request_serializer.validated_data

        if _cross_browser_rate_limited(request.user.pk):
            return Response(
                {
                    'success': False, 'code': 'CROSS_BROWSER_RATE_LIMITED',
                    'message': _CROSS_BROWSER_RATE_LIMITED_MESSAGE,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            result = run_cross_browser_check(snapshot.html, data['engine'], data['width'], data['height'])
        except CrossBrowserCheckError as exc:
            return Response(
                {'success': False, 'code': 'CROSS_BROWSER_UNAVAILABLE', 'message': str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:  # noqa: BLE001 - never leak an unhandled exception/traceback to the client
            request_id = uuid.uuid4().hex[:12]
            logger.exception('landingpages.cross_browser.unexpected_error request_id=%s', request_id)
            return Response(
                {
                    'success': False, 'code': 'CROSS_BROWSER_UNAVAILABLE',
                    'message': _CROSS_BROWSER_UNAVAILABLE_MESSAGE, 'request_id': request_id,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({
            'success': True,
            'engine': result['engine'],
            'viewport': result['viewport'],
            'duration_ms': result['duration_ms'],
            'console_error_count': result['console_error_count'],
            'failed_resource_count': result['failed_resource_count'],
            'overflow_px': result['overflow_px'],
            'render_status': result['render_status'],
            'screenshot_base64': result['screenshot_base64'],
        }, status=status.HTTP_200_OK)

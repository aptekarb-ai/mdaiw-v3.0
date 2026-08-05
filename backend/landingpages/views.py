import logging
import time
import uuid

from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import LandingPageProject, ValidationIssue, ValidationReport
from .serializers import (
    LandingPageProjectSerializer,
    ValidateRequestSerializer,
    ValidationReportSerializer,
)
from .validation.engine import run as run_validation

logger = logging.getLogger(__name__)

_VALIDATION_FAILED_MESSAGE = 'Validation could not be completed. Please try again.'


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


class ValidateView(APIView):
    """POST /api/v1/lp/validate/ — runs the validation engine against
    pasted code and persists a ValidationReport + its ValidationIssue
    rows. Does not require an existing project (ad-hoc paste-and-validate)
    — when `project` is supplied it must belong to the authenticated user,
    checked explicitly rather than via a field-level queryset (see
    serializers.ValidateRequestSerializer's docstring)."""

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
            project = None
            project_id = data['project']
            if project_id is not None:
                project = LandingPageProject.objects.filter(user=request.user, pk=project_id).first()
                if project is None:
                    return Response(
                        {
                            'success': False,
                            'code': 'INVALID_PROJECT',
                            'message': 'Invalid project.',
                            'errors': {'project': ['Invalid project.']},
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            profile = data['profile']
            validation_scope = data['validation_scope']
            started_at = time.perf_counter()
            result = run_validation(
                html=data['html'], css=data['css'], js=data['js'], ts=data['ts'],
                profile=profile, validation_scope=validation_scope,
            )
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            issues = result.issues

            error_count = sum(1 for issue in issues if issue.severity == 'error')
            warning_count = sum(1 for issue in issues if issue.severity == 'warning')
            info_count = sum(1 for issue in issues if issue.severity == 'info')

            report = ValidationReport.objects.create(
                user=request.user,
                project=project,
                duration_ms=duration_ms,
                profile=profile,
                validation_scope=result.validation_scope,
                engine_status=[
                    {
                        'engine_name': status_entry.engine_name,
                        'success': status_entry.success,
                        'duration_ms': status_entry.duration_ms,
                        'issue_count': status_entry.issue_count,
                        'message': status_entry.message,
                    }
                    for status_entry in result.engine_status
                ],
                error_count=error_count,
                warning_count=warning_count,
                info_count=info_count,
            )
            ValidationIssue.objects.bulk_create(
                ValidationIssue(
                    report=report,
                    severity=issue.severity,
                    category=issue.category,
                    rule_id=issue.rule_id,
                    message=issue.message,
                    file=issue.file,
                    language=issue.language,
                    line=issue.line,
                    column=issue.column,
                    suggestion=issue.suggestion,
                    auto_fixable=issue.auto_fixable,
                    risk=issue.risk,
                    fingerprint=issue.fingerprint,
                    source_engine=issue.source_engine,
                    engine_version=issue.engine_version,
                    standards_reference=issue.standards_reference,
                    confidence=issue.confidence,
                    end_line=issue.end_line,
                    end_column=issue.end_column,
                    code_excerpt=issue.code_excerpt,
                    fix_type=issue.fix_type,
                    deterministic_fix=issue.deterministic_fix,
                    requires_manual_review=issue.requires_manual_review,
                    related_element=issue.related_element,
                    related_attribute=issue.related_attribute,
                    source_context=issue.source_context,
                    source_block_index=issue.source_block_index,
                )
                for issue in issues
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

        serializer = ValidationReportSerializer(report)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

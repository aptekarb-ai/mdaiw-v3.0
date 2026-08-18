"""AI Review & Fix — Module 3 LP Validator. Builds a bounded, redacted
request from real ValidationIssue rows + the current submitted source,
calls the configured provider, and hands its raw output to validation.py
for verification. Nothing here ever writes to source — see views.py for
the apply step, which reuses ../fixes' own apply_patches_to_source.
"""

from ..fixes.offsets import line_starts
from ..knowledge.hints import get_repair_hint
from .excerpt import excerpt_window
from .provider import ReviewIssueContext
from .redaction import redact
from .validation import AIProposal, MAX_PROPOSAL_TEXT_LENGTH, validate_proposals

# Issue.file -> sources[] dict key (see validation.py's identical mapping).
_FILE_TO_SOURCE_KEY = {'html': 'html', 'css': 'css', 'javascript': 'js', 'ampscript': 'ampscript'}


def build_issue_context(issue, sources):
    """Returns a `ReviewIssueContext`, or `None` if the issue's source
    isn't available in this request (e.g. its file wasn't submitted)."""
    file_key = _FILE_TO_SOURCE_KEY.get(issue.file)
    if file_key is None or file_key not in sources:
        return None
    source = sources[file_key]
    excerpt, excerpt_start_offset = excerpt_window(source, issue.line)
    return ReviewIssueContext(
        issue_id=issue.id,
        rule_id=issue.rule_id,
        message=issue.message,
        severity=issue.severity,
        confidence=issue.confidence,
        suggestion=issue.suggestion,
        language=issue.language,
        source_context=issue.source_context or '',
        file=issue.file,
        start_line=issue.line,
        start_column=issue.column,
        code_excerpt=redact(excerpt),
        excerpt_start_offset=excerpt_start_offset,
        repair_hint=get_repair_hint(language=issue.language, rule_id=issue.rule_id),
    )


__all__ = [
    'AIProposal',
    'MAX_PROPOSAL_TEXT_LENGTH',
    'build_issue_context',
    'validate_proposals',
    'line_starts',
]

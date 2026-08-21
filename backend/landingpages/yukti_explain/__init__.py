"""Yukti explains validation issues — Module 3 LP Validator. Builds a
bounded, redacted request from real ValidationIssue rows + the current
submitted source, calls the configured provider, and returns explanation
text the view merges with its own computed facts (counts, language
breakdown, fix method). Nothing here ever writes to source, requests a
patch, or calls the AI Fix/AI Review provider — it is read-only advice.
"""

from ..ai_review.excerpt import excerpt_window
from ..ai_review.redaction import redact
from .provider import ExplainIssueContext

# Issue.file -> sources[] dict key (same mapping ai_review/__init__.py uses).
_FILE_TO_SOURCE_KEY = {'html': 'html', 'css': 'css', 'javascript': 'js', 'ampscript': 'ampscript'}


def build_explain_issue_context(issue, sources, fix_method):
    """Returns an `ExplainIssueContext`, or `None` if the issue's source
    isn't available in this request (e.g. its file wasn't submitted)."""
    file_key = _FILE_TO_SOURCE_KEY.get(issue.file)
    if file_key is None or file_key not in sources:
        return None
    source = sources[file_key]
    excerpt, _ = excerpt_window(source, issue.line)
    return ExplainIssueContext(
        issue_id=issue.id,
        rule_id=issue.rule_id,
        message=issue.message,
        severity=issue.severity,
        category=issue.category,
        language=issue.language,
        file=issue.file,
        start_line=issue.line,
        code_excerpt=redact(excerpt),
        fix_method=fix_method,
        source_engine=issue.source_engine or '',
    )


__all__ = ['build_explain_issue_context']

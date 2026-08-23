"""Feature 14 V2 — Phase A. The KnowledgeRule CONTRACT only — Phase A
ships zero real rules on purpose (see load_rules()'s docstring). Phase B
populates this from the sources catalogued in
docs/module-4/AI_ENGINEER_OPEN_SOURCE_AUDIT.md.

`category` reuses Feature 12's existing 8 Validation Center categories
(frontend/src/emailbuilder/emailValidation.ts) rather than inventing a
parallel taxonomy — "one logical validation ecosystem," not two. Feature
14's knowledge rules are meant to ultimately surface through the same
ValidationIssue contract Feature 12 already renders, not a competing UI.

`affected_clients` uses the SAME OUTLOOK_CLASSIC/NEW_OUTLOOK/BOTH/OTHER
identifier space as frontend/src/emailbuilder/emailClientCapabilities.ts's
OutlookAffinity — one identifier space shared by both languages, not two
independently-maintained ones.
"""

from dataclasses import dataclass

# Mirrors frontend/src/emailbuilder/emailValidation.ts's 8 categories
# exactly. Not extended here — a category outside this set is a rule-
# authoring bug, not a new taxonomy branch.
KNOWLEDGE_RULE_CATEGORIES = frozenset({
    'html', 'outlook', 'responsive', 'accessibility', 'links', 'images', 'dark-mode', 'platform',
})

SEVERITY_LEVELS = frozenset({'error', 'warning', 'info'})

# Mirrors frontend/src/emailbuilder/emailClientCapabilities.ts's
# OutlookAffinity union exactly. 'BOTH' is valid here (a RULE may affect
# both Outlook variants) even though no single EMAIL_CLIENTS entry is
# ever tagged 'BOTH' on the frontend side — see that file's docstring.
AFFECTED_CLIENT_VALUES = frozenset({'OUTLOOK_CLASSIC', 'NEW_OUTLOOK', 'BOTH', 'OTHER'})


class KnowledgeRuleValidationError(Exception):
    """Raised by KnowledgeRule.__post_init__ when a rule record violates
    its own contract — an authoring mistake caught at definition time,
    not at first use deep inside the repair engine."""


@dataclass(frozen=True)
class KnowledgeRule:
    id: str
    category: str
    title: str
    description: str
    severity: str
    # tuple, not list — a KnowledgeRule is immutable/hashable once
    # constructed, same posture as the frozen dataclass itself.
    affected_clients: tuple
    # Structured detection spec — Phase A defines only that this is a
    # dict; Phase B defines the actual detection-strategy shapes a real
    # detector consumes (never free-form executable code).
    detection: dict
    suggested_fix: str | None
    safe_auto_fix: bool
    references: tuple
    confidence: float

    def __post_init__(self):
        if not self.id or not isinstance(self.id, str):
            raise KnowledgeRuleValidationError('id is required and must be a non-empty string')
        if self.category not in KNOWLEDGE_RULE_CATEGORIES:
            raise KnowledgeRuleValidationError(f'unknown category: {self.category!r}')
        if self.severity not in SEVERITY_LEVELS:
            raise KnowledgeRuleValidationError(f'unknown severity: {self.severity!r}')
        if not self.affected_clients:
            raise KnowledgeRuleValidationError('affected_clients must not be empty')
        for client in self.affected_clients:
            if client not in AFFECTED_CLIENT_VALUES:
                raise KnowledgeRuleValidationError(f'unknown affected client: {client!r}')
        if not isinstance(self.detection, dict):
            raise KnowledgeRuleValidationError('detection must be a dict')
        if not isinstance(self.confidence, (int, float)) or not (0.0 <= self.confidence <= 1.0):
            raise KnowledgeRuleValidationError('confidence must be a number between 0.0 and 1.0')


def load_rules():
    """Phase A ships the KnowledgeRule CONTRACT only. This returns an
    empty list deliberately — Phase B is where real, individually
    reviewed rules (seeded from Can I Email + the MJML-flavored agent
    skill, both MIT and both adapted with attribution per the open-source
    audit) get added here. Do not add rule content in Phase A."""
    return []

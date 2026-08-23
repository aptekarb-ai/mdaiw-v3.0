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



# Feature 14 V2, Sub-phase 3 item 13 — the first real KnowledgeRule
# content. Scope is deliberately narrow: these 9 rules are explainer
# entries for the exact Outlook/MSO concepts Sub-phase 3 itself
# implements (module comments, the OfficeDocumentSettings block, scoped
# spacer rows, MSO-only font fallback, conditional-comment scope), so the
# Email AI Engineer can answer "why" questions about its own output
# without requiring OpenAI or a local model — a bounded reference glossary,
# not an auto-detector engine (detection={'kind': 'reference'} throughout;
# the real defect detectors for these same concerns live in
# frontend/src/emailbuilder/emailValidation.ts's checkOutlookCompatibility/
# checkNewOutlookCompatibility, added in this same Sub-phase). Phase B's
# broader Can I Email / MJML-skill-seeded rule set is unrelated future
# work and still not started here.
_RULES = (
    KnowledgeRule(
        id='outlook-word-engine-vs-new-outlook',
        category='outlook',
        title='Classic Outlook uses Word\'s rendering engine; New Outlook does not',
        description=(
            'Classic Outlook for Windows (2016, 2019, 2021, Microsoft 365 desktop) renders HTML email '
            'using the Microsoft Word engine, not a browser engine — this is why it needs MSO conditional '
            'comments, VML, and table-based layout to render reliably. New Outlook (and Outlook on the web, '
            'Mac, and mobile) uses a Chromium-based web-rendering engine instead: it ignores every MSO '
            'conditional comment and every VML tag entirely, and generally supports modern CSS the Word '
            'engine does not. Treating "Outlook" as one client is a common source of wasted workarounds — a '
            'fix aimed at Classic Outlook can be a no-op, or entirely irrelevant, for New Outlook.'
        ),
        severity='info',
        affected_clients=('BOTH',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='office-96-dpi',
        category='outlook',
        title='<o:PixelsPerInch>96</o:PixelsPerInch> keeps Word\'s image scaling at 100%',
        description=(
            'The Word rendering engine scales images according to Windows\' configured display DPI, not the '
            'image\'s own pixel dimensions — on a high-DPI display this can shrink images unexpectedly. The '
            '<o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings> block '
            '(inside a conditional <!--[if gte mso 9]>...<![endif]--> comment, itself inside an <xml> block) '
            'tells Word to treat 96 DPI as the baseline, matching web-standard CSS pixels 1:1 so images render '
            'at their intended size in Classic Outlook.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='outlook-allow-png',
        category='outlook',
        title='<o:AllowPNG/> lets Word render PNG transparency correctly',
        description=(
            'Older Word-engine Outlook builds could otherwise flatten a transparent PNG onto a solid '
            'background instead of preserving its alpha channel. <o:AllowPNG/>, set inside the same '
            'conditional OfficeDocumentSettings block as the DPI setting, tells Word to render PNGs with '
            'transparency intact rather than falling back to that legacy behavior.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='vml-namespace-purpose',
        category='outlook',
        title='xmlns:v="urn:schemas-microsoft-com:vml" declares the VML namespace Word needs',
        description=(
            'VML (Vector Markup Language) is the drawing language the Word rendering engine understands for '
            'things like ghost tables, rounded-corner buttons, and full-bleed background images — CSS '
            'background-image and border-radius are not reliably supported there. Any <v:...> tag in the '
            'document requires the <html> element to declare xmlns:v="urn:schemas-microsoft-com:vml" (and '
            'xmlns:o="urn:schemas-microsoft-com:office:office" for the OfficeDocumentSettings block); without '
            'it, Classic Outlook does not recognize the VML tags as markup at all.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='vml-requires-html-fallback',
        category='outlook',
        title='VML content always needs a real HTML fallback for every non-Word client',
        description=(
            'VML is a Word-engine-only drawing language — every other client, including New Outlook, Gmail, '
            'Apple Mail, and mobile clients, ignores <v:...> tags completely, since they are not part of the '
            'HTML/CSS standard those engines implement. Any VML-based effect (a background image, a rounded '
            'button) must be paired with equivalent plain HTML/CSS inside the SAME conditional-comment '
            'boundary (VML inside "[if mso]", the plain-HTML fallback outside it) so every non-Word client '
            'still renders something correct, never a blank gap.'
        ),
        severity='info',
        affected_clients=('BOTH',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='global-row-collapse-danger',
        category='outlook',
        title='A global tr{font-size:0} rule is dangerous — it can collapse real content rows, not just spacers',
        description=(
            'A common but unsafe Outlook trick sets font-size and line-height to 0 on every <tr> to remove '
            'unwanted default row spacing. Applied globally, this rule matches every row in the document, '
            'including rows that hold real text or images — in Classic Outlook this can visually collapse '
            'legitimate content, not just the empty spacer rows the trick was meant for. The safe form scopes '
            'the rule to a dedicated class (see spacer-row-safe-scoping) so it can never match an unrelated row.'
        ),
        severity='warning',
        affected_clients=('OUTLOOK_CLASSIC',),
        detection={'kind': 'reference'},
        suggested_fix='Scope the font-size:0/line-height:0 rule to a dedicated class (e.g. .mso-spacer) applied only to intentional spacer rows, never to a bare tr selector.',
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='spacer-row-safe-scoping',
        category='outlook',
        title='Scope spacer-row CSS to a dedicated class, never a bare tr selector',
        description=(
            'To collapse Outlook\'s default row padding on an intentional spacer row without risking real '
            'content rows, apply a dedicated marker class (this builder uses "mso-spacer") only to that '
            'row\'s cell, and scope the font-size:0/line-height:0 rule to that class in the generated <style> '
            'block — never to a bare tr selector. An ordinary content row never carries the class, so it is '
            'never affected, even if new module types are added later.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='outlook-font-fallback-mso-only',
        category='outlook',
        title='Outlook font fallback must stay inside an MSO conditional comment, never a blanket !important override',
        description=(
            'The Word rendering engine only reliably supports a small set of Windows-native fonts (Arial, '
            'Georgia, Times New Roman, Verdana, and similar system fonts) — a web font or an unrecognized '
            'custom font can render with Word\'s own default substitute instead. The correct fix targets '
            'ONLY Classic Outlook, inside a "<!--[if mso]>...<![endif]-->" conditional comment, and only for '
            'fonts not already confirmed MSO-safe — never a global "* { font-family: Arial !important; }" '
            'rule, which would also override every other client\'s correct, non-Outlook font rendering.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
    KnowledgeRule(
        id='conditional-comment-scope',
        category='outlook',
        title='MSO conditional comments are the only mechanism that targets Word-engine Outlook specifically',
        description=(
            'A "<!--[if mso]>...<![endif]-->" (or "[if gte mso 9]", "[if gte mso 15]") conditional comment '
            'is a plain HTML comment to every client except the Word rendering engine, which alone parses the '
            'condition and keeps or discards the content inside — this is why it is the only safe way to send '
            'markup or CSS meant exclusively for Classic Outlook without any other client seeing or acting on '
            'it. It has no effect on New Outlook, which uses a standard web engine and treats the whole thing '
            'as an inert comment, same as every non-Outlook client.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
    ),
)

_RULES_BY_ID = {rule.id: rule for rule in _RULES}


def load_rules():
    """Sub-phase 3 (item 13): returns the 9 Outlook/MSO explainer rules
    defined above. Phase B's broader Can I Email / MJML-flavored-skill
    seeded rule set (docs/module-4/AI_ENGINEER_OPEN_SOURCE_AUDIT.md) is
    separate, still-unstarted future work — this function's growth is
    additive, never a replacement of these entries."""
    return list(_RULES)


def find_rule(rule_id):
    """Direct id lookup — used by the deterministic "explain" intent
    (ai_command.py) so a topic keyword match doesn't need to re-scan the
    whole list."""
    return _RULES_BY_ID.get(rule_id)

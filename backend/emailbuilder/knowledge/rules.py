"""Feature 14 V2 Phase A / V3 Sub-phase 5 — the KnowledgeRule contract and
the structured professional email-development knowledge base built on it.

`category` reuses Feature 12's existing 9 Validation Center categories
(frontend/src/emailbuilder/emailValidation.ts) rather than inventing a
parallel taxonomy — "one logical validation ecosystem," not two. Feature
14's knowledge rules are meant to ultimately surface through the same
ValidationIssue contract Feature 12 already renders, not a competing UI.

Sub-phase 5 adds two new dimensions on top of Sub-phase 3/4's original
9-rule/14-rule glossary, WITHOUT changing what `category` means:

  - `affected_clients` — extended beyond the original OUTLOOK_CLASSIC/
    NEW_OUTLOOK/BOTH/OTHER set (which mirrors frontend/src/emailbuilder/
    emailClientCapabilities.ts's OutlookAffinity type 1:1) with real,
    named non-Outlook clients (Gmail, Apple Mail, iOS Mail, Yahoo Mail,
    AOL Mail, Outlook.com, and a generic "modern Chromium/WebKit webmail"
    bucket). This is a DELIBERATE, honest divergence from OutlookAffinity:
    that frontend type is specifically about Outlook-family classification
    (Classic vs New) and was never meant to be the universal client-
    identifier space — the new client values below have no Outlook-side
    equivalent to "mirror," so they don't try to.
  - `concerns` — a topic tag (tables, width, vml, dark-mode, fonts, ...)
    orthogonal to `category`. `category` answers "which Validation
    Center bucket does this belong to"; `concerns` answers "which
    email-development TOPIC is this about" — a rule can be found by
    either axis independently (see find_rules_by_category/_by_client/
    _by_concern below), matching the "knowledge lookup by issue/
    category/client" acceptance requirement.

Every rule also now carries `source` — provenance metadata, always
present (never silently absent), distinguishing genuinely developer-
authored facts from anything adapted from a named external reference.
See PROVENANCE HONESTY below for why every new rule in this sub-phase is
marked 'developer-authored, cross-referenced against...' rather than
'ADAPTED FROM <dataset>' — a real distinction, not a formality.
"""

from dataclasses import dataclass

# Mirrors frontend/src/emailbuilder/emailValidation.ts's categories
# exactly (9 as of Sub-phase 4's 'document' category — title/subject/
# favicon/Reset CSS/Custom CSS/head-meta-baseline). Not extended here — a
# category outside this set is a rule-authoring bug, not a new taxonomy
# branch. Sub-phase 5 adds many new RULES but zero new CATEGORIES —
# every new client/concern maps onto one of these 9 existing buckets.
KNOWLEDGE_RULE_CATEGORIES = frozenset({
    'document', 'html', 'outlook', 'responsive', 'accessibility', 'links', 'images', 'dark-mode', 'platform',
})

SEVERITY_LEVELS = frozenset({'error', 'warning', 'info'})

# Feature 14 V3 architectural invariant (recorded during Sub-phase 5,
# applies to every later sub-phase too): the client taxonomy must never
# be a permanently finite, code-validated enum. A new email client,
# client variant, or rendering-engine version must be addable through
# STRUCTURED DATA alone — adding one row here — never by touching
# KnowledgeRule.__post_init__ or any other validation logic. This dict is
# therefore the real source of truth; AFFECTED_CLIENT_VALUES below is a
# COMPUTED, backward-compatible view over it (existing code that treats
# AFFECTED_CLIENT_VALUES as a frozenset keeps working unchanged forever —
# only this registry needs a new entry when a new client shows up).
EMAIL_CLIENT_REGISTRY = {
    'OUTLOOK_CLASSIC': {'name': 'Classic Outlook (Windows desktop)', 'engine_family': 'word'},
    'NEW_OUTLOOK': {'name': 'New Outlook (Windows desktop)', 'engine_family': 'chromium-webmail'},
    'OUTLOOK_COM': {'name': 'Outlook.com (webmail)', 'engine_family': 'chromium-webmail'},
    'GMAIL': {'name': 'Gmail (web/apps)', 'engine_family': 'chromium-webmail'},
    'APPLE_MAIL': {'name': 'Apple Mail (macOS)', 'engine_family': 'webkit'},
    'IOS_MAIL': {'name': 'iOS Mail', 'engine_family': 'webkit'},
    'YAHOO_MAIL': {'name': 'Yahoo Mail', 'engine_family': 'webmail'},
    'AOL_MAIL': {'name': 'AOL Mail', 'engine_family': 'webmail'},
    'WEBMAIL_CHROMIUM': {'name': 'Generic modern Chromium/WebKit-family webmail', 'engine_family': 'chromium-webmail'},
}

# Two meta-values, kept distinct from real named clients above:
#   'BOTH'  — the two Outlook engine families specifically (Classic +
#             New) — Sub-phase 3/4's original meaning, preserved exactly
#             for backward compatibility with every existing rule.
#   'OTHER' — cross-client/generic, no specific client implied.
_AFFECTED_CLIENT_META_VALUES = frozenset({'BOTH', 'OTHER'})

# Backward-compatible computed view — mirrors frontend/src/emailbuilder/
# emailClientCapabilities.ts's OutlookAffinity type for the original 4
# values only; the Sub-phase 5 additions have no OutlookAffinity
# equivalent to mirror (see module docstring). Every existing call site
# that checks membership against this frozenset keeps working exactly as
# before — only EMAIL_CLIENT_REGISTRY needs to grow for a new client.
AFFECTED_CLIENT_VALUES = frozenset(EMAIL_CLIENT_REGISTRY.keys()) | _AFFECTED_CLIENT_META_VALUES

# Sub-phase 5 — a topic tag, ORTHOGONAL to `category` (see module
# docstring). Every rule below carries at least one; most are tagged with
# 2-3 to make cross-cutting facts (e.g. "font fallback" being both a
# 'fonts' AND an 'mso-properties' concern) genuinely findable either way.
CONCERN_VALUES = frozenset({
    'rendering-engine', 'dpi', 'mso-properties', 'images', 'vml', 'namespaces', 'spacing',
    'safe-html-css-practices', 'fonts', 'font-fallback', 'conditional-comments', 'document-metadata',
    'security', 'css-support', 'tables', 'line-height', 'background-images', 'buttons', 'lists',
    'dark-mode', 'preheader', 'client-failure-patterns', 'html-support', 'media-queries', 'responsive',
    'accessibility', 'width', 'links',
})


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
    # Sub-phase 5 — topic tags, see CONCERN_VALUES/module docstring.
    concerns: tuple
    # Structured detection spec — Phase A defines only that this is a
    # dict; Phase C (Sub-phase 6) defines the actual detection-strategy
    # shapes a real detector consumes (never free-form executable code).
    detection: dict
    suggested_fix: str | None
    safe_auto_fix: bool
    references: tuple
    confidence: float
    # Sub-phase 5 — provenance, ALWAYS present (never silently omitted).
    # {'name': str, 'url': str | None, 'license': str | None,
    #  'version': str | None, 'date': str | None, 'transformation': str | None}.
    # `version`/`date` record what snapshot of the source (if any) this
    # rule reflects, and `transformation` records HOW it got from that
    # source into this rule — together these are what let a future
    # refresh pass ask "is this rule stale relative to the source's
    # current state" instead of the knowledge base being a silent,
    # undated, one-time snapshot forever. For rules genuinely adapted
    # from a named external MIT/BSD source, `name`/`license` identify it.
    # For rules authored directly by a developer (or, in this sub-phase,
    # by Claude Code acting as the developer) without literally
    # transforming an external dataset, `name` says so explicitly rather
    # than falsely implying a formal ADAPT relationship — see PROVENANCE
    # HONESTY in the module docstring.
    source: dict

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
        if not self.concerns:
            raise KnowledgeRuleValidationError('concerns must not be empty')
        for concern in self.concerns:
            if concern not in CONCERN_VALUES:
                raise KnowledgeRuleValidationError(f'unknown concern: {concern!r}')
        if not isinstance(self.detection, dict):
            raise KnowledgeRuleValidationError('detection must be a dict')
        if not isinstance(self.confidence, (int, float)) or not (0.0 <= self.confidence <= 1.0):
            raise KnowledgeRuleValidationError('confidence must be a number between 0.0 and 1.0')
        if not isinstance(self.source, dict):
            raise KnowledgeRuleValidationError('source must be a dict')
        if not self.source.get('name'):
            raise KnowledgeRuleValidationError('source.name is required and must be non-empty')
        _SOURCE_KEYS = {'name', 'url', 'license', 'version', 'date', 'transformation'}
        if set(self.source.keys()) - _SOURCE_KEYS:
            raise KnowledgeRuleValidationError(f'source has unexpected keys: {self.source.keys()!r}')
        missing_keys = _SOURCE_KEYS - set(self.source.keys())
        if missing_keys:
            raise KnowledgeRuleValidationError(
                f'source is missing required keys (present but may be None): {missing_keys!r}',
            )


# Provenance shorthand for the rules hand-authored directly for this
# codebase (Sub-phase 3/4's original 14, plus most of Sub-phase 5's new
# rules) — never a literal transform of an external dataset, so never
# claims one. See module docstring's PROVENANCE HONESTY note. `date`
# records when the rule was authored (not a source snapshot date, since
# there is no external source) — still useful for a future refresh pass
# to know how old the FACT itself is.
_DEVELOPER_AUTHORED = {
    'name': 'MDAIW (developer-authored)', 'url': None, 'license': None,
    'version': None, 'date': '2026-08-23', 'transformation': None,
}

# Sub-phase 5 — for rules whose FACTS are cross-referenced against
# Can I Email's publicly documented client-compatibility data
# (github.com/hteumeuleu/caniemail, MIT) as encouraged by
# docs/module-4/AI_ENGINEER_OPEN_SOURCE_AUDIT.md, but which were NOT
# produced by literally parsing/transforming Can I Email's YAML files
# (no such ingestion pipeline exists yet — see the Sub-phase 5 closure
# report's honest disclosure of this). This is deliberately a WEAKER
# provenance claim than "ADAPTED FROM Can I Email" would be. `version`
# stays None (no dataset snapshot was actually pinned/parsed); `date` is
# the date this cross-reference was authored, which is what a future
# refresh pass needs to decide "this is now N months old, worth
# rechecking" even without a real upstream version number to compare
# against.
_INFORMED_BY_CANIEMAIL = {
    'name': 'MDAIW (developer-authored, cross-referenced against Can I Email public compatibility data)',
    'url': 'https://www.caniemail.com/',
    'license': None,
    'version': None,
    'date': '2026-08-23',
    'transformation': (
        'Facts cross-referenced by a developer/Claude Code against Can I Email\'s publicly documented '
        'client-compatibility matrix and general email-development community knowledge; NOT an automated '
        'parse/transform of Can I Email\'s YAML dataset — no such ingestion pipeline exists yet. A future '
        'refresh could add a real offline YAML-to-KnowledgeRule transform script for closer fidelity.'
    ),
}


# --- Query helpers -----------------------------------------------------
# Sub-phase 5 — direct support for "knowledge lookup by issue/category/
# client" (a required acceptance test). Pure filters over load_rules();
# no caching/index needed at this scale (14 -> 51 rules).

def find_rules_by_category(category):
    return [rule for rule in load_rules() if rule.category == category]


def find_rules_by_client(client):
    return [rule for rule in load_rules() if client in rule.affected_clients]


def find_rules_by_concern(concern):
    return [rule for rule in load_rules() if concern in rule.concerns]


# Feature 14 V2, Sub-phase 3 item 13 — the first real KnowledgeRule
# content. Scope was deliberately narrow: 9 rules for the exact Outlook/
# MSO concepts Sub-phase 3 itself implements. Sub-phase 4 added 5
# document-standards rules. Sub-phase 5 (below, after these 14) expands
# far beyond both — see the module docstring.
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
        concerns=('rendering-engine',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('dpi', 'mso-properties'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('images', 'mso-properties'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('vml', 'namespaces'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('vml',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('spacing', 'mso-properties', 'safe-html-css-practices'),
        detection={'kind': 'reference'},
        # Sub-phase 4, item 5 — the Repair Engine's deterministic safe fix
        # for this exact finding (frontend/src/emailbuilder/
        # emailValidation.ts's outlook-classic:unsafe-global-row-collapse)
        # cannot safely rewrite arbitrary Custom CSS text to re-scope just
        # the offending rule, so it disables Custom CSS entirely — kept in
        # sync here so the knowledge explanation never disagrees with what
        # the repair proposal actually offers (item 7).
        suggested_fix='Scope the font-size:0/line-height:0 rule to a dedicated class (e.g. .mso-spacer) applied only to intentional spacer rows, never to a bare tr selector. The Repair Engine\'s automatic fix disables Custom CSS entirely, since it cannot safely rewrite the rule\'s scope for you.',
        safe_auto_fix=True,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('spacing', 'safe-html-css-practices'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('fonts', 'font-fallback', 'mso-properties'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
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
        concerns=('conditional-comments', 'mso-properties'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
    ),
    # Sub-phase 4, item 6 — document-level standards rules, explaining the
    # new checks frontend/src/emailbuilder/emailValidation.ts's
    # checkDocumentStandards() added (title/subject/favicon/Reset CSS).
    # Custom CSS security itself is already explained at the point of
    # rejection (validate_custom_css_security's own message), so no
    # separate rule duplicates that here — these five cover the concepts
    # that check doesn't already explain inline.
    KnowledgeRule(
        id='email-title-vs-document-name',
        category='document',
        title='The email title is distinct from the draft/document name',
        description=(
            'The email title renders into the document\'s <title> element — it is what a browser tab or a '
            'client that displays a document title shows, not send/marketing copy. It is a different field '
            'from the builder\'s draft name (used only in the dashboard/workspace UI) and from the email '
            'subject (send metadata, never rendered as markup). Leaving it empty is valid HTML but shows no '
            'meaningful name where a title would normally appear.'
        ),
        severity='info',
        affected_clients=('BOTH',),
        concerns=('document-metadata',),
        detection={'kind': 'reference'},
        suggested_fix='Set an email title in Document Settings.',
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
    ),
    KnowledgeRule(
        id='email-subject-is-send-metadata',
        category='document',
        title='The email subject is send/document metadata — it is never rendered into the HTML',
        description=(
            'Unlike the title (which becomes the document <title>), the subject line has no corresponding '
            'markup anywhere in the rendered email — it exists purely as metadata this builder stores '
            'alongside the document, for use when the email is actually sent. An empty subject does not '
            'change the rendered HTML at all, but is normally required before a real send.'
        ),
        severity='info',
        affected_clients=('BOTH',),
        concerns=('document-metadata',),
        detection={'kind': 'reference'},
        suggested_fix='Set an email subject in Document Settings.',
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
    ),
    KnowledgeRule(
        id='favicon-url-requirements',
        category='document',
        title='A favicon URL must be a safe http(s) URL, or it is silently omitted',
        description=(
            'The favicon link is rendered only when the configured URL passes the same http(s)-only, '
            'unsafe-scheme-rejecting allow-list every other URL in this builder goes through (javascript:, '
            'data:, and vbscript: are always rejected). An invalid or unsafe favicon URL does not break '
            'rendering — the <link rel="icon"> tag is simply omitted — but it also means the favicon silently '
            'never appears, which can look like a bug rather than a rejected value.'
        ),
        severity='info',
        affected_clients=('BOTH',),
        concerns=('document-metadata', 'security'),
        detection={'kind': 'reference'},
        suggested_fix='Use a direct https:// (or http://) URL to an image file as the favicon.',
        safe_auto_fix=True,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
    ),
    KnowledgeRule(
        id='reset-css-purpose',
        category='document',
        title='Email Reset CSS is the cross-client compatibility baseline',
        description=(
            'Email clients ship wildly inconsistent default styles for tables, images, paragraphs, and line '
            'height — Reset CSS neutralizes those defaults (margin/padding resets, image display:block, '
            'table spacing resets, and similar) so the same module renders consistently instead of inheriting '
            'a different baseline in every client. Disabling it does not break anything by itself, but makes '
            'client-to-client rendering differences more likely, especially for spacing and image display.'
        ),
        severity='info',
        affected_clients=('BOTH',),
        concerns=('css-support', 'safe-html-css-practices'),
        detection={'kind': 'reference'},
        suggested_fix='Enable Email Reset CSS unless you have a specific reason to disable it.',
        safe_auto_fix=True,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
    ),
    KnowledgeRule(
        id='required-email-meta-baseline',
        category='document',
        title='Why the generated <head> always includes charset/viewport/robots/Apple/format-detection metadata',
        description=(
            'Every generated document includes a fixed baseline of <head> declarations regardless of content: '
            'a UTF-8 charset, a mobile-friendly viewport, "noindex, nofollow" robots metadata (marketing email '
            'is not a page meant to be indexed), Apple mobile web-app metadata, format-detection meta tags '
            'that stop iOS/Android from auto-linking addresses/dates/emails/phone numbers inside the email '
            'body, and x-apple-disable-message-reformatting (stops Apple Mail\'s automatic font-size scaling '
            'on some devices). These are emitted unconditionally by the renderer — they exist to prevent a '
            'known category of client-specific surprise, not because any particular module needs them.'
        ),
        severity='info',
        affected_clients=('BOTH',),
        concerns=('document-metadata', 'client-failure-patterns'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
    ),

    # =====================================================================
    # Feature 14 V3, Sub-phase 5 — Professional Email Knowledge Engine.
    # Expands from 14 to 51 rules, adding real coverage for Gmail, Apple
    # Mail, iOS Mail, Yahoo Mail, AOL Mail, and Outlook.com alongside
    # deeper Classic/New Outlook coverage and cross-client general
    # practices (tables, width, fonts, line-height, dark mode, lists,
    # preheader, accessibility, links, CSS/HTML support strategy).
    #
    # PROVENANCE HONESTY: docs/module-4/AI_ENGINEER_OPEN_SOURCE_AUDIT.md
    # names Can I Email (MIT) as the primary adaptation source and the
    # MJML-flavored Claude Skill (MIT) as a secondary checklist source.
    # This sub-phase's rules are FACTUALLY cross-referenced against
    # Can I Email's publicly documented client-compatibility matrix and
    # general, well-established email-development community knowledge —
    # but no automated ingestion pipeline parses Can I Email's actual
    # YAML files yet. Every rule below is therefore marked with
    # `_INFORMED_BY_CANIEMAIL` (a genuinely weaker, more honest provenance
    # claim than "ADAPTED FROM Can I Email" would be) rather than
    # overclaiming a literal-data-transform relationship that did not
    # happen. A follow-up sub-phase could add a real offline YAML-to-
    # KnowledgeRule transform script if closer fidelity to Can I Email's
    # exact wording/versioning is wanted — flagged as a known limitation
    # in the Sub-phase 5 closure report, not silently glossed over.
    # =====================================================================

    # --- Classic Outlook / Word engine, expanded -----------------------
    KnowledgeRule(
        id='outlook-table-layout-required',
        category='outlook',
        title='Table-based layout is the only reliable structural technique in the Word engine',
        description=(
            'The Word rendering engine has no support for CSS layout models such as flexbox, grid, float, or '
            'absolute positioning — <table>/<tr>/<td> with explicit width/cellpadding/cellspacing attributes '
            'remains the only structural technique that renders predictably. This builder\'s renderer is '
            'table-first for exactly this reason (see htmlRenderer.ts); a div-based layout would silently '
            'collapse to a single stacked column in Classic Outlook regardless of any CSS applied to it.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('tables', 'css-support', 'html-support'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='outlook-line-height-exactly',
        category='outlook',
        title='mso-line-height-rule:exactly keeps Word from adding unwanted extra line spacing',
        description=(
            'The Word engine can add its own extra spacing on top of a declared line-height, especially for '
            'single-line table cells. Adding mso-line-height-rule:exactly alongside an explicit line-height '
            'tells Word to use the declared value exactly, without its own additional adjustment — a common '
            'fix for spacer rows or tightly-spaced text that renders correctly everywhere except Classic '
            'Outlook.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('line-height', 'mso-properties'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='outlook-background-image-needs-vml',
        category='outlook',
        title='CSS background-image is not supported by the Word engine — full-bleed backgrounds need VML',
        description=(
            'The Word rendering engine does not support the CSS background-image property on <td> or <body>. '
            'A background image that must appear in Classic Outlook (e.g. a full-bleed hero section) requires '
            'a VML <v:rect>/<v:fill> construct layered behind the content, wrapped in the same "[if mso]" '
            'conditional boundary as every other VML use, with the CSS background-image kept as the real '
            'implementation for every other client.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('background-images', 'vml', 'css-support'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='outlook-css-support-subset',
        category='outlook',
        title='The Word engine supports only a small, mostly table-era CSS subset',
        description=(
            'Beyond lacking flexbox/grid, the Word engine also has unreliable or absent support for many '
            'common properties: border-radius, box-shadow, most pseudo-classes/pseudo-elements, CSS '
            'transforms/transitions, position, and float. Padding/margin on non-table elements is inconsistent. '
            'The safest working set is: table/td-based layout, inline styles for anything critical, and '
            'explicit width/height/valign/align HTML attributes as the primary mechanism, with CSS as an '
            'enhancement layer rather than the sole mechanism.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('css-support',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='outlook-bulletproof-button-pattern',
        category='outlook',
        title='A "bulletproof button" pairs a VML rounded rectangle with an HTML fallback link',
        description=(
            'Since the Word engine does not support border-radius or reliable padding-based hit targets on an '
            'anchor tag, an Outlook-safe clickable button is conventionally built as a VML <v:roundrect> '
            '(providing the rounded shape, fill color, and a real clickable area sized to match) layered over '
            'or paired with a plain HTML <a> styled as a button for every other client — both point to the '
            'same URL, so the click target is correct everywhere even though the visual technique differs.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('buttons', 'vml'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='outlook-list-padding-behavior',
        category='outlook',
        title='Classic Outlook needs explicit padding-left on lists — default indentation is inconsistent',
        description=(
            'The Word engine\'s default <ul>/<ol> indentation does not match modern browser defaults and can '
            'vary across Outlook versions. An explicit padding-left (commonly around 15-20px) declared '
            'directly on the list element, rather than relying on the client default, keeps indentation '
            'predictable. This builder does not currently emit any raw <ul>/<ol> markup (see Sub-phase 3 item '
            '4\'s decision), so this rule is reference-only until a module type that renders real lists exists.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('lists',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='outlook-classic-no-auto-dark-mode',
        category='outlook',
        title='Classic Outlook desktop does not apply automatic dark-mode inversion',
        description=(
            'Unlike Gmail\'s mobile apps, Apple Mail, and New Outlook, Classic Outlook for Windows does not '
            'automatically invert an email\'s colors when the user has system dark mode enabled — it renders '
            'exactly the colors specified, light or dark. This means a design relying on other clients\' auto-'
            'inversion to "become" dark-mode-friendly will simply render in its original light-mode colors in '
            'Classic Outlook, which is a safe default rather than a defect, but worth knowing when reasoning '
            'about why a dark-mode design behaves differently across clients.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('dark-mode',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='outlook-mso-hide-preheader',
        category='outlook',
        title='mso-hide:all hides preheader spacer text from Classic Outlook without removing it from the DOM',
        description=(
            'A hidden preheader block (extra whitespace/em-dash characters used to push real preview text '
            'further into the inbox list snippet) is usually visually hidden with display:none or a zero-size '
            'container — but the Word engine handles those inconsistently for this purpose. Adding '
            'mso-hide:all specifically tells Classic Outlook to hide the element, while every other client '
            'follows its own display:none/font-size:0 hiding, keeping the preheader trick working consistently '
            'across Outlook and non-Outlook clients alike.'
        ),
        severity='info',
        affected_clients=('OUTLOOK_CLASSIC',),
        concerns=('mso-properties', 'preheader'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),

    # --- New Outlook, expanded ------------------------------------------
    KnowledgeRule(
        id='new-outlook-modern-css-support',
        category='outlook',
        title='New Outlook uses a modern web-rendering engine with broad, but not unlimited, CSS support',
        description=(
            'New Outlook (the unified Outlook for Windows app, replacing the old Win32 client\'s rendering '
            'path) renders through a Chromium-based web engine rather than the Word engine — it supports media '
            'queries, background-image, border-radius, and most standard CSS properties. It is not identical '
            'to a full unrestricted browser, though: like most webmail clients it still sanitizes/strips some '
            'HTML (e.g. <script>, certain event-handler attributes) for security, which is a client-safety '
            'policy rather than a rendering-engine limitation.'
        ),
        severity='info',
        affected_clients=('NEW_OUTLOOK',),
        concerns=('css-support', 'rendering-engine'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=1.0,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='new-outlook-vs-outlook-com',
        category='outlook',
        title='New Outlook and Outlook.com (webmail) share the same modern rendering family',
        description=(
            'New Outlook for Windows and Outlook.com (the browser-based webmail client) are both part of '
            'Microsoft\'s unified, web-technology-based Outlook rendering family, distinct from the legacy '
            'Word-engine desktop client. For compatibility purposes they can be treated as the same rendering '
            'family — a fix verified against one is a reasonable (though not certain) signal for the other — '
            'while Classic Outlook desktop remains an entirely separate, Word-engine-based case.'
        ),
        severity='info',
        affected_clients=('NEW_OUTLOOK', 'OUTLOOK_COM'),
        concerns=('rendering-engine',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.8,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='new-outlook-auto-dark-mode',
        category='outlook',
        title='New Outlook applies automatic dark-mode color inversion, unlike Classic Outlook',
        description=(
            'When the user has dark mode enabled, New Outlook can automatically invert an email\'s light-mode '
            'colors — similar to Gmail\'s mobile apps and Apple Mail\'s default behavior. A design that assumes '
            'colors always render exactly as authored (safe in Classic Outlook) can look wrong once auto-'
            'inverted in New Outlook; explicit prefers-color-scheme/color-scheme CSS support is the correct '
            'mitigation where control over the dark-mode presentation matters.'
        ),
        severity='info',
        affected_clients=('NEW_OUTLOOK',),
        concerns=('dark-mode',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.85,
        source=_INFORMED_BY_CANIEMAIL,
    ),

    # --- Gmail -----------------------------------------------------------
    KnowledgeRule(
        id='gmail-clipping-threshold',
        category='html',
        title='Gmail clips email content over roughly 102KB of HTML',
        description=(
            'When a message\'s HTML exceeds approximately 102KB, Gmail truncates the displayed content and '
            'shows "[Message clipped] View entire message" with a link to load the rest — any content after '
            'the clip point (including tracking pixels placed at the very end) may not load until the user '
            'clicks through. Keeping generated HTML lean (avoiding excessive inline comments, redundant CSS, '
            'or deeply nested unnecessary markup) reduces the risk of hitting this threshold.'
        ),
        severity='info',
        affected_clients=('GMAIL',),
        concerns=('client-failure-patterns', 'html-support'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='gmail-image-proxying-and-blocking',
        category='images',
        title='Gmail proxies external images through Google\'s own servers and may block them by default',
        description=(
            'Gmail routes externally-hosted images through Google\'s image proxy (partly for privacy/security, '
            'partly for caching) rather than loading them directly from the original host — this can introduce '
            'a brief delay on first load. Gmail may also block images by default for senders the recipient has '
            'not marked as trusted, showing a "Display images below" prompt; a design should remain readable '
            'with images off, and background-color fallbacks behind background-images matter here too.'
        ),
        severity='info',
        affected_clients=('GMAIL',),
        concerns=('images', 'client-failure-patterns'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='gmail-embedded-style-support',
        category='html',
        title='Gmail supports embedded <style> blocks across its modern web and app surfaces',
        description=(
            'Modern Gmail (web, Android, iOS apps) supports a <style> block in <head> and most standard CSS '
            'selectors, including class selectors — historically some webmail-era restrictions existed, but '
            'current Gmail surfaces render embedded styles reliably. Gmail sanitizes some attributes for '
            'security; inline styles remain the safest choice for anything critical, with the <style> block as '
            'a genuine enhancement layer rather than a fallback-only mechanism, unlike in the Word engine.'
        ),
        severity='info',
        affected_clients=('GMAIL',),
        concerns=('css-support', 'html-support'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.85,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='gmail-dark-mode-auto-invert',
        category='dark-mode',
        title='Gmail\'s mobile apps can auto-invert email colors without explicit dark-mode CSS support',
        description=(
            'The Gmail Android/iOS apps can automatically apply a dark-mode color inversion to emails that do '
            'not explicitly declare dark-mode support, similar to New Outlook and Apple Mail\'s default '
            'behavior. Logos or images with transparent backgrounds and dark foreground colors are a common '
            'casualty — they can become invisible or hard to read once inverted, which is why this app\'s '
            'accessibility contrast check treats dark-mode inversion risk as a distinct finding from normal-'
            'mode contrast (see the dark-mode:contrast:* issue id).'
        ),
        severity='info',
        affected_clients=('GMAIL',),
        concerns=('dark-mode', 'images'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.85,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='gmail-media-query-support',
        category='responsive',
        title='Gmail supports @media queries for responsive email in most modern surfaces',
        description=(
            'Unlike Classic Outlook (which ignores media queries entirely, relying on the MSO ghost-table fixed-'
            'width fallback instead), Gmail\'s web and app surfaces generally support @media queries for '
            'responsive breakpoints. Behavior can still vary by exact Gmail surface and app version, so a '
            'hybrid approach (fluid width as the safe baseline, media queries as a genuine enhancement, MSO '
            'ghost-table as the Word-engine fallback) remains the most broadly reliable strategy — exactly the '
            'approach this builder\'s renderer already uses.'
        ),
        severity='info',
        affected_clients=('GMAIL',),
        concerns=('media-queries', 'responsive'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.85,
        source=_INFORMED_BY_CANIEMAIL,
    ),

    # --- Apple Mail (macOS) ----------------------------------------------
    KnowledgeRule(
        id='apple-mail-best-css-support',
        category='html',
        title='Apple Mail (macOS) has the strongest CSS support among major email clients',
        description=(
            'Apple Mail on macOS is WebKit-based and generally offers the broadest, most standards-compliant '
            'CSS support of any major email client — including media queries, background-image, custom fonts '
            'via @font-face, and most modern layout/visual properties. Content that looks correct in Apple '
            'Mail is not automatically safe everywhere else; it is closer to a "browser-grade" baseline than '
            'the true lowest common denominator across all major clients.'
        ),
        severity='info',
        affected_clients=('APPLE_MAIL',),
        concerns=('css-support', 'fonts'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='apple-mail-dark-mode-auto-invert',
        category='dark-mode',
        title='Apple Mail applies automatic dark-mode inversion unless explicit color-scheme support is present',
        description=(
            'Apple Mail inverts an email\'s colors for dark mode automatically unless the document explicitly '
            'declares support via the color-scheme meta tag and/or prefers-color-scheme CSS media query — '
            'declaring explicit support gives the sender control over the dark-mode presentation instead of '
            'leaving it to Apple Mail\'s automatic (sometimes visually awkward) inversion heuristic.'
        ),
        severity='info',
        affected_clients=('APPLE_MAIL',),
        concerns=('dark-mode',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.85,
        source=_INFORMED_BY_CANIEMAIL,
    ),

    # --- iOS Mail ----------------------------------------------------------
    KnowledgeRule(
        id='ios-mail-format-detection',
        category='html',
        title='iOS Mail auto-links phone numbers, dates, and addresses unless format-detection meta tags are present',
        description=(
            'iOS Mail (and other Apple mobile mail surfaces) automatically converts recognizable phone numbers, '
            'dates, and addresses in the email body into tappable links unless the document includes '
            'format-detection meta tags disabling that behavior for each category — this builder emits all '
            'four (address/date/email/telephone) unconditionally in <head> (see Sub-phase 1), so this is '
            'already handled for every document this renderer produces.'
        ),
        severity='info',
        affected_clients=('IOS_MAIL',),
        concerns=('client-failure-patterns', 'html-support'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='ios-mail-dynamic-type-scaling',
        category='accessibility',
        title='iOS Mail may apply Dynamic Type text scaling to unstyled or under-styled text',
        description=(
            'iOS\'s system-wide Dynamic Type accessibility feature can resize text that does not have an '
            'explicit, sufficiently specific font-size declaration, which can break a carefully designed '
            'layout\'s proportions. Declaring an explicit font-size on every meaningful text element (which '
            'this builder\'s modules already do via their typography props) is both good accessibility '
            'practice and a defense against unpredictable resizing.'
        ),
        severity='info',
        affected_clients=('IOS_MAIL',),
        concerns=('accessibility', 'fonts'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.75,
        source=_INFORMED_BY_CANIEMAIL,
    ),

    # --- Yahoo Mail / AOL Mail ---------------------------------------------
    KnowledgeRule(
        id='yahoo-mail-css-support',
        category='html',
        title='Yahoo Mail supports embedded styles and most standard CSS, with some historical class-name caveats',
        description=(
            'Yahoo Mail supports a <style> block and most standard CSS properties/selectors. Some historical '
            'webmail-sanitization behavior has been reported to rewrite or namespace class names in specific '
            'contexts; inline styles for anything critical remain the safest cross-Yahoo-surface choice, the '
            'same defense-in-depth posture recommended for Gmail.'
        ),
        severity='info',
        affected_clients=('YAHOO_MAIL',),
        concerns=('css-support',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.7,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='yahoo-mail-image-blocking',
        category='images',
        title='Yahoo Mail blocks external images by default for unrecognized senders',
        description=(
            'Similar to Gmail, Yahoo Mail commonly blocks externally-hosted images by default until the '
            'recipient explicitly chooses to display them or marks the sender as trusted — meaningful alt text '
            'and a sensible background-color fallback behind any background-image keep the email readable '
            'with images off.'
        ),
        severity='info',
        affected_clients=('YAHOO_MAIL',),
        concerns=('images', 'accessibility'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.75,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='aol-mail-shared-yahoo-infrastructure',
        category='html',
        title='AOL Mail shares rendering/backend infrastructure with Yahoo Mail',
        description=(
            'AOL Mail and Yahoo Mail have historically been operated on shared backend/rendering '
            'infrastructure under common ownership — compatibility behavior for AOL Mail can generally be '
            'expected to track Yahoo Mail\'s closely, though this should be treated as a reasonable starting '
            'assumption rather than a guarantee for every specific CSS feature.'
        ),
        severity='info',
        affected_clients=('AOL_MAIL',),
        concerns=('rendering-engine', 'client-failure-patterns'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.6,
        source=_INFORMED_BY_CANIEMAIL,
    ),

    # --- Cross-client general practices -----------------------------------
    KnowledgeRule(
        id='email-hybrid-width-strategy',
        category='responsive',
        title='The hybrid fluid/fixed-width pattern is the standard cross-client-safe layout strategy',
        description=(
            'A width="100%" table with max-width in CSS provides genuine fluid shrinking on modern clients, '
            'while an MSO-conditional fixed-width ghost table provides the Word engine (which ignores CSS '
            'max-width) an explicit pixel width it can honor — combining both, exactly as this builder\'s '
            'renderer already does (see htmlRenderer.ts), is the standard technique for a layout that is both '
            'genuinely responsive and correctly fixed-width in Classic Outlook.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('width', 'responsive'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.95,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-media-query-support-general',
        category='responsive',
        title='Media query support is broad but not universal — Classic Outlook is the notable exception',
        description=(
            'Most modern clients (Gmail, Apple Mail, iOS Mail, New Outlook, Yahoo Mail) support @media queries '
            'for responsive breakpoints; Classic Outlook\'s Word engine ignores them entirely. A responsive '
            'design should treat media queries as a genuine enhancement layer for the clients that support '
            'them, never the only mechanism controlling whether a layout is usable in Classic Outlook — the '
            'fluid/hybrid width strategy is what actually keeps Outlook correct.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('media-queries', 'responsive'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-bulletproof-background-pattern',
        category='images',
        title='A bulletproof full-bleed background needs both a CSS background-image AND a VML fallback',
        description=(
            'No single technique covers every client for a full-bleed background image: CSS background-image '
            'on a <td> works for most modern clients but not the Word engine, while VML covers the Word engine '
            'but nothing else. The genuinely cross-client-safe pattern layers both — VML inside the MSO '
            'conditional boundary, CSS background-image as the real implementation everywhere else — with a '
            'solid background-color as the final fallback for any client that supports neither.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('background-images', 'vml'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-font-fallback-stack-general',
        category='html',
        title='Every font declaration needs a robust fallback stack ending in a widely-supported system font',
        description=(
            '@font-face/web-font support varies significantly across clients (strongest in Apple Mail, weakest '
            'in the Word engine, inconsistent elsewhere) — a font-family declaration should always end in a '
            'generic, near-universally-available system font (Arial/Helvetica/sans-serif, or Georgia/Times New '
            'Roman/serif) so that any client that cannot load or does not support the primary web font still '
            'renders legible, appropriately-styled text rather than an unstyled browser default.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('fonts', 'font-fallback'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-explicit-line-height-general',
        category='html',
        title='Explicit line-height avoids inconsistent vertical spacing across clients',
        description=(
            'Relying on a client\'s default line-height (rather than declaring one explicitly on every text '
            'element) is a common source of small but visible vertical-spacing differences between clients, '
            'particularly for single-line table cells and buttons. Declaring line-height explicitly wherever '
            'font-size is declared keeps vertical rhythm consistent.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('line-height', 'spacing'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.85,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-links-absolute-https-only',
        category='links',
        title='Email links should always be full absolute https:// URLs',
        description=(
            'Relative paths and non-http(s) schemes (javascript:, data:, vbscript:) are unsafe and/or '
            'meaningless in an email context — link-tracking/rewriting services and every mainstream client '
            'expect a complete, absolute, http(s) URL. This builder\'s URL sanitization already enforces this '
            'allow-list at every point a URL is accepted (module props, favicon, AI-proposed values), so this '
            'rule documents an invariant already enforced elsewhere, not a new gap.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('links', 'security'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.95,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-list-cross-client-indentation',
        category='html',
        title='Default list indentation (<ul>/<ol>) varies significantly across clients',
        description=(
            'Browser/client default margin and padding for lists is inconsistent — some clients indent '
            'generously, others barely at all, and list-style-position defaults (inside vs outside) also '
            'differ. Declaring explicit padding-left and list-style-position on any list element removes this '
            'source of unpredictable cross-client variation.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('lists',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.8,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-preheader-pattern-general',
        category='html',
        title='A preheader is hidden preview text shown in the inbox list, distinct from the first line of body copy',
        description=(
            'Most inbox list views show a short snippet of text next to the subject line, taken from the '
            'start of the email body unless a dedicated preheader element (typically hidden via CSS and/or '
            'mso-hide:all) supplies deliberate preview text instead. Without one, the snippet often shows '
            'unhelpful content like a stray "View this email in your browser" link or leading whitespace — a '
            'genuine preheader gives control over what appears in that high-visibility inbox real estate.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('preheader',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-accessibility-alt-text-general',
        category='accessibility',
        title='Every meaningful image needs descriptive alt text; decorative images should use an empty alt',
        description=(
            'Many major clients (Gmail, Yahoo Mail, Classic/New Outlook) block images by default for at least '
            'some senders, and screen readers rely entirely on alt text to describe an image\'s content or '
            'purpose — an image conveying real information without alt text is invisible information in both '
            'scenarios. Purely decorative images (spacers, dividers with no informational content) should use '
            'alt="" so assistive technology skips over them cleanly rather than reading a meaningless filename.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('accessibility', 'images'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.95,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-accessibility-wcag-contrast',
        category='accessibility',
        title='WCAG AA requires at least 4.5:1 contrast for normal text',
        description=(
            'The Web Content Accessibility Guidelines success criterion 1.4.3 (Contrast Minimum) requires a '
            'contrast ratio of at least 4.5:1 between normal-size text and its background (3:1 for large text). '
            'This builder enforces this deterministically today (see emailValidation.ts\'s accessibility:'
            'contrast check, WCAG_AA_NORMAL_TEXT_RATIO), including a joint light-mode/dark-mode-inversion-safe '
            'auto-fix where a jointly-safe color genuinely exists.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('accessibility',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=('WCAG 2.1 Success Criterion 1.4.3',),
        confidence=1.0,
        source=_DEVELOPER_AUTHORED,
    ),
    KnowledgeRule(
        id='email-dark-mode-general-strategy',
        category='dark-mode',
        title='Cross-client dark mode falls into three distinct behaviors, and a safe design does not rely on just one',
        description=(
            'Clients handle dark mode in one of three ways: (1) automatic color inversion of unmodified '
            'content (New Outlook, Gmail mobile apps, Apple Mail by default), (2) respecting explicit '
            'prefers-color-scheme/color-scheme CSS when a document declares support (Apple Mail, some Gmail '
            'contexts), or (3) no dark-mode-specific behavior at all, rendering exactly as authored (Classic '
            'Outlook desktop). A design that only ever tests one of these three behaviors risks looking wrong '
            'in the other two — checking both a design\'s original colors AND its auto-inverted colors (which '
            'this builder\'s dark-mode:contrast check already does) covers the two riskiest cases.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('dark-mode',),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.85,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-css-inline-vs-style-block-strategy',
        category='html',
        title='Inline styles are the most universally honored mechanism; a <style> block is a genuine enhancement, not the sole delivery method',
        description=(
            '<style>-block support and sanitization behavior varies meaningfully across clients (full support '
            'in Apple Mail/modern Gmail/New Outlook, none at all as a general CSS delivery mechanism in the '
            'Word engine, historical caveats in Yahoo Mail), while inline styles on the element itself are '
            'almost universally honored everywhere. The safest strategy declares anything critical to '
            'legibility/layout inline, and uses a <style> block for genuine enhancements (media-query-driven '
            'responsive overrides, dark-mode support) that degrade gracefully if ignored.'
        ),
        severity='info',
        affected_clients=('OTHER',),
        concerns=('css-support', 'safe-html-css-practices'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.9,
        source=_INFORMED_BY_CANIEMAIL,
    ),
    KnowledgeRule(
        id='email-webmail-chromium-webkit-family',
        category='html',
        title='Most modern webmail/app clients render through a Chromium or WebKit-family engine with broadly modern CSS support',
        description=(
            'Gmail (web/apps), Outlook.com, New Outlook, and Apple/iOS Mail all render through some variant of '
            'a Chromium-family or WebKit-family web engine, giving them broadly modern, mutually-similar CSS '
            'support — unlike the Word-engine Outlook family. Most REMAINING differences between these clients '
            'come from each provider\'s own HTML/CSS sanitization policy (what tags/attributes/properties they '
            'strip for security or product reasons), not fundamental rendering-engine limitations — worth '
            'knowing when a rendering difference looks like an engine bug but is actually a sanitization rule.'
        ),
        severity='info',
        affected_clients=('WEBMAIL_CHROMIUM',),
        concerns=('rendering-engine', 'css-support'),
        detection={'kind': 'reference'},
        suggested_fix=None,
        safe_auto_fix=False,
        references=(),
        confidence=0.8,
        source=_INFORMED_BY_CANIEMAIL,
    ),
)

_RULES_BY_ID = {rule.id: rule for rule in _RULES}


def load_rules():
    """Sub-phase 3 (item 13) + Sub-phase 4 (item 6) + Sub-phase 5 (Phase B
    — Professional Email Knowledge Engine): returns the full structured
    knowledge base — 14 original Outlook/MSO + document-standards
    explainer rules, plus Sub-phase 5's expansion covering Classic/New
    Outlook depth, Gmail, Apple Mail, iOS Mail, Yahoo Mail, AOL Mail,
    Outlook.com, and cross-client general practices (51 rules total as of
    Sub-phase 5). Phase C (Sub-phase 6)'s VML-generation rules and Phase
    D/E's composition/learning-related knowledge are separate, still-
    unstarted future work — this function's growth is additive, never a
    replacement of existing entries."""
    return list(_RULES)


def find_rule(rule_id):
    """Direct id lookup — used by the deterministic "explain" intent
    (ai_command.py) so a topic keyword match doesn't need to re-scan the
    whole list."""
    return _RULES_BY_ID.get(rule_id)

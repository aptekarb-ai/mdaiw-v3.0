"""D4-D — builder-aware construction planner (Feature 14 V4).

Turns a D4-C EmailBrief into an ordered, ready-to-apply COMPOSE_EMAIL
action, section by section, using ONLY module types/fields that actually
exist in the live capability manifest (module_capabilities.py — the same
one composition.py, ai_command.py's validate_action(), and the frontend
module registry all already trust; this file maintains no second list).

Relationship to composition.py: composition.py's compose_from_brief()
is an existing, separate, deterministic RAW-TEXT -> COMPOSE_EMAIL
pipeline (8 curated whole-email patterns scored against free text,
generic scaffolding copy). It is untouched by this file and remains the
deterministic router's own fallback for a plain "create a promotional
email" message. This module solves a different, narrower-but-deeper
problem: given a D4-C EmailBrief (real extracted headings/CTAs/product
rows/images, with provenance), decide PER SECTION which existing module
best represents that specific content, populate it with the REAL content
(never composition.py's generic placeholder text), and report honestly
when nothing fits. It reuses composition.py's `CompositionItem` shape
and the same `_validate_patch`-routed patch-safety pattern (see
`_safe_patch` below, a one-line mirror of composition.py's own, not an
import of its private helper) so both pipelines produce IDENTICAL,
interchangeable COMPOSE_EMAIL item shapes — one document model, one
mutation system, two ways of deciding what goes in it.

Never mutates an EmailDocument, never calls validate_action() itself
(the caller — views.py — passes the built action through the exact same
validate_action() gate every other action type uses before it can ever
reach the frontend), never imports composition.py's PATTERNS (a
completely separate matching strategy). Zero OpenAI/LLM dependency —
every decision here is table-driven and deterministic (see
MODULE_CAPABILITY_MATCHING_IS_DETERMINISTIC in test_construction_planner.py).

Content safety: every string placed into a patch comes from EmailBrief
values, which themselves come from either the user's own instruction or
attachment-extracted text — both untrusted DATA, never obeyed as
instructions (see email_brief.py's own docstring; this file inherits
that guarantee by construction — it only ever reads `.value`/`.content`
fields and hands them to `_safe_patch`, never executes or branches on
what the text *says*, only on which EmailBrief FIELD it arrived in).
"""

import re
from dataclasses import asdict, dataclass, field

from . import composition, module_capabilities
from .email_brief import EmailBrief

# --- classification -----------------------------------------------------

EXACT = 'exact'
NORMALIZED = 'normalized'
APPROXIMATED = 'approximated'
UNSUPPORTED = 'unsupported'
REQUIRES_NEW_MODULE = 'requires_new_module'

MAX_PLAN_ITEMS = composition.MAX_COMPOSITION_ITEMS  # one shared ceiling, not a second one


def _safe_patch(module_type, patch):
    """Mirrors composition.py's own `_safe_patch` — routes a seed patch
    through the SAME manifest-driven validator every action type uses.
    Not an import of composition.py's private helper: this file and
    composition.py are independent callers of the one real validator
    (`ai_command._validate_patch`), matching the deferred-import pattern
    composition.py itself already uses to avoid a circular import."""
    if not patch:
        return {}
    from .ai_command import _validate_patch

    return _validate_patch(module_type, patch) or {}


def _safe_field_value(module_type, field_key, value):
    field_capability = module_capabilities.get_editable_field(module_type, field_key)
    if not field_capability:
        return None
    from .ai_command import _validate_field_value

    return _validate_field_value(field_capability, value)


def _exists(module_type):
    return module_type in module_capabilities.get_all_module_types()


def _first_existing(*candidates):
    for candidate in candidates:
        if candidate and _exists(candidate):
            return candidate
    return None


@dataclass(frozen=True)
class MatchResult:
    section_role: str
    module_type: str | None
    classification: str
    confidence: float
    reasons: list[str]
    approximation_notes: list[str]
    unmapped_fields: list[str]
    alternatives: list[str]
    provenance: list[dict]
    # Optional — only set for a REQUIRES_NEW_MODULE decision (D4-D hardening
    # item 2): a plain-language pointer to what would need to happen next
    # (a future reusable-module workflow), never a promise this checkpoint
    # implements. See build_construction_plan's video-request handling.
    suggested_next_step: str | None = None

    @property
    def signature(self) -> str:
        """A stable, deterministic learning signature for this decision —
        `learning.py`'s SIGNATURE_PATTERN accepts 2-3 lowercase-hyphenated
        segments; this always produces exactly 3. Computed, not stored: it
        is a pure function of module_type/section_role, so it needs no
        constructor changes at any of this file's many MatchResult(...)
        call sites. D4-D boundary (see this module's docstring and
        ConstructionPlanView): this signature makes a construction
        decision LEARNING-READY. D4-D never calls learning.record_signal()
        itself — that happens only once a genuine user decision (Build /
        Cancel / choose-an-alternative) exists to attach it to."""
        target = self.module_type or self.section_role or 'none'
        return f'construction:module-select:{target}'

    def to_dict(self) -> dict:
        data = asdict(self)
        data['signature'] = self.signature
        return data


@dataclass
class PlannedSection:
    match: MatchResult
    item: dict | None  # composition.CompositionItem.to_dict() shape, or None if UNSUPPORTED

    def to_dict(self) -> dict:
        return {'match': self.match.to_dict(), 'item': self.item}


@dataclass
class ConstructionPlan:
    platform: str
    sections: list[PlannedSection]
    platform_notes: list[str]
    warnings: list[str]

    def to_dict(self) -> dict:
        return {
            'platform': self.platform,
            'sections': [s.to_dict() for s in self.sections],
            'platform_notes': self.platform_notes,
            'warnings': self.warnings,
        }

    @property
    def compose_email_items(self) -> list[dict]:
        """The subset of planned items actually ready to send through
        COMPOSE_EMAIL — UNSUPPORTED sections contribute no item (there is
        nothing safe to insert for them; see D4-D4)."""
        return [s.item for s in self.sections if s.item is not None][:MAX_PLAN_ITEMS]


# --- per-family matchers -------------------------------------------------
# Each returns a MatchResult; item construction happens once in
# build_construction_plan() so every matcher stays a pure decision
# function, easy to unit-test in isolation (see D4-D12's requirement for
# deterministic, individually-testable matching).

def match_header(brief: EmailBrief) -> MatchResult:
    has_cta = bool(brief.ctas)
    module_type = _first_existing('header-logo-cta', 'header-logo-center') if has_cta \
        else _first_existing('header-logo-center', 'header-logo-cta')
    if not module_type:
        return MatchResult('header', None, UNSUPPORTED, 0.0, ['No header module is registered.'], [], [], [], [])
    return MatchResult(
        'header', module_type, NORMALIZED, 0.7,
        ['A standard header/logo module is included by default for every email.'],
        [], [], [t for t in ('header-logo-cta', 'header-logo-center') if t != module_type and _exists(t)], [],
    )


def match_hero(brief: EmailBrief, heading_section) -> MatchResult:
    has_image = bool(brief.images)
    has_cta = bool(brief.ctas)
    if has_image and has_cta:
        candidates = ('hero-image-cta', 'hero-centered-promo', 'hero-text-only')
    elif has_cta:
        candidates = ('hero-centered-promo', 'hero-image-cta', 'hero-text-only')
    else:
        candidates = ('hero-text-only', 'hero-centered-promo')
    module_type = _first_existing(*candidates)
    if not module_type:
        return MatchResult('hero', None, UNSUPPORTED, 0.0, ['No hero module is registered.'], [], [], [], [])
    provenance = list(heading_section.provenance) if heading_section else []
    reasons = ['Matched a hero module supporting an image and CTA.'] if has_image and has_cta else \
        ['Matched a hero module supporting a CTA.'] if has_cta else \
        ['Matched a text-only hero module — no image or CTA was found for this section.']
    classification = EXACT if heading_section else NORMALIZED
    confidence = 0.75 if heading_section else 0.5
    approximation_notes = [] if heading_section else ['No heading content was found — using a generic hero headline.']
    return MatchResult(
        'hero', module_type, classification, confidence, reasons, approximation_notes, [],
        [c for c in candidates if c != module_type and _exists(c)], [p.to_dict() for p in provenance],
    )


def match_content_section(section) -> MatchResult:
    """A content section and a separate, adjacent CTA section (see
    build_construction_plan's CTA handling below) are proposed as two
    correctly-ordered modules — verified functionally valid by
    test_content_section_and_separate_cta_render_as_two_correctly_ordered_adjacent_modules
    in test_construction_planner.py (D4-D hardening item 4). Future
    optimization, NOT implemented here: when content-heading-text-cta
    exists and a content section is immediately followed by a CTA with no
    other module in between, rank/combine them into that single module
    for a more compact result instead of two adjacent ones."""
    has_heading = 'heading' in section.content or bool(section.content.get('text'))
    module_type = _first_existing('content-heading-text', 'text')
    classification = EXACT if module_type == 'content-heading-text' else NORMALIZED
    reasons = ['Matched a heading + body-copy module.'] if module_type == 'content-heading-text' else \
        ['No heading module was available — using a plain text module.']
    return MatchResult(
        section.role, module_type, classification, 0.7 if has_heading else 0.5, reasons, [], [],
        [t for t in ('content-heading-text', 'text') if t != module_type and _exists(t)],
        [p.to_dict() for p in section.provenance],
    )


_COLUMN_LAYOUTS = {
    2: ('layout-2col-50-50', 'layout-2col-60-40', 'layout-2col-40-60'),
    3: ('layout-3col',),
}


def match_multi_column_layout(section_count: int) -> MatchResult:
    """Only called for exactly 2 or 3 remaining content sections (see
    build_construction_plan) — a genuinely multi-column request, not a
    heuristic guess about when columns are "probably" wanted."""
    candidates = _COLUMN_LAYOUTS.get(section_count, ())
    module_type = _first_existing(*candidates)
    if not module_type:
        return MatchResult(
            'columns', None, UNSUPPORTED, 0.0,
            [f'No {section_count}-column layout module is registered.'], [], [], [], [],
        )
    return MatchResult(
        'columns', module_type, EXACT, 0.75,
        [f'Matched a {section_count}-column layout for the remaining content sections.'], [], [],
        [t for t in candidates if t != module_type and _exists(t)], [],
    )


def match_cta(cta: dict) -> MatchResult:
    module_type = _first_existing('cta-centered', 'cta-banner', 'cta-text-cta', 'button')
    if not module_type:
        return MatchResult('cta', None, UNSUPPORTED, 0.0, ['No CTA/button module is registered.'], [], [], [], [])
    has_url = bool(cta.get('url'))
    classification = EXACT if has_url and cta.get('label') else NORMALIZED
    notes = [] if has_url else ['No destination URL was found — the CTA link will need to be filled in manually.']
    if not cta.get('label'):
        notes.append('No button text was found in the source — using a generic label.')
    return MatchResult(
        'cta', module_type, classification, 0.7 if has_url else 0.4,
        ['Matched an existing CTA/button module.'], notes, [], [],
        list(cta.get('provenance') or []),
    )


_PRODUCT_CANDIDATES_BY_CAPACITY = (
    ('product-single', 1), ('product-image-price-cta', 1),
    ('product-two-cards', 2), ('product-three-cards', 3), ('product-grid', 4),
)

# An identifying field a product row must carry at least one of — without
# one, "row count" is the only signal left, and row count alone is not
# evidence that a spreadsheet holds product content at all (a headcount
# sheet, a cost-center list, an attendance log all have rows too).
_PRODUCT_IDENTIFYING_FIELDS = frozenset({'name', 'description'})
_PRODUCT_MIN_MAPPED_FIELDS = 2


def _has_meaningful_product_mapping(mapped_fields) -> bool:
    """D4-D hardening item 1: a repeatable/product module requires
    meaningful mapped-field coverage, not merely a row count. Reuses
    D4-C's own column-mapping output (EmailBrief._spreadsheet_data's
    `mapped_fields`, built from `_COLUMN_ALIASES`) rather than
    re-deriving a second, competing notion of what "looks like a
    product". Requires: at least one identifying field (name or
    description) AND at least two total mapped fields, so a single
    stray "name"-like column can't alone promote arbitrary data."""
    mapped = set(mapped_fields or [])
    return bool(mapped & _PRODUCT_IDENTIFYING_FIELDS) and len(mapped) >= _PRODUCT_MIN_MAPPED_FIELDS


def match_product_dataset(dataset: dict) -> MatchResult:
    """Every registered product-family module has a FIXED item count
    (never a flexible min<max range — confirmed against the live
    manifest, not assumed), so this is genuinely an exact-cardinality
    lookup, not a "closest fit" heuristic dressed up as one — but
    cardinality is only consulted AFTER confirming the data is actually
    product-shaped (see `_has_meaningful_product_mapping`); row count by
    itself never selects a product module."""
    row_count = dataset.get('row_count', 0)
    provenance = list(dataset.get('provenance') or [])
    if row_count <= 0:
        return MatchResult('data', None, UNSUPPORTED, 0.0, ['No product rows were found.'], [], [], [], provenance)

    mapped_fields = dataset.get('mapped_fields') or []
    if not _has_meaningful_product_mapping(mapped_fields):
        unmapped = list(dataset.get('unmapped_columns') or dataset.get('headers') or [])
        mapped_note = f'Recognized column(s): {", ".join(mapped_fields)}.' if mapped_fields \
            else 'No columns were recognized as product fields.'
        unmapped_note = f' Unrecognized column(s): {", ".join(unmapped)}.' if unmapped else ''
        return MatchResult(
            'data', None, UNSUPPORTED, 0.0,
            [
                f'{row_count} row(s) were found, but this does not look like product data — a product module '
                'requires at least a name or description column plus one more mapped field (price, image, '
                'URL, CTA, or category). Row count alone is not enough to classify spreadsheet data as '
                f'products. {mapped_note}{unmapped_note}'
            ],
            [], list(mapped_fields), [], provenance,
        )

    candidates = [(t, cap) for t, cap in _PRODUCT_CANDIDATES_BY_CAPACITY if _exists(t)]
    exact = next((t for t, cap in candidates if cap == row_count), None)
    if exact:
        return MatchResult(
            'data', exact, EXACT, 0.8,
            [f'Found a product module supporting exactly {row_count} item(s), matching the source data.'],
            [], [], [t for t, _cap in candidates if t != exact], provenance,
        )

    # No exact-cardinality match — approximate with the LARGEST-capacity
    # candidate whose capacity is < row_count (truncate, never pad with
    # fabricated rows), and say exactly how many were left out. If every
    # candidate's capacity exceeds row_count instead, use the SMALLEST
    # one that still fits (nothing to truncate, just fewer slots filled
    # than the module technically allows — still an approximation, since
    # the module wasn't built specifically for this count).
    smaller_or_equal = [(t, cap) for t, cap in candidates if cap <= row_count]
    if smaller_or_equal:
        best_type, best_cap = max(smaller_or_equal, key=lambda pair: pair[1])
        omitted = row_count - best_cap
        return MatchResult(
            'data', best_type, APPROXIMATED, 0.4,
            [f'No product module supports exactly {row_count} items.'],
            [f'Only the first {best_cap} of {row_count} product(s) are included; {omitted} were omitted.'],
            [], [t for t, _cap in candidates if t != best_type], provenance,
        )
    if candidates:
        best_type, best_cap = min(candidates, key=lambda pair: pair[1])
        return MatchResult(
            'data', best_type, APPROXIMATED, 0.4,
            [f'No product module supports exactly {row_count} items.'],
            [f'Using a {best_cap}-item product module; only {best_cap} of {row_count} product(s) are shown.'],
            [], [t for t, _cap in candidates if t != best_type], provenance,
        )
    return MatchResult(
        'data', None, UNSUPPORTED, 0.0,
        ['No product-family module is registered at all.'], [], [], [], provenance,
    )


def match_image(image: dict) -> MatchResult:
    module_type = _first_existing('image', 'image-text')
    if not module_type:
        return MatchResult('image', None, UNSUPPORTED, 0.0, ['No image module is registered.'], [], [], [], [])
    # D4-A/D4-D1 constraint: an attachment id is not a valid image_asset
    # marker ({'assetId': int} or {'url': safe-http(s)} only) and this
    # planner never fabricates a URL — the module is correctly selected,
    # its image field is simply left at the module's own default rather
    # than populated, and that omission is reported, not hidden.
    return MatchResult(
        'image', module_type, NORMALIZED, 0.5,
        ['Matched an image module for the uploaded image.'],
        ['The uploaded image needs to be assigned to this module manually — it cannot be linked automatically yet.'],
        ['src'], [t for t in ('image', 'image-text') if t != module_type],
        list(image.get('provenance') or []),
    )


def match_footer(brief: EmailBrief) -> MatchResult:
    module_type = _first_existing('footer-social-legal', 'footer-simple-legal')
    if not module_type:
        return MatchResult('footer', None, UNSUPPORTED, 0.0, ['No footer module is registered.'], [], [], [], [])
    provenance = list(brief.footer['provenance']) if brief.footer else []
    classification = EXACT if brief.footer else NORMALIZED
    reasons = ['Footer/compliance content was found in the source.'] if brief.footer else \
        ['No explicit footer content was found — a standard unsubscribe/legal footer is included by default.']
    return MatchResult(
        'footer', module_type, classification, 0.75 if brief.footer else 0.6, reasons, [], [],
        [t for t in ('footer-social-legal', 'footer-simple-legal') if t != module_type], provenance,
    )


# --- REQUIRES_NEW_MODULE proof case (D4-D hardening item 2) ---------------
# The live manifest has zero video-capable module or field (confirmed by
# direct inspection of module_capabilities.get_all_module_types() and every
# module's editable fields — not assumed). An explicit request to embed a
# video is understood, not malicious, not merely missing content, and not
# something any existing module or safe combination of modules can
# represent even approximately — a static image or a CTA button is a
# materially different reader experience than a playable video embed, so
# this is not an APPROXIMATED case dressed up as something bigger. This is
# the deterministic, reproducible REQUIRES_NEW_MODULE proof.
_VIDEO_REQUEST_PATTERN = re.compile(r'\b(?:embed(?:ded)?\s+)?videos?\b', re.IGNORECASE)


def match_video_request(message: str) -> MatchResult | None:
    """Returns None when the message doesn't mention video, OR when a
    video-capable module has since been added to the manifest (in which
    case there is honestly nothing to flag anymore) — only returns a
    MatchResult for the genuine gap."""
    if not message or not _VIDEO_REQUEST_PATTERN.search(message):
        return None
    if any('video' in module_type for module_type in module_capabilities.get_all_module_types()):
        return None
    return MatchResult(
        'video', None, REQUIRES_NEW_MODULE, 0.6,
        [
            'The instruction asked for an embedded video, but no builder module supports video content. '
            'A CTA button linking to the video or a static thumbnail image would be a materially different '
            'reader experience, not a safe approximation, so no module was substituted.',
        ],
        [], [], [], [],
        suggested_next_step=(
            'This content could be represented by a future reusable-module workflow once a video-capable '
            'module type is defined for the builder; no module is created automatically for it here.'
        ),
    )


# --- platform notes -------------------------------------------------------
# EmailPlatform's non-generic members are documented as NOT YET
# implemented adapters (see models.py's own EmailPlatform docstring) —
# this planner never fabricates AMPscript/platform-token syntax for any
# of them (matches the knowledge base's own hard rule,
# 'sfmc-ampscript-never-evaluated': platform tokens are read/preserved as
# literal text, never generated). All this function does is say so.
_PLATFORM_LABELS = {
    'sfmc': 'Salesforce Marketing Cloud', 'marketo': 'Marketo', 'hubspot': 'HubSpot', 'pardot': 'Pardot / Account Engagement',
}


def _platform_notes(platform: str, brief: EmailBrief) -> list[str]:
    notes = []
    label = _PLATFORM_LABELS.get(platform)
    if label:
        notes.append(
            f'This document targets {label}. This builder does not generate platform-specific merge/personalization '
            f'syntax (e.g. AMPscript) automatically — any platform tokens must be added manually after Apply.',
        )
    if brief.personalization:
        notes.append(
            f'The source mentions personalization ({", ".join(brief.personalization)}) — no module field was '
            f'populated with this automatically; add it manually where needed.',
        )
    return notes


# --- plan assembly ---------------------------------------------------------

def build_construction_plan(brief: EmailBrief, message: str = '') -> ConstructionPlan:
    """`message` is the caller's original raw instruction — OPTIONAL and
    used for exactly one thing: when the user names a section explicitly
    in a TEXT-ONLY request (no attachment facts to derive it from — e.g.
    "...with a CTA and three products"), reuses composition.py's own
    already-tested `detect_sections()` (never a second, parallel keyword
    set) to add that module with its own factory-default placeholder
    content — the SAME "generic scaffolding, never a fabricated claim"
    posture composition.py's whole engine already documents, applied
    only to fill a structural gap the EmailBrief pipeline (attachment-
    facts-driven by design) has no way to see on its own."""
    warnings = list(brief.warnings)
    sections: list[PlannedSection] = []
    text_signals = composition.detect_sections(message) if message else set()

    def add(match: MatchResult, patch: dict | None = None, repeatable_items=None, children=None):
        if match.module_type is None:
            sections.append(PlannedSection(match, None))
            return
        item = composition.CompositionItem(
            match.module_type, _safe_patch(match.module_type, patch or {}),
            children=children, repeatable_items=repeatable_items,
        )
        sections.append(PlannedSection(match, item.to_dict()))

    # Header — always proposed first; a safe structural default.
    add(match_header(brief))

    heading_sections = [s for s in brief.sections if s.role in ('heading', 'paragraph', 'list_item')]
    hero_section = heading_sections[0] if heading_sections else None
    hero_match = match_hero(brief, hero_section)
    hero_patch = {}
    if hero_section:
        hero_patch['headline'] = hero_section.content.get('text', '')
    if brief.ctas:
        first_cta = brief.ctas[0]
        if _safe_field_value(hero_match.module_type or '', 'ctaText', first_cta.get('label') or 'Learn More') is not None:
            hero_patch['ctaText'] = first_cta.get('label') or 'Learn More'
        if first_cta.get('url') and _safe_field_value(hero_match.module_type or '', 'ctaHref', first_cta['url']) is not None:
            hero_patch['ctaHref'] = first_cta['url']
    add(hero_match, hero_patch)

    # Remaining heading/paragraph sections (beyond the one used for hero).
    # Exactly 2 or 3 of them is a genuinely multi-column request (D4-D6) —
    # nested one level into a real layout module's columns, matching
    # composition.py's own `_two_column_content_layout` pattern. Any other
    # count falls back to sequential flat content sections.
    remaining_content_sections = heading_sections[1:]

    def _content_patch(module_type, section):
        if module_type == 'content-heading-text':
            return {'heading': section.content.get('text', '')[:120], 'text': section.content.get('text', '')}
        if module_type == 'text':
            return {'text': section.content.get('text', '')}
        return {}

    def _add_flat_content_sections(sections_to_add):
        for section in sections_to_add:
            match = match_content_section(section)
            add(match, _content_patch(match.module_type, section))

    layout_match = match_multi_column_layout(len(remaining_content_sections)) \
        if len(remaining_content_sections) in _COLUMN_LAYOUTS else None
    if layout_match and layout_match.module_type:
        children = []
        child_matches = []
        for index, section in enumerate(remaining_content_sections):
            content_match = match_content_section(section)
            child_matches.append(content_match)
            if content_match.module_type is None:
                continue
            patch = _safe_patch(content_match.module_type, _content_patch(content_match.module_type, section))
            children.append({
                'column_index': index,
                'modules': [composition.CompositionItem(content_match.module_type, patch)],
            })
        merged_match = MatchResult(
            layout_match.section_role, layout_match.module_type, layout_match.classification, layout_match.confidence,
            layout_match.reasons + [r for m in child_matches for r in m.reasons],
            layout_match.approximation_notes + [n for m in child_matches for n in m.approximation_notes],
            layout_match.unmapped_fields, layout_match.alternatives,
            [p for m in child_matches for p in m.provenance],
        )
        if children:
            add(merged_match, children=children)
        else:
            _add_flat_content_sections(remaining_content_sections)
    else:
        _add_flat_content_sections(remaining_content_sections)

    # Product data sections.
    data_sections = [s for s in brief.sections if s.role == 'data']
    for data_section in data_sections:
        for dataset in data_section.content.get('datasets', []):
            match = match_product_dataset(dataset)
            if match.module_type is None:
                add(match)
                continue
            repeatable = module_capabilities.get_repeatable_field(match.module_type)
            items = []
            if repeatable:
                capacity = repeatable['maxItems']
                fields_by_alias = {f['key'].lower(): f for f in repeatable['itemSchema']}
                for row in dataset.get('rows', [])[:capacity]:
                    safe_item = {}
                    for alias, value in row.items():
                        target_field = None
                        if alias == 'name' and 'name' in fields_by_alias:
                            target_field = fields_by_alias['name']
                        elif alias == 'price' and 'price' in fields_by_alias:
                            target_field = fields_by_alias['price']
                        elif alias == 'description' and 'description' in fields_by_alias:
                            target_field = fields_by_alias['description']
                        elif alias == 'url' and 'ctahref' in fields_by_alias:
                            target_field = fields_by_alias['ctahref']
                        elif alias == 'image_url' and 'imagesrc' in fields_by_alias:
                            target_field = fields_by_alias['imagesrc']
                            value = {'url': value} if isinstance(value, str) else value
                        elif alias == 'cta' and 'ctatext' in fields_by_alias:
                            target_field = fields_by_alias['ctatext']
                        if not target_field:
                            continue
                        from .ai_command import _validate_field_value

                        validated = _validate_field_value(target_field, value)
                        if validated is not None:
                            safe_item[target_field['key']] = validated
                    if safe_item:
                        items.append(safe_item)
            add(match, repeatable_items=items or None)

    # Arbitrary DOCX/PDF tables (role='table', distinct from the
    # semantically-mapped 'data' role above — see email_brief.py's
    # _sections_from_facts) have no clean, honest module mapping: no
    # existing module represents "an arbitrary table extracted from a
    # document." Explicitly classified UNSUPPORTED rather than silently
    # dropped (D4-D4) — this is a genuine gap, not a fabricated one (the
    # 5/6-column layout modules DO exist; this is the real unsupported
    # case).
    for table_section in [s for s in brief.sections if s.role == 'table']:
        row_count = (table_section.content.get('rows') or [])
        add(MatchResult(
            'table', None, UNSUPPORTED, 0.0,
            [f'A table with {len(row_count)} row(s) was found in a document, but no builder module represents an '
             f'arbitrary table — only structured product/spreadsheet data can be mapped automatically.'],
            [], [], [], [p.to_dict() for p in table_section.provenance],
        ))

    # CTAs not already consumed by the hero.
    for cta in brief.ctas[1:] if brief.ctas else []:
        match = match_cta(cta)
        patch = {}
        if match.module_type:
            if cta.get('label') and _safe_field_value(match.module_type, 'ctaText', cta['label']) is not None:
                patch['ctaText'] = cta['label']
            elif _safe_field_value(match.module_type, 'ctaText', 'Learn More') is not None:
                patch['ctaText'] = 'Learn More'
            if cta.get('url') and _safe_field_value(match.module_type, 'ctaHref', cta['url']) is not None:
                patch['ctaHref'] = cta['url']
        add(match, patch)

    # Text-only gap fill — see build_construction_plan's own docstring:
    # only reached when the EmailBrief itself found no real CTA/product
    # content (no attachment facts to derive it from) but the user's OWN
    # instruction explicitly named the section. Uses each module's own
    # factory-default placeholder content (empty repeatable_items / a
    # generic "Learn More" CTA label) — never a fabricated product name,
    # price, or URL, matching composition.py's own documented posture.
    if 'cta' in text_signals and not brief.ctas and 'ctaText' not in (hero_patch or {}):
        cta_match = match_cta({'label': None, 'url': None, 'confidence': 0.0, 'note': '', 'provenance': []})
        if cta_match.module_type:
            cta_match = MatchResult(
                cta_match.section_role, cta_match.module_type, NORMALIZED, 0.4,
                ['The instruction asked for a CTA, but no specific link or button text was found in any source.'],
                ['Using a generic CTA — fill in the real destination and label before sending.'], [], [], [],
            )
            add(cta_match, {'ctaText': 'Learn More'} if _safe_field_value(cta_match.module_type, 'ctaText', 'Learn More') is not None else {})
    if 'products' in text_signals and not data_sections:
        product_match = MatchResult(
            'data', 'product-three-cards' if _exists('product-three-cards') else _first_existing(*(t for t, _c in _PRODUCT_CANDIDATES_BY_CAPACITY)),
            NORMALIZED, 0.4,
            ['The instruction asked for products, but no product data was found in any source.'],
            ['Using placeholder product slots — fill in real product names, prices, and images before sending.'],
            [], [], [],
        )
        if product_match.module_type:
            add(product_match)

    # Video-embed request — see match_video_request's own docstring for
    # why this is a genuine REQUIRES_NEW_MODULE case rather than an
    # approximation. Adds no CompositionItem (add() already no-ops for a
    # None module_type — see the `add` closure above).
    video_match = match_video_request(message)
    if video_match is not None:
        add(video_match)

    # Images (metadata-only — see match_image).
    for image in brief.images:
        add(match_image(image))

    # Footer — always proposed last.
    footer_match = match_footer(brief)
    footer_patch = {}
    add(footer_match, footer_patch)

    if len(sections) > MAX_PLAN_ITEMS:
        warnings.append(f'This plan has more than {MAX_PLAN_ITEMS} sections; only the first {MAX_PLAN_ITEMS} will be applied.')

    return ConstructionPlan(
        platform=brief.platform, sections=sections,
        platform_notes=_platform_notes(brief.platform, brief), warnings=warnings,
    )


def summarize_plan(plan: ConstructionPlan, conflicts=None) -> str:
    """One deterministic, human-readable "what I understood / what will
    happen" summary — never a template the user can't verify against the
    actual `plan.sections` classifications returned alongside it.

    D4-E3I §5 — `conflicts` (optional, a list of the brief's own
    EmailBrief.conflicts dicts) surfaces disagreements between the user's
    typed instruction and attachment-derived facts directly in this reply
    text. Callers already receive the full `brief.conflicts` list
    separately in the response body (email_brief.py has always populated
    it); this was the one place a conflict could go completely unmentioned
    to the user — the ConstructionPlanView reply text never referenced it
    before, so a real disagreement (e.g. instruction says "welcome email",
    attached brief says "webinar invitation") was silently applied one way
    with no visible sign anything was ever in question. Never silently
    resolves which side wins — states both candidates and which one this
    plan proceeded with."""
    exact = sum(1 for s in plan.sections if s.match.classification == EXACT)
    normalized = sum(1 for s in plan.sections if s.match.classification == NORMALIZED)
    approximated = sum(1 for s in plan.sections if s.match.classification == APPROXIMATED)
    unsupported = [s for s in plan.sections if s.match.classification == UNSUPPORTED]
    needs_new_module = [s for s in plan.sections if s.match.classification == REQUIRES_NEW_MODULE]
    total = len(plan.sections)

    parts = [
        f'I found {total} section(s) for this email: {exact} exact match(es), '
        f'{normalized} normalized, {approximated} approximated.',
    ]
    if unsupported:
        details = '; '.join((s.match.reasons[0] if s.match.reasons else s.match.section_role) for s in unsupported)
        parts.append(f'{len(unsupported)} item(s) are not supported by the current builder: {details}.')
    if needs_new_module:
        details = '; '.join((s.match.reasons[0] if s.match.reasons else s.match.section_role) for s in needs_new_module)
        parts.append(f'{len(needs_new_module)} item(s) would need a new builder module to represent properly: {details}.')
    if plan.platform_notes:
        parts.append(' '.join(plan.platform_notes))
    if conflicts:
        for conflict in conflicts:
            if not isinstance(conflict, dict):
                continue
            message = conflict.get('message')
            if message:
                parts.append(f'Note: {message}')
    parts.append('Review the proposal below and choose Build to apply it, or Cancel.')
    return ' '.join(parts)

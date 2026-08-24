"""Feature 14 V3 Sub-phase 7 — the Email AI Engineer's composition engine.

Turns a free-text email brief ("Create a promotional email for a summer
sale with preheader, header, hero, products, CTA, social links and
footer.") into a structured, ordered COMPOSITION PLAN — a list of
composition items, each an EXISTING registered module type plus an
already-validated prop patch, optionally with one level of nested
children (for a layout module's columns) or seeded repeatable-field items
(for a module with a repeatable list, e.g. social platform links).

This module is deliberately NOT a template-name lookup ("use the
'promotional' template"). `interpret_brief()` scores the brief's free
text against a small set of curated PATTERNS using bounded keyword/phrase
matching, then layers in explicitly-requested SECTIONS the brief mentions
(preheader/header/hero/products/cta/social/footer/content) that the
chosen pattern's own base slot list may not already include — so two
briefs that both land on the same base pattern (e.g. both "promotional")
can still produce different compositions when their wording differs.

Every module type referenced here is checked against
module_capabilities.get_all_module_types() before being used — a pattern
whose preferred type has since been removed from the registry silently
skips that slot (or falls back to an alternative) rather than emitting an
action validate_action() would reject. This is the SAME manifest every
other part of ai_command.py already trusts; composition.py maintains no
second module list.

Composition items carry only SAFE, already-manifest-known patch keys —
built through the exact same `_validate_patch`-shaped dispatch as every
other action type (see `_safe_patch` below, which delegates to
ai_command.py's own `_validate_patch`/`_validate_field_value`) — so a
composition item can never carry a prop value the rest of this file
wouldn't also accept from a hand-typed UPDATE_MODULE_PROPS action. Text
values seeded here (headings, button labels) are short, generic, brand-
neutral scaffolding copy — never a fabricated claim, price, date, or
brand name the user did not supply. When the brief's own wording contains
a clean, short subject-like phrase, that phrase is used verbatim for the
hero headline (see `_extract_headline`); otherwise every module's own
`createDefaultProps` placeholder text (identical to what a manual "Add
module" click already produces) is left in place — never invented copy
beyond what the module registry itself already ships.
"""

import re

from . import module_capabilities

MAX_COMPOSITION_ITEMS = 14
MAX_COMPOSITION_CHILDREN_PER_COLUMN = 6


def _exists(module_type):
    return module_type in module_capabilities.get_all_module_types()


def _first_existing(*candidates):
    """First module type in `candidates` that is actually registered
    today — the fallback chain that keeps a pattern valid even if a
    preferred module type is later removed from the registry."""
    for candidate in candidates:
        if candidate and _exists(candidate):
            return candidate
    return None


def _safe_patch(module_type, patch):
    """Routes a composition slot's seed patch through the SAME
    manifest-driven field validator every other action type uses — never
    a parallel/looser validation path for composition content. Deferred
    import — ai_command.py imports THIS module, so a top-level import
    here would be circular; by call time both modules are fully loaded."""
    if not patch:
        return {}
    from .ai_command import _validate_patch

    return _validate_patch(module_type, patch) or {}


class CompositionItem:
    """One node in a composition plan. `children` is a list of
    {'column_index': int, 'modules': [CompositionItem, ...]} dicts — used
    only when `module_type` is a layout type; every nested CompositionItem
    is itself flat (no grandchildren — the engine, like
    INSERT_NESTED_MODULE, only ever nests one level deep).
    `repeatable_items` seeds a non-layout module's own repeatable field
    (e.g. social-icon-row's platform links) with real, non-fabricated
    values — used only when the module actually has a repeatableField."""

    __slots__ = ('module_type', 'patch', 'children', 'repeatable_items')

    def __init__(self, module_type, patch=None, children=None, repeatable_items=None):
        self.module_type = module_type
        self.patch = patch or {}
        self.children = children
        self.repeatable_items = repeatable_items

    def to_dict(self):
        result = {'module_type': self.module_type, 'patch': self.patch}
        if self.children:
            result['children'] = [
                {
                    'column_index': group['column_index'],
                    'modules': [child.to_dict() for child in group['modules']],
                }
                for group in self.children
            ]
        if self.repeatable_items:
            result['repeatable_items'] = self.repeatable_items
        return result


def _module_item(*candidates, patch=None):
    """Builds one flat CompositionItem from the first registered
    candidate type, or None if none of the candidates exist (the slot is
    silently skipped by the caller — see build_composition)."""
    module_type = _first_existing(*candidates)
    if not module_type:
        return None
    return CompositionItem(module_type, _safe_patch(module_type, patch or {}))


def _social_item(headline_words=None):
    module_type = _first_existing('social-icon-row', 'social-follow-us')
    if not module_type:
        return None
    # The three default platforms every social module already ships with
    # (see socialCatalog.tsx's DEFAULT_PLATFORMS) — seeded explicitly here
    # so the composition engine's repeatable-item wiring is genuinely
    # exercised, not merely left to the module's own createDefaultProps.
    # Never a fabricated URL — href stays empty, same as a manual add.
    items = [
        {'label': 'Facebook', 'href': ''},
        {'label': 'Instagram', 'href': ''},
        {'label': 'LinkedIn', 'href': ''},
    ]
    repeatable = module_capabilities.get_repeatable_field(module_type)
    if not repeatable:
        return CompositionItem(module_type)
    fields_by_key = {f['key']: f for f in repeatable['itemSchema']}
    safe_items = []
    for raw_item in items:
        safe_item = {}
        for key, value in raw_item.items():
            field = fields_by_key.get(key)
            if not field:
                continue
            from .ai_command import _validate_field_value

            validated = _validate_field_value(field, value)
            if validated is not None:
                safe_item[key] = validated
        if safe_item:
            safe_items.append(safe_item)
    return CompositionItem(module_type, repeatable_items=safe_items or None)


def _two_column_content_layout():
    """One genuinely nested composition: a 2-column layout module whose
    two columns each hold a real content module — demonstrates the
    composition engine's layout/nested-module support (Sub-phase 6's
    structural capabilities), not just a flat list of top-level modules."""
    layout_type = _first_existing('layout-2col-50-50', 'layout-2col-60-40', 'layout-2col-40-60')
    content_type = _first_existing('content-heading-text', 'content-heading-text-cta')
    if not layout_type or not content_type:
        return None
    left = CompositionItem(content_type, _safe_patch(content_type, {'heading': 'What\'s new'}))
    right = CompositionItem(content_type, _safe_patch(content_type, {'heading': 'Why it matters'}))
    return CompositionItem(layout_type, children=[
        {'column_index': 0, 'modules': [left]},
        {'column_index': 1, 'modules': [right]},
    ])


# --- Curated pattern library ----------------------------------------------
# Each pattern builder returns an ordered list of CompositionItem (None
# entries silently dropped) — composition PATTERNS, never final HTML: the
# actual markup is produced later by each module's own existing
# renderEmailHtml, exactly like a manually-assembled email.

def _pattern_promotional(headline):
    return [
        _module_item('header-logo-cta', 'header-logo-center'),
        _module_item('hero-image-cta', 'hero-background-image', 'hero-centered-promo', patch={'headline': headline} if headline else None),
        _module_item('product-three-cards', 'product-two-cards', 'product-grid'),
        _module_item('cta-centered', 'cta-banner'),
        _social_item(),
        _module_item('footer-social-legal', 'footer-simple-legal'),
    ]


def _pattern_newsletter(headline):
    return [
        _module_item('header-logo-center', 'header-logo-left'),
        _module_item('content-heading-text', patch={'heading': headline} if headline else {'heading': 'This week\'s update'}),
        _two_column_content_layout(),
        _module_item('cta-text-cta', 'cta-centered'),
        _module_item('footer-simple-legal', 'footer-social-legal'),
    ]


def _pattern_welcome(headline):
    return [
        _module_item('header-logo-center'),
        _module_item('hero-text-only', 'hero-centered-promo', patch={'headline': headline} if headline else {'headline': 'Welcome aboard!'}),
        _module_item('content-icon-text-rows', 'content-feature-list'),
        _module_item('cta-centered', 'button'),
        _module_item('footer-simple-legal'),
    ]


def _pattern_product_launch(headline):
    return [
        _module_item('header-logo-cta', 'header-logo-center'),
        _module_item('hero-image-cta', 'hero-centered-promo', patch={'headline': headline} if headline else {'headline': 'Introducing something new'}),
        _module_item('product-image-price-cta', 'product-single'),
        _module_item('content-heading-text-cta', 'content-heading-text'),
        _social_item(),
        _module_item('footer-social-legal', 'footer-simple-legal'),
    ]


def _pattern_event(headline):
    return [
        _module_item('header-logo-center'),
        _module_item('hero-centered-promo', 'hero-text-only', patch={'headline': headline} if headline else {'headline': 'You\'re invited'}),
        _module_item('content-heading-text', patch={'heading': 'Event details'}),
        _module_item('cta-centered', 'button', patch={'text': 'RSVP Now'} if _exists('button') else None),
        _module_item('footer-simple-legal'),
    ]


def _pattern_transactional(headline):
    return [
        _module_item('header-compact', 'header-logo-center'),
        _module_item('content-heading-text', patch={'heading': headline} if headline else None),
        _module_item('footer-simple-legal'),
    ]


def _pattern_editorial(headline):
    return [
        _module_item('header-logo-center'),
        _module_item('content-article-teaser', patch={'heading': headline} if headline else None),
        _two_column_content_layout(),
        _module_item('footer-simple-legal', 'footer-social-legal'),
    ]


def _pattern_announcement(headline):
    return [
        _module_item('header-logo-center'),
        _module_item('text', patch={'text': headline} if headline else None),
        _module_item('button', 'cta-centered'),
        _module_item('footer-simple-legal'),
    ]


# key -> (builder, human label, trigger keyword patterns)
PATTERNS = {
    'promotional': (
        _pattern_promotional, 'Promotional / Campaign',
        re.compile(r'\b(promo(?:tional)?|campaign|sale|discount|offer|deal)\b', re.IGNORECASE),
    ),
    'newsletter': (
        _pattern_newsletter, 'Newsletter',
        re.compile(r'\b(newsletter|digest|weekly\s+update|roundup)\b', re.IGNORECASE),
    ),
    'welcome': (
        _pattern_welcome, 'Welcome / Onboarding',
        re.compile(r'\b(welcome|onboard(?:ing)?|getting\s+started)\b', re.IGNORECASE),
    ),
    'product_launch': (
        _pattern_product_launch, 'Product Launch',
        re.compile(r'\b(product\s+launch|new\s+product|launching|unveil)\b', re.IGNORECASE),
    ),
    'event': (
        _pattern_event, 'Event / Announcement',
        re.compile(r'\b(event|webinar|conference|rsvp|invite(?:d|s)?|save\s+the\s+date)\b', re.IGNORECASE),
    ),
    'transactional': (
        _pattern_transactional, 'Transactional / Informational',
        re.compile(r'\b(transactional|receipt|confirmation|order\s+update|informational|notice)\b', re.IGNORECASE),
    ),
    'editorial': (
        _pattern_editorial, 'Content / Editorial',
        re.compile(r'\b(editorial|article|blog|digest|story|feature\s+story)\b', re.IGNORECASE),
    ),
    'announcement': (
        _pattern_announcement, 'Simple Branded Announcement',
        re.compile(r'\b(announce(?:ment)?|update|heads[\s-]*up)\b', re.IGNORECASE),
    ),
}

# A composition request must clearly be ABOUT an email, not merely
# contain a pattern keyword ("update the button color" must never be
# read as a compose-email request) — see interpret_brief.
_EMAIL_WORD_PATTERN = re.compile(r'\bemail\b', re.IGNORECASE)
_COMPOSE_VERB_PATTERN = re.compile(r'\b(create|build|generate|make|compose|draft)\b', re.IGNORECASE)

# Explicitly-requested sections a brief can layer on top of its base
# pattern — each maps to a slot-building function appended (if not
# already present) to the chosen pattern's own list. Deliberately a SMALL
# bounded set (never open-ended "any module the user names"), matching
# the deterministic-router posture the rest of this file already uses.
_SECTION_SIGNALS = {
    'preheader': re.compile(r'\bpreheader\b', re.IGNORECASE),
    'header': re.compile(r'\bheader\b', re.IGNORECASE),
    'hero': re.compile(r'\bhero\b', re.IGNORECASE),
    'products': re.compile(r'\bproducts?\b', re.IGNORECASE),
    'cta': re.compile(r'\bcta\b|\bcall[\s-]*to[\s-]*action\b', re.IGNORECASE),
    'social': re.compile(r'\bsocial\b', re.IGNORECASE),
    'footer': re.compile(r'\bfooter\b', re.IGNORECASE),
}

_HEADLINE_PATTERN = re.compile(r'\bfor\s+(?:an?\s+)?(.{3,60}?)(?:\s+with\b|\s+that\b|[.!?]|$)', re.IGNORECASE)


def _extract_headline(text):
    """A short, literal phrase from the user's OWN brief ("summer sale")
    to use as the hero headline — never fabricated. Bounded to a short
    capture (<=60 chars) with no sentence-ending punctuation, so a run-on
    brief never leaks an entire paragraph into a headline field (which
    would in any case be rejected by _clean_text_value's 200-char cap and
    is additionally re-trimmed here for a sane headline length)."""
    match = _HEADLINE_PATTERN.search(text)
    if not match:
        return None
    phrase = match.group(1).strip().strip('"\'').strip()
    if not phrase or len(phrase) > 60:
        return None
    return phrase[0].upper() + phrase[1:] if phrase else None


def interpret_brief(text):
    """Bounded deterministic brief -> (pattern_key, label, headline) or
    None if `text` is not recognizably an email-composition request at
    all (so the caller can fall through to the normal command router).
    Scoring is simple keyword-hit counting per pattern — the highest-
    scoring pattern with at least one hit wins; ties break toward the
    pattern listed first in PATTERNS (dict insertion order, stable)."""
    if not text or not _COMPOSE_VERB_PATTERN.search(text):
        return None

    best_key, best_score = None, 0
    for key, (_builder, _label, pattern) in PATTERNS.items():
        score = len(pattern.findall(text))
        if score > best_score:
            best_key, best_score = key, score

    # A composition request must EITHER say "...email..." explicitly OR
    # already match one of the named-pattern keywords (a bare "newsletter"/
    # "promotional"/etc. request unambiguously means an email in this
    # builder — every curated pattern IS an email pattern) — never treat
    # an unrelated "create a button" as a composition request.
    if best_key is None and not _EMAIL_WORD_PATTERN.search(text):
        return None

    # No specific pattern keyword matched, but the message is still
    # clearly "create/build ... email" — degrade to the simplest, safest
    # curated pattern rather than refusing outright.
    if best_key is None:
        best_key = 'announcement'

    headline = _extract_headline(text)
    return best_key, PATTERNS[best_key][1], headline


def build_composition(pattern_key, headline=None, extra_sections=None):
    """Builds the ordered CompositionItem list for one pattern, then adds
    any explicitly-requested section from `extra_sections` (a set of
    _SECTION_SIGNALS keys) that the base pattern didn't already include —
    see interpret_brief/detect_sections. Returns [] if the pattern key is
    unknown (never raises)."""
    entry = PATTERNS.get(pattern_key)
    if not entry:
        return []
    builder = entry[0]
    items = [item for item in builder(headline) if item is not None]

    if extra_sections:
        present_types = {item.module_type for item in items}
        present_families = _families_present(present_types)
        if 'social' in extra_sections and 'social' not in present_families:
            extra = _social_item()
            if extra:
                items.insert(max(0, len(items) - 1), extra)
        if 'cta' in extra_sections and 'cta' not in present_families:
            extra = _module_item('cta-centered', 'button')
            if extra:
                items.insert(max(0, len(items) - 1), extra)
        if 'products' in extra_sections and 'products' not in present_families:
            extra = _module_item('product-three-cards', 'product-two-cards', 'product-single')
            if extra:
                items.insert(max(1, len(items) - 1), extra)
        if 'hero' in extra_sections and 'hero' not in present_families:
            extra = _module_item('hero-image-cta', 'hero-centered-promo', 'hero-text-only')
            if extra:
                items.insert(min(1, len(items)), extra)
        if 'preheader' in extra_sections and 'header' in present_families and _exists('header-preheader-logo'):
            # Upgrade whichever header slot the base pattern picked to the
            # preheader-carrying variant, rather than adding a second
            # header module.
            for index, item in enumerate(items):
                if item.module_type.startswith('header') and item.module_type != 'header-preheader-logo':
                    items[index] = CompositionItem('header-preheader-logo')
                    break

    return items[:MAX_COMPOSITION_ITEMS]


def _families_present(module_types):
    families = set()
    for module_type in module_types:
        if module_type.startswith('header'):
            families.add('header')
        elif module_type.startswith('hero'):
            families.add('hero')
        elif module_type.startswith('product'):
            families.add('products')
        elif module_type.startswith('cta') or module_type == 'button':
            families.add('cta')
        elif module_type.startswith('social'):
            families.add('social')
        elif module_type.startswith('footer'):
            families.add('footer')
    return families


def detect_sections(text):
    """The bounded set of _SECTION_SIGNALS keys explicitly mentioned in
    the brief — used by build_composition to layer extra sections onto
    the chosen base pattern (see that function's docstring)."""
    return {key for key, pattern in _SECTION_SIGNALS.items() if pattern.search(text)}


def compose_from_brief(text):
    """The single entry point ai_command.py calls: text -> a list of
    CompositionItem dicts ready to embed in a COMPOSE_EMAIL action, or
    None if `text` is not a composition request. Never raises."""
    interpreted = interpret_brief(text)
    if interpreted is None:
        return None
    pattern_key, label, headline = interpreted
    sections = detect_sections(text)
    items = build_composition(pattern_key, headline=headline, extra_sections=sections)
    if not items:
        return None
    return {
        'pattern_key': pattern_key,
        'pattern_label': label,
        'items': [item.to_dict() for item in items],
    }

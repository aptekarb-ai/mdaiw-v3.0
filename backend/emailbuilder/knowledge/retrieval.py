"""R4-B2 §13 — Local Email Engineering Knowledge retrieval.

rules.py already holds a large, curated, structured knowledge base (60
rules as of R4-B2 — see its own module docstring). Until now the ONLY
consumer was ai_command.py's deterministic "explain this issue" intent,
which looks up ONE rule by id. Every AI provider (openai/local) instead
relied on a single large, static system-prompt string for domain
knowledge — the same text on every single request, regardless of what
the user actually asked about.

This module is the missing piece: a small, deterministic, keyword-scored
retrieval function that selects a BOUNDED, RELEVANT subset of rules for
one specific request, so a provider's system context grows with what the
conversation actually needs instead of the whole knowledge base being
dumped into every prompt (the spec's own explicit requirement — "Do not
dump the entire knowledge base into every request").

Pure, synchronous, entirely local — no embeddings, no vector store, no
network call, no third-party NLP dependency. Scoring is plain keyword/
tag overlap, which is enough at this knowledge-base size (60 rules) and
keeps the "entirely local" guarantee trivially true — see the module's
own test file for the precision/exclusion cases this must satisfy.
"""

import re

from .rules import KNOWLEDGE_RULE_CATEGORIES, load_rules

# A rule must clear this score before it is ever returned — prevents an
# unrelated rule from being injected just because it shares one common
# word with the user's message. Set so that ONE match against a rule's
# curated `concerns` tag (weight 3, see _score_rule) is enough on its
# own, but generic description-prose overlap (weight 1 per word) needs
# at least 3 separate shared words to clear the same bar — a single
# incidental shared word (e.g. "design", "become") can never alone
# surface an unrelated rule. Tuned against retrieval_test.py's precision/
# exclusion cases.
_MIN_SCORE = 3

# Hard caps — the actual defense against "dump the whole knowledge base"
# regardless of how the message scores. max_chars bounds the SERIALIZED
# size of what gets injected (title + truncated description per rule),
# not just the count, since a single very long description could still
# blow the budget with only 1-2 rules.
DEFAULT_MAX_RULES = 4
DEFAULT_MAX_CHARS = 1400
_DESCRIPTION_PREVIEW_CHARS = 260

_WORD_RE = re.compile(r'[a-z0-9]+')

# Words too common to be a meaningful topical signal on their own —
# excluded from scoring so a message like "the email looks wrong" does
# not spuriously match every rule that happens to contain "email".
_STOPWORDS = frozenset({
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of',
    'in', 'on', 'for', 'and', 'or', 'it', 'its', 'i', 'you', 'we', 'my', 'our', 'your', 'me', 'us', 'not',
    'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'with', 'without', 'have', 'has', 'had',
    'email', 'builder', 'make', 'looks', 'look', 'like', 'why', 'what', 'how', 'please', 'help', 'want',
    'become', 'became', 'design', 'way', 'correctly', 'issue', 'issues', 'need', 'needs', 'work', 'works',
    'get', 'got', 'still', 'here', 'there', 'now', 'also', 'about', 'more', 'than', 'just', 'use', 'used',
    'using', 'section', 'version', 'keep', 'unchanged', 'desktop', 'tighter', 'closer', 'feels', 'feel',
})


def _tokens(text):
    return {word for word in _WORD_RE.findall((text or '').lower()) if word not in _STOPWORDS and len(word) > 2}


# Context signals: which KnowledgeRule.concerns / .category values a
# given piece of already-whitelisted request context implies are
# relevant, even if the user's own wording never uses the matching
# keyword. Each context signal contributes the SAME weight as one
# message-keyword hit, added on top of it — never a replacement for
# actual topical scoring, so an unrelated concern never wins purely off
# platform metadata.
_PLATFORM_CONCERN_HINTS = {
    'sfmc': ('ampscript', 'personalization', 'esp-platform'),
    'marketo': ('personalization', 'esp-platform'),
    'hubspot': ('personalization', 'esp-platform'),
    'pardot': ('personalization', 'esp-platform'),
}

_VALIDATION_CATEGORY_CONCERN_HINTS = {
    'accessibility': ('accessibility',),
    'outlook': ('vml', 'mso-properties', 'rendering-engine'),
    'dark-mode': ('dark-mode',),
    'responsive': ('responsive', 'media-queries', 'width'),
    'images': ('images', 'background-images'),
    'links': ('links',),
}


def _score_rule(rule, message_tokens, context_concern_hints):
    # Weighted by WHERE the overlap is, not just that it exists: a
    # curated concern-tag word (e.g. "vml", "contrast", "ampscript") is a
    # far stronger topical signal than an incidental word shared with the
    # rule's long-form description prose — see _MIN_SCORE's own
    # reasoning for why this specific weighting was chosen.
    concern_tokens = _tokens(' '.join(rule.concerns).replace('-', ' '))
    title_tokens = _tokens(rule.title)
    description_tokens = _tokens(rule.description)

    score = 3 * len(message_tokens & concern_tokens)
    score += 2 * len(message_tokens & title_tokens)
    score += len(message_tokens & description_tokens)
    if rule.concerns and (set(rule.concerns) & context_concern_hints):
        score += 3
    return score


def retrieve_relevant_knowledge(
    message, context=None, max_rules=DEFAULT_MAX_RULES, max_chars=DEFAULT_MAX_CHARS,
):
    """Returns a bounded, ranked list of small dicts
    ({'id', 'title', 'description'}) — never a raw KnowledgeRule, never
    the full description (truncated to _DESCRIPTION_PREVIEW_CHARS),
    never more than max_rules entries or max_chars of combined
    title+description text. `context` is the SAME already-whitelisted
    safe_context dict _build_safe_context builds for a provider (never
    the raw, un-validated request context) — only `platform` and
    `selected_validation_issue.category` are read from it here, both
    already bounded/type-checked upstream.

    Zero-result is a normal, expected outcome (e.g. a pure module-
    mutation command like "add a button" has no matching knowledge) —
    callers must treat an empty list as "inject nothing," never as an
    error."""
    message_tokens = _tokens(message)

    context = context if isinstance(context, dict) else {}
    concern_hints = set()
    platform = context.get('platform')
    if isinstance(platform, str):
        concern_hints |= set(_PLATFORM_CONCERN_HINTS.get(platform.lower(), ()))
    issue = context.get('selected_validation_issue')
    if isinstance(issue, dict) and isinstance(issue.get('category'), str):
        concern_hints |= set(_VALIDATION_CATEGORY_CONCERN_HINTS.get(issue['category'], ()))

    if not message_tokens and not concern_hints:
        return []

    scored = []
    for rule in load_rules():
        score = _score_rule(rule, message_tokens, concern_hints)
        if score >= _MIN_SCORE:
            scored.append((score, rule))

    # Stable, deterministic ordering: highest score first, ties broken by
    # rule id (never insertion order alone, which would make ties depend
    # on _RULES's authoring sequence rather than something reproducible
    # and testable).
    scored.sort(key=lambda pair: (-pair[0], pair[1].id))

    selected = []
    total_chars = 0
    for _score, rule in scored:
        if len(selected) >= max_rules:
            break
        description = rule.description.strip()
        if len(description) > _DESCRIPTION_PREVIEW_CHARS:
            description = description[:_DESCRIPTION_PREVIEW_CHARS].rstrip() + '…'
        entry = {'id': rule.id, 'title': rule.title, 'description': description}
        entry_chars = len(entry['title']) + len(entry['description'])
        if selected and total_chars + entry_chars > max_chars:
            break
        selected.append(entry)
        total_chars += entry_chars

    return selected


# Defensive, import-time-cheap sanity check: every category the hint
# table above references must be a real KnowledgeRule category (the two
# taxonomies are meant to be the same set — see rules.py's own module
# docstring), so a typo here fails loudly at import rather than silently
# never matching.
for _hint_key in _VALIDATION_CATEGORY_CONCERN_HINTS:
    if _hint_key not in KNOWLEDGE_RULE_CATEGORIES:
        raise AssertionError(f'retrieval.py hint key {_hint_key!r} is not a real KnowledgeRule category')

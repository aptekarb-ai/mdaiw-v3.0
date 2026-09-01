"""R4-B3 §A — language-independent canonical intent detection.

Internal builder actions (ActionType in ai_command.py) are already
language-neutral strings (INSERT_MODULE, UPDATE_MODULE_PROPS, ...) — this
module adds the layer ABOVE that: recognizing WHAT the user wants
(a small, fixed vocabulary of CanonicalIntent values) independently of
WHICH language they asked in.

    user message (any language)
            |
            v
    detect_language()            -- heuristic, local, no network
            |
            v
    normalize_intent()           -- keyword/phrase match per language
            |
            v
    CanonicalIntent | None, confidence, language

This NEVER duplicates ActionType or RuleBasedEmailCommandProvider's own
English-language pattern matching — see canonical_intent_to_action_type()
for the (intentionally small) set of canonical intents wired all the way
through to a real deterministic execution today. For every other
canonical intent, detection alone is still useful: it is attached to the
context sent to the LLM tiers (see ai_command_local.py/
ai_command_openai.py's own docstrings) as a same-language-independent
hint, so a non-English message gets grounded reasoning even when Tier 0
has no matching branch for it.

A local model's actual multilingual generation quality depends on which
model is configured — this module never promises translation quality;
it only recognizes a bounded phrase vocabulary for the intents listed
below, in the languages listed below. Anything outside that vocabulary
returns (None, 0.0, detected_language) — normalize_intent() failing to
recognize an intent is the expected, common case for most messages, not
an error.
"""

import re
import unicodedata


# R4-D Checkpoint D1-C — accent-insensitive matching for Spanish/French
# phrase lists ONLY (never English or Hindi — Hindi has no equivalent
# diacritic-omission convention, and English's phrase list has no
# accented characters to begin with). Real-world es/fr typing routinely
# drops accents (mobile keyboards, casual typing, ASCII-only input
# methods) — "mas" for "más", "securite" for "sécurité" — and this
# module's phrase matching is plain substring comparison, which would
# otherwise treat those as completely different text. NFKD-decompose
# and drop combining marks (never a language-specific lookup table) —
# a well-known, dependency-free technique; the phrase table itself stays
# written WITH proper accents (readable, matches how a developer or a
# real user who DOES type accents would write it) and is folded at
# match time, same as the haystack.
def _fold_accents(text):
    return ''.join(ch for ch in unicodedata.normalize('NFKD', text) if not unicodedata.combining(ch))


class CanonicalIntent:
    FIX_CONTRAST = 'FIX_CONTRAST'
    SET_LINK = 'SET_LINK'
    CHANGE_SPACING = 'CHANGE_SPACING'
    CHANGE_ALIGNMENT = 'CHANGE_ALIGNMENT'
    SET_BACKGROUND = 'SET_BACKGROUND'
    ENABLE_OUTLOOK_FALLBACK = 'ENABLE_OUTLOOK_FALLBACK'
    EXPLAIN_VALIDATION_ISSUE = 'EXPLAIN_VALIDATION_ISSUE'
    COMPARE_IMPORT_RECONSTRUCTION = 'COMPARE_IMPORT_RECONSTRUCTION'
    CHANGE_COLUMN_RATIO = 'CHANGE_COLUMN_RATIO'
    SET_IMAGE = 'SET_IMAGE'
    # R4-D Checkpoint D1 — the entry-point/dispatch intent for "fix
    # everything/whatever you safely can", "make it closer to the
    # original", etc. Named to match COMPARE_IMPORT_RECONSTRUCTION's own
    # existing convention exactly (same IMPORT_RECONSTRUCTION domain
    # suffix; COMPARE=explain-only, IMPROVE=repair-request) rather than
    # inventing an unrelated naming style. Its own executor (see
    # ai_command.py's compute_improve_reconstruction_result) NEVER
    # mutates the EDM — it cannot: this backend request only ever
    # carries the bounded `import_reconstruction` summary (fidelity
    # categories), never the live module tree or the raw source HTML,
    # so it structurally has nothing to build a real repair candidate
    # from. Real candidate generation/Apply stays 100% where R4-C built
    # it — frontend-only (reconstructionCorrectionLoop.ts) — this intent
    # exists so a message that reaches the BACKEND (a language/phrasing
    # the frontend's own local matcher doesn't catch) still gets an
    # honest, reconstruction-aware answer instead of a generic non-reply
    # or, worse, a wrong mutation attempt.
    IMPROVE_IMPORT_RECONSTRUCTION = 'IMPROVE_IMPORT_RECONSTRUCTION'

    values = frozenset({
        FIX_CONTRAST, SET_LINK, CHANGE_SPACING, CHANGE_ALIGNMENT, SET_BACKGROUND, ENABLE_OUTLOOK_FALLBACK,
        EXPLAIN_VALIDATION_ISSUE, COMPARE_IMPORT_RECONSTRUCTION, CHANGE_COLUMN_RATIO, SET_IMAGE,
        IMPROVE_IMPORT_RECONSTRUCTION,
    })


SUPPORTED_LANGUAGES = ('en', 'hi', 'es', 'fr')

# Unicode block check — cheap, dependency-free, unambiguous for Hindi
# specifically (no other supported language uses Devanagari script).
_DEVANAGARI_RE = re.compile(r'[ऀ-ॿ]')

# Small, curated stopword sets — enough to distinguish en/es/fr on
# ordinary sentences without a language-detection library or network
# call. Not exhaustive; a message matching none of these (and containing
# no Devanagari) defaults to 'en', the same default every provider's
# system prompt already assumes.
_LANGUAGE_STOPWORDS = {
    'es': frozenset({
        'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'para', 'con', 'por', 'como', 'más', 'este',
        'esta', 'ese', 'esa', 'y', 'es', 'son', 'está', 'están', 'haz', 'hazlo', 'cambia', 'arregla',
    }),
    'fr': frozenset({
        'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'que', 'pour', 'avec', 'par', 'comme', 'plus', 'ce',
        'cette', 'ces', 'et', 'est', 'sont', 'fais', 'corrige', 'répare',
        # R4-D Checkpoint D1-C — added for a real, verified detect_language
        # miss: "rapproche ceci de l'original" scored an ES/FR TIE on
        # 'de' alone (both stopword sets contain it) and Python's max()
        # picks the first dict entry on a tie ('es' is defined first) —
        # 'ceci'/'cela'/'toi'/'peux' are unambiguous French-only words
        # (never Spanish) that give genuinely French sentences enough
        # additional signal to win that tie honestly, not by ordering.
        'ceci', 'cela', 'toi', 'peux',
        # NOTE: deliberately excludes 'change' — an English/French
        # homograph (the French verb stem and the English noun/verb
        # spell identically) that would otherwise misclassify an
        # ordinary English "change the X" command as French.
    }),
}


def detect_language(text):
    """Best-effort, local-only heuristic — never a claim of general
    language-ID accuracy. Returns one of SUPPORTED_LANGUAGES, defaulting
    to 'en' whenever the input doesn't clearly indicate otherwise
    (matches every provider's own system-prompt assumption)."""
    if not isinstance(text, str) or not text.strip():
        return 'en'
    if _DEVANAGARI_RE.search(text):
        return 'hi'
    words = set(re.findall(r"[a-zàâäéèêëïîôöùûüç']+", text.lower()))
    scores = {lang: len(words & stops) for lang, stops in _LANGUAGE_STOPWORDS.items()}
    best_lang, best_score = max(scores.items(), key=lambda item: item[1])
    return best_lang if best_score > 0 else 'en'


# Phrase vocabulary per canonical intent, per language. Deliberately
# SMALL and bounded — see the module docstring. Every phrase is matched
# as a substring against the lowercased message (Hindi is matched
# without lowercasing, since Devanagari has no case) — simple, local,
# fast, and sufficient for a fixed, curated vocabulary this size (no NLP
# library, no network call, no ML model).
_INTENT_PHRASES = {
    CanonicalIntent.FIX_CONTRAST: {
        'en': ('fix contrast', 'fix the contrast', 'weak contrast', 'low contrast', 'improve readability', 'hard to read'),
        'hi': ('कंट्रास्ट ठीक करो', 'कंट्रास्ट सुधारो', 'पढ़ने में मुश्किल'),
        'es': ('arregla el contraste', 'corrige el contraste', 'contraste bajo', 'difícil de leer'),
        'fr': ('corrige le contraste', 'répare le contraste', 'contraste faible', 'difficile à lire'),
    },
    CanonicalIntent.SET_LINK: {
        'en': ('set the link', 'change the link', 'update the url', 'set the url', 'fix the link'),
        'hi': ('लिंक बदलो', 'लिंक सेट करो', 'यूआरएल बदलो'),
        'es': ('cambia el enlace', 'establece el enlace', 'actualiza la url', 'arregla el enlace'),
        'fr': ('change le lien', 'définis le lien', 'mets à jour le lien', 'répare le lien'),
    },
    CanonicalIntent.CHANGE_SPACING: {
        'en': ('change the spacing', 'change the padding', 'more padding', 'less padding', 'change the gutter'),
        'hi': ('स्पेसिंग बदलो', 'पैडिंग बदलो'),
        'es': ('cambia el espaciado', 'cambia el relleno', 'más espacio', 'menos espacio'),
        'fr': ('change l\'espacement', 'change le remplissage', 'plus d\'espace', 'moins d\'espace'),
    },
    CanonicalIntent.CHANGE_ALIGNMENT: {
        'en': ('center it', 'center this', 'align left', 'align right', 'change the alignment'),
        # 'बीच में' ("in the middle/center") alone, not tied to one verb
        # conjugation (करो/करें/करना/...) — R4-B4 §4's own worked example
        # uses "करें" (polite), an earlier draft used "करो" (informal);
        # matching the noun phrase, not the verb, covers both and any
        # other conjugation a real user might type.
        'hi': ('बीच में', 'संरेखण बदलो'),
        'es': ('céntralo', 'alinea a la izquierda', 'alinea a la derecha', 'cambia la alineación'),
        'fr': ('centre-le', 'aligne à gauche', 'aligne à droite', 'change l\'alignement'),
    },
    CanonicalIntent.SET_BACKGROUND: {
        'en': ('set the background', 'change the background', 'background color', 'background image'),
        'hi': ('बैकग्राउंड बदलो', 'पृष्ठभूमि बदलो'),
        'es': ('cambia el fondo', 'color de fondo', 'imagen de fondo'),
        'fr': ('change le fond', 'couleur de fond', 'image de fond'),
    },
    CanonicalIntent.ENABLE_OUTLOOK_FALLBACK: {
        'en': ('outlook fallback', 'work in outlook', 'fix outlook', 'enable vml', 'classic outlook'),
        'hi': ('आउटलुक में ठीक करो', 'वीएमएल चालू करो'),
        'es': ('funcionar en outlook', 'arregla outlook', 'habilita vml'),
        'fr': ('fonctionner dans outlook', 'corrige outlook', 'active vml'),
    },
    CanonicalIntent.EXPLAIN_VALIDATION_ISSUE: {
        'en': ('explain this issue', 'what is wrong', 'why is this failing', 'explain the problem'),
        'hi': ('यह समस्या समझाओ', 'क्या गलत है'),
        'es': ('explica este problema', 'qué está mal', 'por qué falla'),
        'fr': ('explique ce problème', 'qu\'est-ce qui ne va pas', 'pourquoi ça échoue'),
    },
    CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION: {
        # English phrases deliberately include the R4-B3 spec's own §F
        # example questions verbatim (as substrings) — "What changed
        # during import?", "Why is this 40/60 instead of 38/62?",
        # "Which differences can you fix?", "Why was this removed?",
        # "Can the builder reproduce this exactly?", "Why doesn't this
        # look like the original?", "What was normalized?", "What was
        # removed for security?", "Can you make this section closer to
        # the original?" — every one of those must classify as this
        # canonical intent, proven by test_reconstruction_conversation.py.
        'en': (
            'what changed during import', 'compare to the original', 'compare to the imported',
            'closer to the original', 'why is this different from the import', '40/60', '38/62',
            'which differences can you fix', 'why was this removed', 'reproduce this exactly',
            'reproduced exactly', 'look like the original', 'what was normalized',
            'removed for security', 'closer to the imported',
        ),
        'hi': ('इंपोर्ट के दौरान क्या बदला', 'मूल से तुलना करो'),
        'es': ('qué cambió al importar', 'compara con el original', 'más cerca del original'),
        'fr': ('qu\'est-ce qui a changé à l\'importation', 'compare à l\'original', 'plus proche de l\'original'),
    },
    CanonicalIntent.CHANGE_COLUMN_RATIO: {
        'en': ('change the column ratio', 'change the column width', 'make the columns', 'column split'),
        'hi': ('कॉलम अनुपात बदलो', 'कॉलम की चौड़ाई बदलो'),
        'es': ('cambia la proporción de columnas', 'cambia el ancho de columna'),
        'fr': ('change le ratio des colonnes', 'change la largeur des colonnes'),
    },
    CanonicalIntent.SET_IMAGE: {
        'en': ('set the image', 'change the image', 'update the image', 'replace the image'),
        'hi': ('इमेज बदलो', 'तस्वीर बदलो'),
        'es': ('cambia la imagen', 'actualiza la imagen', 'reemplaza la imagen'),
        'fr': ('change l\'image', 'mets à jour l\'image', 'remplace l\'image'),
    },
    # R4-D Checkpoint D1-B/D1-D — every phrase here is an ACTION/REQUEST
    # (never a question — see is_explanation_seeking() below, which is
    # what actually keeps these from ever colliding with
    # COMPARE_IMPORT_RECONSTRUCTION's own overlapping vocabulary like
    # "closer to the original"/"look like the original"; the two phrase
    # lists are allowed to share wording precisely BECAUSE the
    # explanation/action bipartition gate decides which list is even
    # attempted, not the wording itself). Covers D1's own required exact
    # phrases: "fix everything/whatever you safely can", "fix the
    # remaining safe differences", "make the reconstruction closer to
    # the source", "make this look like the imported email", "make this
    # button look like the original", "look like the original" (bare).
    CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION: {
        'en': (
            'fix everything you safely can', 'fix whatever you safely can', 'fix everything you can',
            'fix this safely', 'repair what you can', 'fix all the safe', 'fix the remaining safe',
            'fix the remaining differences', 'fix the remaining issues', 'fix the remaining problems',
            'make this closer to the original', 'make it closer to the original',
            'make the reconstruction closer to the source', 'make this closer to the source',
            'make it closer to the source', 'make this look like the imported email',
            'make this look like the original', 'make this button look like the original',
            'improve the reconstruction', 'look like the original', 'look like the imported',
        ),
        'hi': (
            'जो सुरक्षित रूप से ठीक कर सको वो ठीक करो', 'सब कुछ ठीक करो', 'बाकी बची सुरक्षित समस्याएं ठीक करो',
            'इसे मूल जैसा बनाओ', 'इसे इंपोर्ट किए गए जैसा बनाओ',
        ),
        'es': (
            'arregla todo lo que puedas de forma segura', 'arregla lo que puedas de forma segura',
            'arregla las diferencias seguras restantes', 'hazlo más parecido al original',
            'hazlo más cercano al original', 'hazlo parecido al correo importado',
            'mejora la reconstrucción',
        ),
        'fr': (
            'corrige tout ce que tu peux corriger en toute sécurité', 'corrige ce que tu peux corriger en toute sécurité',
            'corrige les différences sûres restantes', 'rapproche ceci de l\'original',
            'rapproche ceci de la source', 'fais en sorte que cela ressemble à l\'e-mail importé',
            'améliore la reconstruction',
        ),
    },
}

# R4-D Checkpoint D1-A — the explanation/action bipartition. An
# "explanation-seeking" utterance (question OR "explain X"/"tell me
# about X") is checked ONLY against _EXPLANATION_INTENTS' phrase lists;
# everything else is checked ONLY against _ACTION_INTENTS' phrase lists
# (EXPLAIN_VALIDATION_ISSUE/COMPARE_IMPORT_RECONSTRUCTION are never
# reachable from an imperative sentence, and FIX_CONTRAST/.../
# IMPROVE_IMPORT_RECONSTRUCTION are never reachable from a genuine
# question) — see is_explanation_seeking()'s own docstring for exactly
# why this, not phrase-list wording, is what disambiguates overlapping
# vocabulary like "closer to the original" appearing in both an explain
# question ("why isn't this closer to the original?") and a repair
# request ("make this closer to the original").
_EXPLANATION_INTENTS = frozenset({
    CanonicalIntent.EXPLAIN_VALIDATION_ISSUE, CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION,
})
_ACTION_INTENTS = frozenset({
    CanonicalIntent.FIX_CONTRAST, CanonicalIntent.SET_LINK, CanonicalIntent.CHANGE_SPACING,
    CanonicalIntent.CHANGE_ALIGNMENT, CanonicalIntent.SET_BACKGROUND, CanonicalIntent.ENABLE_OUTLOOK_FALLBACK,
    CanonicalIntent.CHANGE_COLUMN_RATIO, CanonicalIntent.SET_IMAGE, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION,
})

# A polite ACTION request ("Can you make this...", "Could you fix...")
# must NOT be treated as explanation-seeking despite starting with a
# question word — this is the one deliberate carve-out. Anchored at the
# START of the message (never a bare mid-sentence substring check) so a
# genuine capability QUESTION like "Which differences can you fix?" or
# "Can the builder reproduce this exactly?" (neither starts with
# "can/could/would YOU") is correctly left alone and still classified as
# explanation-seeking by the broader check below.
_POLITE_REQUEST_RE = {
    'en': re.compile(
        r'^\s*(can|could|would)\s+you\s+(make|fix|repair|correct|improve|change|set|use|update|give|center|align|keep|preserve)\b',
        re.IGNORECASE,
    ),
    'hi': re.compile(r'^\s*(क्या\s+)?(आप|तुम)\s+.{0,12}(ठीक|सुधार|बदल|बना)\s*(सकते|सकती|सकता)?\s*(हो|हैं)?\b'),
    'es': re.compile(
        r'^\s*¿?\s*(puedes|podrías|podrias)\s+(hacer|arreglar|corregir|mejorar|cambiar|usar)\b',
        re.IGNORECASE,
    ),
    'fr': re.compile(
        r'^\s*(peux|pourrais)[-\s]tu\s+(faire|réparer|corriger|améliorer|changer|utiliser)\b'
        r'|^\s*peux[-\s]tu\b',
        re.IGNORECASE,
    ),
}

# Genuine explanation-seeking: a question-word opener, "explain"/"tell
# me about" (imperative in form but explanation-seeking in intent — same
# concept ai_command.py's own long-standing _EXPLAIN_PATTERN already
# captured for the general knowledge-base lookup; this supersedes that
# ONE for canonical-intent purposes, never removes it), or the message
# simply ends with a question mark (catches phrasings no fixed prefix
# list can fully enumerate, e.g. "Can the builder reproduce this
# exactly?").
_EXPLANATION_SEEKING_RE = {
    # 'can'/'could'/'does'/'is'/'are'/'was'/'were' are all safe to
    # include as prefix openers HERE (unlike a bare mid-sentence check)
    # precisely because _POLITE_REQUEST_RE above is checked FIRST and
    # already carves out the one real ambiguity ("Can you make/fix/...")
    # — "can THE BUILDER reproduce this exactly" (no "you", a genuine
    # capability question, not a request) still correctly reaches this
    # broader check and is recognized even without a trailing '?'.
    'en': re.compile(r'^\s*(why|what|how|can|could|does|is|are|was|were)\b|\b(explain|tell\s+me\s+about)\b|\?\s*$', re.IGNORECASE),
    'hi': re.compile(r'क्यों|क्या|कैसे|समझाओ|समझाइए|\?\s*$'),
    # Deliberately requires the ACCENTED 'qué'/'cómo' — the unaccented
    # forms ('que'/'como') are extremely common non-interrogative words
    # in Spanish (the relative pronoun "that/which", and "as/like"
    # respectively — e.g. "arregla todo LO QUE puedas" / "hazlo COMO el
    # original" are ordinary imperative sentences, not questions) and
    # would otherwise false-trigger explanation-seeking on a huge
    # fraction of perfectly normal repair REQUESTS. The trade-off: a
    # genuine Spanish question that both omits the accent AND lacks a
    # trailing '?' loses this specific signal — the '?'-ending check
    # below still catches the large majority of real questions.
    'es': re.compile(r'^\s*¿|\bpor\s+qué\b|\bqué\b|\bcómo\b|\bexplica\b|\?\s*$', re.IGNORECASE),
    'fr': re.compile(r'\bpourquoi\b|\bqu\'est-ce\b|\bcomment\b|\bexplique\b|\?\s*$', re.IGNORECASE),
}


# R4-D Checkpoint D1-D — a small, targeted semantic normalization,
# never a growing pile of entire-sentence regexes: strips a generic
# TARGET NOUN standing between "this/it/the" and a similarity verb
# ("closer"/"look"/"match"/"resemble") so "make THIS SECTION closer to
# the original" and "make this closer to the original" reach the SAME
# IMPROVE_IMPORT_RECONSTRUCTION phrase. Deliberately narrow — only the
# handful of generic structural nouns a user might reasonably name
# ("section", "module", "element", "button"/"cta", "part", "area"), never
# a content word like "image"/"link"/"background" that could change
# which OTHER intent's phrase should legitimately match instead. Applied
# ONLY when checking IMPROVE_IMPORT_RECONSTRUCTION's own phrases below —
# never mutates `haystack` for any other intent's matching.
_TARGET_NOUN_RE = {
    'en': re.compile(r'\b(this|it|the)\s+(section|module|element|button|cta|part|area|region)\b', re.IGNORECASE),
}


def _normalize_target_noun(haystack, language):
    pattern = _TARGET_NOUN_RE.get(language)
    if pattern is None:
        return haystack
    return pattern.sub(r'\1', haystack)


def is_explanation_seeking(text, language='en'):
    """True if `text` is asking a question or requesting an explanation
    — even one that happens to share words with an action intent's own
    phrase list ("change", "fix", "background", "closer to the
    original"). False for a polite ACTION request ("Can you make this
    blue?", "Can you fix everything safely?") despite starting with a
    question word — see _POLITE_REQUEST_RE's own docstring. `language`
    should come from detect_language(text); defaults to 'en' for a
    caller that hasn't detected it yet (e.g. a quick standalone check)."""
    text = (text or '').strip()
    if not text:
        return False
    text = text.replace(chr(8217), "'").replace(chr(8216), "'")
    polite = _POLITE_REQUEST_RE.get(language, _POLITE_REQUEST_RE['en'])
    if polite.search(text):
        return False
    pattern = _EXPLANATION_SEEKING_RE.get(language, _EXPLANATION_SEEKING_RE['en'])
    return bool(pattern.search(text))

# R4-B4 §1 — every canonical intent now has a real Tier-0 executor (see
# ai_command.py's apply_canonical_intent()). Kept as an explicit
# allow-list (not "all of CanonicalIntent.values") on purpose: a future
# canonical intent added to the enum without a matching executor must
# fail this checkpoint's own tests (test_intent_normalization.py) rather
# than silently claim coverage it doesn't have.
EXECUTABLE_INTENTS = frozenset({
    CanonicalIntent.FIX_CONTRAST, CanonicalIntent.SET_LINK, CanonicalIntent.CHANGE_SPACING,
    CanonicalIntent.CHANGE_ALIGNMENT, CanonicalIntent.SET_BACKGROUND, CanonicalIntent.ENABLE_OUTLOOK_FALLBACK,
    CanonicalIntent.EXPLAIN_VALIDATION_ISSUE, CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION,
    CanonicalIntent.CHANGE_COLUMN_RATIO, CanonicalIntent.SET_IMAGE, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION,
})

# R4-B4 §4 — a small, bounded, multilingual alignment-word lookup used
# ONLY by CHANGE_ALIGNMENT's canonical-intent executor (never by the
# English deterministic router's own _ALIGN_PATTERN, which is untouched)
# — closes the exact gap the R4-B4 spec's own worked example needs: a
# Hindi "बीच में" ("in the middle"/center) has no English "center"
# substring for the English-only alignment regex to find. Deliberately
# tiny — left/center/right only, matching the manifest's own `align`
# field's value set exactly (never a value validate_action() wouldn't
# also accept from the English path).
ALIGNMENT_WORDS = {
    'en': {
        'left': 'left', 'center': 'center', 'centre': 'center', 'right': 'right', 'middle': 'center',
        'centered': 'center', 'centred': 'center',
    },
    'hi': {'बाएं': 'left', 'बायें': 'left', 'बीच': 'center', 'केंद्र': 'center', 'दाएं': 'right', 'दायें': 'right'},
    'es': {'izquierda': 'left', 'centro': 'center', 'centrado': 'center', 'derecha': 'right'},
    'fr': {'gauche': 'left', 'centre': 'center', 'centré': 'center', 'droite': 'right'},
}


def find_alignment_value(text, language):
    """Returns 'left'/'center'/'right', or None. `language` should come
    from detect_language(text) — passed in rather than re-detected here
    so a caller that already knows the language (e.g. having just called
    normalize_intent()) never pays for a second detection pass. Word-
    boundary matched (never a bare substring check) — "right" must never
    match inside "copyright"/"alright"."""
    words = ALIGNMENT_WORDS.get(language, {})
    haystack = text if language == 'hi' else text.lower()
    for word, value in words.items():
        if re.search(rf'\b{re.escape(word)}\b', haystack):
            return value
    # Always also check English words — a mixed-language message
    # ("इस बटन को left करो") should still resolve.
    if language != 'en':
        lowered = text.lower()
        for word, value in ALIGNMENT_WORDS['en'].items():
            if re.search(rf'\b{re.escape(word)}\b', lowered):
                return value
    return None


def normalize_intent(message):
    """Returns (CanonicalIntent value or None, confidence 0.0-1.0,
    detected language). Confidence is deliberately coarse (0.9 for a
    real phrase match, 0.0 for no match) — this is phrase-vocabulary
    matching, not a probabilistic classifier; a fine-grained score would
    overstate precision it does not have."""
    text = (message or '').strip()
    if not text:
        return None, 0.0, 'en'
    # Normalize curly/smart quotes to straight ones before matching —
    # "doesn't" (U+2019) and "doesn't" (U+0027) must classify identically.
    # Curly quotes (U+2019/U+2018) built via chr(), never as a literal
    # character or a \u-escape in this source file — this deployment
    # environment's Python does not reliably decode a literal multi-byte
    # curly-quote character embedded directly in a .py file (observed:
    # the compiled constant silently became U+FFFD instead of U+2019,
    # even via a ’ escape sequence). chr(8217)/chr(8216) is a pure-
    # ASCII function call in the source bytes, so it is immune to that
    # decoding issue regardless of root cause.
    text = text.replace(chr(8217), "'").replace(chr(8216), "'")
    language = detect_language(text)
    lowered = text.lower()
    haystack = text if language == 'hi' else lowered
    # D1-C — fold accents on the es/fr side of the comparison only (see
    # _fold_accents' own docstring); every phrase compared against this
    # haystack for es/fr is ALSO folded at the point of comparison below,
    # so "más"/"mas" and "sécurité"/"securite" match identically without
    # needing two literal spellings of every phrase in the table.
    if language in ('es', 'fr'):
        haystack = _fold_accents(haystack)
    # R4-D Checkpoint D1-A — the explanation/action bipartition gate.
    # Computed ONCE per message, applied uniformly across every
    # language: an explanation-seeking utterance never even attempts an
    # action intent's phrase list (and vice versa), so property-specific
    # mutation matching structurally cannot fire on a question — see
    # is_explanation_seeking()'s own docstring for the polite-request
    # carve-out that keeps "Can you make it closer to the original?"
    # correctly reaching the action side despite starting with "Can."
    is_explaining = is_explanation_seeking(text, language)
    for intent, by_language in _INTENT_PHRASES.items():
        if is_explaining and intent in _ACTION_INTENTS:
            continue
        if not is_explaining and intent in _EXPLANATION_INTENTS:
            continue
        phrases = by_language.get(language, ())
        # D1-D — only IMPROVE_IMPORT_RECONSTRUCTION's own matching uses
        # the target-noun-stripped haystack; every other intent keeps
        # matching against the exact, unmodified text as before.
        search_space = _normalize_target_noun(haystack, language) if intent == CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION else haystack
        for phrase in phrases:
            needle = phrase if language == 'hi' else phrase.lower()
            if language in ('es', 'fr'):
                needle = _fold_accents(needle)
            if needle in search_space:
                return intent, 0.9, language
    return None, 0.0, language

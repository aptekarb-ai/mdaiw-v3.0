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

    values = frozenset({
        FIX_CONTRAST, SET_LINK, CHANGE_SPACING, CHANGE_ALIGNMENT, SET_BACKGROUND, ENABLE_OUTLOOK_FALLBACK,
        EXPLAIN_VALIDATION_ISSUE, COMPARE_IMPORT_RECONSTRUCTION, CHANGE_COLUMN_RATIO, SET_IMAGE,
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
        'es': ('cambia el enlace', 'establece el enlace', 'actualiza la url'),
        'fr': ('change le lien', 'définis le lien', 'mets à jour le lien'),
    },
    CanonicalIntent.CHANGE_SPACING: {
        'en': ('change the spacing', 'change the padding', 'more padding', 'less padding', 'change the gutter'),
        'hi': ('स्पेसिंग बदलो', 'पैडिंग बदलो'),
        'es': ('cambia el espaciado', 'cambia el relleno', 'más espacio', 'menos espacio'),
        'fr': ('change l\'espacement', 'change le remplissage', 'plus d\'espace', 'moins d\'espace'),
    },
    CanonicalIntent.CHANGE_ALIGNMENT: {
        'en': ('center it', 'center this', 'align left', 'align right', 'change the alignment'),
        'hi': ('बीच में करो', 'संरेखण बदलो'),
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
            'look like the original', 'what was normalized',
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
}

# The subset of canonical intents wired all the way through to a real
# deterministic execution path today (see ai_command.py's
# apply_canonical_intent()) — everything else in CanonicalIntent.values
# is still detected/classified (useful as an LLM-tier hint, see the
# module docstring) but has no direct Tier-0 executor yet. Never claim
# more coverage than this set actually has.
EXECUTABLE_INTENTS = frozenset({CanonicalIntent.FIX_CONTRAST})


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
    for intent, by_language in _INTENT_PHRASES.items():
        phrases = by_language.get(language, ())
        for phrase in phrases:
            needle = phrase if language == 'hi' else phrase.lower()
            if needle in haystack:
                return intent, 0.9, language
    return None, 0.0, language

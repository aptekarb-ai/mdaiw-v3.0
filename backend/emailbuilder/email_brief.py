"""D4-C — EmailBrief construction: the structured, provenance-aware
"what email does the user want" understanding layer that sits between
D4-B's raw ExtractedFact[] (+ the user's chat instruction) and any
future builder-aware construction plan (D4-D+).

Pipeline: user instruction + a document's already-uploaded EmailAttachment
rows -> re-extract each attachment's facts on demand (attachment_extraction.py
— the SAME extractors D4-B already validated; facts are still never
persisted, exactly as D4-B's model docstring documents) -> deterministic
heuristics turn instruction text + facts into an EmailBrief.

Nothing here mutates an EmailDocument, calls validate_action(), or
produces an ActionType — this module has zero import of ai_command.py /
composition.py, mirroring attachment_extraction.py's own no-mutation-
coupling guarantee (see test_email_brief.py's import-graph assertion).

Zero-OpenAI operation: EVERY code path in this module is deterministic —
there is no optional LLM-enrichment tier in this checkpoint. The `source`
field on every BriefValue is therefore always 'deterministic' today; it
carries the 'local_llm'/'openai' values now only so a future checkpoint
can add an enrichment tier without a schema change. See the D4-C
completion report for why that tier was deliberately deferred rather
than half-built this checkpoint.

Untrusted content: every string pulled from an attachment or from the
user's own message is treated as DATA to classify/quote, never as an
instruction to obey. Nothing here executes, evaluates, or branches
program behaviour based on what the text *says* — only on structural
signals (a heading style, a header row position, a URL scheme) that are
identical whether the text is benign or adversarial. A sentence reading
"ignore previous instructions" becomes an ordinary paragraph section's
body text, verbatim, exactly like every other sentence.
"""

import re
from dataclasses import asdict, dataclass, field

from . import attachment_extraction as extraction

# --- provenance / value wrappers --------------------------------------

SOURCE_USER_INSTRUCTION = 'user_instruction'
SOURCE_PDF_PAGE = 'pdf_page'
SOURCE_DOCX_PARAGRAPH = 'docx_paragraph'
SOURCE_DOCX_TABLE = 'docx_table'
SOURCE_XLSX_CELL = 'xlsx_cell'
SOURCE_CSV_ROW = 'csv_row'
SOURCE_MARKDOWN = 'markdown'
SOURCE_TEXT = 'text'
SOURCE_IMAGE_OBSERVATION = 'image_observation'

EXTRACTION_DETERMINISTIC = 'deterministic'
EXTRACTION_LOCAL_LLM = 'local_llm'  # reserved — no code path produces this yet, see module docstring
EXTRACTION_OPENAI = 'openai'  # reserved — no code path produces this yet, see module docstring


@dataclass(frozen=True)
class Provenance:
    source_kind: str
    locator: str
    extraction_method: str = EXTRACTION_DETERMINISTIC

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class BriefValue:
    """One interpreted value with its evidence trail. `confidence` is
    always populated here (unlike attachment_extraction.ExtractedFact,
    where it's usually None) because every BriefValue in this module IS
    an interpretation, not a raw structural fact — confidence is never
    fabricated to look more certain than the heuristic that produced it
    actually was."""

    value: object
    confidence: float
    provenance: tuple[Provenance, ...]
    note: str = ''

    def to_dict(self) -> dict:
        return {
            'value': self.value,
            'confidence': self.confidence,
            'provenance': [p.to_dict() for p in self.provenance],
            'note': self.note,
        }


@dataclass(frozen=True)
class ClarificationRequest:
    field: str
    message: str
    options: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {'field': self.field, 'message': self.message, 'options': list(self.options)}


@dataclass(frozen=True)
class BriefSection:
    role: str
    confidence: float
    content: dict
    provenance: tuple[Provenance, ...]

    def to_dict(self) -> dict:
        return {
            'role': self.role, 'confidence': self.confidence, 'content': self.content,
            'provenance': [p.to_dict() for p in self.provenance],
        }


@dataclass
class EmailBrief:
    version: int
    platform: str
    purpose: BriefValue | None
    audience: BriefValue | None
    subject_suggestions: list[BriefValue]
    preheader_suggestions: list[BriefValue]
    sections: list[BriefSection]
    ctas: list[dict]
    images: list[dict]
    footer: dict | None
    personalization: list[str]
    conflicts: list[dict]
    clarifications: list[ClarificationRequest]
    warnings: list[str]

    def to_dict(self) -> dict:
        return {
            'version': self.version,
            'platform': self.platform,
            'purpose': self.purpose.to_dict() if self.purpose else None,
            'audience': self.audience.to_dict() if self.audience else None,
            'subject_suggestions': [v.to_dict() for v in self.subject_suggestions],
            'preheader_suggestions': [v.to_dict() for v in self.preheader_suggestions],
            'sections': [s.to_dict() for s in self.sections],
            'ctas': self.ctas,
            'images': self.images,
            'footer': self.footer,
            'personalization': self.personalization,
            'conflicts': self.conflicts,
            'clarifications': [c.to_dict() for c in self.clarifications],
            'warnings': self.warnings,
        }


# --- purpose / audience keyword heuristics ----------------------------
# Deliberately small, explicit vocabularies — a miss means "not stated",
# never a guess. Each bucket's FIRST matching keyword is quoted back in
# the note so the confidence is explainable, not a black box.

_PURPOSE_KEYWORDS = {
    'promotional': ('sale', 'discount', '% off', 'promo', 'deal', 'offer', 'shop now', 'limited time'),
    'newsletter': ('newsletter', 'this month', 'roundup', 'digest', 'update from'),
    'welcome': ('welcome', 'thanks for signing up', 'get started', 'onboarding'),
    'transactional': ('order confirmation', 'receipt', 'your order', 'shipping', 'invoice', 'password reset'),
    'event': ('event', 'webinar', 'register now', 'save the date', 'rsvp'),
}

_AUDIENCE_KEYWORDS = {
    'existing customers': ('existing customer', 'loyal customer', 'valued customer', 'returning customer'),
    'new subscribers': ('new subscriber', 'new user', 'just signed up', 'new member'),
    'prospects': ('prospect', 'lead', 'potential customer'),
    'general': ('everyone', 'all subscribers', 'our audience'),
}

_FOOTER_KEYWORDS = ('unsubscribe', 'privacy policy', 'update your preferences', '©', 'copyright', 'all rights reserved')
_PERSONALIZATION_PATTERNS = (
    re.compile(r'\{\{\s*\w+\s*\}\}'),  # {{first_name}}
    re.compile(r'%%\s*\w+\s*%%'),  # %%FirstName%% (AMPscript-flavoured)
    re.compile(r'\[\s*(first\s*name|last\s*name|name)\s*\]', re.IGNORECASE),  # [First Name]
)
_URL_PATTERN = re.compile(r'https?://[^\s)>\]"\']+')
_CTA_TEXT_HINTS = ('shop now', 'buy now', 'learn more', 'get started', 'register', 'sign up', 'view', 'click here', 'read more')

_SUBJECT_LINE_PATTERN = re.compile(r'^\s*subject\s*:\s*(.+)$', re.IGNORECASE)
_PREHEADER_LINE_PATTERN = re.compile(r'^\s*preheader\s*:\s*(.+)$', re.IGNORECASE)

_COLUMN_ALIASES = {
    'name': {'name', 'product', 'product name', 'title', 'item', 'productname'},
    'price': {'price', 'cost', 'amount', 'msrp'},
    'description': {'description', 'desc', 'details', 'summary'},
    'url': {'url', 'link', 'href', 'product url', 'product link', 'producturl'},
    'image_url': {'image', 'image url', 'img', 'photo', 'picture', 'imageurl', 'imagelink'},
    'cta': {'cta', 'button', 'button text', 'action'},
    'category': {'category', 'type', 'tag'},
}


def _normalize_header(header) -> str:
    text = str(header or '').strip().lower()
    return re.sub(r'[_\-]+', ' ', text)


def _map_column_header(header) -> str | None:
    normalized = _normalize_header(header)
    for canonical, aliases in _COLUMN_ALIASES.items():
        if normalized in aliases:
            return canonical
    return None


def _match_keywords(text: str, buckets: dict) -> tuple[str, str, float] | None:
    """Returns (bucket, matched_keyword, confidence) for the FIRST bucket
    with a hit, scanned in the dict's own declared order — deterministic,
    never a fuzzy/ML match."""
    lowered = text.lower()
    for bucket, keywords in buckets.items():
        for keyword in keywords:
            if keyword in lowered:
                return bucket, keyword, 0.6
    return None


def _collect_text_facts(facts: list) -> list[tuple[str, extraction.ExtractedFact, str]]:
    """(text, fact, source_kind) triples for every fact that carries a
    plain string worth scanning for purpose/audience/footer/personalization
    keywords — tables/rows/images are handled by their own dedicated
    collectors below, not here."""
    out = []
    for fact in facts:
        if fact.kind in ('text', 'heading', 'paragraph', 'list_item') and isinstance(fact.value, str):
            out.append((fact.value, fact, _source_kind_for(fact)))
    return out


def _source_kind_for(fact: extraction.ExtractedFact) -> str:
    return {
        'pdf': SOURCE_PDF_PAGE, 'docx': SOURCE_DOCX_PARAGRAPH, 'markdown': SOURCE_MARKDOWN,
        'txt': SOURCE_TEXT, 'csv': SOURCE_CSV_ROW, 'xlsx': SOURCE_XLSX_CELL, 'image': SOURCE_IMAGE_OBSERVATION,
    }.get(fact.source, fact.source)


def _purpose_and_audience(instruction: str, attachment_texts: list[tuple[str, extraction.ExtractedFact, str]]):
    """Runs the SAME heuristic independently against the instruction and
    against attachment text, never blending them into one guess — if
    they disagree, that disagreement is a real conflict the user must
    resolve, not something this module is allowed to silently pick a
    winner for."""
    instruction_purpose = _match_keywords(instruction, _PURPOSE_KEYWORDS) if instruction else None
    attachment_purpose = None
    attachment_purpose_fact = None
    for text, fact, _source in attachment_texts:
        match = _match_keywords(text, _PURPOSE_KEYWORDS)
        if match:
            attachment_purpose, attachment_purpose_fact = match, fact
            break

    conflicts = []
    purpose = None
    if instruction_purpose and attachment_purpose and instruction_purpose[0] != attachment_purpose[0]:
        conflicts.append({
            'field': 'purpose',
            'message': (
                f'The instruction suggests "{instruction_purpose[0]}" '
                f'(matched "{instruction_purpose[1]}"), but an attachment suggests '
                f'"{attachment_purpose[0]}" (matched "{attachment_purpose[1]}").'
            ),
            'candidates': [
                {'value': instruction_purpose[0], 'source': SOURCE_USER_INSTRUCTION, 'confidence': instruction_purpose[2]},
                {
                    'value': attachment_purpose[0], 'source': _source_kind_for(attachment_purpose_fact),
                    'confidence': attachment_purpose[2],
                },
            ],
        })
        # Neither side is silently preferred — purpose stays unset and
        # the conflict is surfaced instead (see module docstring).
    elif instruction_purpose:
        bucket, keyword, confidence = instruction_purpose
        purpose = BriefValue(
            value=bucket, confidence=confidence,
            provenance=(Provenance(SOURCE_USER_INSTRUCTION, 'message'),),
            note=f'Matched keyword "{keyword}" in the instruction.',
        )
    elif attachment_purpose:
        bucket, keyword, confidence = attachment_purpose
        purpose = BriefValue(
            value=bucket, confidence=confidence * 0.85,  # slightly lower — inferred, not stated by the user
            provenance=(Provenance(_source_kind_for(attachment_purpose_fact), attachment_purpose_fact.locator),),
            note=f'Matched keyword "{keyword}" in an attachment; not stated directly by the user.',
        )

    audience = None
    instruction_audience = _match_keywords(instruction, _AUDIENCE_KEYWORDS) if instruction else None
    if instruction_audience:
        bucket, keyword, confidence = instruction_audience
        audience = BriefValue(
            value=bucket, confidence=confidence,
            provenance=(Provenance(SOURCE_USER_INSTRUCTION, 'message'),),
            note=f'Matched keyword "{keyword}" in the instruction.',
        )
    else:
        for text, fact, _source in attachment_texts:
            match = _match_keywords(text, _AUDIENCE_KEYWORDS)
            if match:
                bucket, keyword, confidence = match
                audience = BriefValue(
                    value=bucket, confidence=confidence * 0.85,
                    provenance=(Provenance(_source_kind_for(fact), fact.locator),),
                    note=f'Matched keyword "{keyword}" in an attachment; not stated directly by the user.',
                )
                break

    return purpose, audience, conflicts


def _subject_and_preheader_suggestions(instruction: str, attachment_texts) -> tuple[list[BriefValue], list[BriefValue]]:
    subjects, preheaders = [], []
    sources = [(instruction, Provenance(SOURCE_USER_INSTRUCTION, 'message'))] if instruction else []
    sources += [(text, Provenance(_source_kind_for(fact), fact.locator)) for text, fact, _s in attachment_texts]
    for text, provenance in sources:
        for line in text.splitlines():
            subject_match = _SUBJECT_LINE_PATTERN.match(line)
            if subject_match:
                candidate = subject_match.group(1).strip()
                if candidate:
                    subjects.append(BriefValue(candidate, 0.8, (provenance,), 'Explicit "Subject:" line.'))
            preheader_match = _PREHEADER_LINE_PATTERN.match(line)
            if preheader_match:
                candidate = preheader_match.group(1).strip()
                if candidate:
                    preheaders.append(BriefValue(candidate, 0.8, (provenance,), 'Explicit "Preheader:" line.'))
    return subjects, preheaders


def _ctas_from_facts(facts: list) -> list[dict]:
    ctas = []
    for fact in facts:
        if fact.kind == 'link' and isinstance(fact.value, dict):
            url = fact.value.get('url', '')
            text = fact.value.get('text', '')
            ctas.append({
                'label': text or None, 'url': url or None,
                'confidence': 0.7, 'note': 'Hyperlink found in an attachment.',
                'provenance': [Provenance(_source_kind_for(fact), fact.locator).to_dict()],
            })
        elif fact.kind in ('text', 'paragraph', 'list_item') and isinstance(fact.value, str):
            for url in _URL_PATTERN.findall(fact.value):
                looks_like_cta = any(hint in fact.value.lower() for hint in _CTA_TEXT_HINTS)
                ctas.append({
                    'label': None, 'url': url,
                    'confidence': 0.5 if looks_like_cta else 0.3,
                    'note': 'URL found in attachment text.' if not looks_like_cta else 'URL found near call-to-action wording.',
                    'provenance': [Provenance(_source_kind_for(fact), fact.locator).to_dict()],
                })
    return ctas


def _sections_from_facts(facts: list) -> list[BriefSection]:
    sections = []
    for fact in facts:
        if fact.kind == 'heading':
            sections.append(BriefSection(
                role='heading', confidence=0.7, content={'text': fact.value},
                provenance=(Provenance(_source_kind_for(fact), fact.locator),),
            ))
        elif fact.kind in ('paragraph', 'text') and isinstance(fact.value, str) and fact.value.strip():
            sections.append(BriefSection(
                role='paragraph', confidence=0.6, content={'text': fact.value},
                provenance=(Provenance(_source_kind_for(fact), fact.locator),),
            ))
        elif fact.kind == 'list_item':
            sections.append(BriefSection(
                role='list_item', confidence=0.6, content={'text': fact.value},
                provenance=(Provenance(_source_kind_for(fact), fact.locator),),
            ))
        elif fact.kind == 'table':
            sections.append(BriefSection(
                role='table', confidence=0.6,
                content={'rows': fact.value, 'row_count': (fact.structural_meta or {}).get('rows')},
                provenance=(Provenance(_source_kind_for(fact), fact.locator),),
            ))
    return sections


def _spreadsheet_data(facts: list) -> tuple[list[dict], list[ClarificationRequest]]:
    """Groups 'row' facts by their originating attachment/sheet (encoded
    in the locator prefix, e.g. 'xlsx:sheet:Products!row:3' or 'row:3'
    for CSV) and maps each header column to a canonical field name where
    confidently possible — never guesses an unmapped column's meaning."""
    row_facts = [f for f in facts if f.kind == 'row']
    if not row_facts:
        return [], []

    groups: dict[str, list] = {}
    for fact in row_facts:
        # 'xlsx:sheet:Products!row:3' -> group key 'xlsx:sheet:Products';
        # CSV's plain 'row:3' has no sheet segment -> one group 'csv'.
        prefix = fact.locator.rsplit('!row:', 1)[0] if '!row:' in fact.locator else 'csv'
        groups.setdefault(prefix, []).append(fact)

    datasets = []
    clarifications = []
    for group_key, rows in groups.items():
        header_fact = next((r for r in rows if (r.structural_meta or {}).get('is_header') or (r.structural_meta or {}).get('is_header_guess')), rows[0])
        headers = header_fact.value
        mapped = {}
        unmapped = []
        for index, header in enumerate(headers):
            canonical = _map_column_header(header)
            if canonical:
                mapped[index] = canonical
            elif header not in (None, ''):
                unmapped.append(str(header))

        data_rows = [r for r in rows if r is not header_fact]
        mapped_rows = []
        for row in data_rows:
            record = {}
            for index, value in enumerate(row.value):
                canonical = mapped.get(index)
                if canonical:
                    record[canonical] = value
            mapped_rows.append(record)

        datasets.append({
            'source': group_key, 'headers': headers, 'mapped_fields': sorted(set(mapped.values())),
            'unmapped_columns': unmapped, 'row_count': len(data_rows), 'rows': mapped_rows,
            'provenance': [Provenance(SOURCE_XLSX_CELL if 'xlsx' in group_key else SOURCE_CSV_ROW, header_fact.locator).to_dict()],
        })
        if unmapped and data_rows:
            clarifications.append(ClarificationRequest(
                field=f'spreadsheet_columns:{group_key}',
                message=(
                    f'I found column(s) in "{group_key}" I\'m not confident how to use: '
                    f'{", ".join(unmapped)}. What do they represent?'
                ),
                options=tuple(sorted(_COLUMN_ALIASES.keys())),
            ))
    return datasets, clarifications


def _footer_from_facts(instruction: str, facts: list) -> dict | None:
    texts = [instruction] if instruction else []
    provenances = [Provenance(SOURCE_USER_INSTRUCTION, 'message')] if instruction else []
    for fact in facts:
        if fact.kind in ('text', 'paragraph') and isinstance(fact.value, str):
            texts.append(fact.value)
            provenances.append(Provenance(_source_kind_for(fact), fact.locator))
    for text, provenance in zip(texts, provenances):
        lowered = text.lower()
        if any(keyword in lowered for keyword in _FOOTER_KEYWORDS):
            return {'present': True, 'confidence': 0.6, 'provenance': [provenance.to_dict()]}
    return None


def _personalization_signals(instruction: str, facts: list) -> list[str]:
    signals = set()
    candidates = [instruction] if instruction else []
    candidates += [f.value for f in facts if f.kind in ('text', 'paragraph', 'heading') and isinstance(f.value, str)]
    for text in candidates:
        for pattern in _PERSONALIZATION_PATTERNS:
            for match in pattern.findall(text):
                signals.add(match if isinstance(match, str) else pattern.pattern)
    return sorted(signals)


def _images_from_facts(facts: list, attachment_id_by_fact_source: dict) -> list[dict]:
    images = []
    for fact in facts:
        if fact.kind == 'image' and isinstance(fact.value, dict):
            images.append({
                'attachment_id': attachment_id_by_fact_source.get(id(fact)),
                'width': fact.value.get('width'), 'height': fact.value.get('height'),
                'format': fact.value.get('format'),
                'provenance': [Provenance(SOURCE_IMAGE_OBSERVATION, fact.locator).to_dict()],
                'note': 'Metadata only — no semantic/visual analysis performed (see D4-F).',
            })
    return images


def build_email_brief(instruction: str, attachments: list, platform: str) -> EmailBrief:
    """`attachments` is a list of EmailAttachment model instances already
    ownership/document-checked by the caller (see views.EmailBriefView) —
    this function itself never touches request.user or does any
    authorization; it only re-extracts and interprets. `instruction` is
    untrusted user-typed text; `attachments` content is untrusted
    file-derived text — both are read, never obeyed (see module docstring).
    """
    instruction = (instruction or '').strip()
    all_facts: list[extraction.ExtractedFact] = []
    warnings: list[str] = []
    attachment_id_by_fact_source: dict[int, int] = {}

    for attachment in attachments:
        if attachment.status != 'ready':
            warnings.append(f'Attachment "{attachment.original_filename}" was skipped (not ready).')
            continue
        try:
            attachment.file.open('rb')
            try:
                result = extraction.run_extraction(
                    attachment.detected_type, attachment.file,
                    probe_meta=attachment.extraction_meta, content_type=attachment.content_type,
                )
            finally:
                attachment.file.close()
        except Exception:  # noqa: BLE001 - a re-extraction failure must never fail the whole brief
            warnings.append(f'Attachment "{attachment.original_filename}" could not be re-read.')
            continue
        if result.status != 'ready':
            warnings.append(f'Attachment "{attachment.original_filename}" could not be re-extracted.')
            continue
        for fact in result.facts:
            attachment_id_by_fact_source[id(fact)] = attachment.id
        all_facts.extend(result.facts)

    text_facts = _collect_text_facts(all_facts)
    purpose, audience, purpose_conflicts = _purpose_and_audience(instruction, text_facts)
    subjects, preheaders = _subject_and_preheader_suggestions(instruction, text_facts)
    sections = _sections_from_facts(all_facts)
    ctas = _ctas_from_facts(all_facts)
    images = _images_from_facts(all_facts, attachment_id_by_fact_source)
    footer = _footer_from_facts(instruction, all_facts)
    personalization = _personalization_signals(instruction, all_facts)
    spreadsheet_datasets, spreadsheet_clarifications = _spreadsheet_data(all_facts)
    if spreadsheet_datasets:
        sections.append(BriefSection(
            role='data', confidence=0.7, content={'datasets': spreadsheet_datasets},
            provenance=tuple(Provenance(d['provenance'][0]['source_kind'], d['provenance'][0]['locator']) for d in spreadsheet_datasets),
        ))

    if not instruction and not all_facts:
        warnings.append('No instruction and no usable attachment content — this brief is empty.')

    return EmailBrief(
        version=1,
        platform=platform,
        purpose=purpose,
        audience=audience,
        subject_suggestions=subjects,
        preheader_suggestions=preheaders,
        sections=sections,
        ctas=ctas,
        images=images,
        footer=footer,
        personalization=personalization,
        conflicts=purpose_conflicts,
        clarifications=list(spreadsheet_clarifications),
        warnings=warnings,
    )

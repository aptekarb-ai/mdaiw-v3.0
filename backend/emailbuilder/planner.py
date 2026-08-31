"""R4-B3 §C — a bounded, deterministic planner.

Decomposes a natural request into a fixed, small set of KNOWN Email
Builder operations — never an open-ended agent loop, never a plan step
that isn't one of this module's own registered step kinds. EmailAIPlan
is a plain data structure describing what WOULD be inspected/compared/
proposed; nothing in this module ever mutates a document, calls
validate_action(), or applies anything — see needs_clarification/
proposed_actions below, which are always empty at this stage (R4-C's
job, not this one's).

The plan is meant to be READ by an LLM tier (attached to its context,
same pattern as `knowledge` — see ai_command_local.py/
ai_command_openai.py) so the model's own natural-language explanation is
grounded in a concrete, deterministic decomposition instead of it
inventing one — the user only ever sees the model's prose, never this
structure directly (matches §C: "The user should see the useful
explanation/proposal, not internal chain-of-thought.").
"""

from dataclasses import dataclass, field

from .intent_normalization import CanonicalIntent, normalize_intent

# The fixed vocabulary of step kinds a plan may ever contain — mirrors
# the bounded read-tool vocabulary in ai_command.py's tool-loop (§D),
# intentionally the SAME small set rather than a second taxonomy.
STEP_KINDS = frozenset({
    'resolve_target', 'retrieve_reconstruction_region', 'compare_structure', 'compare_typography',
    'compare_spacing', 'compare_background_image', 'compare_cta', 'identify_repairable_differences',
    'compute_contrast_fix', 'lookup_knowledge', 'build_candidate_action', 'validate_candidate_action',
    'present_proposal',
})


@dataclass(frozen=True)
class PlanStep:
    kind: str
    description: str

    def __post_init__(self):
        if self.kind not in STEP_KINDS:
            raise ValueError(f'unknown plan step kind: {self.kind!r}')


@dataclass(frozen=True)
class EmailAIPlan:
    goal: str
    target: str | None
    steps: tuple[PlanStep, ...] = field(default_factory=tuple)
    required_context: tuple[str, ...] = field(default_factory=tuple)
    # R4-B3 scope — always empty. A plan describes what WOULD be
    # compared/proposed; it never carries real AICommandAction dicts.
    # R4-C is the checkpoint that turns a plan step into a real proposal.
    proposed_actions: tuple = field(default_factory=tuple)
    needs_clarification: bool = False
    confidence: float = 0.0
    explanation: str = ''

    def as_context_lines(self):
        """A short, bounded, human-scannable rendering — this is what
        actually reaches an LLM's context (never the dataclass itself,
        never raw JSON of internal field names) via safe_context['plan']."""
        lines = [f'Goal: {self.goal}']
        if self.target:
            lines.append(f'Target: {self.target}')
        for index, step in enumerate(self.steps, start=1):
            lines.append(f'{index}. {step.description}')
        return lines


_RECONSTRUCTION_COMPARISON_STEPS = (
    PlanStep('resolve_target', 'Identify which module/section the user is referring to.'),
    PlanStep('retrieve_reconstruction_region', 'Retrieve the matching imported source region, if one exists.'),
    PlanStep('compare_structure', 'Compare structural layout (rows/columns/nesting) between source and reconstruction.'),
    PlanStep('compare_typography', 'Compare typography (font size/weight/color/alignment).'),
    PlanStep('compare_spacing', 'Compare padding/gutter/outer spacing.'),
    PlanStep('compare_background_image', 'Compare background color/image.'),
    PlanStep('compare_cta', 'Compare any call-to-action button (alignment, padding, destination).'),
    PlanStep('identify_repairable_differences', 'Classify each difference as Preserved/Normalized/Approximation/Repairable/Removed — never invert an architectural Approximation into a false Repairable.'),
    PlanStep('build_candidate_action', 'For each Repairable difference only, describe what a correction WOULD look like (not yet a real action — R4-C).'),
    PlanStep('validate_candidate_action', 'Note that any real action would still need to pass validate_action() before ever being proposed.'),
    PlanStep('present_proposal', 'Summarize findings for the user in plain language; wait for a real R4-C proposal flow before anything is applied.'),
)

_CONTRAST_FIX_STEPS = (
    PlanStep('resolve_target', 'Identify the selected module.'),
    PlanStep('compute_contrast_fix', 'Compute a WCAG AA-compliant replacement color from the current foreground/background.'),
    PlanStep('validate_candidate_action', 'Confirm the proposed patch passes validate_action().'),
    PlanStep('present_proposal', 'Show the before/after color and ratio; wait for the user to confirm.'),
)

_KNOWLEDGE_QUESTION_STEPS = (
    PlanStep('lookup_knowledge', 'Retrieve the curated knowledge relevant to this question.'),
    PlanStep('present_proposal', 'Answer combining that knowledge with the live document context — never a generic textbook answer alone.'),
)

_GENERIC_STEPS = (
    PlanStep('resolve_target', 'Identify what the user is referring to.'),
    PlanStep('build_candidate_action', 'Determine which registered skill/action applies.'),
    PlanStep('validate_candidate_action', 'Confirm the proposed action passes validate_action().'),
    PlanStep('present_proposal', 'Show the proposal and wait for confirmation.'),
)


def build_plan(message, context=None):
    """Deterministic — the SAME message+context always produces the SAME
    plan. `context` is the same already-bounded safe_context shape the
    providers build (only 'import_reconstruction' and
    'selected_module' are read here). Never raises; a message this
    function cannot usefully decompose returns a low-confidence,
    needs_clarification plan rather than an empty/None result, so a
    caller never has to null-check before reading .steps."""
    context = context if isinstance(context, dict) else {}
    intent, confidence, _language = normalize_intent(message)
    has_reconstruction = bool(context.get('import_reconstruction'))
    selected = context.get('selected_module')
    target = selected.get('type') if isinstance(selected, dict) else None

    if intent == CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION and has_reconstruction:
        return EmailAIPlan(
            goal='Compare the reconstructed email against the imported source and identify differences.',
            target=target,
            steps=_RECONSTRUCTION_COMPARISON_STEPS,
            required_context=('import_reconstruction', 'selected_module'),
            confidence=confidence,
            explanation='Recognized as an import-reconstruction comparison request.',
        )

    if intent == CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION and not has_reconstruction:
        return EmailAIPlan(
            goal='Compare against an imported source.',
            target=target,
            steps=(),
            needs_clarification=True,
            confidence=confidence,
            explanation='This conversation has no import-reconstruction context, so there is nothing to compare against.',
        )

    if intent == CanonicalIntent.FIX_CONTRAST:
        return EmailAIPlan(
            goal='Fix weak text contrast on the selected module.',
            target=target,
            steps=_CONTRAST_FIX_STEPS,
            required_context=('selected_module',),
            confidence=confidence,
            explanation='Recognized as a contrast-fix request.',
        )

    if intent == CanonicalIntent.EXPLAIN_VALIDATION_ISSUE:
        return EmailAIPlan(
            goal='Explain a validation issue using curated knowledge and live document context.',
            target=target,
            steps=_KNOWLEDGE_QUESTION_STEPS,
            required_context=('selected_validation_issue', 'knowledge'),
            confidence=confidence,
            explanation='Recognized as a request to explain a validation/compatibility issue.',
        )

    if intent is not None:
        return EmailAIPlan(
            goal=f'Apply the {intent} action.',
            target=target,
            steps=_GENERIC_STEPS,
            required_context=('selected_module',) if target else (),
            confidence=confidence,
            explanation=f'Recognized as a {intent} request.',
        )

    return EmailAIPlan(
        goal='Unclear',
        target=target,
        steps=(),
        needs_clarification=True,
        confidence=0.0,
        explanation='No recognized canonical intent — likely a free-form question or an out-of-vocabulary request; the LLM tier reasons about it directly.',
    )

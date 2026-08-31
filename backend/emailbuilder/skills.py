"""R4-B2 §14 — Email skill recipe registry.

A "skill" here is a STABLE IDENTITY for a capability this application
already has, never a second, parallel execution engine. Every skill
listed as `available` below already executes through the SAME
deterministic code path every other command in this app uses — the
Tier-0 deterministic router (RuleBasedEmailCommandProvider), the
contrast-fix math (minimal_readable_foreground), or the renderer's own
automatic Outlook/VML fallback generation — followed by the SAME
validate_action() trust boundary. This registry does not introduce a new
"skill executor" abstraction that bypasses any of that; it exists so:

  1. A learning-signal signature can name a skill stably
     ("skill:fix-weak-contrast", "skill:outlook-button-fallback") — see
     learning.py's widened SIGNATURE_PATTERN.
  2. A local/OpenAI LLM's reasoning can be grounded in a known, bounded
     vocabulary of "things this builder can actually do" rather than
     inventing capability names — see ai_command_local.py/
     ai_command_openai.py's own system prompts, which already enumerate
     the allowed ActionTypes; this registry is the SAME allow-list,
     described for a human/LLM reader rather than for validate_action().
  3. Documentation/diagnostics (§24 — "admin/settings diagnostics") can
     list what the AI Engineer can do without re-deriving it from
     ai_command.py's control flow by hand.

`status='reserved'` skills are explicitly NOT implemented yet — R4-C's
job (automatic import-reconstruction repair), per this checkpoint's own
"Do not implement automatic reconstruction repair" instruction. Listing
them now, with an honest status rather than a working executor, is
deliberate: it gives R4-C a stable id/signature to adopt without a
later rename, and it lets this registry (and its tests) already prove
"a reserved skill can never be treated as available" — see
list_available_skills()/is_skill_available() below.
"""

from dataclasses import dataclass

SKILL_SIGNATURE_PREFIX = 'skill'


@dataclass(frozen=True)
class Skill:
    id: str
    label: str
    description: str
    category: str
    # 'available' — already executes via an existing deterministic path.
    # 'reserved' — identity exists for future (R4-C) use; not executable
    # yet. Never anything else.
    status: str
    # What ACTUALLY performs this today, in plain terms a developer can
    # verify against the real code — never executable, just documentation
    # of which existing function/flow this id refers to.
    implementation_note: str

    def __post_init__(self):
        if self.status not in ('available', 'reserved'):
            raise ValueError(f'{self.id}: unknown status {self.status!r}')

    @property
    def signature(self):
        return f'{SKILL_SIGNATURE_PREFIX}:{self.id}'


# --- Available now — each already executes via an existing, tested code
# path; this registry only names it. ---------------------------------
_SKILLS = (
    Skill(
        id='fix-weak-contrast',
        label='Fix weak text contrast',
        description='Computes a WCAG AA-compliant (>=4.5:1) foreground color from the module\'s existing colors, preserving hue/brand intent.',
        category='accessibility',
        status='available',
        implementation_note='ai_command.py::minimal_readable_foreground(), reached via the deterministic router\'s contrast-fix branch and via both LLM providers\' system-prompt instruction (2).',
    ),
    Skill(
        id='resolve-placeholder-link',
        label='Resolve a placeholder link',
        description='Sets a real destination URL on a link the user (or an earlier turn) has actually provided — never invents one.',
        category='links',
        status='available',
        implementation_note='RuleBasedEmailCommandProvider\'s placeholder-link branch (ai_command.py) and both LLM providers\' system-prompt instruction (3); the frontend\'s pendingPlaceholderLinkModuleIdRef conversational flow (AIEngineerPanel.tsx).',
    ),
    Skill(
        id='set-button-url',
        label='Set a button/link URL',
        description='Updates the href of the currently selected Button (or any link-carrying) module to a safe, validated URL.',
        category='links',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS action on the selected module\'s url-typed field, via validate_action()\'s _validate_field_value URL branch.',
    ),
    Skill(
        id='change-text-color',
        label='Change text color',
        description='Updates a module\'s text/foreground color property to a given color.',
        category='typography',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS on a color-typed field.',
    ),
    Skill(
        id='change-padding',
        label='Change padding',
        description='Updates a module\'s (or column\'s) padding settings.',
        category='spacing',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS on the module\'s responsive padding settings fields.',
    ),
    Skill(
        id='change-gutter',
        label='Change column gutter',
        description='Updates a layout module\'s desktop/mobile gutter spacing.',
        category='spacing',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS on a layout module\'s gutter settings field; rendered via responsiveStyles.ts::resolveMobileGutterPx.',
    ),
    Skill(
        id='change-column-percentages',
        label='Change column width percentages',
        description='Switches a layout module to a different supported column-ratio preset (e.g. 50/50, 60/40).',
        category='structure',
        status='available',
        implementation_note='Selecting a different layout-*col-*-* module_type; the manifest\'s fixed set of supported ratios is the same set Import Reconstruction snaps an arbitrary source ratio onto (see reconstructionReview.ts\'s Approximation classification).',
    ),
    Skill(
        id='enable-outlook-vml',
        label='Enable Outlook/VML rendering',
        description='Enables the document-level Outlook VML fallback option.',
        category='outlook',
        status='available',
        implementation_note='SET_RESET_CSS_ENABLED-family document-level action toggling outlook_vml_enabled; VML markup itself is generated automatically by htmlRenderer.ts whenever enabled, never authored by the AI.',
    ),
    Skill(
        id='set-image-url',
        label='Set an image URL',
        description='Sets an Image module\'s source to an already-uploaded asset — never a bare invented URL.',
        category='images',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS with an {"assetId": <id>} value, resolved via resolve_asset_references() in ai_command.py.',
    ),
    Skill(
        id='set-background-color',
        label='Set background color',
        description='Updates a module/column\'s background color.',
        category='images',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS on a backgroundColor-typed field.',
    ),
    Skill(
        id='set-background-image',
        label='Set background image',
        description='Sets a module/column\'s background image to an already-uploaded asset.',
        category='images',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS with an {"assetId": <id>} value on a background-image-typed field; Outlook VML background fallback generated automatically by the renderer when enabled.',
    ),
    Skill(
        id='set-alignment',
        label='Change alignment',
        description='Updates a module\'s text/content alignment.',
        category='typography',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS on an align-typed field.',
    ),
    Skill(
        id='set-visibility',
        label='Change module visibility',
        description='Shows/hides a module on desktop and/or mobile.',
        category='responsive',
        status='available',
        implementation_note='UPDATE_MODULE_PROPS on the module\'s responsive visibility settings field.',
    ),
    Skill(
        id='set-document-title-subject',
        label='Set email title/subject',
        description='Sets the document-level email title (<title>) or subject (send metadata, never rendered).',
        category='document',
        status='available',
        implementation_note='SET_EMAIL_TITLE / SET_EMAIL_SUBJECT document-level actions.',
    ),

    # --- Reserved for R4-C — identity only, no executor yet. -------------
    Skill(
        id='reconstruct-button',
        label='Reconstruct button alignment/padding to match the source',
        description='Would adjust a reconstructed Button module\'s alignment/padding toward the imported source, ONLY for a difference already classified Repairable (never Approximation).',
        category='import-reconstruction',
        status='reserved',
        implementation_note='R4-C — will read reconstructionReview.ts\'s ReconstructionDifference (signature import-reconstruction:button:*) and propose the same UPDATE_MODULE_PROPS action a manual edit would use; no executor exists yet.',
    ),
    Skill(
        id='reconstruct-typography',
        label='Reconstruct typography to match the source',
        description='Would adjust reconstructed text typography (e.g. CSS font-weight not reflected) toward the imported source, ONLY for a Repairable difference.',
        category='import-reconstruction',
        status='reserved',
        implementation_note='R4-C — signature import-reconstruction:text:font-weight; no executor exists yet.',
    ),
    Skill(
        id='reconstruct-spacing',
        label='Reconstruct spacing to match the source',
        description='Would adjust reconstructed module padding toward the imported source, ONLY for a Repairable difference.',
        category='import-reconstruction',
        status='reserved',
        implementation_note='R4-C — signature import-reconstruction:spacing:text-padding; no executor exists yet.',
    ),
    Skill(
        id='set-preheader',
        label='Set email preheader text',
        description='Would set a hidden preheader-text block.',
        category='document',
        status='reserved',
        implementation_note='No preheader module/prop exists in the manifest yet (see module_capabilities.py) — reserved until one is added; not an R4-B2 or R4-C scope decision either way.',
    ),
)

_SKILLS_BY_ID = {skill.id: skill for skill in _SKILLS}


def list_all_skills():
    return list(_SKILLS)


def list_available_skills():
    return [skill for skill in _SKILLS if skill.status == 'available']


def get_skill(skill_id):
    return _SKILLS_BY_ID.get(skill_id)


def is_skill_available(skill_id):
    skill = _SKILLS_BY_ID.get(skill_id)
    return bool(skill and skill.status == 'available')

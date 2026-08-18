"""The Rule dataclass every language's rule table is built from — see
validation_rules/... in the Deep Validation spec, section 2."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Rule:
    rule_id: str
    language: str  # 'html' | 'css' | 'scss' | 'sass' | 'less' | 'javascript' | 'ampscript' | 'cross_language'
    category: str
    severity: str  # 'error' | 'warning' | 'info' — the TYPICAL severity; a real finding's own severity is authoritative
    description: str
    detection_source: str  # which engine/adapter actually raises this (e.g. 'html-structure', 'nu-html-checker')
    standards_reference: str = ''
    valid_examples: tuple[str, ...] = field(default_factory=tuple)
    invalid_examples: tuple[str, ...] = field(default_factory=tuple)
    repair_strategy: str = ''
    auto_repair_allowed: bool = True
    requires_context: bool = False
    requires_external_input: bool = False
    related_rules: tuple[str, ...] = field(default_factory=tuple)
    # True for a PARAMETRIC family (e.g. 'html5lib:*', 'nu:*') where the
    # detection source mints many distinct rule_ids from one underlying
    # checker (one per parser/linter message code) that this project does
    # not enumerate individually — the family entry still carries real,
    # non-invented guidance (what the family covers, how it's normally
    # repaired), it just isn't one specific standards clause.
    is_family: bool = False

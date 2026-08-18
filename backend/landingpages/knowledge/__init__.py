"""Controlled Self-Learning AI Engineer — application-level knowledge
augmentation, never OpenAI model retraining (spec section 1/40).

This package only ever supplements the existing, code-authored Rule
Knowledge Registry (validation/rules/) — it is consulted exclusively at
the moment that registry has nothing for a rule, never as a replacement
for it, and never as a way to skip the existing candidate-first
authoritative-revalidation gate every repair (deterministic, recipe, or
AI-produced) already goes through.
"""

// D4-D (Feature 14 V4) — TypeScript mirror of backend
// construction_planner.py's ConstructionPlan/PlannedSection/MatchResult
// shapes, as returned by POST /api/v1/email-builder/construction-plan/
// (see api/client.ts::requestConstructionPlan). Backend-authoritative:
// no logic here, only the response's shape.
import type { EmailBrief, EmailBriefProvenance } from './emailBrief';
import type { AICommandAction, AICommandProviderId } from './aiCommand';

export type MatchClassification = 'exact' | 'normalized' | 'approximated' | 'unsupported' | 'requires_new_module';

export interface MatchResult {
  section_role: string;
  module_type: string | null;
  classification: MatchClassification;
  confidence: number;
  reasons: string[];
  approximation_notes: string[];
  unmapped_fields: string[];
  alternatives: string[];
  provenance: EmailBriefProvenance[];
  // Only set for a REQUIRES_NEW_MODULE decision — a plain-language
  // pointer to what would need to happen next (a future reusable-module
  // workflow), never a promise this checkpoint implements one.
  suggested_next_step?: string | null;
  // A stable, learning.py-valid signature (`construction:module-select:*`)
  // for this decision. D4-D boundary: this makes the decision
  // learning-READY — D4-D never calls record_signal() itself. A future
  // checkpoint records it once a genuine user decision (Build / Cancel /
  // pick-an-alternative) exists to attach it to.
  signature: string;
}

export interface PlannedSection {
  match: MatchResult;
  // The composition-item shape actually going into the COMPOSE_EMAIL
  // action — null for an UNSUPPORTED section (nothing safe to insert).
  item: Record<string, unknown> | null;
}

export interface ConstructionPlan {
  platform: string;
  sections: PlannedSection[];
  platform_notes: string[];
  warnings: string[];
}

export interface RequestConstructionPlanInput {
  document: number | string;
  message?: string;
  attachmentIds?: number[];
}

export interface RequestConstructionPlanResponse {
  success: boolean;
  reply: string;
  brief: EmailBrief;
  plan: ConstructionPlan;
  action: AICommandAction;
  requires_confirmation: boolean;
  requires_strong_confirmation: boolean;
  provider: AICommandProviderId;
}

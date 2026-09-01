// D4-C (Feature 14 V4) — TypeScript mirror of backend email_brief.py's
// EmailBrief.to_dict() shape, as returned by POST /api/v1/email-builder/
// brief/ (see api/client.ts::requestEmailBrief). Backend-authoritative:
// this file has no logic, only the response's shape, so a later
// checkpoint's UI can consume a typed brief without re-deriving it.
//
// Nothing here is wired into the AI Engineer UI yet — D4-C's own scope
// is the understanding layer, not the "build my email" conversational
// experience (that's D4-E) or builder-aware module matching (D4-D).

export interface EmailBriefProvenance {
  source_kind: string;
  locator: string;
  extraction_method: 'deterministic' | 'local_llm' | 'openai';
}

export interface EmailBriefValue {
  value: unknown;
  confidence: number;
  provenance: EmailBriefProvenance[];
  note: string;
}

export interface EmailBriefClarification {
  field: string;
  message: string;
  options: string[];
}

export interface EmailBriefSection {
  role: string;
  confidence: number;
  content: Record<string, unknown>;
  provenance: EmailBriefProvenance[];
}

export interface EmailBriefConflict {
  field: string;
  message: string;
  candidates: Array<{ value: string; source: string; confidence: number }>;
}

export interface EmailBriefCta {
  label: string | null;
  url: string | null;
  confidence: number;
  note: string;
  provenance: EmailBriefProvenance[];
}

export interface EmailBriefImage {
  attachment_id: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  provenance: EmailBriefProvenance[];
  note: string;
}

export interface EmailBrief {
  version: number;
  platform: string;
  purpose: EmailBriefValue | null;
  audience: EmailBriefValue | null;
  subject_suggestions: EmailBriefValue[];
  preheader_suggestions: EmailBriefValue[];
  sections: EmailBriefSection[];
  ctas: EmailBriefCta[];
  images: EmailBriefImage[];
  footer: { present: boolean; confidence: number; provenance: EmailBriefProvenance[] } | null;
  personalization: string[];
  conflicts: EmailBriefConflict[];
  clarifications: EmailBriefClarification[];
  warnings: string[];
}

export interface RequestEmailBriefInput {
  document: number | string;
  message?: string;
  attachmentIds?: number[];
}

export interface RequestEmailBriefResponse {
  success: boolean;
  brief: EmailBrief;
}

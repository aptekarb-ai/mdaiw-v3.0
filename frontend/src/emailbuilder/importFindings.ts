// Phase C (Import HTML) — the Import Review finding shape. Deliberately
// its OWN type, not ValidationIssue (emailValidation.ts): Import findings
// describe a one-time TRANSFORMATION of source HTML into EDM (this
// element was normalized/dropped/stripped/left unresolved), computed
// once client-side before the document even exists, and are discarded
// after the Import Review step — never persisted, never fed into
// validateEmail(). Email validation findings describe the RESULTING
// document (HTML validity, Outlook compatibility, accessibility, ...)
// and are computed by the unchanged validateEmail() after creation, on
// every document identically regardless of how it was created. Keeping
// these two lifecycles distinct is an explicit, approved Phase C
// decision — a shared `category`/id space would risk import findings
// silently becoming (or being confused with) persistent validation
// errors.
export type ImportFindingCategory =
  | 'normalized'          // imported, but with a lossy/adjusted mapping
  | 'unsupported'         // no existing module can represent this — dropped
  | 'security'            // actively dangerous content — stripped
  | 'unresolved-resource' // an image/link source could not be safely resolved
  | 'structural-conversion'; // column/table structure required normalization

export interface ImportFinding {
  category: ImportFindingCategory;
  /** The source element/structure this finding is about, e.g. "<img>", "<style>", "column 2 of row 3". */
  source: string;
  /** Approximate location — nearest row/column index or a short structural path, never exact source line/col (a DOMParser tree has none). */
  location: string;
  /** Why this finding exists. */
  reason: string;
  /** What happened as a result (dropped / normalized to X / stripped / left unresolved). */
  outcome: string;
  /** What the user can do about it, if anything. */
  recommendation: string;
}

export interface ImportMappingResult {
  modules: import('./edm').EmailModule[];
  findings: ImportFinding[];
  emailTitle: string;
}

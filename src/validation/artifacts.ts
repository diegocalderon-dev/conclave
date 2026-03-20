/** Artifact validation — ensures structural correctness */

import type {
  Claim,
  Issue,
  AgreementEntry,
  DraftSynthesis,
  FinalSynthesis,
  ClaimStatus,
  IssueState,
  AgreementStatus,
  NormalizedTaskContract,
  RunManifest,
} from "../core/types.js";

const VALID_CLAIM_STATUSES: ClaimStatus[] = [
  "proposed",
  "accepted",
  "rejected",
  "modified",
  "merged",
  "withdrawn",
];

const VALID_ISSUE_STATES: IssueState[] = [
  "open",
  "narrowed",
  "hybrid_proposed",
  "resolved",
  "irreducible_disagreement",
];

const VALID_AGREEMENT_STATUSES: AgreementStatus[] = [
  "agreed",
  "disputed",
  "hybrid_proposed",
  "dropped",
];

export interface ValidationError {
  field: string;
  message: string;
}

export function validateTaskContract(
  contract: NormalizedTaskContract
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!contract.prompt) {
    errors.push({ field: "prompt", message: "Task contract missing prompt" });
  }
  if (!contract.requestedDeliverable) {
    errors.push({
      field: "requestedDeliverable",
      message: "Task contract missing requestedDeliverable",
    });
  }
  if (!Array.isArray(contract.scopeHints)) {
    errors.push({
      field: "scopeHints",
      message: "Task contract scopeHints must be an array",
    });
  }
  if (!Array.isArray(contract.constraints)) {
    errors.push({
      field: "constraints",
      message: "Task contract constraints must be an array",
    });
  }
  return errors;
}

export function validateRunManifest(manifest: RunManifest): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!manifest.runId) {
    errors.push({ field: "runId", message: "Manifest missing runId" });
  }
  if (!manifest.task) {
    errors.push({ field: "task", message: "Manifest missing task" });
  }
  if (!Array.isArray(manifest.adapters)) {
    errors.push({ field: "adapters", message: "Manifest adapters must be an array" });
  }
  if (!Array.isArray(manifest.phases)) {
    errors.push({ field: "phases", message: "Manifest phases must be an array" });
  }
  errors.push(...validateTaskContract(manifest.taskContract).map((error) => ({
    field: `taskContract.${error.field}`,
    message: error.message,
  })));
  return errors;
}

export function validateClaim(claim: Claim): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!claim.id) errors.push({ field: "id", message: "Claim missing id" });
  if (!claim.text) errors.push({ field: "text", message: "Claim missing text" });
  if (!VALID_CLAIM_STATUSES.includes(claim.status)) {
    errors.push({
      field: "status",
      message: `Invalid claim status: ${claim.status}`,
    });
  }
  if (!claim.source)
    errors.push({ field: "source", message: "Claim missing source" });
  return errors;
}

export function validateIssue(issue: Issue): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!issue.id) errors.push({ field: "id", message: "Issue missing id" });
  if (!issue.title)
    errors.push({ field: "title", message: "Issue missing title" });
  if (!VALID_ISSUE_STATES.includes(issue.state)) {
    errors.push({
      field: "state",
      message: `Invalid issue state: ${issue.state}`,
    });
  }
  return errors;
}

export function validateIssueTransition(
  from: IssueState,
  to: IssueState
): boolean {
  const allowed: Record<IssueState, IssueState[]> = {
    open: ["narrowed", "hybrid_proposed", "resolved", "irreducible_disagreement"],
    narrowed: ["hybrid_proposed", "resolved", "irreducible_disagreement", "open"],
    hybrid_proposed: ["resolved", "irreducible_disagreement", "narrowed", "open"],
    resolved: [], // terminal
    irreducible_disagreement: [], // terminal
  };
  return allowed[from]?.includes(to) ?? false;
}

export function validateAgreementEntry(
  entry: AgreementEntry
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!entry.claimId)
    errors.push({ field: "claimId", message: "Entry missing claimId" });
  if (!Array.isArray(entry.claimIds) || entry.claimIds.length === 0) {
    errors.push({
      field: "claimIds",
      message: "Entry must include at least one stable claim id reference",
    });
  }
  if (!VALID_AGREEMENT_STATUSES.includes(entry.status)) {
    errors.push({
      field: "status",
      message: `Invalid agreement status: ${entry.status}`,
    });
  }
  return errors;
}

export function validateDraftSynthesis(
  draft: DraftSynthesis
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!Array.isArray(draft.candidateDeliverables)) {
    errors.push({
      field: "candidateDeliverables",
      message: "candidateDeliverables must be an array",
    });
  }
  if (!Array.isArray(draft.agreedPoints)) {
    errors.push({
      field: "agreedPoints",
      message: "agreedPoints must be an array",
    });
  }
  if (!Array.isArray(draft.supportedClaimIds)) {
    errors.push({
      field: "supportedClaimIds",
      message: "supportedClaimIds must be an array",
    });
  }
  if (!Array.isArray(draft.assumptions)) {
    errors.push({
      field: "assumptions",
      message: "assumptions must be an array",
    });
  }
  if (!Array.isArray(draft.unresolvedDisagreements)) {
    errors.push({
      field: "unresolvedDisagreements",
      message: "unresolvedDisagreements must be an array",
    });
  }
  if (!Array.isArray(draft.conditionalAgreements)) {
    errors.push({
      field: "conditionalAgreements",
      message: "conditionalAgreements must be an array",
    });
  }
  if (!Array.isArray(draft.recommendedNextActions)) {
    errors.push({
      field: "recommendedNextActions",
      message: "recommendedNextActions must be an array",
    });
  }
  // Check that unresolved disagreements are not presented as consensus
  for (const d of draft.unresolvedDisagreements || []) {
    if (draft.agreedPoints.some((p) => p.includes(d.title))) {
      errors.push({
        field: "agreedPoints",
        message: `Unresolved disagreement "${d.title}" appears in agreedPoints — must not present disputes as consensus`,
      });
    }
  }
  return errors;
}

export function validateFinalSynthesis(
  synthesis: FinalSynthesis
): ValidationError[] {
  const errors: ValidationError[] = [];
  errors.push(...validateDraftSynthesis(synthesis.synthesis));

  if (!Array.isArray(synthesis.ratificationVotes)) {
    errors.push({
      field: "ratificationVotes",
      message: "ratificationVotes must be an array",
    });
  }

  // If not ratified, must have unresolved disagreements or blocks
  if (!synthesis.ratified) {
    const hasBlocks = synthesis.ratificationVotes.some(
      (v) => v.outcome === "blocked"
    );
    const hasDisagreements =
      synthesis.synthesis.unresolvedDisagreements.length > 0;
    if (!hasBlocks && !hasDisagreements) {
      errors.push({
        field: "ratified",
        message:
          "Non-ratified synthesis must have blocks or unresolved disagreements",
      });
    }
  }

  return errors;
}

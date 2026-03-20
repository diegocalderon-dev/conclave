/** Lane selection policy — model-suggested, orchestrator-decided */

import type {
  LaneType,
  DepthProfile,
  DepthPolicy,
  DEPTH_POLICIES,
  LaneConfig,
  Claim,
  Issue,
} from "../core/types.js";
import { DEPTH_POLICIES as policies } from "../core/types.js";

export interface LaneSelectionInput {
  task: string;
  depth: DepthProfile;
  laneConfig: LaneConfig;
  existingClaims: Claim[];
  existingIssues: Issue[];
  round: number;
  adapterSuggestions?: LaneType[];
}

export interface LaneSelectionResult {
  activeLanes: LaneType[];
  rationale: string;
}

export function selectLanes(input: LaneSelectionInput): LaneSelectionResult {
  const depthPolicy = policies[input.depth];
  const enabledLanes = input.laneConfig.enabled;
  const maxLanes = Math.min(depthPolicy.laneBudget, input.laneConfig.maxParallel);

  // Round 1: always start with independent draft
  if (input.round === 1) {
    const lanes: LaneType[] = ["independent-draft"];
    return {
      activeLanes: lanes,
      rationale:
        "Round 1: independent drafts preserve unanchored first-pass thinking.",
    };
  }

  // After round 1: select based on state
  const candidateLanes: LaneType[] = [];
  const rationale: string[] = [];

  // If we have claims, atomic negotiation is valuable
  if (input.existingClaims.length > 0 && enabledLanes.includes("atomic-claim")) {
    candidateLanes.push("atomic-claim");
    rationale.push("Claims exist — atomic negotiation reduces rhetorical drift.");
  }

  // If we have open issues, issue debate helps
  const openIssues = input.existingIssues.filter(
    (i) => i.state === "open" || i.state === "narrowed"
  );
  if (openIssues.length > 0 && enabledLanes.includes("issue-debate")) {
    candidateLanes.push("issue-debate");
    rationale.push(
      `${openIssues.length} open/narrowed issues — debate isolates disagreements.`
    );
  }

  // Hybrid editing when we have some agreement
  const agreedClaims = input.existingClaims.filter(
    (c) => c.status === "accepted"
  );
  if (
    agreedClaims.length >= 2 &&
    enabledLanes.includes("hybrid-edit")
  ) {
    candidateLanes.push("hybrid-edit");
    rationale.push("Sufficient agreement for hybrid artifact editing.");
  }

  // Contrarian in later rounds at high+ depth
  if (
    input.round >= 3 &&
    enabledLanes.includes("contrarian") &&
    (input.depth === "high" || input.depth === "exhaustive")
  ) {
    candidateLanes.push("contrarian");
    rationale.push("Later round at high depth — contrarian preserves dissent.");
  }

  // Honor adapter suggestions if they're in the enabled set
  if (input.adapterSuggestions) {
    for (const s of input.adapterSuggestions) {
      if (enabledLanes.includes(s) && !candidateLanes.includes(s)) {
        candidateLanes.push(s);
        rationale.push(`Adapter-suggested: ${s}`);
      }
    }
  }

  // Trim to budget
  const selected = candidateLanes.slice(0, maxLanes);

  // Fallback: if nothing selected, use independent draft
  if (selected.length === 0) {
    selected.push("independent-draft");
    rationale.push("Fallback: no specific lanes triggered, using independent draft.");
  }

  return {
    activeLanes: selected,
    rationale: rationale.join(" "),
  };
}

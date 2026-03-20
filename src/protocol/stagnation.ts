/** Stagnation detection — stop when rounds stop producing meaningful deltas */

import type { Claim, Issue, DepthPolicy } from "../core/types.js";

export interface RoundSnapshot {
  round: number;
  claimCount: number;
  acceptedCount: number;
  rejectedCount: number;
  openIssueCount: number;
  resolvedIssueCount: number;
}

export function takeSnapshot(
  round: number,
  claims: Claim[],
  issues: Issue[]
): RoundSnapshot {
  return {
    round,
    claimCount: claims.length,
    acceptedCount: claims.filter((c) => c.status === "accepted").length,
    rejectedCount: claims.filter((c) => c.status === "rejected").length,
    openIssueCount: issues.filter(
      (i) => i.state === "open" || i.state === "narrowed"
    ).length,
    resolvedIssueCount: issues.filter(
      (i) => i.state === "resolved" || i.state === "irreducible_disagreement"
    ).length,
  };
}

export function detectStagnation(
  snapshots: RoundSnapshot[],
  threshold: number
): { stagnant: boolean; reason?: string } {
  if (snapshots.length < 2) return { stagnant: false };

  let stagnantRounds = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];

    const delta =
      Math.abs(curr.acceptedCount - prev.acceptedCount) +
      Math.abs(curr.rejectedCount - prev.rejectedCount) +
      Math.abs(curr.resolvedIssueCount - prev.resolvedIssueCount) +
      Math.abs(curr.claimCount - prev.claimCount);

    if (delta <= 1) {
      stagnantRounds++;
    } else {
      stagnantRounds = 0;
    }
  }

  if (stagnantRounds >= threshold) {
    return {
      stagnant: true,
      reason: `${stagnantRounds} consecutive rounds with minimal delta (threshold: ${threshold}).`,
    };
  }

  return { stagnant: false };
}

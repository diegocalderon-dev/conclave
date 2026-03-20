/** Simple ID generation for run artifacts */

export function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `run-${ts}-${rand}`;
}

export function generateClaimId(round: number, index: number): string {
  return `claim-r${round}-${index}`;
}

export function generateIssueId(round: number, index: number): string {
  return `issue-r${round}-${index}`;
}

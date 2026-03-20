/** Protocol prompt templates for each phase and lane */

import type { Claim, Issue, AgreementEntry, DraftSynthesis, LaneType } from "../core/types.js";

// --- Discovery Phase Prompts ---

export function independentDraftPrompt(task: string, target?: string): string {
  return `You are participating in a structured deliberation process. Your role is to produce an independent first-pass analysis.

TASK: ${task}
${target ? `TARGET/CONTEXT: ${target}` : ""}

Produce your analysis with the following structure (use JSON):
{
  "proposal": "Your main proposal or approach",
  "assumptions": ["List of assumptions you are making"],
  "risks": ["Identified risks"],
  "openQuestions": ["Questions that need resolution"],
  "confidence": "low | medium | high",
  "claims": [
    {
      "text": "A specific, atomic claim",
      "evidence": ["Supporting reasoning or evidence"]
    }
  ]
}

Important:
- Think independently. Do not try to anticipate what another model might say.
- Be specific and concrete.
- Label your confidence honestly.
- Each claim should be atomic — one idea per claim.`;
}

export function atomicClaimNegotiationPrompt(
  task: string,
  claims: Claim[],
  adapterId: string
): string {
  const claimList = claims
    .map(
      (c) =>
        `- [${c.id}] (${c.source}, ${c.status}): ${c.text}`
    )
    .join("\n");

  return `You are participating in atomic-claim negotiation for a structured deliberation.

TASK: ${task}

CURRENT CLAIMS:
${claimList}

For each claim, respond with a JSON array of decisions:
[
  {
    "claimId": "the claim id",
    "action": "accept | reject | modify | merge",
    "reason": "Why this action",
    "modifiedText": "If modifying, the new text",
    "mergeWith": "If merging, the other claim id"
  }
]

You may also propose NEW claims:
[
  {
    "action": "propose",
    "text": "New atomic claim",
    "evidence": ["Supporting reasoning"]
  }
]

Rules:
- Accept claims you agree with.
- Reject claims you disagree with — state why.
- Modify claims that are close but need refinement.
- Merge claims that overlap.
- You are: ${adapterId}`;
}

export function issueDebatePrompt(
  task: string,
  issue: Issue,
  positions: Record<string, string>
): string {
  const posStr = Object.entries(positions)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  return `You are participating in an issue-by-issue debate.

TASK: ${task}

ISSUE: ${issue.title}
${issue.description}
Current state: ${issue.state}

POSITIONS:
${posStr}

Respond with JSON:
{
  "position": "Your position on this specific issue",
  "reasoning": "Detailed reasoning",
  "proposedResolution": "How you think this should resolve",
  "acceptableCompromise": "What compromise you could accept, if any",
  "blockers": ["What would make you block resolution"]
}

Rules:
- Stay focused on THIS issue only.
- Be specific about what you can and cannot accept.
- If you think the issue is resolved, say so clearly.`;
}

export function hybridEditPrompt(
  task: string,
  currentDraft: string,
  adapterId: string
): string {
  return `You are co-editing a shared artifact in a structured deliberation.

TASK: ${task}

CURRENT DRAFT:
${currentDraft}

As ${adapterId}, propose edits to improve this draft. Respond with JSON:
{
  "edits": [
    {
      "section": "Which part to edit",
      "action": "add | remove | rewrite | refine",
      "content": "The new content",
      "reason": "Why this edit improves the draft"
    }
  ],
  "overallAssessment": "Brief assessment of draft quality",
  "simplificationOpportunities": ["Ways to make it simpler"]
}

Rules:
- Additions must compete with simplification pressure.
- Prefer precision over volume.
- Do not rewrite the entire draft — make targeted edits.`;
}

export function contrarianPrompt(
  task: string,
  currentConsensus: string
): string {
  return `You are the contrarian / minority-report voice in a structured deliberation.

TASK: ${task}

CURRENT CONSENSUS DIRECTION:
${currentConsensus}

Your job is to identify the strongest surviving objection or alternative. Respond with JSON:
{
  "strongestObjection": "The most important objection to the current direction",
  "alternativeApproach": "The best alternative that the consensus might be missing",
  "hiddenAssumptions": ["Assumptions the consensus is making that might be wrong"],
  "risksOfConsensus": ["Risks of following the current direction"],
  "shouldBlock": true/false,
  "blockReason": "If blocking, why"
}

Rules:
- This is not contrarianism for its own sake. Only raise objections with substance.
- If the consensus is genuinely strong, say so — and explain why the alternatives are weaker.
- Preserve dissent even if you ultimately agree with the direction.`;
}

// --- Consolidation ---

export function consolidationPrompt(
  task: string,
  claims: Claim[],
  issues: Issue[]
): string {
  const claimStr = claims
    .map((c) => `- [${c.id}] (${c.source}, ${c.status}): ${c.text}`)
    .join("\n");
  const issueStr = issues
    .map((i) => `- [${i.id}] (${i.state}): ${i.title}`)
    .join("\n");

  return `Consolidate the following discovery outputs into a canonical view.

TASK: ${task}

CLAIMS:
${claimStr || "(none)"}

ISSUES:
${issueStr || "(none)"}

Produce a JSON consolidation:
{
  "agreedPoints": ["Points both sides agree on"],
  "disputedPoints": ["Points with active disagreement"],
  "candidateHybrids": ["Potential compromise positions"],
  "droppedIdeas": ["Ideas that were explored but should be dropped"],
  "sharedAssumptions": ["Assumptions both sides share"],
  "openTensions": ["Unresolved tensions"]
}

Rules:
- Reduce duplication. Normalize language.
- Do not invent new claims. Only restructure existing ones.
- Be honest about what is disputed vs. agreed.`;
}

// --- Validation ---

export function validationPrompt(
  task: string,
  agreementMatrix: AgreementEntry[],
  claims: Claim[]
): string {
  const matrixStr = agreementMatrix
    .map(
      (e) =>
        `- Claim ${e.claimId} (${e.status}): ${JSON.stringify(e.positions)}`
    )
    .join("\n");

  return `Validate the following consolidated findings. This is a FRESH validation — do not rely on prior conversation context.

TASK: ${task}

AGREEMENT MATRIX:
${matrixStr || "(empty)"}

Respond with JSON:
{
  "feasibilityIssues": ["Claims that may not be feasible"],
  "missingConstraints": ["Constraints not yet considered"],
  "unsupportedClaims": ["Claims without adequate evidence"],
  "hiddenAssumptions": ["Assumptions that should be made explicit"],
  "misstatements": ["Places where agreement is overstated"],
  "recommendations": ["Suggested changes to the synthesis"],
  "overallAssessment": "strong | adequate | weak"
}

Rules:
- Bias toward PRUNING weak claims, not inventing new ones.
- Challenge the synthesis honestly.
- Flag any place where unresolved disputes are being presented as consensus.`;
}

// --- Ratification ---

export function ratificationPrompt(
  adapterId: string,
  draft: DraftSynthesis
): string {
  return `Review this synthesis draft for ratification. You are: ${adapterId}

DRAFT SYNTHESIS:
${JSON.stringify(draft, null, 2)}

Respond with JSON:
{
  "outcome": "approved | blocked",
  "objections": ["Specific statements you reject, if blocking"],
  "requestedEdits": ["Minimal changes needed for approval, if blocking"],
  "comments": "Any additional comments"
}

Rules:
- Only block if you have substantive objections.
- If blocking, specify the EXACT statement you reject and the MINIMAL change needed.
- Approving does not mean you agree with everything — just that the synthesis is fair and accurate.`;
}

// --- Lane Type to Prompt Mapper ---

export function getLanePrompt(
  lane: LaneType,
  task: string,
  context: {
    target?: string;
    claims?: Claim[];
    issues?: Issue[];
    adapterId?: string;
    currentDraft?: string;
    currentConsensus?: string;
    positions?: Record<string, string>;
    issue?: Issue;
  }
): string {
  switch (lane) {
    case "independent-draft":
      return independentDraftPrompt(task, context.target);
    case "atomic-claim":
      return atomicClaimNegotiationPrompt(
        task,
        context.claims || [],
        context.adapterId || "unknown"
      );
    case "issue-debate":
      if (!context.issue)
        return independentDraftPrompt(task, context.target); // fallback
      return issueDebatePrompt(
        task,
        context.issue,
        context.positions || {}
      );
    case "hybrid-edit":
      return hybridEditPrompt(
        task,
        context.currentDraft || "(no draft yet)",
        context.adapterId || "unknown"
      );
    case "contrarian":
      return contrarianPrompt(
        task,
        context.currentConsensus || "(no consensus yet)"
      );
  }
}

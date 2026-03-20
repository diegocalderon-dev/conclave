/** Artifact persistence — writes run artifacts to artifact_root */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  RunManifest,
  Claim,
  Issue,
  AgreementEntry,
  DraftSynthesis,
  RatificationVote,
  FinalSynthesis,
} from "../core/types.js";

export class ArtifactStore {
  readonly runDir: string;

  constructor(artifactRoot: string, target: string, runId: string) {
    this.runDir = join(artifactRoot, sanitize(target), runId);
    mkdirSync(this.runDir, { recursive: true });
  }

  private write(name: string, data: unknown): void {
    writeFileSync(
      join(this.runDir, name),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  }

  private read<T>(name: string): T | null {
    const path = join(this.runDir, name);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  }

  saveManifest(manifest: RunManifest): void {
    this.write("run-manifest.json", manifest);
  }

  loadManifest(): RunManifest | null {
    return this.read<RunManifest>("run-manifest.json");
  }

  saveClaimLedger(claims: Claim[]): void {
    this.write("claim-ledger.json", { claims, savedAt: new Date().toISOString() });
  }

  loadClaimLedger(): { claims: Claim[] } | null {
    return this.read("claim-ledger.json");
  }

  saveIssueLedger(issues: Issue[]): void {
    this.write("issue-ledger.json", { issues, savedAt: new Date().toISOString() });
  }

  loadIssueLedger(): { issues: Issue[] } | null {
    return this.read("issue-ledger.json");
  }

  saveAgreementMatrix(entries: AgreementEntry[]): void {
    this.write("agreement-matrix.json", {
      entries,
      savedAt: new Date().toISOString(),
    });
  }

  loadAgreementMatrix(): { entries: AgreementEntry[] } | null {
    return this.read("agreement-matrix.json");
  }

  saveDraftSynthesis(draft: DraftSynthesis): void {
    this.write("draft-synthesis.json", draft);
  }

  loadDraftSynthesis(): DraftSynthesis | null {
    return this.read("draft-synthesis.json");
  }

  saveRatificationRecord(votes: RatificationVote[]): void {
    this.write("ratification-record.json", {
      votes,
      savedAt: new Date().toISOString(),
    });
  }

  loadRatificationRecord(): { votes: RatificationVote[] } | null {
    return this.read("ratification-record.json");
  }

  saveFinalSynthesis(synthesis: FinalSynthesis): void {
    this.write("final-synthesis.json", synthesis);
  }

  loadFinalSynthesis(): FinalSynthesis | null {
    return this.read("final-synthesis.json");
  }

  savePrompt(task: string, context?: string): void {
    this.write("prompt.json", { task, context, savedAt: new Date().toISOString() });
  }

  saveLaneSelection(rationale: string, lanes: string[]): void {
    this.write("lane-selection.json", {
      rationale,
      lanes,
      savedAt: new Date().toISOString(),
    });
  }

  saveTranscript(phase: string, adapterId: string, content: string): void {
    const name = `transcript-${phase}-${adapterId}.txt`;
    writeFileSync(join(this.runDir, name), content, "utf-8");
  }

  saveReadme(manifest: RunManifest): void {
    const lines: string[] = [
      `# Conclave Run: ${manifest.runId}`,
      "",
      `**Task:** ${manifest.task}`,
      manifest.target ? `**Target:** ${manifest.target}` : "",
      `**Depth:** ${manifest.depth}`,
      `**Adapters:** ${manifest.adapters.join(", ")}`,
      `**Started:** ${manifest.startedAt}`,
      manifest.completedAt ? `**Completed:** ${manifest.completedAt}` : "",
      "",
      "## How to read this folder",
      "",
      "Start with **synthesis.md** — the human-readable deliverable assembled around the requested outcome, evidence-backed claims, assumptions, open questions, and disagreements.",
      "",
      "| File | Purpose |",
      "|------|---------|",
      "| `synthesis.md` | Deliverable-first summary with primary response, candidate deliverables, claims with evidence, assumptions, disagreements, and next actions |",
      "| `README.md` | This file — folder index and orientation |",
      "| `run-manifest.json` | Run metadata: task, normalized task contract, config, phases, timing |",
      "| `claim-ledger.json` | All claims with status and provenance |",
      "| `issue-ledger.json` | Disagreements and open questions with state transitions |",
      "| `agreement-matrix.json` | Per-claim agreement status across adapters |",
      "| `draft-synthesis.json` | Pre-ratification synthesis (structured) |",
      "| `ratification-record.json` | Each adapter's approve/block vote |",
      "| `final-synthesis.json` | Final structured synthesis with ratification outcome |",
      "| `prompt.json` | Original task input |",
      "| `lane-selection.json` | Which deliberation lanes were used and why |",
      "| `transcript-*.txt` | Raw adapter outputs per phase (if transcript retention is enabled) |",
      "",
      "## Protocol",
      "",
      "This run followed the Conclave deliberation protocol:",
      "1. **Input normalization** — task and config established",
      "2. **Discovery** — independent drafts and claim negotiation across adapters",
      "3. **Consolidation** — claims merged into agreement matrix",
      "4. **Validation** — fresh review pruning weak claims",
      "5. **Ratification** — each adapter votes approve/block on the draft",
      "6. **Synthesis** — final output with honest disagreement labeling",
    ];

    writeFileSync(join(this.runDir, "README.md"), lines.filter(l => l !== undefined).join("\n"), "utf-8");
  }

  saveSynthesisMarkdown(
    manifest: RunManifest,
    synthesis: FinalSynthesis,
    claims: Claim[],
    issues: Issue[],
    votes: RatificationVote[]
  ): void {
    const s = synthesis.synthesis;
    const supportedClaims = s.supportedClaimIds
      .map((claimId) => claims.find((claim) => claim.id === claimId))
      .filter((claim): claim is Claim => Boolean(claim));
    const openIssues = issues.filter((issue) => issue.state !== "resolved");
    const nextActions =
      s.recommendedNextActions.length > 0
        ? s.recommendedNextActions
        : deriveNextActions(manifest, synthesis, openIssues);
    const lines: string[] = [
      `# Deliverable: ${manifest.taskContract.requestedDeliverable}`,
      "",
      `> **Task:** ${manifest.task}`,
      manifest.target ? `> **Target:** ${manifest.target}` : "",
      `> **Depth:** ${manifest.depth} | **Adapters:** ${manifest.adapters.join(", ")} | **Run:** ${manifest.runId}`,
      `> **Date:** ${synthesis.producedAt}`,
      `> **Ratification:** ${
        synthesis.ratified
          ? "Ratified"
          : "Working draft with labeled disagreements"
      }`,
      "",
    ];

    lines.push("## Primary Response");
    lines.push("");
    lines.push(s.summary);
    lines.push("");

    if (s.candidateDeliverables.length > 0) {
      lines.push("## Candidate Deliverables Considered");
      lines.push("");
      for (const deliverable of s.candidateDeliverables) {
        const confidenceSuffix = deliverable.confidence
          ? ` (${deliverable.confidence} confidence)`
          : "";
        lines.push(`- ${deliverable.summary}${confidenceSuffix}`);
      }
      lines.push("");
    }

    lines.push("## Key Claims and Evidence");
    lines.push("");
    if (supportedClaims.length > 0) {
      for (const claim of supportedClaims) {
        lines.push(`- ${claim.text}`);
        if (claim.evidence && claim.evidence.length > 0) {
          lines.push(`  Evidence: ${claim.evidence.join("; ")}`);
        }
      }
    }
    if (s.acceptedHybrids.length > 0) {
      for (const hybrid of s.acceptedHybrids) {
        lines.push(`- Hybrid position: ${hybrid}`);
      }
    }
    if (supportedClaims.length === 0 && s.acceptedHybrids.length === 0) {
      lines.push("- No strongly supported claims were established.");
    }
    lines.push("");

    lines.push("## Assumptions and Constraints");
    lines.push("");
    lines.push(`- Requested deliverable: ${manifest.taskContract.requestedDeliverable}`);
    if (manifest.target) {
      lines.push(`- Target context: ${manifest.target}`);
    }
    if (s.assumptions.length > 0) {
      for (const assumption of s.assumptions) {
        lines.push(`- Assumption: ${assumption}`);
      }
    } else {
      lines.push("- Assumption: none surfaced");
    }
    if (manifest.taskContract.scopeHints.length > 0) {
      for (const hint of manifest.taskContract.scopeHints) {
        lines.push(`- Scope hint: ${hint}`);
      }
    } else {
      lines.push("- Scope hint: none captured");
    }
    if (manifest.taskContract.constraints.length > 0) {
      for (const constraint of manifest.taskContract.constraints) {
        lines.push(`- Constraint: ${constraint}`);
      }
    } else {
      lines.push("- Constraint: none captured");
    }
    lines.push("");

    lines.push("## Unresolved Questions");
    lines.push("");
    if (s.conditionalAgreements.length > 0) {
      for (const agreement of s.conditionalAgreements) {
        lines.push(`- Conditional agreement: ${agreement}`);
      }
    }
    if (openIssues.length > 0) {
      for (const issue of openIssues) {
        const detail =
          issue.description && issue.description !== issue.title
            ? ` — ${issue.description}`
            : "";
        lines.push(`- ${issue.title}${detail}`);
      }
    }
    if (s.conditionalAgreements.length === 0 && openIssues.length === 0) {
      lines.push("- No explicit open questions were captured.");
    }
    lines.push("");

    if (s.unresolvedDisagreements.length > 0) {
      lines.push("## Labeled Disagreements");
      lines.push("");
      for (const disagreement of s.unresolvedDisagreements) {
        lines.push(`### ${disagreement.title}`);
        lines.push("");
        lines.push(`Reason: ${disagreement.reason}`);
        lines.push("");
        for (const [adapter, position] of Object.entries(disagreement.positions)) {
          lines.push(`- ${adapter}: ${position}`);
        }
        lines.push("");
      }
    }

    lines.push("## Recommended Next Actions");
    lines.push("");
    for (const action of nextActions) {
      lines.push(`- ${action}`);
    }
    lines.push("");

    lines.push("## Ratification and Run Notes");
    lines.push("");
    lines.push(`- Ratification status: ${synthesis.ratified ? "ratified" : "not fully ratified"}`);
    lines.push(`- Claims processed: ${claims.length}`);
    lines.push(`- Issues raised: ${issues.length}`);
    lines.push(
      `- Phases completed cleanly: ${
        manifest.phases.filter((phase) => phase.status === "completed").length
      }/${manifest.phases.length}`
    );
    const partialPhases = manifest.phases.filter((phase) => phase.status === "partial");
    if (partialPhases.length > 0) {
      lines.push(
        `- Partially completed phases: ${partialPhases.map((phase) => phase.phase).join(", ")}`
      );
    }
    if (manifest.startedAt && manifest.completedAt) {
      const durationMs =
        new Date(manifest.completedAt).getTime() -
        new Date(manifest.startedAt).getTime();
      const durationMin = (durationMs / 60000).toFixed(1);
      lines.push(`- Duration: ${durationMin} minutes`);
    }
    for (const vote of votes) {
      lines.push(
        `- ${vote.adapterId}: ${vote.outcome}${
          vote.objections && vote.objections.length > 0
            ? ` (${vote.objections.join("; ")})`
            : ""
        }`
      );
    }
    lines.push("");

    lines.push("---");
    lines.push("");
    lines.push("*Generated by [Conclave](https://github.com/diegocalderon-dev/conclave) — a protocol-driven deliberation orchestrator.*");
    lines.push("*This synthesis reflects structured multi-model deliberation, not a single model's opinion.*");
    lines.push("*Unresolved disagreements are explicitly labeled and never presented as consensus.*");

    writeFileSync(join(this.runDir, "synthesis.md"), lines.filter(l => l !== undefined).join("\n"), "utf-8");
  }

  getRunDir(): string {
    return this.runDir;
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function deriveNextActions(
  manifest: RunManifest,
  synthesis: FinalSynthesis,
  openIssues: Issue[]
): string[] {
  const actions: string[] = [];

  if (
    synthesis.synthesis.agreedPoints.length > 0 ||
    synthesis.synthesis.acceptedHybrids.length > 0
  ) {
    actions.push(
      `Use the supported points above as the current basis for the requested deliverable: ${manifest.taskContract.requestedDeliverable}.`
    );
  }

  if (openIssues.length > 0) {
    actions.push(
      "Resolve the remaining open questions before treating this deliverable as complete."
    );
  }

  if (synthesis.synthesis.unresolvedDisagreements.length > 0) {
    actions.push(
      "Review the labeled disagreements and decide whether to gather more evidence, narrow scope, or accept the tradeoff explicitly."
    );
  }

  if (!synthesis.ratified) {
    actions.push(
      "Treat this output as a working draft until the blocking ratification objections are addressed."
    );
  }

  if (actions.length === 0) {
    actions.push("Use this ratified deliverable as the current working baseline.");
  }

  return actions;
}

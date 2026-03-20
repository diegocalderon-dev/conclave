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
      "Start with **synthesis.md** — the human-readable deliverable with conclusions and disagreements.",
      "",
      "| File | Purpose |",
      "|------|---------|",
      "| `synthesis.md` | Readable summary of conclusions, agreed points, and unresolved disagreements |",
      "| `README.md` | This file — folder index and orientation |",
      "| `run-manifest.json` | Run metadata: task, config, phases, timing |",
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
    const lines: string[] = [
      `# Deliberation Synthesis`,
      "",
      `> **Task:** ${manifest.task}`,
      manifest.target ? `> **Target:** ${manifest.target}` : "",
      `> **Depth:** ${manifest.depth} | **Adapters:** ${manifest.adapters.join(", ")} | **Run:** ${manifest.runId}`,
      `> **Date:** ${synthesis.producedAt}`,
      "",
    ];

    // Verdict
    if (synthesis.ratified) {
      lines.push("## Verdict: Ratified");
      lines.push("");
      lines.push("Both adapters approved this synthesis.");
    } else {
      lines.push("## Verdict: Synthesis with unresolved disagreements");
      lines.push("");
      lines.push("Not all adapters fully approved. Disagreements are labeled below.");
    }
    lines.push("");

    // Agreed points
    if (s.agreedPoints.length > 0) {
      lines.push(`## Agreed Points (${s.agreedPoints.length})`);
      lines.push("");
      for (const point of s.agreedPoints) {
        lines.push(`- ${point}`);
      }
      lines.push("");
    }

    // Accepted hybrids
    if (s.acceptedHybrids.length > 0) {
      lines.push(`## Accepted Hybrids (${s.acceptedHybrids.length})`);
      lines.push("");
      for (const hybrid of s.acceptedHybrids) {
        lines.push(`- ${hybrid}`);
      }
      lines.push("");
    }

    // Unresolved disagreements
    if (s.unresolvedDisagreements.length > 0) {
      lines.push(`## Unresolved Disagreements (${s.unresolvedDisagreements.length})`);
      lines.push("");
      for (const d of s.unresolvedDisagreements) {
        lines.push(`### ${d.title}`);
        lines.push("");
        lines.push(`**Reason:** ${d.reason}`);
        lines.push("");
        for (const [adapter, position] of Object.entries(d.positions)) {
          lines.push(`- **${adapter}:** ${position}`);
        }
        lines.push("");
      }
    }

    // Ratification votes
    lines.push("## Ratification Votes");
    lines.push("");
    for (const vote of votes) {
      const icon = vote.outcome === "approved" ? "[approved]" : "[BLOCKED]";
      lines.push(`- **${vote.adapterId}:** ${icon}`);
      if (vote.objections && vote.objections.length > 0) {
        for (const obj of vote.objections) {
          lines.push(`  - Objection: ${obj}`);
        }
      }
      if (vote.requestedEdits && vote.requestedEdits.length > 0) {
        for (const edit of vote.requestedEdits) {
          lines.push(`  - Requested edit: ${edit}`);
        }
      }
    }
    lines.push("");

    // Run summary
    lines.push("## Run Summary");
    lines.push("");
    lines.push(`- **Claims processed:** ${claims.length}`);
    lines.push(`- **Issues raised:** ${issues.length}`);
    lines.push(`- **Phases completed:** ${manifest.phases.filter(p => p.status === "completed").length}/${manifest.phases.length}`);
    if (manifest.startedAt && manifest.completedAt) {
      const durationMs = new Date(manifest.completedAt).getTime() - new Date(manifest.startedAt).getTime();
      const durationMin = (durationMs / 60000).toFixed(1);
      lines.push(`- **Duration:** ${durationMin} minutes`);
    }
    lines.push("");

    // Methodology note
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

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

  getRunDir(): string {
    return this.runDir;
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

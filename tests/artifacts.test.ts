import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ArtifactStore } from "../src/artifacts/store.js";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Claim, Issue, DraftSynthesis, FinalSynthesis } from "../src/core/types.js";

describe("ArtifactStore", () => {
  let store: ArtifactStore;
  const testRoot = join(tmpdir(), "conclave-test-artifacts");

  beforeEach(() => {
    store = new ArtifactStore(testRoot, "test-target", "test-run-001");
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true });
    }
  });

  test("creates run directory", () => {
    expect(existsSync(store.getRunDir())).toBe(true);
  });

  test("saves and loads claim ledger", () => {
    const claims: Claim[] = [
      {
        id: "claim-r1-0",
        text: "Test claim",
        status: "proposed",
        source: "test",
        round: 1,
      },
    ];
    store.saveClaimLedger(claims);
    const loaded = store.loadClaimLedger();
    expect(loaded).not.toBeNull();
    expect(loaded!.claims).toHaveLength(1);
    expect(loaded!.claims[0].id).toBe("claim-r1-0");
  });

  test("saves and loads issue ledger", () => {
    const issues: Issue[] = [
      {
        id: "issue-r1-0",
        title: "Test issue",
        description: "A test issue",
        state: "open",
        raisedBy: "test",
        round: 1,
        transitions: [],
      },
    ];
    store.saveIssueLedger(issues);
    const loaded = store.loadIssueLedger();
    expect(loaded).not.toBeNull();
    expect(loaded!.issues).toHaveLength(1);
    expect(loaded!.issues[0].state).toBe("open");
  });

  test("saves and loads agreement matrix", () => {
    store.saveAgreementMatrix([
      {
        claimId: "claim-r1-0",
        status: "agreed",
        positions: { test: "Agreed" },
      },
    ]);
    const loaded = store.loadAgreementMatrix();
    expect(loaded).not.toBeNull();
    expect(loaded!.entries).toHaveLength(1);
  });

  test("saves and loads draft synthesis", () => {
    const draft: DraftSynthesis = {
      version: 1,
      agreedPoints: ["Point A"],
      acceptedHybrids: [],
      unresolvedDisagreements: [],
      conditionalAgreements: [],
      summary: "Test synthesis",
    };
    store.saveDraftSynthesis(draft);
    const loaded = store.loadDraftSynthesis();
    expect(loaded).not.toBeNull();
    expect(loaded!.agreedPoints).toEqual(["Point A"]);
  });

  test("saves and loads final synthesis", () => {
    const final: FinalSynthesis = {
      ratified: true,
      ratificationVotes: [{ adapterId: "test", outcome: "approved" }],
      synthesis: {
        version: 1,
        agreedPoints: ["Point A"],
        acceptedHybrids: [],
        unresolvedDisagreements: [],
        conditionalAgreements: [],
        summary: "Test",
      },
      producedAt: new Date().toISOString(),
    };
    store.saveFinalSynthesis(final);
    const loaded = store.loadFinalSynthesis();
    expect(loaded).not.toBeNull();
    expect(loaded!.ratified).toBe(true);
  });

  test("saves manifest", () => {
    store.saveManifest({
      runId: "test-run-001",
      task: "Test task",
      depth: "medium",
      autonomy: "supervised",
      transcriptRetention: "summary",
      adapters: ["test"],
      activeLanes: ["independent-draft"],
      startedAt: new Date().toISOString(),
      artifactRoot: testRoot,
      phases: [],
    });
    const loaded = store.loadManifest();
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe("test-run-001");
  });

  test("saves transcript files", () => {
    store.saveTranscript("discovery", "test", "This is a transcript");
    const path = join(store.getRunDir(), "transcript-discovery-test.txt");
    expect(existsSync(path)).toBe(true);
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ArtifactStore } from "../src/artifacts/store.js";
import { existsSync, readFileSync, rmSync } from "fs";
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
        claimIds: ["claim-r1-0"],
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
      candidateDeliverables: [],
      agreedPoints: ["Point A"],
      supportedClaimIds: ["claim-r1-0"],
      acceptedHybrids: [],
      assumptions: [],
      unresolvedDisagreements: [],
      conditionalAgreements: [],
      recommendedNextActions: [],
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
        candidateDeliverables: [],
        agreedPoints: ["Point A"],
        supportedClaimIds: ["claim-r1-0"],
        acceptedHybrids: [],
        assumptions: [],
        unresolvedDisagreements: [],
        conditionalAgreements: [],
        recommendedNextActions: [],
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
      taskContract: {
        prompt: "Test task",
        requestedDeliverable: "Test task",
        scopeHints: [],
        constraints: [],
      },
      depth: "low",
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

  test("writes deliverable-first synthesis markdown", () => {
    const manifest = {
      runId: "test-run-001",
      task: "Draft a refinement plan",
      target: "/tmp/example-repo",
      taskContract: {
        prompt: "Draft a refinement plan",
        requestedDeliverable: "Draft a refinement plan",
        scopeHints: ["/tmp/example-repo"],
        constraints: [],
        targetContext: "/tmp/example-repo",
      },
      depth: "low" as const,
      autonomy: "supervised" as const,
      transcriptRetention: "summary" as const,
      adapters: ["claude", "codex"],
      activeLanes: ["independent-draft"],
      startedAt: "2026-03-20T00:00:00.000Z",
      completedAt: "2026-03-20T00:01:00.000Z",
      artifactRoot: testRoot,
      phases: [
        {
          phase: "discovery" as const,
          startedAt: "2026-03-20T00:00:00.000Z",
          completedAt: "2026-03-20T00:00:10.000Z",
          status: "partial" as const,
          summary: "One adapter returned an empty response.",
        },
      ],
    };
    const final: FinalSynthesis = {
      ratified: false,
      ratificationVotes: [
        {
          adapterId: "claude",
          outcome: "approved",
        },
        {
          adapterId: "codex",
          outcome: "blocked",
          objections: ["Needs clearer disagreement labeling."],
        },
      ],
      synthesis: {
        version: 1,
        candidateDeliverables: [
          {
            id: "deliverable-r1-0",
            summary: "Draft a refinement plan document",
            source: "claude",
            round: 1,
            confidence: "medium",
          },
        ],
        agreedPoints: ["Keep the default path fast."],
        supportedClaimIds: ["claim-r1-0"],
        acceptedHybrids: ["Preserve a deterministic consolidation step."],
        assumptions: ["The task is still at planning scope, not implementation scope."],
        unresolvedDisagreements: [
          {
            issueId: "ratification-codex",
            title: "Ratification objection from codex",
            positions: {
              codex: "Needs clearer disagreement labeling.",
            },
            reason: "Blocked during ratification.",
          },
        ],
        conditionalAgreements: ["Proceed once the target scope is confirmed."],
        recommendedNextActions: [
          "Resolve the remaining open questions before treating the deliverable as complete.",
        ],
        summary: "Keep the default path fast while preserving deterministic consolidation.",
      },
      producedAt: "2026-03-20T00:01:00.000Z",
    };
    const claims: Claim[] = [
      {
        id: "claim-r1-0",
        text: "Keep the default path fast.",
        status: "proposed",
        source: "claude",
        round: 1,
        evidence: ["ADR 002 moves the default depth to low."],
      },
    ];
    const issues: Issue[] = [
      {
        id: "issue-r1-0",
        title: "Confirm the repo scope",
        description: "Need to confirm whether the target is the local checkout or a linked worktree.",
        state: "open",
        raisedBy: "claude",
        round: 1,
        transitions: [],
      },
    ];

    store.saveSynthesisMarkdown(
      manifest,
      final,
      claims,
      issues,
      final.ratificationVotes
    );

    const markdown = readFileSync(join(store.getRunDir(), "synthesis.md"), "utf-8");
    expect(markdown).toContain("# Deliverable: Draft a refinement plan");
    expect(markdown).toContain("## Primary Response");
    expect(markdown).toContain("## Candidate Deliverables Considered");
    expect(markdown).toContain("## Key Claims and Evidence");
    expect(markdown).toContain("## Assumptions and Constraints");
    expect(markdown).toContain("## Unresolved Questions");
    expect(markdown).toContain("## Labeled Disagreements");
    expect(markdown).toContain("## Recommended Next Actions");
    expect(markdown).toContain("## Ratification and Run Notes");
    expect(markdown).toContain("Evidence: ADR 002 moves the default depth to low.");
    expect(markdown).toContain("Assumption: The task is still at planning scope, not implementation scope.");
    expect(markdown).not.toContain("## Verdict");
    expect(markdown).not.toContain("## Agreed Points");
  });
});

import { describe, test, expect, afterEach } from "bun:test";
import { executeRun } from "../src/orchestration/engine.js";
import { getDefaultConfig } from "../src/config/loader.js";
import type { Adapter, AdapterCapabilities, AdapterResponse } from "../src/core/types.js";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const artifactRoot = join(tmpdir(), "conclave-live-engine-test");

function createScriptedAdapter(
  id: string,
  responder: (prompt: string) => string
): Adapter {
  return {
    id,
    async detect(): Promise<AdapterCapabilities> {
      return {
        id,
        name: id,
        available: true,
        command: id,
        nonInteractiveSupported: true,
        structuredOutputSupported: true,
        features: [],
      };
    },
    async invoke(prompt: string): Promise<AdapterResponse> {
      return {
        content: responder(prompt),
        exitCode: 0,
        durationMs: 1,
      };
    },
  };
}

function successfulValidationResponse(): string {
  return JSON.stringify({
    feasibilityIssues: [],
    missingConstraints: [],
    unsupportedClaims: [],
    hiddenAssumptions: [],
    misstatements: [],
    recommendations: [],
    overallAssessment: "adequate",
  });
}

afterEach(() => {
  if (existsSync(artifactRoot)) {
    rmSync(artifactRoot, { recursive: true });
  }
});

describe("Live Engine", () => {
  test("normalizes the task contract and completes synthesis with deterministic consolidation", async () => {
    const responder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return JSON.stringify({
          proposal: "Preserve task-neutral artifacts while keeping the default path fast.",
          candidateDeliverables: [
            "A concise refinement plan for the harness refactor",
          ],
          assumptions: ["The task is asking for repo-level planning, not implementation details."],
          constraints: ["Keep the protocol task-neutral."],
          risks: [],
          openQuestions: [],
          confidence: "medium",
          claims: [
            {
              text: "Preserve task-neutral artifacts",
              evidence: ["ADR 002 requires a single protocol for all prompts."],
            },
            {
              text: "Keep the default path fast",
              evidence: ["ADR 002 changes the default depth to low."],
            },
          ],
        });
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        return successfulValidationResponse();
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        return JSON.stringify({ outcome: "approved", objections: [], requestedEdits: [] });
      }
      return "";
    };

    const result = await executeRun({
      task: "Refinement plan:",
      target: "/tmp/example-repo",
      config: {
        ...getDefaultConfig(),
        artifactRoot,
      },
      adapters: [
        createScriptedAdapter("claude", responder),
        createScriptedAdapter("codex", responder),
      ],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.manifest.taskContract.prompt).toBe("Refinement plan:");
    expect(result.manifest.taskContract.requestedDeliverable).toBe("Refinement plan");
    expect(result.manifest.taskContract.scopeHints).toContain("/tmp/example-repo");
    expect(
      result.manifest.phases.find((phase) => phase.phase === "synthesis")?.status
    ).toBe("completed");
    expect(result.finalSynthesis?.synthesis.candidateDeliverables.length).toBeGreaterThan(0);
    expect(result.finalSynthesis?.synthesis.assumptions).toContain(
      "The task is asking for repo-level planning, not implementation details."
    );
    expect(result.finalSynthesis?.synthesis.supportedClaimIds.length).toBeGreaterThan(0);

    const matrix = JSON.parse(
      readFileSync(join(result.artifactDir, "agreement-matrix.json"), "utf-8")
    ) as { entries: Array<unknown> };
    expect(matrix.entries.length).toBeGreaterThan(0);
    expect(result.finalSynthesis?.ratified).toBe(true);
  });

  test("runs a bounded repair pass when ratification blocks", async () => {
    let blockedRatificationCalls = 0;

    const approvingResponder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return "1. Preserve deterministic consolidation";
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        return successfulValidationResponse();
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        return JSON.stringify({ outcome: "approved", objections: [], requestedEdits: [] });
      }
      return "";
    };

    const blockingResponder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return "1. Preserve deterministic consolidation";
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        return successfulValidationResponse();
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        blockedRatificationCalls += 1;
        return JSON.stringify({
          outcome: "blocked",
          objections: ["The synthesis needs explicit disagreement labeling."],
          requestedEdits: ["Attach the ratification objection as a labeled disagreement."],
        });
      }
      return "";
    };

    const result = await executeRun({
      task: "Plan the protocol refactor",
      config: {
        ...getDefaultConfig(),
        artifactRoot,
      },
      adapters: [
        createScriptedAdapter("claude", approvingResponder),
        createScriptedAdapter("codex", blockingResponder),
      ],
    });

    expect(blockedRatificationCalls).toBe(2);
    expect(result.finalSynthesis?.ratified).toBe(false);
    expect(
      result.manifest.phases.find((phase) => phase.phase === "ratification")?.status
    ).toBe("partial");
    expect(
      result.finalSynthesis?.synthesis.unresolvedDisagreements.some(
        (disagreement) => disagreement.issueId === "ratification-codex"
      )
    ).toBe(true);
    expect(
      existsSync(join(result.artifactDir, "transcript-ratification-repair-codex.txt"))
    ).toBe(true);
  });

  test("marks discovery partial when an adapter returns an empty discovery response", async () => {
    const successfulResponder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return "1. Preserve task-neutral artifacts";
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        return successfulValidationResponse();
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        return JSON.stringify({ outcome: "approved", objections: [], requestedEdits: [] });
      }
      return "";
    };

    const emptyDiscoveryResponder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return "";
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        return successfulValidationResponse();
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        return JSON.stringify({ outcome: "approved", objections: [], requestedEdits: [] });
      }
      return "";
    };

    const result = await executeRun({
      task: "Create a first draft response",
      config: {
        ...getDefaultConfig(),
        artifactRoot,
      },
      adapters: [
        createScriptedAdapter("claude", successfulResponder),
        createScriptedAdapter("codex", emptyDiscoveryResponder),
      ],
    });

    expect(
      result.manifest.phases.find((phase) => phase.phase === "discovery")?.status
    ).toBe("partial");
    expect(result.errors.some((error) => error.includes("empty response"))).toBe(true);
    expect(result.finalSynthesis).not.toBeNull();
    expect(result.finalSynthesis?.synthesis.summary.length).toBeGreaterThan(0);
  });

  test("treats malformed ratification output as a blocked vote", async () => {
    const approvingResponder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return "1. Preserve task-neutral artifacts";
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        return successfulValidationResponse();
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        return JSON.stringify({ outcome: "approved", objections: [], requestedEdits: [] });
      }
      return "";
    };

    const malformedRatificationResponder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return "1. Preserve task-neutral artifacts";
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        return successfulValidationResponse();
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        return "approve this as-is";
      }
      return "";
    };

    const result = await executeRun({
      task: "Assemble a working draft",
      config: {
        ...getDefaultConfig(),
        artifactRoot,
      },
      adapters: [
        createScriptedAdapter("claude", approvingResponder),
        createScriptedAdapter("codex", malformedRatificationResponder),
      ],
    });

    expect(result.finalSynthesis?.ratified).toBe(false);
    expect(
      result.finalSynthesis?.ratificationVotes.find((vote) => vote.adapterId === "codex")
        ?.outcome
    ).toBe("blocked");
    expect(
      result.finalSynthesis?.synthesis.unresolvedDisagreements.some(
        (disagreement) => disagreement.issueId === "ratification-codex"
      )
    ).toBe(true);
    expect(
      result.errors.some((error) =>
        error.includes("Ratification codex: No JSON object found in ratification response")
      )
    ).toBe(true);
  });

  test("validation prunes unsupported claims by exact claim id", async () => {
    let unsupportedClaimId = "";

    const discoveryResponder = (prompt: string) => {
      if (prompt.includes("independent first-pass analysis")) {
        return JSON.stringify({
          proposal: "Produce a working draft.",
          candidateDeliverables: ["A working draft"],
          assumptions: [],
          risks: [],
          openQuestions: [],
          confidence: "medium",
          claims: [
            {
              text: "Keep the default path fast",
              evidence: ["ADR 002 changes the default depth to low."],
            },
            {
              text: "Introduce a costly extra consensus pass by default",
              evidence: ["This claim should be pruned by validation."],
            },
          ],
        });
      }
      if (prompt.includes("atomic-claim negotiation")) {
        return "[]";
      }
      if (prompt.includes("Validate the following consolidated findings")) {
        const claimMatch = prompt.match(/\[(claim-r1-\d+)\].*costly extra consensus pass by default/i);
        unsupportedClaimId = claimMatch?.[1] || "";
        return JSON.stringify({
          feasibilityIssues: [],
          missingConstraints: [],
          unsupportedClaimIds: unsupportedClaimId ? [unsupportedClaimId] : [],
          hiddenAssumptions: [],
          misstatements: [],
          recommendations: [],
          recommendedNextActions: [],
          overallAssessment: "adequate",
        });
      }
      if (prompt.includes("Review this synthesis draft for ratification")) {
        return JSON.stringify({ outcome: "approved", objections: [], requestedEdits: [] });
      }
      return "";
    };

    const result = await executeRun({
      task: "Assemble a working draft",
      config: {
        ...getDefaultConfig(),
        artifactRoot,
      },
      adapters: [
        createScriptedAdapter("claude", discoveryResponder),
        createScriptedAdapter("codex", discoveryResponder),
      ],
    });

    const claimLedger = JSON.parse(
      readFileSync(join(result.artifactDir, "claim-ledger.json"), "utf-8")
    ) as { claims: Array<{ id: string; status: string }> };

    expect(unsupportedClaimId).toBeTruthy();
    expect(
      claimLedger.claims.find((claim) => claim.id === unsupportedClaimId)?.status
    ).toBe("withdrawn");
  });
});

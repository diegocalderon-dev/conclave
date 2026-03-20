import { describe, test, expect } from "bun:test";
import {
  validateClaim,
  validateIssue,
  validateIssueTransition,
  validateAgreementEntry,
  validateDraftSynthesis,
  validateFinalSynthesis,
  validateTaskContract,
  validateRunManifest,
} from "../src/validation/artifacts.js";
import type {
  AgreementEntry,
  Claim,
  Issue,
  DraftSynthesis,
  FinalSynthesis,
  NormalizedTaskContract,
  RunManifest,
} from "../src/core/types.js";

describe("Artifact Validation", () => {
  describe("validateTaskContract", () => {
    test("valid contract passes", () => {
      const contract: NormalizedTaskContract = {
        prompt: "Review the auth flow",
        requestedDeliverable: "Review the auth flow",
        scopeHints: [],
        constraints: [],
      };
      expect(validateTaskContract(contract)).toHaveLength(0);
    });

    test("missing requested deliverable fails", () => {
      const contract = {
        prompt: "Review the auth flow",
        requestedDeliverable: "",
        scopeHints: [],
        constraints: [],
      } as NormalizedTaskContract;
      expect(
        validateTaskContract(contract).some(
          (error) => error.field === "requestedDeliverable"
        )
      ).toBe(true);
    });
  });

  describe("validateRunManifest", () => {
    test("manifest requires a task contract", () => {
      const manifest = {
        runId: "run-1",
        task: "Review the auth flow",
        taskContract: {
          prompt: "Review the auth flow",
          requestedDeliverable: "",
          scopeHints: [],
          constraints: [],
        },
        depth: "low",
        autonomy: "supervised",
        transcriptRetention: "summary",
        adapters: ["claude"],
        activeLanes: ["independent-draft"],
        startedAt: new Date().toISOString(),
        artifactRoot: "/tmp/conclave",
        phases: [],
      } as RunManifest;
      expect(
        validateRunManifest(manifest).some((error) =>
          error.field.startsWith("taskContract.")
        )
      ).toBe(true);
    });
  });

  describe("validateClaim", () => {
    test("valid claim passes", () => {
      const claim: Claim = {
        id: "claim-r1-0",
        text: "Test claim",
        status: "proposed",
        source: "test",
        round: 1,
      };
      expect(validateClaim(claim)).toHaveLength(0);
    });

    test("missing id fails", () => {
      const claim = { id: "", text: "Test", status: "proposed", source: "test", round: 1 } as Claim;
      expect(validateClaim(claim).length).toBeGreaterThan(0);
    });

    test("invalid status fails", () => {
      const claim = { id: "c1", text: "Test", status: "invalid" as any, source: "test", round: 1 } as Claim;
      const errors = validateClaim(claim);
      expect(errors.some((e) => e.field === "status")).toBe(true);
    });
  });

  describe("validateAgreementEntry", () => {
    test("requires stable claim references", () => {
      const entry = {
        claimId: "claim-r1-0",
        claimIds: [],
        status: "agreed",
        positions: { claude: "agreed" },
      } as AgreementEntry;
      expect(
        validateAgreementEntry(entry).some((error) => error.field === "claimIds")
      ).toBe(true);
    });
  });

  describe("validateIssue", () => {
    test("valid issue passes", () => {
      const issue: Issue = {
        id: "issue-r1-0",
        title: "Test issue",
        description: "Desc",
        state: "open",
        raisedBy: "test",
        round: 1,
        transitions: [],
      };
      expect(validateIssue(issue)).toHaveLength(0);
    });

    test("invalid state fails", () => {
      const issue = {
        id: "i1",
        title: "T",
        description: "D",
        state: "bogus" as any,
        raisedBy: "t",
        round: 1,
        transitions: [],
      } as Issue;
      expect(validateIssue(issue).some((e) => e.field === "state")).toBe(true);
    });
  });

  describe("Issue Transitions", () => {
    test("open -> resolved is valid", () => {
      expect(validateIssueTransition("open", "resolved")).toBe(true);
    });

    test("open -> narrowed is valid", () => {
      expect(validateIssueTransition("open", "narrowed")).toBe(true);
    });

    test("resolved -> open is invalid (terminal)", () => {
      expect(validateIssueTransition("resolved", "open")).toBe(false);
    });

    test("irreducible_disagreement is terminal", () => {
      expect(validateIssueTransition("irreducible_disagreement", "open")).toBe(false);
    });

    test("narrowed -> hybrid_proposed is valid", () => {
      expect(validateIssueTransition("narrowed", "hybrid_proposed")).toBe(true);
    });
  });

  describe("Disagreement Labeling", () => {
    test("draft synthesis must not present disputes as consensus", () => {
      const draft: DraftSynthesis = {
        version: 1,
        candidateDeliverables: [],
        agreedPoints: ["Use caching for invalidation strategy"],
        supportedClaimIds: ["claim-r1-0"],
        acceptedHybrids: [],
        assumptions: [],
        unresolvedDisagreements: [
          {
            issueId: "i1",
            title: "invalidation strategy",
            positions: { a: "TTL", b: "Event-driven" },
            reason: "No consensus",
          },
        ],
        conditionalAgreements: [],
        recommendedNextActions: [],
        summary: "Test",
      };
      const errors = validateDraftSynthesis(draft);
      expect(errors.some((e) => e.message.includes("must not present disputes as consensus"))).toBe(true);
    });

    test("clean draft synthesis passes", () => {
      const draft: DraftSynthesis = {
        version: 1,
        candidateDeliverables: [],
        agreedPoints: ["Use Redis"],
        supportedClaimIds: ["claim-r1-0"],
        acceptedHybrids: [],
        assumptions: [],
        unresolvedDisagreements: [],
        conditionalAgreements: [],
        recommendedNextActions: [],
        summary: "Test",
      };
      expect(validateDraftSynthesis(draft)).toHaveLength(0);
    });
  });

  describe("Final Synthesis", () => {
    test("non-ratified must have blocks or disagreements", () => {
      const synthesis: FinalSynthesis = {
        ratified: false,
        ratificationVotes: [{ adapterId: "test", outcome: "approved" }],
        synthesis: {
          version: 1,
          candidateDeliverables: [],
          agreedPoints: [],
          supportedClaimIds: [],
          acceptedHybrids: [],
          assumptions: [],
          unresolvedDisagreements: [],
          conditionalAgreements: [],
          recommendedNextActions: [],
          summary: "",
        },
        producedAt: new Date().toISOString(),
      };
      const errors = validateFinalSynthesis(synthesis);
      expect(errors.some((e) => e.field === "ratified")).toBe(true);
    });

    test("ratified synthesis passes", () => {
      const synthesis: FinalSynthesis = {
        ratified: true,
        ratificationVotes: [
          { adapterId: "claude", outcome: "approved" },
          { adapterId: "codex", outcome: "approved" },
        ],
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
          summary: "Ratified",
        },
        producedAt: new Date().toISOString(),
      };
      expect(validateFinalSynthesis(synthesis)).toHaveLength(0);
    });
  });
});

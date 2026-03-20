import { describe, test, expect } from "bun:test";
import { selectLanes } from "../src/protocol/lanes.js";
import type { LaneType } from "../src/core/types.js";

const defaultLaneConfig = {
  enabled: [
    "independent-draft",
    "atomic-claim",
    "issue-debate",
    "hybrid-edit",
    "contrarian",
  ] as LaneType[],
  maxParallel: 3,
};

describe("Lane Selection", () => {
  test("round 1 always selects independent-draft", () => {
    const result = selectLanes({
      task: "Test",
      depth: "medium",
      laneConfig: defaultLaneConfig,
      existingClaims: [],
      existingIssues: [],
      round: 1,
    });
    expect(result.activeLanes).toEqual(["independent-draft"]);
  });

  test("round 2 with claims selects atomic-claim", () => {
    const result = selectLanes({
      task: "Test",
      depth: "medium",
      laneConfig: defaultLaneConfig,
      existingClaims: [
        { id: "c1", text: "Claim", status: "proposed", source: "test", round: 1 },
      ],
      existingIssues: [],
      round: 2,
    });
    expect(result.activeLanes).toContain("atomic-claim");
  });

  test("round 2 with open issues selects issue-debate", () => {
    const result = selectLanes({
      task: "Test",
      depth: "medium",
      laneConfig: defaultLaneConfig,
      existingClaims: [],
      existingIssues: [
        {
          id: "i1",
          title: "Issue",
          description: "",
          state: "open",
          raisedBy: "test",
          round: 1,
          transitions: [],
        },
      ],
      round: 2,
    });
    expect(result.activeLanes).toContain("issue-debate");
  });

  test("contrarian only at round 3+ and high depth", () => {
    const result = selectLanes({
      task: "Test",
      depth: "high",
      laneConfig: defaultLaneConfig,
      existingClaims: [
        { id: "c1", text: "A", status: "accepted", source: "test", round: 1 },
        { id: "c2", text: "B", status: "accepted", source: "test", round: 1 },
      ],
      existingIssues: [],
      round: 3,
    });
    expect(result.activeLanes).toContain("contrarian");
  });

  test("low depth does not select contrarian even at round 3", () => {
    const result = selectLanes({
      task: "Test",
      depth: "low",
      laneConfig: defaultLaneConfig,
      existingClaims: [],
      existingIssues: [],
      round: 3,
    });
    expect(result.activeLanes).not.toContain("contrarian");
  });

  test("respects adapter suggestions", () => {
    const result = selectLanes({
      task: "Test",
      depth: "medium",
      laneConfig: defaultLaneConfig,
      existingClaims: [],
      existingIssues: [],
      round: 2,
      adapterSuggestions: ["hybrid-edit"],
    });
    expect(result.activeLanes).toContain("hybrid-edit");
  });
});

import { describe, test, expect } from "bun:test";
import { takeSnapshot, detectStagnation, type RoundSnapshot } from "../src/protocol/stagnation.js";

describe("Stagnation Detection", () => {
  test("no stagnation with 1 snapshot", () => {
    const snapshots: RoundSnapshot[] = [
      { round: 1, claimCount: 5, acceptedCount: 0, rejectedCount: 0, openIssueCount: 2, resolvedIssueCount: 0 },
    ];
    expect(detectStagnation(snapshots, 2).stagnant).toBe(false);
  });

  test("no stagnation when deltas are meaningful", () => {
    const snapshots: RoundSnapshot[] = [
      { round: 1, claimCount: 5, acceptedCount: 0, rejectedCount: 0, openIssueCount: 2, resolvedIssueCount: 0 },
      { round: 2, claimCount: 8, acceptedCount: 3, rejectedCount: 1, openIssueCount: 1, resolvedIssueCount: 1 },
    ];
    expect(detectStagnation(snapshots, 2).stagnant).toBe(false);
  });

  test("detects stagnation after threshold of no-change rounds", () => {
    const snapshots: RoundSnapshot[] = [
      { round: 1, claimCount: 5, acceptedCount: 3, rejectedCount: 1, openIssueCount: 1, resolvedIssueCount: 0 },
      { round: 2, claimCount: 5, acceptedCount: 3, rejectedCount: 1, openIssueCount: 1, resolvedIssueCount: 0 },
      { round: 3, claimCount: 5, acceptedCount: 3, rejectedCount: 1, openIssueCount: 1, resolvedIssueCount: 0 },
    ];
    expect(detectStagnation(snapshots, 2).stagnant).toBe(true);
  });

  test("takeSnapshot produces correct counts", () => {
    const claims = [
      { id: "c1", text: "A", status: "accepted" as const, source: "t", round: 1 },
      { id: "c2", text: "B", status: "rejected" as const, source: "t", round: 1 },
      { id: "c3", text: "C", status: "proposed" as const, source: "t", round: 1 },
    ];
    const issues = [
      { id: "i1", title: "I", description: "", state: "open" as const, raisedBy: "t", round: 1, transitions: [] },
      { id: "i2", title: "I2", description: "", state: "resolved" as const, raisedBy: "t", round: 1, transitions: [] },
    ];
    const snap = takeSnapshot(1, claims, issues);
    expect(snap.claimCount).toBe(3);
    expect(snap.acceptedCount).toBe(1);
    expect(snap.rejectedCount).toBe(1);
    expect(snap.openIssueCount).toBe(1);
    expect(snap.resolvedIssueCount).toBe(1);
  });
});

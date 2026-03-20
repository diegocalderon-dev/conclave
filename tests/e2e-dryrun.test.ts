import { describe, test, expect, afterAll } from "bun:test";
import { executeRun } from "../src/orchestration/engine.js";
import { getDefaultConfig } from "../src/config/loader.js";
import { ClaudeAdapter } from "../src/adapters/claude/adapter.js";
import { CodexAdapter } from "../src/adapters/codex/adapter.js";
import { existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("E2E Dry Run", () => {
  const artifactRoot = join(tmpdir(), "conclave-e2e-test");

  afterAll(() => {
    if (existsSync(artifactRoot)) {
      rmSync(artifactRoot, { recursive: true });
    }
  });

  test("completes a full dry-run and produces all artifacts", async () => {
    const config = {
      ...getDefaultConfig(),
      artifactRoot,
    };

    const result = await executeRun({
      task: "Design a testing strategy for microservices",
      target: "test-project",
      config,
      adapters: [new ClaudeAdapter(), new CodexAdapter()],
      dryRun: true,
    });

    // Verify run completed
    expect(result.runId).toBeTruthy();
    expect(result.artifactDir).toBeTruthy();
    expect(existsSync(result.artifactDir)).toBe(true);

    // Verify all mandatory artifacts exist
    const dir = result.artifactDir;
    expect(existsSync(join(dir, "run-manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "claim-ledger.json"))).toBe(true);
    expect(existsSync(join(dir, "issue-ledger.json"))).toBe(true);
    expect(existsSync(join(dir, "agreement-matrix.json"))).toBe(true);
    expect(existsSync(join(dir, "draft-synthesis.json"))).toBe(true);
    expect(existsSync(join(dir, "ratification-record.json"))).toBe(true);
    expect(existsSync(join(dir, "final-synthesis.json"))).toBe(true);
    expect(existsSync(join(dir, "prompt.json"))).toBe(true);
    expect(existsSync(join(dir, "lane-selection.json"))).toBe(true);

    // Verify manifest structure
    const manifest = JSON.parse(readFileSync(join(dir, "run-manifest.json"), "utf-8"));
    expect(manifest.task).toBe("Design a testing strategy for microservices");
    expect(manifest.depth).toBe("low");
    expect(manifest.phases.length).toBe(6);
    expect(manifest.completedAt).toBeTruthy();

    // Verify final synthesis structure
    const final = result.finalSynthesis;
    expect(final).not.toBeNull();
    expect(final!.synthesis.agreedPoints).toBeInstanceOf(Array);
    expect(final!.synthesis.unresolvedDisagreements).toBeInstanceOf(Array);
    expect(final!.producedAt).toBeTruthy();

    // Verify claim ledger
    const claimLedger = JSON.parse(readFileSync(join(dir, "claim-ledger.json"), "utf-8"));
    expect(claimLedger.claims.length).toBeGreaterThan(0);

    // Verify issue ledger
    const issueLedger = JSON.parse(readFileSync(join(dir, "issue-ledger.json"), "utf-8"));
    expect(issueLedger.issues.length).toBeGreaterThan(0);

    // No errors expected in dry run
    expect(result.errors).toHaveLength(0);
  });
});

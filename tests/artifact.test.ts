import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveArtifact } from "../src/artifact.ts";
import { createSession } from "../src/session.ts";
import type { Session } from "../src/session.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "conclave-artifact-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function buildAcceptedSession(): Session {
  const session = createSession("Analyze why the banner is duplicated", { maxSteps: 6 });
  session.status = "accepted";
  session.acceptedAt = "2026-04-09T16:00:00.000Z";
  session.steps.push({
    number: 0,
    agent: "claude",
    role: "analyze",
    content: "Claude initial analysis of the banner issue",
    durationMs: 5000,
  });
  session.steps.push({
    number: 1,
    agent: "codex",
    role: "review",
    content: "Codex review: mostly correct but missing edge case",
    durationMs: 4000,
    steer: "Focus on the useMbm hook",
  });
  session.steps.push({
    number: 2,
    agent: "claude",
    role: "refine",
    content: "Claude refined analysis addressing the review",
    durationMs: 3000,
  });
  return session;
}

describe("saveArtifact", () => {
  test("generates markdown with frontmatter for accepted sessions", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir);

    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);

    const content = readFileSync(path!, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("conclave_session:");
    expect(content).toContain("status: accepted");
    expect(content).toContain("steps: 3");
    expect(content).toContain("agents: [claude, codex]");
  });

  test("final output is the last step's content", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");

    // Final Output section should have the last step
    expect(content).toContain("## Final Output");
    expect(content).toContain("Claude refined analysis addressing the review");
  });

  test("includes full session history with roles", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");

    expect(content).toContain("claude (analyze)");
    expect(content).toContain("codex (review)");
    expect(content).toContain("claude (refine)");
    expect(content).toContain("[steered]");
  });

  test("includes session metadata", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");

    expect(content).toContain("Steer interventions: 1");
    expect(content).toContain("Steps: 3");
  });

  test("saves session.json alongside markdown", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const dir = path.replace("/output.md", "");
    const jsonPath = join(dir, "session.json");

    expect(existsSync(jsonPath)).toBe(true);
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(raw.steps).toHaveLength(3);
    expect(raw.status).toBe("accepted");
  });

  test("returns null for non-accepted sessions", () => {
    const session = createSession("abandoned task", { maxSteps: 6 });
    session.status = "abandoned";
    session.steps.push({
      number: 0,
      agent: "claude",
      role: "analyze",
      content: "output",
      durationMs: 1000,
    });

    const path = saveArtifact(session, tempDir);
    expect(path).toBeNull();
  });

  test("returns null for active sessions", () => {
    const session = createSession("active task", { maxSteps: 6 });
    const path = saveArtifact(session, tempDir);
    expect(path).toBeNull();
  });

  test("escapes quotes in title frontmatter", () => {
    const session = createSession('Why does "premium" banner appear twice?', { maxSteps: 6 });
    session.status = "accepted";
    session.acceptedAt = new Date().toISOString();
    session.steps.push({
      number: 0,
      agent: "claude",
      role: "analyze",
      content: "output",
      durationMs: 1000,
    });

    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");
    expect(content).toContain('\\"premium\\"');
  });

  test("calculates total duration from all steps", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");

    // 5000 + 4000 + 3000 = 12000ms = 12s
    expect(content).toContain("duration_seconds: 12");
  });
});

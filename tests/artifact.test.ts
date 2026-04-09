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
  const session = createSession("Analyze why the banner is duplicated", { maxRounds: 3 });
  session.status = "accepted";
  session.acceptedAt = "2026-04-09T16:00:00.000Z";
  session.rounds.push({
    number: 0,
    claude: { content: "Claude initial draft", durationMs: 5000 },
    codex: { content: "Codex initial draft", durationMs: 6000 },
  });
  session.rounds.push({
    number: 1,
    claude: { content: "Claude refined analysis with agreements", durationMs: 4000 },
    codex: { content: "Codex refined analysis with agreements", durationMs: 4500 },
    steer: "Focus on the useMbm hook",
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
    expect(content).toContain("rounds: 2");
    expect(content).toContain("agents: [claude, codex]");
  });

  test("includes final round outputs in markdown", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");

    // Should contain the LAST round's outputs, not round 0
    expect(content).toContain("Claude refined analysis with agreements");
    expect(content).toContain("Codex refined analysis with agreements");
    expect(content).not.toContain("Claude initial draft");
  });

  test("includes session metadata", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");

    expect(content).toContain("Steer interventions: 1");
    expect(content).toContain("Rounds: 2");
  });

  test("saves session.json alongside markdown", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const dir = path.replace("/output.md", "");
    const jsonPath = join(dir, "session.json");

    expect(existsSync(jsonPath)).toBe(true);
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(raw.rounds).toHaveLength(2);
    expect(raw.status).toBe("accepted");
  });

  test("returns null for non-accepted sessions", () => {
    const session = createSession("abandoned task", { maxRounds: 3 });
    session.status = "abandoned";
    session.rounds.push({
      number: 0,
      claude: { content: "output", durationMs: 1000 },
      codex: { content: "output", durationMs: 1000 },
    });

    const path = saveArtifact(session, tempDir);
    expect(path).toBeNull();
  });

  test("returns null for active sessions", () => {
    const session = createSession("active task", { maxRounds: 3 });
    const path = saveArtifact(session, tempDir);
    expect(path).toBeNull();
  });

  test("escapes quotes in title frontmatter", () => {
    const session = createSession('Why does "premium" banner appear twice?', { maxRounds: 3 });
    session.status = "accepted";
    session.acceptedAt = new Date().toISOString();
    session.rounds.push({
      number: 0,
      claude: { content: "output", durationMs: 1000 },
      codex: { content: "output", durationMs: 1000 },
    });

    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");
    expect(content).toContain('\\"premium\\"');
  });

  test("calculates total duration from all rounds", () => {
    const session = buildAcceptedSession();
    const path = saveArtifact(session, tempDir)!;
    const content = readFileSync(path, "utf-8");

    // Round 0: max(5000, 6000) = 6000, Round 1: max(4000, 4500) = 4500, total = 10500ms = 10s
    expect(content).toContain("duration_seconds: 11"); // 10500ms rounds to 11s
  });
});

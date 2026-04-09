import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession, persistSession, loadSession, listSessions, toAgentResult } from "../src/session.ts";
import type { AdapterResponse } from "../src/adapters/types.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "conclave-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("createSession", () => {
  test("generates session with correct defaults", () => {
    const session = createSession("Analyze the auth flow", { maxRounds: 3 });

    expect(session.id).toBeTruthy();
    expect(session.task).toBe("Analyze the auth flow");
    expect(session.rounds).toEqual([]);
    expect(session.status).toBe("active");
    expect(session.maxRounds).toBe(3);
    expect(session.startedAt).toBeTruthy();
    expect(session.workdir).toBeUndefined();
    expect(session.repos).toBeUndefined();
  });

  test("includes optional workdir and repos", () => {
    const session = createSession("Review PR", {
      workdir: "/tmp/repo",
      repos: ["https://github.com/org/repo"],
      maxRounds: 5,
    });

    expect(session.workdir).toBe("/tmp/repo");
    expect(session.repos).toEqual(["https://github.com/org/repo"]);
    expect(session.maxRounds).toBe(5);
  });

  test("generates unique IDs", () => {
    const a = createSession("task a", { maxRounds: 3 });
    const b = createSession("task b", { maxRounds: 3 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("toAgentResult", () => {
  test("extracts relevant fields from AdapterResponse", () => {
    const response: AdapterResponse = {
      content: "analysis text",
      durationMs: 1500,
      exitCode: 0,
    };
    const result = toAgentResult(response);

    expect(result.content).toBe("analysis text");
    expect(result.durationMs).toBe(1500);
    expect(result.error).toBeUndefined();
  });

  test("preserves error field", () => {
    const response: AdapterResponse = {
      content: "",
      durationMs: 300000,
      exitCode: -1,
      error: "timeout",
    };
    const result = toAgentResult(response);

    expect(result.error).toBe("timeout");
  });
});

describe("persistSession / loadSession", () => {
  test("round-trips a session through JSON", () => {
    const session = createSession("test task", { maxRounds: 3 });
    session.rounds.push({
      number: 0,
      claude: { content: "claude output", durationMs: 1000 },
      codex: { content: "codex output", durationMs: 1200 },
    });

    persistSession(session, tempDir);
    const loaded = loadSession(session.id, tempDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.task).toBe("test task");
    expect(loaded!.rounds).toHaveLength(1);
    expect(loaded!.rounds[0]!.claude.content).toBe("claude output");
    expect(loaded!.rounds[0]!.codex.content).toBe("codex output");
  });

  test("returns null for non-existent session", () => {
    const loaded = loadSession("nonexistent", tempDir);
    expect(loaded).toBeNull();
  });

  test("persists steer guidance in rounds", () => {
    const session = createSession("steered task", { maxRounds: 3 });
    session.rounds.push({
      number: 0,
      claude: { content: "initial", durationMs: 500 },
      codex: { content: "initial", durationMs: 600 },
    });
    session.rounds.push({
      number: 1,
      claude: { content: "refined", durationMs: 800 },
      codex: { content: "refined", durationMs: 900 },
      steer: "Focus on the auth middleware specifically",
    });

    persistSession(session, tempDir);
    const loaded = loadSession(session.id, tempDir);

    expect(loaded!.rounds[1]!.steer).toBe("Focus on the auth middleware specifically");
  });
});

describe("listSessions", () => {
  test("returns empty array for empty directory", () => {
    const sessions = listSessions(tempDir);
    expect(sessions).toEqual([]);
  });

  test("lists sessions sorted by most recent first", () => {
    const a = createSession("first task", { maxRounds: 3 });
    a.startedAt = "2026-04-09T10:00:00.000Z";
    persistSession(a, tempDir);

    const b = createSession("second task", { maxRounds: 3 });
    b.startedAt = "2026-04-09T11:00:00.000Z";
    persistSession(b, tempDir);

    const sessions = listSessions(tempDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.task).toBe("second task");
    expect(sessions[1]!.task).toBe("first task");
  });

  test("truncates task to 80 chars", () => {
    const longTask = "a".repeat(120);
    const session = createSession(longTask, { maxRounds: 3 });
    persistSession(session, tempDir);

    const sessions = listSessions(tempDir);
    expect(sessions[0]!.task).toHaveLength(80);
  });

  test("reports round count and status", () => {
    const session = createSession("task", { maxRounds: 3 });
    session.status = "accepted";
    session.rounds.push({
      number: 0,
      claude: { content: "c", durationMs: 100 },
      codex: { content: "x", durationMs: 100 },
    });
    persistSession(session, tempDir);

    const sessions = listSessions(tempDir);
    expect(sessions[0]!.status).toBe("accepted");
    expect(sessions[0]!.rounds).toBe(1);
  });
});

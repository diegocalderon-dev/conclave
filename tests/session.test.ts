import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession, persistSession, loadSession, listSessions, toStep } from "../src/session.ts";
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
    const session = createSession("Analyze the auth flow", { maxSteps: 6 });

    expect(session.id).toBeTruthy();
    expect(session.task).toBe("Analyze the auth flow");
    expect(session.steps).toEqual([]);
    expect(session.status).toBe("active");
    expect(session.maxSteps).toBe(6);
    expect(session.startedAt).toBeTruthy();
    expect(session.workdir).toBeUndefined();
    expect(session.repos).toBeUndefined();
  });

  test("includes optional workdir and repos", () => {
    const session = createSession("Review PR", {
      workdir: "/tmp/repo",
      repos: ["https://github.com/org/repo"],
      maxSteps: 4,
    });

    expect(session.workdir).toBe("/tmp/repo");
    expect(session.repos).toEqual(["https://github.com/org/repo"]);
    expect(session.maxSteps).toBe(4);
  });

  test("generates unique IDs", () => {
    const a = createSession("task a", { maxSteps: 6 });
    const b = createSession("task b", { maxSteps: 6 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("toStep", () => {
  test("creates step from AdapterResponse", () => {
    const response: AdapterResponse = {
      content: "analysis text",
      durationMs: 1500,
      exitCode: 0,
    };
    const step = toStep(response, 0, "claude", "analyze");

    expect(step.number).toBe(0);
    expect(step.agent).toBe("claude");
    expect(step.role).toBe("analyze");
    expect(step.content).toBe("analysis text");
    expect(step.durationMs).toBe(1500);
    expect(step.error).toBeUndefined();
    expect(step.steer).toBeUndefined();
  });

  test("preserves error and steer", () => {
    const response: AdapterResponse = {
      content: "",
      durationMs: 300000,
      exitCode: -1,
      error: "timeout",
    };
    const step = toStep(response, 1, "codex", "review", "focus on auth");

    expect(step.error).toBe("timeout");
    expect(step.steer).toBe("focus on auth");
  });
});

describe("persistSession / loadSession", () => {
  test("round-trips a session through JSON", () => {
    const session = createSession("test task", { maxSteps: 6 });
    session.steps.push({
      number: 0,
      agent: "claude",
      role: "analyze",
      content: "claude analysis",
      durationMs: 1000,
    });

    persistSession(session, tempDir);
    const loaded = loadSession(session.id, tempDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.task).toBe("test task");
    expect(loaded!.steps).toHaveLength(1);
    expect(loaded!.steps[0]!.agent).toBe("claude");
    expect(loaded!.steps[0]!.role).toBe("analyze");
    expect(loaded!.steps[0]!.content).toBe("claude analysis");
  });

  test("returns null for non-existent session", () => {
    const loaded = loadSession("nonexistent", tempDir);
    expect(loaded).toBeNull();
  });

  test("persists relay steps with steer", () => {
    const session = createSession("relay task", { maxSteps: 6 });
    session.steps.push({
      number: 0,
      agent: "claude",
      role: "analyze",
      content: "initial analysis",
      durationMs: 500,
    });
    session.steps.push({
      number: 1,
      agent: "codex",
      role: "review",
      content: "review output",
      durationMs: 800,
      steer: "Focus on the auth middleware",
    });
    session.steps.push({
      number: 2,
      agent: "claude",
      role: "refine",
      content: "refined analysis",
      durationMs: 600,
    });

    persistSession(session, tempDir);
    const loaded = loadSession(session.id, tempDir);

    expect(loaded!.steps).toHaveLength(3);
    expect(loaded!.steps[0]!.agent).toBe("claude");
    expect(loaded!.steps[0]!.role).toBe("analyze");
    expect(loaded!.steps[1]!.agent).toBe("codex");
    expect(loaded!.steps[1]!.role).toBe("review");
    expect(loaded!.steps[1]!.steer).toBe("Focus on the auth middleware");
    expect(loaded!.steps[2]!.agent).toBe("claude");
    expect(loaded!.steps[2]!.role).toBe("refine");
  });
});

describe("listSessions", () => {
  test("returns empty array for empty directory", () => {
    const sessions = listSessions(tempDir);
    expect(sessions).toEqual([]);
  });

  test("lists sessions sorted by most recent first", () => {
    const a = createSession("first task", { maxSteps: 6 });
    a.startedAt = "2026-04-09T10:00:00.000Z";
    persistSession(a, tempDir);

    const b = createSession("second task", { maxSteps: 6 });
    b.startedAt = "2026-04-09T11:00:00.000Z";
    persistSession(b, tempDir);

    const sessions = listSessions(tempDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.task).toBe("second task");
    expect(sessions[1]!.task).toBe("first task");
  });

  test("truncates task to 80 chars", () => {
    const longTask = "a".repeat(120);
    const session = createSession(longTask, { maxSteps: 6 });
    persistSession(session, tempDir);

    const sessions = listSessions(tempDir);
    expect(sessions[0]!.task).toHaveLength(80);
  });

  test("reports step count and status", () => {
    const session = createSession("task", { maxSteps: 6 });
    session.status = "accepted";
    session.steps.push({
      number: 0,
      agent: "claude",
      role: "analyze",
      content: "output",
      durationMs: 100,
    });
    persistSession(session, tempDir);

    const sessions = listSessions(tempDir);
    expect(sessions[0]!.status).toBe("accepted");
    expect(sessions[0]!.steps).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";
import { runCommand, commandExists } from "../src/adapters/base.ts";
import { ClaudeAdapter } from "../src/adapters/claude.ts";
import { CodexAdapter } from "../src/adapters/codex.ts";

describe("runCommand", () => {
  test("captures stdout from a simple command", async () => {
    const result = await runCommand({ args: ["echo", "hello"] });
    expect(result.content).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test("captures non-zero exit code and stderr", async () => {
    const result = await runCommand({ args: ["sh", "-c", "echo err >&2; exit 1"] });
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("err");
  });

  test("returns empty-response error for commands with no output", async () => {
    const result = await runCommand({ args: ["true"] });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBe("empty-response");
    expect(result.content).toBe("");
  });

  test("kills process on timeout", async () => {
    const result = await runCommand({
      args: ["sleep", "10"],
      timeout: 200,
    });
    expect(result.error).toBe("timeout");
    expect(result.durationMs).toBeLessThan(1000);
  });

  test("respects cwd option", async () => {
    const result = await runCommand({ args: ["pwd"], cwd: "/tmp" });
    // macOS /tmp is a symlink to /private/tmp
    expect(result.content).toMatch(/\/tmp/);
    expect(result.exitCode).toBe(0);
  });
});

describe("commandExists", () => {
  test("returns true for existing commands", async () => {
    const result = await commandExists("echo");
    expect(result.exists).toBe(true);
  });

  test("returns false for non-existent commands", async () => {
    const result = await commandExists("nonexistent-command-xyz");
    expect(result.exists).toBe(false);
  });
});

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  test("detect returns available", async () => {
    const result = await adapter.detect();
    expect(result.available).toBe(true);
    expect(result.version).toBeTruthy();
  });

  test("has correct name", () => {
    expect(adapter.name).toBe("claude");
  });
});

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  test("detect returns available", async () => {
    const result = await adapter.detect();
    expect(result.available).toBe(true);
    expect(result.version).toBeTruthy();
  });

  test("has correct name", () => {
    expect(adapter.name).toBe("codex");
  });
});

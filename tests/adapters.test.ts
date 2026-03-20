import { describe, test, expect } from "bun:test";
import { ClaudeAdapter } from "../src/adapters/claude/adapter.js";
import { CodexAdapter } from "../src/adapters/codex/adapter.js";

describe("Adapter Capability Detection", () => {
  test("claude adapter detects availability", async () => {
    const adapter = new ClaudeAdapter();
    const caps = await adapter.detect();
    expect(caps.id).toBe("claude");
    expect(caps.name).toBe("Claude Code");
    // Available depends on environment — just verify structure
    expect(typeof caps.available).toBe("boolean");
    expect(typeof caps.nonInteractiveSupported).toBe("boolean");
    expect(Array.isArray(caps.features)).toBe(true);
    if (caps.available) {
      expect(caps.features).toContain("non-interactive-print");
      expect(caps.command).toBeTruthy();
    }
  });

  test("codex adapter detects availability", async () => {
    const adapter = new CodexAdapter();
    const caps = await adapter.detect();
    expect(caps.id).toBe("codex");
    expect(caps.name).toBe("Codex CLI");
    expect(typeof caps.available).toBe("boolean");
    if (caps.available) {
      expect(caps.features).toContain("non-interactive-exec");
      expect(caps.command).toBeTruthy();
    }
  });

  test("adapter with missing command reports unavailable", async () => {
    const adapter = new ClaudeAdapter({ command: "nonexistent-cli-tool-xyz" });
    const caps = await adapter.detect();
    expect(caps.available).toBe(false);
    expect(caps.error).toBeTruthy();
  });

  test("codex adapter with missing command reports unavailable", async () => {
    const adapter = new CodexAdapter({ command: "nonexistent-cli-tool-xyz" });
    const caps = await adapter.detect();
    expect(caps.available).toBe(false);
    expect(caps.error).toBeTruthy();
  });
});

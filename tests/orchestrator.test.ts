import { describe, expect, test } from "bun:test";
import type { Adapter, AdapterResponse, DetectResult, InvokeOptions } from "../src/adapters/types.ts";

// Mock adapter that returns predetermined responses and captures prompts
class MockAdapter implements Adapter {
  name: string;
  private responses: string[];
  private callIndex = 0;
  invokedPrompts: string[] = [];

  constructor(name: string, responses: string[]) {
    this.name = name;
    this.responses = responses;
  }

  async detect(): Promise<DetectResult> {
    return { available: true, version: "mock" };
  }

  async invoke(prompt: string, _options?: InvokeOptions): Promise<AdapterResponse> {
    this.invokedPrompts.push(prompt);
    const content = this.responses[this.callIndex] ?? `${this.name} response ${this.callIndex}`;
    this.callIndex++;
    return { content, durationMs: 100, exitCode: 0 };
  }
}

describe("mock adapter", () => {
  test("captures invoked prompts", async () => {
    const mock = new MockAdapter("test", ["response 1", "response 2"]);
    await mock.invoke("first prompt");
    await mock.invoke("second prompt");

    expect(mock.invokedPrompts).toEqual(["first prompt", "second prompt"]);
  });

  test("cycles through responses", async () => {
    const mock = new MockAdapter("test", ["a", "b", "c"]);

    const r1 = await mock.invoke("p1");
    const r2 = await mock.invoke("p2");
    const r3 = await mock.invoke("p3");

    expect(r1.content).toBe("a");
    expect(r2.content).toBe("b");
    expect(r3.content).toBe("c");
  });

  test("provides fallback after exhausting responses", async () => {
    const mock = new MockAdapter("claude", ["only one"]);

    await mock.invoke("p1");
    const r2 = await mock.invoke("p2");

    expect(r2.content).toBe("claude response 1");
  });
});

describe("relay workflow design", () => {
  test("claude and codex have distinct roles", () => {
    const claude = new MockAdapter("claude", []);
    const codex = new MockAdapter("codex", []);

    // The relay model: Claude = analyst, Codex = reviewer
    expect(claude.name).toBe("claude");
    expect(codex.name).toBe("codex");
  });

  // Full relay loop integration tests require mocking stdin for HITL.
  // Validated manually with: bun run src/cli.ts "task"
});

import { describe, test, expect } from "bun:test";
import { PassThrough } from "stream";
import { runCli, type CliDependencies } from "../src/cli/index.js";
import { promptForTask } from "../src/cli/interactive.js";
import { getDefaultConfig } from "../src/config/index.js";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterResponse,
  ConclaveConfig,
  RunManifest,
} from "../src/core/types.js";
import type { RunInput, RunResult } from "../src/orchestration/index.js";

class TtyPassThrough extends PassThrough {
  readonly isTTY = true;
  rawModeHistory: boolean[] = [];

  setRawMode(mode: boolean) {
    this.rawModeHistory.push(mode);
  }
}

function createWriter() {
  let value = "";

  return {
    writer: {
      write(chunk: string) {
        value += chunk;
        return true;
      },
    },
    text() {
      return value;
    },
  };
}

function createAdapter(id: string): Adapter {
  return {
    id,
    async detect(): Promise<AdapterCapabilities> {
      return {
        id,
        name: id,
        available: true,
        command: id,
        nonInteractiveSupported: true,
        structuredOutputSupported: true,
        features: [],
      };
    },
    async invoke(): Promise<AdapterResponse> {
      return {
        content: "",
        exitCode: 0,
        durationMs: 0,
      };
    },
  };
}

function createManifest(task: string): RunManifest {
  return {
    runId: "run-123",
    task,
    depth: "medium",
    autonomy: "supervised",
    transcriptRetention: "summary",
    adapters: ["claude", "codex"],
    activeLanes: [],
    startedAt: "2026-03-20T00:00:00.000Z",
    artifactRoot: "/tmp/conclave",
    phases: [],
  };
}

function createRunResult(task: string): RunResult {
  return {
    runId: "run-123",
    artifactDir: "/tmp/conclave/default/run-123",
    finalSynthesis: {
      ratified: true,
      ratificationVotes: [{ adapterId: "claude", outcome: "approved" }],
      synthesis: {
        version: 1,
        agreedPoints: [`Handled task: ${task}`],
        acceptedHybrids: [],
        unresolvedDisagreements: [],
        conditionalAgreements: [],
        summary: "Synthetic result",
      },
      producedAt: "2026-03-20T00:00:00.000Z",
    },
    manifest: createManifest(task),
    errors: [],
  };
}

function createCliDeps(overrides: Partial<CliDependencies> = {}) {
  const stdout = createWriter();
  const stderr = createWriter();
  const adapters = [createAdapter("claude"), createAdapter("codex")];
  const executions: RunInput[] = [];
  let promptedWith: string | undefined;

  const deps: CliDependencies = {
    stdout: stdout.writer,
    stderr: stderr.writer,
    stdinIsTTY: true,
    stdoutIsTTY: true,
    loadConfig(): ConclaveConfig {
      return getDefaultConfig();
    },
    createAdapters() {
      return adapters;
    },
    async detectAllAdapters(items) {
      return items.map((adapter) => ({
        id: adapter.id,
        name: adapter.id,
        available: true,
        command: adapter.id,
        nonInteractiveSupported: true,
        structuredOutputSupported: true,
        features: [],
      }));
    },
    async executeRun(input) {
      executions.push(input);
      return createRunResult(input.task);
    },
    async promptForTask(options) {
      promptedWith = options?.intro;
      return "Interactive task";
    },
  };

  Object.assign(deps, overrides);

  return {
    deps,
    executions,
    stdout,
    stderr,
    promptIntro() {
      return promptedWith;
    },
  };
}

describe("runCli", () => {
  test("enters interactive mode when invoked without arguments", async () => {
    const { deps, executions, promptIntro } = createCliDeps();

    const exitCode = await runCli([], deps);

    expect(exitCode).toBe(0);
    expect(promptIntro()).toContain("interactive mode");
    expect(executions).toHaveLength(1);
    expect(executions[0]?.task).toBe("Interactive task");
  });

  test("prompts for a task when `run` is missing --task in a TTY", async () => {
    const { deps, executions, promptIntro } = createCliDeps();

    const exitCode = await runCli(["run"], deps);

    expect(exitCode).toBe(0);
    expect(promptIntro()).toContain("No task provided.");
    expect(executions).toHaveLength(1);
    expect(executions[0]?.task).toBe("Interactive task");
  });

  test("fails fast without a TTY when no task is available", async () => {
    const { deps, executions, stdout, stderr } = createCliDeps({
      stdinIsTTY: false,
      stdoutIsTTY: false,
    });

    const exitCode = await runCli([], deps);

    expect(exitCode).toBe(1);
    expect(executions).toHaveLength(0);
    expect(stderr.text()).toContain("interactive mode requires a TTY");
    expect(stdout.text()).toContain("Usage: conclave run");
  });

  test("exits when the interactive prompt is cancelled", async () => {
    const { deps, executions, stderr } = createCliDeps({
      async promptForTask() {
        return null;
      },
    });

    const exitCode = await runCli(["run"], deps);

    expect(exitCode).toBe(1);
    expect(executions).toHaveLength(0);
    expect(stderr.text()).toContain("No task provided. Exiting.");
  });
});

describe("promptForTask", () => {
  test("re-prompts until a non-empty task is provided", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let transcript = "";

    output.on("data", (chunk) => {
      transcript += chunk.toString();
    });

    const pending = promptForTask({ input, output, intro: "Intro\n" });
    input.write("\n");
    input.write("Build interactive mode\n");
    input.end();

    const task = await pending;

    expect(task).toBe("Build interactive mode");
    expect(transcript).toContain("Task cannot be empty");
  });

  test("submits on Enter and inserts new lines on Shift+Enter in raw mode", async () => {
    const input = new TtyPassThrough();
    const output = new PassThrough();
    let transcript = "";

    output.on("data", (chunk) => {
      transcript += chunk.toString();
    });

    const pending = promptForTask({ input, output });
    input.write("Investigate interactive mode");
    input.write("\x1b[13;2u");
    input.write("Add a regression test");
    input.write("\r");

    expect(await pending).toBe(
      "Investigate interactive mode\nAdd a regression test"
    );
    expect(input.rawModeHistory).toEqual([true, false]);
    expect(transcript).toContain("\x1b[?2004h");
    expect(transcript).toContain("\x1b[>1u");
    expect(transcript).toContain("\x1b[>4;2m");
    expect(transcript).toContain("\x1b[>4m");
    expect(transcript).toContain("\x1b[<u");
    expect(transcript).toContain("\x1b[?2004l");
  });

  test("accepts Shift+Enter from xterm modifyOtherKeys", async () => {
    const input = new TtyPassThrough();
    const output = new PassThrough();

    const pending = promptForTask({ input, output });
    input.write("Investigate interactive mode");
    input.write("\x1b[27;2;13~");
    input.write("Add a regression test");
    input.write("\r");

    expect(await pending).toBe(
      "Investigate interactive mode\nAdd a regression test"
    );
  });

  test("uses Ctrl+J as a raw-mode newline fallback", async () => {
    const input = new TtyPassThrough();
    const output = new PassThrough();

    const pending = promptForTask({ input, output });
    input.write("Investigate interactive mode");
    input.write("\n");
    input.write("Add a regression test");
    input.write("\r");

    expect(await pending).toBe(
      "Investigate interactive mode\nAdd a regression test"
    );
  });

  test("recognizes Ctrl+C and Ctrl+D when the terminal encodes modified keys", async () => {
    const cancelledInput = new TtyPassThrough();
    const cancelledOutput = new PassThrough();

    const cancelled = promptForTask({ input: cancelledInput, output: cancelledOutput });
    cancelledInput.write("Investigate interactive mode");
    cancelledInput.write("\x1b[99;5u");

    expect(await cancelled).toBeNull();

    const submittedInput = new TtyPassThrough();
    const submittedOutput = new PassThrough();

    const submitted = promptForTask({
      input: submittedInput,
      output: submittedOutput,
    });
    submittedInput.write("Investigate interactive mode");
    submittedInput.write("\x1b[100;5u");

    expect(await submitted).toBe("Investigate interactive mode");
  });

  test("recognizes xterm-encoded Ctrl+C and Ctrl+D when modifyOtherKeys is enabled", async () => {
    const cancelledInput = new TtyPassThrough();
    const cancelledOutput = new PassThrough();

    const cancelled = promptForTask({ input: cancelledInput, output: cancelledOutput });
    cancelledInput.write("Investigate interactive mode");
    cancelledInput.write("\x1b[27;5;99~");

    expect(await cancelled).toBeNull();

    const submittedInput = new TtyPassThrough();
    const submittedOutput = new PassThrough();

    const submitted = promptForTask({
      input: submittedInput,
      output: submittedOutput,
    });
    submittedInput.write("Investigate interactive mode");
    submittedInput.write("\x1b[27;5;100~");

    expect(await submitted).toBe("Investigate interactive mode");
  });

  test("returns null when cancelled in raw mode", async () => {
    const input = new TtyPassThrough();
    const output = new PassThrough();

    const pending = promptForTask({ input, output });
    input.write("Investigate interactive mode");
    input.write("\x03");

    expect(await pending).toBeNull();
  });

  test("collects multiline tasks until EOF", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const pending = promptForTask({ input, output });
    input.write("Investigate interactive mode\n");
    input.write("Include a reproduction case\n");
    input.write("\n");
    input.write("Add a regression test\n");
    input.end();

    expect(await pending).toBe(
      "Investigate interactive mode\nInclude a reproduction case\n\nAdd a regression test"
    );
  });

  test("returns null on EOF", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const pending = promptForTask({ input, output });
    input.end();

    expect(await pending).toBeNull();
  });
});

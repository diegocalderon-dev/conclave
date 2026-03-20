#!/usr/bin/env bun
/** Conclave CLI — protocol-driven deliberation orchestrator */

import { parseArgs } from "util";
import { loadConfig } from "../config/index.js";
import { createAdapters, detectAllAdapters } from "../adapters/index.js";
import { executeRun } from "../orchestration/index.js";
import { promptForTask, type PromptForTaskOptions } from "./interactive.js";
import type {
  Adapter,
  DepthProfile,
  AutonomyMode,
  TranscriptRetention,
  FinalSynthesis,
} from "../core/types.js";
import type { CLIFlags } from "../config/index.js";
import type { RunResult } from "../orchestration/index.js";

const HELP = `
conclave — protocol-driven, model-agnostic deliberation orchestrator

USAGE:
  conclave                     Start interactive mode
  conclave run [options]       Run a deliberation
  conclave doctor              Check adapter availability
  conclave help                Show this help

RUN OPTIONS:
  -t, --task <text>            Task or question to deliberate (prompted in a TTY; Enter submits, Shift+Enter inserts a new line, Ctrl+J is a fallback line break)
  -T, --target <text>          Target workspace or topic context
  -d, --depth <profile>        Depth: low | medium | high | exhaustive (default: low)
  -a, --autonomy <mode>        Mode: supervised | autonomous (default: supervised)
      --transcripts <policy>   Transcripts: none | summary | full (default: summary)
  -o, --artifact-root <path>   Override artifact storage location
      --adapters <list>        Comma-separated adapter list (default: claude,codex)
  -n, --dry-run                Simulate without invoking adapters
  -c, --config <path>          Path to config file

EXAMPLES:
  conclave
  conclave run -t "Design a caching strategy" -d high
  conclave run -t "Review auth approach" -T ~/dev/myapp -n
  conclave doctor
`;

const RUN_USAGE = "Usage: conclave run --task 'Your task here' [options]\n";

interface TextWriter {
  write(chunk: string): unknown;
}

export interface CliDependencies {
  stdout: TextWriter;
  stderr: TextWriter;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  loadConfig: typeof loadConfig;
  createAdapters: typeof createAdapters;
  detectAllAdapters: typeof detectAllAdapters;
  executeRun: typeof executeRun;
  promptForTask: (options?: PromptForTaskOptions) => Promise<string | null>;
}

interface ParsedRunOptions {
  task?: string;
  target?: string;
  depth?: DepthProfile;
  autonomy?: AutonomyMode;
  transcripts?: TranscriptRetention;
  artifactRoot?: string;
  adapters?: string;
  dryRun: boolean;
  config?: string;
  help: boolean;
}

function createDefaultDependencies(): CliDependencies {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    loadConfig,
    createAdapters,
    detectAllAdapters,
    executeRun,
    promptForTask,
  };
}

function write(stream: TextWriter, chunk: string): void {
  stream.write(chunk);
}

function isInteractiveTerminal(deps: CliDependencies): boolean {
  return deps.stdinIsTTY && deps.stdoutIsTTY;
}

function parseRunOptions(args: string[]): ParsedRunOptions {
  const { values } = parseArgs({
    args,
    options: {
      task: { type: "string", short: "t" },
      target: { type: "string", short: "T" },
      depth: { type: "string", short: "d" },
      autonomy: { type: "string", short: "a" },
      transcripts: { type: "string" },
      "artifact-root": { type: "string", short: "o" },
      adapters: { type: "string" },
      "dry-run": { type: "boolean", default: false, short: "n" },
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: false,
  });

  return {
    task: typeof values.task === "string" ? values.task.trim() : undefined,
    target: values.target as string | undefined,
    depth: values.depth as DepthProfile | undefined,
    autonomy: values.autonomy as AutonomyMode | undefined,
    transcripts: values.transcripts as TranscriptRetention | undefined,
    artifactRoot: values["artifact-root"] as string | undefined,
    adapters: values.adapters as string | undefined,
    dryRun: values["dry-run"] as boolean,
    config: values.config as string | undefined,
    help: values.help as boolean,
  };
}

async function resolveTask(
  task: string | undefined,
  deps: CliDependencies,
  invokedWithoutCommand: boolean
): Promise<string | null> {
  if (task) {
    return task;
  }

  if (!isInteractiveTerminal(deps)) {
    if (invokedWithoutCommand) {
      write(
        deps.stderr,
        "Error: interactive mode requires a TTY, or provide a task with `conclave run --task`.\n\n"
      );
    } else {
      write(
        deps.stderr,
        "Error: --task is required when not running interactively.\n\n"
      );
    }
    write(deps.stdout, RUN_USAGE);
    return null;
  }

  const intro = invokedWithoutCommand
    ? "conclave interactive mode\nEnter a task to deliberate. Press Shift+Enter for a new line, Enter to submit, Ctrl+J for a guaranteed line break, or Ctrl+C to cancel.\n\n"
    : "No task provided.\nEnter a task to deliberate. Press Shift+Enter for a new line, Enter to submit, Ctrl+J for a guaranteed line break, or Ctrl+C to cancel.\n\n";

  return deps.promptForTask({ intro });
}

function buildConfig(flags: ParsedRunOptions, deps: CliDependencies) {
  const configFlags: CLIFlags = {
    artifactRoot: flags.artifactRoot,
    depth: flags.depth,
    autonomy: flags.autonomy,
    transcriptRetention: flags.transcripts,
    configPath: flags.config,
  };

  return deps.loadConfig(configFlags);
}

function filterAdapters(
  adapters: Adapter[],
  requestedList?: string
): Adapter[] {
  if (!requestedList) {
    return adapters;
  }

  const requested = requestedList.split(",").map((value) => value.trim());
  return adapters.filter((adapter) => requested.includes(adapter.id));
}

function printRunSummary(
  result: RunResult,
  finalSynthesis: FinalSynthesis | null,
  deps: CliDependencies
): void {
  write(deps.stdout, "\n═══ Conclave Run Complete ═══\n\n");
  write(deps.stdout, `Run ID:   ${result.runId}\n`);
  write(
    deps.stdout,
    `Verdict:  ${finalSynthesis?.ratified ? "Ratified" : "Synthesis with unresolved disagreements"}\n`
  );

  if (finalSynthesis) {
    const synthesis = finalSynthesis.synthesis;

    if (synthesis.agreedPoints.length > 0) {
      write(deps.stdout, `\nAgreed (${synthesis.agreedPoints.length}):\n`);
      for (const point of synthesis.agreedPoints.slice(0, 10)) {
        write(deps.stdout, `  + ${point}\n`);
      }
      if (synthesis.agreedPoints.length > 10) {
        write(
          deps.stdout,
          `  ... and ${synthesis.agreedPoints.length - 10} more\n`
        );
      }
    }

    if (synthesis.acceptedHybrids.length > 0) {
      write(deps.stdout, `\nHybrids (${synthesis.acceptedHybrids.length}):\n`);
      for (const hybrid of synthesis.acceptedHybrids) {
        write(deps.stdout, `  ~ ${hybrid}\n`);
      }
    }

    if (synthesis.unresolvedDisagreements.length > 0) {
      write(
        deps.stdout,
        `\nUnresolved (${synthesis.unresolvedDisagreements.length}):\n`
      );
      for (const disagreement of synthesis.unresolvedDisagreements) {
        write(deps.stdout, `  ? ${disagreement.title}\n`);
      }
    }

    write(deps.stdout, "\nVotes:\n");
    for (const vote of finalSynthesis.ratificationVotes) {
      const icon = vote.outcome === "approved" ? "+" : "!";
      write(deps.stdout, `  ${icon} ${vote.adapterId}: ${vote.outcome}\n`);
    }
  }

  if (result.errors.length > 0) {
    write(deps.stdout, `\nErrors (${result.errors.length}):\n`);
    for (const error of result.errors) {
      write(deps.stdout, `  - ${error}\n`);
    }
  }

  write(deps.stdout, `\nFull synthesis: ${result.artifactDir}/synthesis.md\n`);
  write(deps.stdout, `All artifacts:  ${result.artifactDir}/\n\n`);
}

async function runDoctor(deps: CliDependencies): Promise<number> {
  write(deps.stdout, "conclave doctor — checking adapter availability\n\n");

  const config = deps.loadConfig();
  const adapters = deps.createAdapters(config);
  const capabilities = await deps.detectAllAdapters(adapters);

  for (const capability of capabilities) {
    const status = capability.available ? "✓" : "✗";
    write(deps.stdout, `${status} ${capability.name} (${capability.id})\n`);
    if (capability.available) {
      write(deps.stdout, `  Command: ${capability.command}\n`);
      if (capability.version) {
        write(deps.stdout, `  Version: ${capability.version}\n`);
      }
      write(
        deps.stdout,
        `  Non-interactive: ${capability.nonInteractiveSupported}\n`
      );
      write(
        deps.stdout,
        `  Structured output: ${capability.structuredOutputSupported}\n`
      );
      write(
        deps.stdout,
        `  Features: ${capability.features.join(", ")}\n`
      );
    } else {
      write(deps.stdout, `  Error: ${capability.error}\n`);
    }
    write(deps.stdout, "\n");
  }

  const available = capabilities.filter((capability) => capability.available);
  write(deps.stdout, `${available.length}/${capabilities.length} adapters available.\n`);

  if (available.length === 0) {
    write(
      deps.stdout,
      "\nNo adapters available. Install claude or codex CLI to run deliberations.\n"
    );
    return 1;
  }

  return 0;
}

async function runDeliberation(
  args: string[],
  deps: CliDependencies,
  invokedWithoutCommand = false
): Promise<number> {
  const options = parseRunOptions(args);

  if (options.help) {
    write(deps.stdout, HELP);
    return 0;
  }

  const task = await resolveTask(options.task, deps, invokedWithoutCommand);
  if (!task) {
    if (isInteractiveTerminal(deps)) {
      write(deps.stderr, "No task provided. Exiting.\n");
    }
    return 1;
  }

  const config = buildConfig(options, deps);
  const adapters = filterAdapters(deps.createAdapters(config), options.adapters);
  const capabilities = await deps.detectAllAdapters(adapters);
  const availableAdapters = adapters.filter((adapter) =>
    capabilities.find((capability) => capability.id === adapter.id && capability.available)
  );

  if (availableAdapters.length === 0 && !options.dryRun) {
    write(
      deps.stderr,
      "No adapters available. Use --dry-run to simulate, or install claude/codex.\n"
    );
    return 1;
  }

  const result = await deps.executeRun({
    task,
    target: options.target,
    config,
    adapters: options.dryRun ? adapters : availableAdapters,
    dryRun: options.dryRun,
  });

  printRunSummary(result, result.finalSynthesis, deps);
  return 0;
}

export async function runCli(
  args: string[],
  deps: CliDependencies = createDefaultDependencies()
): Promise<number> {
  const command = args[0];

  if (!command) {
    return runDeliberation([], deps, true);
  }

  if (command === "help" || command === "--help" || command === "-h") {
    write(deps.stdout, HELP);
    return 0;
  }

  if (command === "doctor") {
    return runDoctor(deps);
  }

  if (command === "run") {
    return runDeliberation(args.slice(1), deps);
  }

  write(deps.stderr, `Unknown command: ${command}\n`);
  write(deps.stdout, HELP);
  return 1;
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
  });
}

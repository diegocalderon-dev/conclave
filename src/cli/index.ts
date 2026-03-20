#!/usr/bin/env bun
/** Conclave CLI — protocol-driven deliberation orchestrator */

import { parseArgs } from "util";
import { loadConfig } from "../config/index.js";
import { createAdapters, detectAllAdapters } from "../adapters/index.js";
import { executeRun } from "../orchestration/index.js";
import type { DepthProfile, AutonomyMode, TranscriptRetention } from "../core/types.js";

const HELP = `
conclave — protocol-driven, model-agnostic deliberation orchestrator

USAGE:
  conclave run [options]       Run a deliberation
  conclave doctor              Check adapter availability
  conclave help                Show this help

RUN OPTIONS:
  --task <text>                Task or question to deliberate (required)
  --target <text>              Target workspace or topic context
  --depth <profile>            Depth: low | medium | high | exhaustive (default: medium)
  --autonomy <mode>            Mode: supervised | autonomous (default: supervised)
  --transcripts <policy>       Transcripts: none | summary | full (default: summary)
  --artifact-root <path>       Override artifact storage location
  --adapters <list>            Comma-separated adapter list (default: claude,codex)
  --dry-run                    Simulate without invoking adapters
  --config <path>              Path to config file

EXAMPLES:
  conclave run --task "Design a caching strategy" --depth high
  conclave run --task "Review auth approach" --target ~/dev/myapp --dry-run
  conclave doctor
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  if (command === "doctor") {
    await runDoctor();
    return;
  }

  if (command === "run") {
    await runDeliberation(args.slice(1));
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exit(1);
}

async function runDoctor() {
  console.log("conclave doctor — checking adapter availability\n");

  const config = loadConfig();
  const adapters = createAdapters(config);
  const caps = await detectAllAdapters(adapters);

  for (const cap of caps) {
    const status = cap.available ? "✓" : "✗";
    console.log(`${status} ${cap.name} (${cap.id})`);
    if (cap.available) {
      console.log(`  Command: ${cap.command}`);
      if (cap.version) console.log(`  Version: ${cap.version}`);
      console.log(`  Non-interactive: ${cap.nonInteractiveSupported}`);
      console.log(`  Structured output: ${cap.structuredOutputSupported}`);
      console.log(`  Features: ${cap.features.join(", ")}`);
    } else {
      console.log(`  Error: ${cap.error}`);
    }
    console.log();
  }

  const available = caps.filter((c) => c.available);
  console.log(
    `${available.length}/${caps.length} adapters available.`
  );

  if (available.length === 0) {
    console.log(
      "\nNo adapters available. Install claude or codex CLI to run deliberations."
    );
    process.exit(1);
  }
}

async function runDeliberation(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      task: { type: "string" },
      target: { type: "string" },
      depth: { type: "string" },
      autonomy: { type: "string" },
      transcripts: { type: "string" },
      "artifact-root": { type: "string" },
      adapters: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      config: { type: "string" },
    },
    strict: false,
  });

  if (!values.task) {
    console.error("Error: --task is required\n");
    console.log("Usage: conclave run --task 'Your task here' [options]");
    process.exit(1);
  }

  const config = loadConfig({
    artifactRoot: values["artifact-root"] as string | undefined,
    depth: values.depth as DepthProfile | undefined,
    autonomy: values.autonomy as AutonomyMode | undefined,
    transcriptRetention: values.transcripts as TranscriptRetention | undefined,
    configPath: values.config as string | undefined,
  });

  // Create adapters (filter if specified)
  let adapters = createAdapters(config);
  if (values.adapters) {
    const requested = (values.adapters as string).split(",").map((s) => s.trim());
    adapters = adapters.filter((a) => requested.includes(a.id));
  }

  // Detect available adapters
  const caps = await detectAllAdapters(adapters);
  const available = adapters.filter((a) =>
    caps.find((c) => c.id === a.id && c.available)
  );

  if (available.length === 0 && !values["dry-run"]) {
    console.error("No adapters available. Use --dry-run to simulate, or install claude/codex.");
    process.exit(1);
  }

  const result = await executeRun({
    task: values.task as string,
    target: values.target as string | undefined,
    config,
    adapters: values["dry-run"] ? adapters : available,
    dryRun: values["dry-run"] as boolean,
  });

  // Print summary
  console.log("\n═══ Conclave Run Complete ═══");
  console.log(`Run ID:     ${result.runId}`);
  console.log(`Artifacts:  ${result.artifactDir}`);
  console.log(
    `Ratified:   ${result.finalSynthesis?.ratified ? "Yes" : "No (with labeled disagreements)"}`
  );
  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    for (const e of result.errors) {
      console.log(`  - ${e}`);
    }
  }
  if (result.finalSynthesis) {
    const s = result.finalSynthesis.synthesis;
    console.log(`\nAgreed points: ${s.agreedPoints.length}`);
    console.log(`Unresolved:    ${s.unresolvedDisagreements.length}`);
    console.log(`Hybrids:       ${s.acceptedHybrids.length}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

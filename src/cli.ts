#!/usr/bin/env bun

import { ClaudeAdapter } from "./adapters/claude.ts";
import { CodexAdapter } from "./adapters/codex.ts";
import { run, resumeSession } from "./orchestrator.ts";
import { loadSession, listSessions } from "./session.ts";
import { saveArtifact } from "./artifact.ts";
import { displayCompletion } from "./ui.ts";

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_TIMEOUT = 300_000; // 5 minutes in ms

function usage(): void {
  console.log(`conclave v2 — multi-agent analysis with HITL convergence

Usage:
  conclave <task>                              Start a session in cwd
  conclave --workdir <dir> <task>              Set agent working directory
  conclave --repo <url> <task>                 Pass repo URL(s) to agents (repeatable)
  conclave --max-rounds <n> <task>             Hard budget (default: ${DEFAULT_MAX_ROUNDS})
  conclave --timeout <seconds> <task>          Per-adapter timeout (default: 300s)
  conclave --allow-writes <task>               Opt-in: remove read-only restrictions
  conclave resume [session-id]                 Resume from last completed round
  conclave doctor                              Verify adapter availability
  conclave list                                List past sessions

HITL actions during a session:
  [c]ontinue  Run another cross-review round
  [a]ccept    Save final artifact and exit
  [s]teer     Inject guidance for the next round
  [q]uit      Abandon session (preserves all rounds)`);
}

async function doctor(): Promise<void> {
  const claude = new ClaudeAdapter();
  const codex = new CodexAdapter();

  const [claudeResult, codexResult] = await Promise.all([claude.detect(), codex.detect()]);

  const ok = "\x1b[32m✓\x1b[0m";
  const fail = "\x1b[31m✗\x1b[0m";

  console.log("\n\x1b[1mAdapter Status\x1b[0m");
  console.log(
    `  ${claudeResult.available ? ok : fail} \x1b[1m\x1b[35mClaude\x1b[0m  ${claudeResult.version ? `\x1b[2m${claudeResult.version}\x1b[0m` : ""}${claudeResult.error ? `  \x1b[31m${claudeResult.error}\x1b[0m` : ""}`,
  );
  console.log(
    `  ${codexResult.available ? ok : fail} \x1b[1m\x1b[32mCodex\x1b[0m   ${codexResult.version ? `\x1b[2m${codexResult.version}\x1b[0m` : ""}${codexResult.error ? `  \x1b[31m${codexResult.error}\x1b[0m` : ""}`,
  );
  console.log();

  if (!claudeResult.available || !codexResult.available) {
    process.exit(1);
  }
}

async function list(): Promise<void> {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("\n  \x1b[2mNo sessions found.\x1b[0m\n");
    return;
  }

  console.log("\n\x1b[1mSessions\x1b[0m\n");
  for (const s of sessions) {
    const icon = s.status === "accepted"
      ? "\x1b[32m✓\x1b[0m"
      : s.status === "abandoned"
        ? "\x1b[33m○\x1b[0m"
        : "\x1b[36m●\x1b[0m";
    const rounds = `\x1b[2m${s.rounds} round${s.rounds !== 1 ? "s" : ""}\x1b[0m`;
    console.log(`  ${icon} \x1b[1m${s.id}\x1b[0m  ${rounds}  ${s.task}`);
  }
  console.log();
}

async function resume(sessionId?: string): Promise<void> {
  if (!sessionId) {
    // Pick the most recent active session
    const sessions = listSessions();
    const active = sessions.find((s) => s.status === "active");
    if (!active) {
      console.error("No active sessions to resume. Provide a session ID.");
      process.exit(1);
    }
    sessionId = active.id;
  }

  const session = loadSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  if (session.status !== "active") {
    console.error(`Session ${sessionId} is already ${session.status}.`);
    process.exit(1);
  }

  const claude = new ClaudeAdapter();
  const codex = new CodexAdapter();

  const finished = await resumeSession(claude, codex, session, {
    maxRounds: session.maxRounds,
    workdir: session.workdir,
    repos: session.repos,
  });

  const path = finished.status === "accepted" ? saveArtifact(finished) : null;
  displayCompletion(finished.status as "accepted" | "abandoned", path);
}

function parseArgs(argv: string[]): {
  command?: string;
  task?: string;
  workdir?: string;
  repos: string[];
  maxRounds: number;
  timeout: number;
  allowWrites: boolean;
  sessionId?: string;
} {
  const result = {
    repos: [] as string[],
    maxRounds: DEFAULT_MAX_ROUNDS,
    timeout: DEFAULT_TIMEOUT,
    allowWrites: false,
  } as ReturnType<typeof parseArgs>;

  const args = argv.slice(2); // skip bun and script path
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      case "--workdir":
        result.workdir = args[++i];
        break;
      case "--repo":
        result.repos.push(args[++i]!);
        break;
      case "--max-rounds":
        result.maxRounds = parseInt(args[++i]!, 10);
        break;
      case "--timeout":
        result.timeout = parseInt(args[++i]!, 10) * 1000; // convert seconds to ms
        break;
      case "--allow-writes":
        result.allowWrites = true;
        break;
      default:
        positional.push(arg);
    }
  }

  // Determine command vs task
  const first = positional[0];
  if (first === "doctor" || first === "list" || first === "resume") {
    result.command = first;
    result.sessionId = positional[1];
  } else if (positional.length > 0) {
    result.task = positional.join(" ");
  }

  return result;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.command === "doctor") {
    await doctor();
    return;
  }
  if (parsed.command === "list") {
    await list();
    return;
  }
  if (parsed.command === "resume") {
    await resume(parsed.sessionId);
    return;
  }

  if (!parsed.task) {
    usage();
    process.exit(1);
  }

  const claude = new ClaudeAdapter();
  const codex = new CodexAdapter();

  // Verify adapters before starting
  const [claudeOk, codexOk] = await Promise.all([claude.detect(), codex.detect()]);
  if (!claudeOk.available) {
    console.error(`Claude CLI not available: ${claudeOk.error}`);
    process.exit(1);
  }
  if (!codexOk.available) {
    console.error(`Codex CLI not available: ${codexOk.error}`);
    process.exit(1);
  }

  const session = await run(claude, codex, parsed.task, {
    workdir: parsed.workdir ?? process.cwd(),
    repos: parsed.repos.length > 0 ? parsed.repos : undefined,
    maxRounds: parsed.maxRounds,
    timeout: parsed.timeout,
    allowWrites: parsed.allowWrites,
  });

  const path = session.status === "accepted" ? saveArtifact(session) : null;
  displayCompletion(session.status as "accepted" | "abandoned", path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

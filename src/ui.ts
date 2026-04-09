import { createInterface } from "node:readline";
import type { AgentResult } from "./session.ts";

export type HitlAction = "continue" | "accept" | "steer" | "quit";

// ── ANSI helpers ──────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  clearLine: "\x1b[2K",
  cursorUp: "\x1b[A",
};

const CLAUDE_LABEL = `${c.bold}${c.magenta}Claude${c.reset}`;
const CODEX_LABEL = `${c.bold}${c.green}Codex${c.reset}`;

// ── Progress tracking ─────────────────────────────────────────

type AgentStatus = "running" | "done" | "error";

interface ProgressState {
  roundLabel: string;
  startTime: number;
  claude: { status: AgentStatus; durationMs?: number };
  codex: { status: AgentStatus; durationMs?: number };
}

function renderStatusIcon(status: AgentStatus): string {
  switch (status) {
    case "running": return `${c.yellow}●${c.reset}`;
    case "done": return `${c.green}✓${c.reset}`;
    case "error": return `${c.red}✗${c.reset}`;
  }
}

function renderAgentStatus(name: string, label: string, state: { status: AgentStatus; durationMs?: number }, elapsed: number): string {
  const icon = renderStatusIcon(state.status);
  if (state.status === "done" || state.status === "error") {
    return `  ${icon} ${label}  ${c.dim}${formatDuration(state.durationMs ?? 0)}${c.reset}`;
  }
  return `  ${icon} ${label}  ${c.dim}${formatDuration(elapsed)}...${c.reset}`;
}

function drawProgress(state: ProgressState): void {
  const elapsed = Date.now() - state.startTime;
  const line1 = `${c.bold}${c.cyan}⟐ ${state.roundLabel}${c.reset}  ${c.dim}[${formatDuration(elapsed)}]${c.reset}`;
  const line2 = renderAgentStatus("claude", CLAUDE_LABEL, state.claude, elapsed);
  const line3 = renderAgentStatus("codex", CODEX_LABEL, state.codex, elapsed);

  // Move up 3 lines, clear, and redraw
  process.stderr.write(`${c.cursorUp}${c.clearLine}${c.cursorUp}${c.clearLine}${c.cursorUp}${c.clearLine}\r`);
  process.stderr.write(`${line1}\n${line2}\n${line3}\n`);
}

export interface ProgressTracker {
  markDone(agent: "claude" | "codex", durationMs: number): void;
  markError(agent: "claude" | "codex", durationMs: number): void;
  stop(): void;
}

export function startProgress(roundLabel: string): ProgressTracker {
  const state: ProgressState = {
    roundLabel,
    startTime: Date.now(),
    claude: { status: "running" },
    codex: { status: "running" },
  };

  // Initial draw (3 lines)
  const elapsed = 0;
  const line1 = `${c.bold}${c.cyan}⟐ ${roundLabel}${c.reset}  ${c.dim}[0s]${c.reset}`;
  const line2 = renderAgentStatus("claude", CLAUDE_LABEL, state.claude, elapsed);
  const line3 = renderAgentStatus("codex", CODEX_LABEL, state.codex, elapsed);
  process.stderr.write(`${line1}\n${line2}\n${line3}\n`);

  const interval = setInterval(() => drawProgress(state), 500);

  return {
    markDone(agent, durationMs) {
      state[agent] = { status: "done", durationMs };
      drawProgress(state);
    },
    markError(agent, durationMs) {
      state[agent] = { status: "error", durationMs };
      drawProgress(state);
    },
    stop() {
      clearInterval(interval);
      // Final draw
      drawProgress(state);
    },
  };
}

// ── Round display ─────────────────────────────────────────────

export function displayRound(
  roundNumber: number,
  maxRounds: number,
  claude: AgentResult,
  codex: AgentResult,
  sessionId: string,
): void {
  const totalDuration = Math.max(claude.durationMs, codex.durationMs);
  const roundType = roundNumber === 0 ? "Independent analysis" : "Cross-review";

  // Header
  console.log();
  console.log(`${c.bold}${c.cyan}${"═".repeat(70)}${c.reset}`);
  console.log(
    `${c.bold}${c.cyan}  Round ${roundNumber}${c.reset}` +
    `  ${c.dim}·${c.reset}  ${roundType}` +
    `  ${c.dim}·${c.reset}  ${formatDuration(totalDuration)}`,
  );
  console.log(`${c.bold}${c.cyan}${"═".repeat(70)}${c.reset}`);

  // Claude output
  console.log();
  console.log(`  ${c.dim}┌─${c.reset} ${CLAUDE_LABEL} ${c.dim}${"─".repeat(58)}${c.reset}`);
  if (claude.error) {
    console.log(`  ${c.dim}│${c.reset} ${c.red}[error: ${claude.error}]${c.reset}`);
  }
  printIndented(claude.content || "(no output)");
  console.log(`  ${c.dim}└${"─".repeat(67)}${c.reset}`);

  // Codex output
  console.log();
  console.log(`  ${c.dim}┌─${c.reset} ${CODEX_LABEL} ${c.dim}${"─".repeat(59)}${c.reset}`);
  if (codex.error) {
    console.log(`  ${c.dim}│${c.reset} ${c.red}[error: ${codex.error}]${c.reset}`);
  }
  printIndented(codex.content || "(no output)");
  console.log(`  ${c.dim}└${"─".repeat(67)}${c.reset}`);

  // Footer context
  console.log();
  const roundsRemaining = maxRounds - Math.max(0, roundNumber);
  console.log(
    `  ${c.dim}Session ${sessionId}  ·  ` +
    `${roundsRemaining > 0 ? `${roundsRemaining} round${roundsRemaining !== 1 ? "s" : ""} remaining` : "max rounds reached"}${c.reset}`,
  );
}

function printIndented(text: string): void {
  for (const line of text.split("\n")) {
    console.log(`  ${c.dim}│${c.reset} ${line}`);
  }
}

// ── Session header ────────────────────────────────────────────

export function displaySessionHeader(task: string, maxRounds: number, workdir?: string): void {
  console.log();
  console.log(`${c.bold}${c.cyan}conclave${c.reset} ${c.dim}v2${c.reset}`);
  console.log(`${c.dim}${"─".repeat(70)}${c.reset}`);
  console.log(`  ${c.bold}Task:${c.reset}    ${task.length > 60 ? task.slice(0, 60) + "..." : task}`);
  if (workdir) {
    console.log(`  ${c.bold}Workdir:${c.reset} ${c.dim}${workdir}${c.reset}`);
  }
  console.log(`  ${c.bold}Budget:${c.reset}  ${maxRounds} cross-review round${maxRounds !== 1 ? "s" : ""}`);
  console.log(`${c.dim}${"─".repeat(70)}${c.reset}`);
  console.log();
}

// ── HITL prompt ───────────────────────────────────────────────

export async function hitlPrompt(options: { atLimit: boolean }): Promise<HitlAction> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  const actions = options.atLimit
    ? [
        `${c.bold}a${c.reset}ccept`,
        `${c.bold}s${c.reset}teer`,
        `${c.bold}q${c.reset}uit`,
      ]
    : [
        `${c.bold}c${c.reset}ontinue`,
        `${c.bold}a${c.reset}ccept`,
        `${c.bold}s${c.reset}teer`,
        `${c.bold}q${c.reset}uit`,
      ];

  const prompt = `  ${c.yellow}▸${c.reset} ${actions.join(`${c.dim} │ ${c.reset}`)}${options.atLimit ? ` ${c.dim}(max rounds)${c.reset}` : ""} ${c.yellow}▸${c.reset} `;

  return new Promise<HitlAction>((resolve) => {
    const ask = () => {
      rl.question(prompt, (answer) => {
        const input = answer.trim().toLowerCase();
        if (input === "c" || input === "continue") {
          if (options.atLimit) {
            process.stderr.write(`  ${c.red}Max rounds reached.${c.reset} Accept or quit.\n`);
            ask();
            return;
          }
          rl.close();
          resolve("continue");
        } else if (input === "a" || input === "accept") {
          rl.close();
          resolve("accept");
        } else if (input === "s" || input === "steer") {
          rl.close();
          resolve("steer");
        } else if (input === "q" || input === "quit") {
          rl.close();
          resolve("quit");
        } else {
          ask();
        }
      });
    };
    ask();
  });
}

export async function getSteerInput(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise<string>((resolve) => {
    process.stderr.write(`\n  ${c.yellow}Steer guidance${c.reset} ${c.dim}(Enter twice to submit):${c.reset}\n  `);
    const lines: string[] = [];
    let lastWasEmpty = false;

    rl.on("line", (line) => {
      if (line === "" && lastWasEmpty) {
        rl.close();
        resolve(lines.join("\n").trim());
        return;
      }
      lastWasEmpty = line === "";
      lines.push(line);
      process.stderr.write("  ");
    });
  });
}

// ── Completion summary ────────────────────────────────────────

export function displayCompletion(status: "accepted" | "abandoned", artifactPath?: string | null): void {
  console.log();
  if (status === "accepted") {
    console.log(`  ${c.green}✓${c.reset} ${c.bold}Session accepted${c.reset}`);
    if (artifactPath) {
      console.log(`  ${c.dim}Artifact: ${artifactPath}${c.reset}`);
    }
  } else {
    console.log(`  ${c.yellow}○${c.reset} ${c.bold}Session abandoned${c.reset}`);
    console.log(`  ${c.dim}Use \`conclave resume\` to continue later${c.reset}`);
  }
  console.log();
}

// ── Utilities ─────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining}s`;
}

import { createInterface } from "node:readline";
import type { AgentResult } from "./session.ts";

export type HitlAction = "continue" | "accept" | "steer" | "quit";

// ── ANSI ──────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  clearLine: "\x1b[2K",
  cursorUp: "\x1b[A",
};

const W = 56; // default divider width
const DIV = `${c.dim}${"─".repeat(W)}${c.reset}`;

// ── Session header ────────────────────────────────────────────

export function displaySessionHeader(task: string, maxRounds: number, workdir?: string): void {
  const wd = workdir ? ` ${c.dim}·${c.reset} ${c.dim}${workdir}${c.reset}` : "";
  console.log(`\n${c.bold}conclave${c.reset}${wd} ${c.dim}·${c.reset} ${c.dim}${maxRounds} rounds${c.reset}`);
  console.log(DIV);
  console.log();
}

// ── Progress tracking ─────────────────────────────────────────

type AgentStatus = "running" | "done" | "error";

interface ProgressState {
  roundLabel: string;
  startTime: number;
  claude: { status: AgentStatus; durationMs?: number };
  codex: { status: AgentStatus; durationMs?: number };
}

function agentLine(label: string, color: string, state: { status: AgentStatus; durationMs?: number }, elapsed: number): string {
  if (state.status === "done") {
    return `  ${label}  ${c.green}✓${c.reset} ${c.dim}${formatDuration(state.durationMs ?? 0)}${c.reset}`;
  }
  if (state.status === "error") {
    return `  ${label}  ${c.red}✗${c.reset} ${c.dim}${formatDuration(state.durationMs ?? 0)}${c.reset}`;
  }
  return `  ${label}  ${c.yellow}●${c.reset} ${c.dim}${formatDuration(elapsed)}...${c.reset}`;
}

function drawProgress(state: ProgressState): void {
  const elapsed = Date.now() - state.startTime;
  const header = `${c.yellow}●${c.reset} ${c.bold}${state.roundLabel}${c.reset}  ${c.dim}[${formatDuration(elapsed)}]${c.reset}`;
  const l1 = agentLine("claude", c.magenta, state.claude, elapsed);
  const l2 = agentLine("codex ", c.green, state.codex, elapsed);

  process.stderr.write(`${c.cursorUp}${c.clearLine}${c.cursorUp}${c.clearLine}${c.cursorUp}${c.clearLine}\r`);
  process.stderr.write(`${header}\n${l1}\n${l2}\n`);
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

  // Initial draw
  const header = `${c.yellow}●${c.reset} ${c.bold}${roundLabel}${c.reset}  ${c.dim}[0s]${c.reset}`;
  const l1 = agentLine("claude", c.magenta, state.claude, 0);
  const l2 = agentLine("codex ", c.green, state.codex, 0);
  process.stderr.write(`${header}\n${l1}\n${l2}\n`);

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
      // Clear progress lines after completion
      process.stderr.write(`${c.cursorUp}${c.clearLine}${c.cursorUp}${c.clearLine}${c.cursorUp}${c.clearLine}\r`);
    },
  };
}

// ── Round display ─────────────────────────────────────────────

export function displayRound(
  roundNumber: number,
  maxRounds: number,
  claude: AgentResult,
  codex: AgentResult,
  _sessionId: string,
): void {
  const roundType = roundNumber === 0 ? "independent analysis" : "cross-review";
  const totalDuration = Math.max(claude.durationMs, codex.durationMs);

  // Round header
  console.log(`\n${c.bold}■ Round ${roundNumber}${c.reset}  ${c.dim}${roundType}${c.reset}  ${c.dim}${formatDuration(totalDuration)}${c.reset}`);

  // Claude
  const claudeTime = `${c.dim}(${formatDuration(claude.durationMs)})${c.reset}`;
  const claudeDivLen = Math.max(0, W - 12 - Math.ceil(claude.durationMs / 1000).toString().length);
  console.log(`\n${c.dim}──${c.reset} ${c.bold}${c.magenta}claude${c.reset} ${claudeTime} ${c.dim}${"─".repeat(claudeDivLen)}${c.reset}`);
  if (claude.error) {
    console.log(`${c.red}[error: ${claude.error}]${c.reset}`);
  }
  console.log(claude.content || `${c.dim}(no output)${c.reset}`);

  // Codex
  const codexTime = `${c.dim}(${formatDuration(codex.durationMs)})${c.reset}`;
  const codexDivLen = Math.max(0, W - 11 - Math.ceil(codex.durationMs / 1000).toString().length);
  console.log(`\n${c.dim}──${c.reset} ${c.bold}${c.green}codex${c.reset} ${codexTime} ${c.dim}${"─".repeat(codexDivLen)}${c.reset}`);
  if (codex.error) {
    console.log(`${c.red}[error: ${codex.error}]${c.reset}`);
  }
  console.log(codex.content || `${c.dim}(no output)${c.reset}`);

  console.log();
}

// ── HITL prompt ───────────────────────────────────────────────

export async function hitlPrompt(options: { atLimit: boolean; roundsLeft: number }): Promise<HitlAction> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  // Orientation: remind the user what actions mean in context
  const hint = options.atLimit
    ? `${c.dim}accept the analyses above or quit${c.reset}`
    : `${c.dim}continue to refine, accept as-is, steer with guidance, or quit${c.reset}`;
  console.log(`${hint}`);
  console.log(DIV);

  const parts: string[] = [];
  if (!options.atLimit) parts.push(`${c.bold}c${c.reset}ontinue`);
  parts.push(`${c.bold}a${c.reset}ccept`);
  parts.push(`${c.bold}s${c.reset}teer`);
  parts.push(`${c.bold}q${c.reset}uit`);

  const budget = options.atLimit
    ? `${c.dim}(max rounds)${c.reset}`
    : `${c.dim}(${options.roundsLeft} left)${c.reset}`;

  const prompt = `${parts.join("  ")}  ${budget} ${c.bold}▸${c.reset} `;

  return new Promise<HitlAction>((resolve) => {
    const ask = () => {
      rl.question(prompt, (answer) => {
        const input = answer.trim().toLowerCase();
        if (input === "c" || input === "continue") {
          if (options.atLimit) {
            process.stderr.write(`${c.red}Max rounds reached.${c.reset}\n`);
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
    process.stderr.write(`\n${c.yellow}steer${c.reset} ${c.dim}(enter twice to submit)${c.reset}\n> `);
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
      process.stderr.write("> ");
    });
  });
}

// ── Completion ────────────────────────────────────────────────

export function displayCompletion(status: "accepted" | "abandoned", artifactPath?: string | null): void {
  console.log(DIV);
  if (status === "accepted") {
    console.log(`${c.green}✓${c.reset} ${c.bold}accepted${c.reset}${artifactPath ? `  ${c.dim}${artifactPath}${c.reset}` : ""}`);
  } else {
    console.log(`${c.yellow}○${c.reset} ${c.bold}abandoned${c.reset}  ${c.dim}resume to continue${c.reset}`);
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

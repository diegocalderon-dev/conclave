import { createInterface } from "node:readline";
import type { Step } from "./session.ts";

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

const W = 56;
const DIV = `${c.dim}${"─".repeat(W)}${c.reset}`;

function agentLabel(agent: "claude" | "codex"): string {
  return agent === "claude"
    ? `${c.bold}${c.magenta}claude${c.reset}`
    : `${c.bold}${c.green}codex${c.reset}`;
}

// ── Session header ────────────────────────────────────────────

export function displaySessionHeader(task: string, maxSteps: number, workdir?: string): void {
  const wd = workdir ? ` ${c.dim}·${c.reset} ${c.dim}${workdir}${c.reset}` : "";
  console.log(`\n${c.bold}conclave${c.reset}${wd} ${c.dim}·${c.reset} ${c.dim}${maxSteps} steps${c.reset}`);
  console.log(DIV);
  console.log();
}

// ── Progress (single agent) ──────────────────────────────────

export interface ProgressTracker {
  stop(durationMs: number, isError: boolean): void;
}

export function startProgress(agent: "claude" | "codex", action: string): ProgressTracker {
  const startTime = Date.now();
  const label = agentLabel(agent);

  const draw = () => {
    const elapsed = formatDuration(Date.now() - startTime);
    process.stderr.write(`${c.clearLine}\r${c.yellow}●${c.reset} ${label} ${c.dim}${action}${c.reset}  ${c.dim}${elapsed}...${c.reset}`);
  };

  draw();
  const interval = setInterval(draw, 500);

  return {
    stop(durationMs, isError) {
      clearInterval(interval);
      const icon = isError ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;
      process.stderr.write(`${c.clearLine}\r${icon} ${label} ${c.dim}${action}${c.reset}  ${c.dim}${formatDuration(durationMs)}${c.reset}\n`);
    },
  };
}

// ── Step display ──────────────────────────────────────────────

export function displayStep(step: Step, stepsLeft: number): void {
  const label = agentLabel(step.agent);
  const time = `${c.dim}(${formatDuration(step.durationMs)})${c.reset}`;
  const divLen = Math.max(0, W - 10 - step.agent.length - Math.ceil(step.durationMs / 1000).toString().length);

  console.log(`\n${c.dim}──${c.reset} ${label} ${c.dim}${step.role}${c.reset} ${time} ${c.dim}${"─".repeat(divLen)}${c.reset}`);

  if (step.error) {
    console.log(`${c.red}[error: ${step.error}]${c.reset}`);
  }
  console.log(step.content || `${c.dim}(no output)${c.reset}`);

  if (step.steer) {
    console.log(`\n${c.dim}steered: ${step.steer}${c.reset}`);
  }

  console.log();
}

// ── HITL prompt ───────────────────────────────────────────────

export async function hitlPrompt(options: { atLimit: boolean; stepsLeft: number }): Promise<HitlAction> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  const hint = options.atLimit
    ? `${c.dim}accept the output above or quit${c.reset}`
    : `${c.dim}continue the relay, accept as-is, steer with guidance, or quit${c.reset}`;
  console.log(hint);
  console.log(DIV);

  const parts: string[] = [];
  if (!options.atLimit) parts.push(`${c.bold}c${c.reset}ontinue`);
  parts.push(`${c.bold}a${c.reset}ccept`);
  parts.push(`${c.bold}s${c.reset}teer`);
  parts.push(`${c.bold}q${c.reset}uit`);

  const budget = options.atLimit
    ? `${c.dim}(max steps)${c.reset}`
    : `${c.dim}(${options.stepsLeft} left)${c.reset}`;

  const prompt = `${parts.join("  ")}  ${budget} ${c.bold}▸${c.reset} `;

  return new Promise<HitlAction>((resolve) => {
    const ask = () => {
      rl.question(prompt, (answer) => {
        const input = answer.trim().toLowerCase();
        if (input === "c" || input === "continue") {
          if (options.atLimit) {
            process.stderr.write(`${c.red}Max steps reached.${c.reset}\n`);
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

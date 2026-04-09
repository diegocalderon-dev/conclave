import { createInterface } from "node:readline";
import type { AgentResult } from "./session.ts";

export type HitlAction = "continue" | "accept" | "steer" | "quit";

const DIVIDER = "─".repeat(60);

export function displayRound(roundNumber: number, claude: AgentResult, codex: AgentResult): void {
  const totalDuration = Math.max(claude.durationMs, codex.durationMs);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Round ${roundNumber}  (${formatDuration(totalDuration)})`);
  console.log(`${"═".repeat(60)}`);

  console.log(`\n${DIVIDER} Claude ${DIVIDER}`);
  if (claude.error) {
    console.log(`[error: ${claude.error}]`);
  }
  console.log(claude.content || "(no output)");

  console.log(`\n${DIVIDER} Codex ${DIVIDER}`);
  if (codex.error) {
    console.log(`[error: ${codex.error}]`);
  }
  console.log(codex.content || "(no output)");

  console.log();
}

export async function hitlPrompt(options: { atLimit: boolean }): Promise<HitlAction> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  const choices = options.atLimit
    ? "[a]ccept | [s]teer | [q]uit"
    : "[c]ontinue | [a]ccept | [s]teer | [q]uit";

  const hint = options.atLimit ? " (max rounds reached)" : "";

  return new Promise<HitlAction>((resolve) => {
    const ask = () => {
      rl.question(`${choices}${hint} > `, (answer) => {
        const input = answer.trim().toLowerCase();
        if (input === "c" || input === "continue") {
          if (options.atLimit) {
            console.error("Max rounds reached. Please accept or quit.");
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
    console.error("Enter guidance for the next round (press Enter twice to submit):");
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
    });
  });
}

export function displaySpinner(message: string): { stop: () => void } {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r${frames[i++ % frames.length]} ${message}`);
  }, 100);

  return {
    stop() {
      clearInterval(interval);
      process.stderr.write("\r" + " ".repeat(message.length + 4) + "\r");
    },
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining}s`;
}

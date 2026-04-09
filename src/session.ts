import { mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AdapterResponse } from "./adapters/types.ts";

export interface AgentResult {
  content: string;
  durationMs: number;
  error?: string;
}

export interface Round {
  number: number;
  claude: AgentResult;
  codex: AgentResult;
  steer?: string;
}

export interface Session {
  id: string;
  task: string;
  workdir?: string;
  repos?: string[];
  rounds: Round[];
  status: "active" | "accepted" | "abandoned";
  maxRounds: number;
  startedAt: string;
  acceptedAt?: string;
}

function defaultSessionDir(): string {
  return join(homedir(), ".conclave", "sessions");
}

function generateId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

export function createSession(task: string, options: { workdir?: string; repos?: string[]; maxRounds: number }): Session {
  return {
    id: generateId(),
    task,
    workdir: options.workdir,
    repos: options.repos,
    rounds: [],
    status: "active",
    maxRounds: options.maxRounds,
    startedAt: new Date().toISOString(),
  };
}

export function toAgentResult(response: AdapterResponse): AgentResult {
  return {
    content: response.content,
    durationMs: response.durationMs,
    error: response.error,
  };
}

export function persistSession(session: Session, sessionDir?: string): void {
  const dir = sessionDir ?? defaultSessionDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${session.id}.json`);
  Bun.write(filePath, JSON.stringify(session, null, 2));
}

export function loadSession(id: string, sessionDir?: string): Session | null {
  const dir = sessionDir ?? defaultSessionDir();
  const filePath = join(dir, `${id}.json`);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Session;
}

export function listSessions(sessionDir?: string): Array<{ id: string; task: string; status: string; startedAt: string; rounds: number }> {
  const dir = sessionDir ?? defaultSessionDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const raw = readFileSync(join(dir, f), "utf-8");
        const s = JSON.parse(raw) as Session;
        return {
          id: s.id,
          task: s.task.slice(0, 80),
          status: s.status,
          startedAt: s.startedAt,
          rounds: s.rounds.length,
        };
      } catch {
        return null;
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Session } from "./session.ts";

function defaultArtifactDir(): string {
  return join(homedir(), ".conclave", "artifacts");
}

export function saveArtifact(session: Session, artifactRoot?: string): string | null {
  if (session.status !== "accepted") return null;

  const dir = join(artifactRoot ?? defaultArtifactDir(), session.id);
  mkdirSync(dir, { recursive: true });

  const lastRound = session.rounds.at(-1)!;
  const totalDurationMs = session.rounds.reduce(
    (sum, r) => sum + Math.max(r.claude.durationMs, r.codex.durationMs),
    0,
  );
  const steerCount = session.rounds.filter((r) => r.steer).length;
  const title = session.task.slice(0, 80);

  const markdown = `---
title: "${title.replace(/"/g, '\\"')}"
conclave_session: "${session.id}"
agents: [claude, codex]
rounds: ${session.rounds.length}
duration_seconds: ${Math.round(totalDurationMs / 1000)}
status: ${session.status}
created: ${session.startedAt}
accepted: ${session.acceptedAt ?? ""}
---

# ${session.task}

## Claude — Final Analysis
${lastRound.claude.content || "(no output)"}

## Codex — Final Analysis
${lastRound.codex.content || "(no output)"}

## Session Metadata
- Rounds: ${session.rounds.length}
- Total duration: ${formatDuration(totalDurationMs)}
- Steer interventions: ${steerCount}
`;

  const outputPath = join(dir, "output.md");
  Bun.write(outputPath, markdown);

  // Also save raw session JSON alongside
  Bun.write(join(dir, "session.json"), JSON.stringify(session, null, 2));

  return outputPath;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining}s`;
}

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

  const lastStep = session.steps.at(-1)!;
  const totalDurationMs = session.steps.reduce((sum, s) => sum + s.durationMs, 0);
  const steerCount = session.steps.filter((s) => s.steer).length;
  const title = session.task.slice(0, 80);

  const markdown = `---
title: "${title.replace(/"/g, '\\"')}"
conclave_session: "${session.id}"
agents: [claude, codex]
steps: ${session.steps.length}
duration_seconds: ${Math.round(totalDurationMs / 1000)}
status: ${session.status}
created: ${session.startedAt}
accepted: ${session.acceptedAt ?? ""}
---

# ${session.task}

## Final Output
${lastStep.content || "(no output)"}

## Session History
${session.steps.map((s) => `### Step ${s.number} — ${s.agent} (${s.role})${s.steer ? ` [steered]` : ""}
${s.content || "(no output)"}
`).join("\n")}

## Metadata
- Steps: ${session.steps.length}
- Total duration: ${formatDuration(totalDurationMs)}
- Steer interventions: ${steerCount}
`;

  const outputPath = join(dir, "output.md");
  Bun.write(outputPath, markdown);
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

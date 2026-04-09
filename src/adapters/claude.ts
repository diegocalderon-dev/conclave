import type { Adapter, AdapterResponse, DetectResult, InvokeOptions } from "./types.ts";
import { commandExists, runCommand } from "./base.ts";

const READ_ONLY_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "LS",
  "Bash(git log:*)",
  "Bash(git diff:*)",
  "Bash(git show:*)",
  "Bash(git blame:*)",
  "Bash(git branch:*)",
  "Bash(git status:*)",
].join(",");

export class ClaudeAdapter implements Adapter {
  name = "claude";

  async detect(): Promise<DetectResult> {
    const result = await commandExists("claude");
    if (!result.exists) {
      return { available: false, error: "claude CLI not found in PATH" };
    }
    return { available: true, version: result.version };
  }

  async invoke(prompt: string, options: InvokeOptions = {}): Promise<AdapterResponse> {
    const { workdir, timeout, allowWrites = false } = options;

    const args = [
      "claude",
      "-p",
      prompt,
      "--output-format", "json",
      "--no-session-persistence",
      "--append-system-prompt", "IMPORTANT: Always end your response with a text message summarizing your analysis. Never end on a tool call.",
    ];

    if (allowWrites) {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--allowed-tools", READ_ONLY_TOOLS);
    }

    const raw = await runCommand({ args, cwd: workdir, timeout });

    // Transport-level JSON parsing: extract .result from Claude CLI envelope
    if (raw.exitCode === 0 && raw.content) {
      try {
        const envelope = JSON.parse(raw.content);
        if (typeof envelope.result === "string" && envelope.result.length > 0) {
          return { ...raw, content: envelope.result };
        }
        // result is empty — Claude likely ended on a tool call
        if (envelope.result === "" || envelope.result === null) {
          return { ...raw, content: "", error: "empty-result: model ended on tool call without text summary" };
        }
      } catch {
        // Not valid JSON — return raw content (may happen with non-json output)
      }
    }

    return raw;
  }
}

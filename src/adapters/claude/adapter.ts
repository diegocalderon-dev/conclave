/** Claude CLI adapter */

import type {
  Adapter,
  AdapterCapabilities,
  AdapterResponse,
  AdapterInvokeOptions,
} from "../../core/types.js";
import { detectCommand, runCommand } from "../base.js";

export class ClaudeAdapter implements Adapter {
  id = "claude";
  private commandOverride?: string;
  private modelOverride?: string;

  constructor(options?: { command?: string; model?: string }) {
    this.commandOverride = options?.command;
    this.modelOverride = options?.model;
  }

  private get command(): string {
    return this.commandOverride || "claude";
  }

  async detect(): Promise<AdapterCapabilities> {
    const detection = await detectCommand(this.command);
    if (!detection.available) {
      return {
        id: this.id,
        name: "Claude Code",
        available: false,
        nonInteractiveSupported: false,
        structuredOutputSupported: false,
        features: [],
        error: `${this.command} not found in PATH`,
      };
    }

    return {
      id: this.id,
      name: "Claude Code",
      available: true,
      command: detection.path,
      version: detection.version,
      nonInteractiveSupported: true, // -p / --print
      structuredOutputSupported: true, // --output-format json
      features: [
        "non-interactive-print",
        "json-output",
        "model-selection",
        "system-prompt",
        "permission-modes",
        "worktree-isolation",
      ],
    };
  }

  async invoke(
    prompt: string,
    options?: AdapterInvokeOptions
  ): Promise<AdapterResponse> {
    const args: string[] = [this.command, "-p", prompt];

    if (this.modelOverride || options?.model) {
      args.push("--model", options?.model || this.modelOverride!);
    }

    if (options?.structuredOutput) {
      args.push("--output-format", "json");
    }

    // Use permissive mode for orchestration
    args.push("--permission-mode", "bypassPermissions");
    args.push("--no-session-persistence");

    if (options?.outputFile) {
      // Claude doesn't have -o, we capture stdout
    }

    const response = await runCommand(args, {
      timeout: options?.timeout,
      cwd: options?.workingDir,
    });

    // Try to parse structured output
    if (options?.structuredOutput && response.content) {
      try {
        response.structured = JSON.parse(response.content);
      } catch {
        // Content is plain text, that's fine
      }
    }

    return response;
  }
}

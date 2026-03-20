/** Codex CLI adapter */

import type {
  Adapter,
  AdapterCapabilities,
  AdapterResponse,
  AdapterInvokeOptions,
} from "../../core/types.js";
import { detectCommand, runCommand } from "../base.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, readFileSync, existsSync } from "fs";

export class CodexAdapter implements Adapter {
  id = "codex";
  private commandOverride?: string;
  private modelOverride?: string;

  constructor(options?: { command?: string; model?: string }) {
    this.commandOverride = options?.command;
    this.modelOverride = options?.model;
  }

  private get command(): string {
    return this.commandOverride || "codex";
  }

  async detect(): Promise<AdapterCapabilities> {
    const detection = await detectCommand(this.command);
    if (!detection.available) {
      return {
        id: this.id,
        name: "Codex CLI",
        available: false,
        nonInteractiveSupported: false,
        structuredOutputSupported: false,
        features: [],
        error: `${this.command} not found in PATH`,
      };
    }

    return {
      id: this.id,
      name: "Codex CLI",
      available: true,
      command: detection.path,
      version: detection.version,
      nonInteractiveSupported: true, // codex exec
      structuredOutputSupported: true, // --json, --output-schema, -o
      features: [
        "non-interactive-exec",
        "json-events",
        "output-last-message",
        "model-selection",
        "sandbox-modes",
        "full-auto",
        "output-schema",
      ],
    };
  }

  async invoke(
    prompt: string,
    options?: AdapterInvokeOptions
  ): Promise<AdapterResponse> {
    const args: string[] = [this.command, "exec"];

    if (this.modelOverride || options?.model) {
      args.push("-m", options?.model || this.modelOverride!);
    }

    // Use full-auto for autonomous orchestration
    args.push("--full-auto");

    // Capture output to a file for reliable extraction
    const outDir = mkdtempSync(join(tmpdir(), "conclave-codex-"));
    const outFile = join(outDir, "output.txt");
    args.push("-o", outFile);

    // Skip git repo check since we may run from temp dirs
    args.push("--skip-git-repo-check");

    // The prompt goes last
    args.push(prompt);

    const response = await runCommand(args, {
      timeout: options?.timeout || 300_000,
      cwd: options?.workingDir,
    });

    // Read captured output if available
    if (existsSync(outFile)) {
      const captured = readFileSync(outFile, "utf-8");
      if (captured) {
        response.content = captured;
      }
    }

    return response;
  }
}

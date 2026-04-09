import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Adapter, AdapterResponse, DetectResult, InvokeOptions } from "./types.ts";
import { commandExists, runCommand } from "./base.ts";

export class CodexAdapter implements Adapter {
  name = "codex";

  async detect(): Promise<DetectResult> {
    const result = await commandExists("codex");
    if (!result.exists) {
      return { available: false, error: "codex CLI not found in PATH" };
    }
    return { available: true, version: result.version };
  }

  async invoke(prompt: string, options: InvokeOptions = {}): Promise<AdapterResponse> {
    const { workdir, timeout, allowWrites = false } = options;

    const tmpDir = mkdtempSync(join(tmpdir(), "conclave-codex-"));
    const outputFile = join(tmpDir, "output.txt");

    try {
      const args = [
        "codex",
        "exec",
        prompt,
        "-s", allowWrites ? "workspace-write" : "read-only",
        "-o", outputFile,
        "--skip-git-repo-check",
        "--ephemeral",
      ];

      if (workdir) {
        args.push("-C", workdir);
      }

      const raw = await runCommand({ args, timeout });

      // Read output from file (more reliable than stdout)
      if (existsSync(outputFile)) {
        const fileContent = readFileSync(outputFile, "utf-8").trim();
        if (fileContent) {
          return { ...raw, content: fileContent, exitCode: raw.exitCode };
        }
      }

      // Fall back to stdout if file is empty/missing
      return raw;
    } finally {
      // Cleanup temp directory
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

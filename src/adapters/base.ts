/** Base adapter utilities shared by all adapters */

import type {
  Adapter,
  AdapterCapabilities,
  AdapterResponse,
  AdapterInvokeOptions,
} from "../core/types.js";

export async function detectCommand(
  command: string
): Promise<{ available: boolean; path?: string; version?: string }> {
  try {
    const proc = Bun.spawn(["which", command], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return { available: false };

    const path = (await new Response(proc.stdout).text()).trim();

    // Try to get version
    let version: string | undefined;
    try {
      const vProc = Bun.spawn([command, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await vProc.exited;
      version = (await new Response(vProc.stdout).text()).trim().split("\n")[0];
    } catch {
      // version detection is optional
    }

    return { available: true, path, version };
  } catch {
    return { available: false };
  }
}

export async function runCommand(
  args: string[],
  options: {
    timeout?: number;
    cwd?: string;
    stdin?: string;
  } = {}
): Promise<AdapterResponse> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: options.cwd,
      stdin: options.stdin ? new Response(options.stdin).body! : undefined,
    });

    // Handle timeout
    let timedOut = false;
    const timeoutMs = options.timeout || 300_000; // 5 min default
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const durationMs = Date.now() - start;

    if (timedOut) {
      return {
        content: stdout,
        exitCode: -1,
        durationMs,
        error: `Command timed out after ${timeoutMs}ms`,
      };
    }

    return {
      content: stdout,
      exitCode,
      durationMs,
      error: exitCode !== 0 ? stderr || `Exit code ${exitCode}` : undefined,
    };
  } catch (err) {
    return {
      content: "",
      exitCode: -1,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

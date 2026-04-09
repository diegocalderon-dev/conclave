import type { AdapterResponse } from "./types.ts";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

export interface SpawnOptions {
  args: string[];
  cwd?: string;
  timeout?: number;
  stdin?: string;
}

export async function runCommand(options: SpawnOptions): Promise<AdapterResponse> {
  const { args, cwd, timeout = DEFAULT_TIMEOUT, stdin } = options;
  const start = Date.now();

  const proc = Bun.spawn(args, {
    cwd,
    stdin: stdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (stdin && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }

  const timer = setTimeout(() => {
    proc.kill();
  }, timeout);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timer);

    const durationMs = Date.now() - start;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // If we exceeded the timeout, the process was killed
    if (durationMs >= timeout) {
      return {
        content: stdout.trim(),
        durationMs,
        exitCode: exitCode ?? -1,
        error: "timeout",
      };
    }

    if (exitCode !== 0) {
      return {
        content: stdout.trim(),
        durationMs,
        exitCode,
        error: stderr.trim() || `exit code ${exitCode}`,
      };
    }

    const content = stdout.trim();
    if (!content) {
      return { content: "", durationMs, exitCode: 0, error: "empty-response" };
    }

    return { content, durationMs, exitCode: 0 };
  } catch (err) {
    clearTimeout(timer);
    return {
      content: "",
      durationMs: Date.now() - start,
      exitCode: -1,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function commandExists(command: string): Promise<{ exists: boolean; version?: string }> {
  try {
    const proc = Bun.spawn([command, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const version = (await new Response(proc.stdout).text()).trim();
      return { exists: true, version };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

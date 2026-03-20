# Adapter Contract

This document specifies the interface that every Conclave adapter must implement.

## AdapterCapabilities Interface

```typescript
interface AdapterCapabilities {
  /** Unique identifier for this adapter (e.g., "claude", "codex"). */
  id: string;

  /** Human-readable name for display purposes. */
  name: string;

  /** Whether the adapter supports structured JSON output. */
  supportsJsonOutput: boolean;

  /** Whether the adapter supports streaming responses. */
  supportsStreaming: boolean;

  /** Maximum context length the underlying agent can handle (in tokens). */
  maxContextLength: number;
}
```

## AdapterResponse Interface

```typescript
interface AdapterResponse {
  /** The text output from the agent. */
  content: string;

  /** Structured output, if the adapter supports it and it was requested. */
  structured?: Record<string, unknown>;

  /** Token usage for this invocation, if reported by the agent. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };

  /** Wall-clock duration of the invocation in milliseconds. */
  durationMs: number;

  /** Whether the invocation completed successfully. */
  success: boolean;

  /** Error details if success is false. */
  error?: {
    code: string;
    message: string;
    retriable: boolean;
  };
}
```

## Adapter Interface

```typescript
interface Adapter {
  /** Static metadata about this adapter's capabilities. */
  capabilities: AdapterCapabilities;

  /**
   * Check whether the underlying agent CLI is available and functional.
   * Returns true if the adapter is ready to accept invocations.
   * Used by the `doctor` command and at run startup.
   */
  detect(): Promise<boolean>;

  /**
   * Send a prompt to the agent and return a structured response.
   * The adapter is responsible for translating the prompt into
   * whatever CLI arguments the underlying agent requires.
   */
  invoke(prompt: string, options?: InvokeOptions): Promise<AdapterResponse>;
}

interface InvokeOptions {
  /** Request structured JSON output instead of plain text. */
  jsonOutput?: boolean;

  /** Working directory for the agent process. */
  cwd?: string;

  /** Timeout in milliseconds. */
  timeoutMs?: number;

  /** Additional environment variables to pass to the agent process. */
  env?: Record<string, string>;
}
```

## Claude Adapter

The Claude adapter wraps the Claude Code CLI (`claude`).

**Detection:** Runs `claude --version` and checks for a successful exit code.

**Invocation flags:**

- `-p` / `--print` -- Non-interactive mode. The prompt is passed as an argument and the response is printed to stdout.
- `--output-format json` -- Requests JSON-structured output, which the adapter parses into the `structured` field of `AdapterResponse`.
- `--permission-mode bypassPermissions` -- Allows the agent to operate without interactive permission prompts. Required for autonomous execution within the orchestrator.

**Example invocation:**

```bash
claude -p "Your prompt here" --output-format json --permission-mode bypassPermissions
```

**Response parsing:** The Claude CLI in JSON output mode returns a JSON object. The adapter extracts the text content and token usage from this structure.

## Codex Adapter

The Codex adapter wraps the Codex CLI (`codex`).

**Detection:** Runs `codex --version` and checks for a successful exit code.

**Invocation flags:**

- `exec` -- Subcommand for non-interactive execution.
- `--full-auto` -- Runs without requiring user approval for actions.
- `-o <path>` -- Captures output to a file, which the adapter reads after the process completes.

**Example invocation:**

```bash
codex exec "Your prompt here" --full-auto -o /tmp/codex-output.json
```

**Response parsing:** The adapter reads the output file written by `-o`, extracts the response content, and normalizes it into an `AdapterResponse`.

## Error Normalization

Adapters are responsible for normalizing errors from their underlying CLI into the standard `AdapterResponse.error` structure. The orchestrator never sees raw CLI errors.

Error normalization rules:

- **Timeout:** If the agent process exceeds `timeoutMs`, the adapter kills the process and returns `{ code: "TIMEOUT", message: "...", retriable: true }`.
- **CLI not found:** If the agent CLI binary is not on `$PATH`, return `{ code: "NOT_FOUND", message: "...", retriable: false }`.
- **Non-zero exit:** If the agent process exits with a non-zero code, the adapter captures stderr and returns `{ code: "PROCESS_ERROR", message: "...", retriable: true }`.
- **Parse failure:** If the agent's output cannot be parsed (e.g., malformed JSON when JSON was requested), return `{ code: "PARSE_ERROR", message: "...", retriable: true }`.
- **Authentication:** If the agent reports an auth error, return `{ code: "AUTH_ERROR", message: "...", retriable: false }`.

## Adding New Adapters

To add support for a new agent:

1. Create a new file in `src/adapters/` (e.g., `src/adapters/newagent.ts`).
2. Implement the `Adapter` interface with appropriate `detect` and `invoke` methods.
3. Register the adapter in the adapter registry so the orchestrator can discover it.
4. Add detection to the `doctor` command output.
5. Write tests in `tests/` covering detection, successful invocation, and error normalization.

The adapter should handle all agent-specific concerns (CLI flags, output parsing, error mapping) internally. The orchestrator interacts only through the `Adapter` interface and must not contain any agent-specific logic.

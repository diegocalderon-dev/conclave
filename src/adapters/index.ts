export { ClaudeAdapter } from "./claude/adapter.js";
export { CodexAdapter } from "./codex/adapter.js";
export { detectCommand, runCommand } from "./base.js";

import { ClaudeAdapter } from "./claude/adapter.js";
import { CodexAdapter } from "./codex/adapter.js";
import type { Adapter, AdapterCapabilities, ConclaveConfig } from "../core/types.js";

export function createAdapters(config: ConclaveConfig): Adapter[] {
  return [
    new ClaudeAdapter(config.adapters.claude),
    new CodexAdapter(config.adapters.codex),
  ];
}

export async function detectAllAdapters(
  adapters: Adapter[]
): Promise<AdapterCapabilities[]> {
  return Promise.all(adapters.map((a) => a.detect()));
}

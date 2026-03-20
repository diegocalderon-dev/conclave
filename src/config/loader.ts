/** Config loading with precedence: CLI flags > project config > user config > defaults */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import TOML from "@iarna/toml";
import type {
  ConclaveConfig,
  DepthProfile,
  AutonomyMode,
  TranscriptRetention,
  LaneType,
  ALL_LANES,
} from "../core/types.js";

const DEFAULT_CONFIG: ConclaveConfig = {
  artifactRoot: join(homedir(), ".conclave", "artifacts"),
  depth: "low",
  autonomy: "supervised",
  transcriptRetention: "summary",
  adapters: {
    claude: {},
    codex: {},
  },
  lanes: {
    enabled: [
      "independent-draft",
      "atomic-claim",
      "issue-debate",
      "hybrid-edit",
      "contrarian",
    ],
    maxParallel: 2,
  },
  limits: {
    maxRounds: 6,
    stagnationThreshold: 2,
    maxClaims: 50,
  },
};

export interface CLIFlags {
  artifactRoot?: string;
  depth?: DepthProfile;
  autonomy?: AutonomyMode;
  transcriptRetention?: TranscriptRetention;
  configPath?: string;
}

function loadTomlFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return TOML.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeConfig(
  base: ConclaveConfig,
  overrides: Record<string, unknown>
): ConclaveConfig {
  const result = { ...base };

  if (typeof overrides.artifact_root === "string") {
    result.artifactRoot = overrides.artifact_root.replace("~", homedir());
  }
  if (typeof overrides.depth === "string") {
    result.depth = overrides.depth as DepthProfile;
  }
  if (typeof overrides.autonomy === "string") {
    result.autonomy = overrides.autonomy as AutonomyMode;
  }
  if (typeof overrides.transcript_retention === "string") {
    result.transcriptRetention =
      overrides.transcript_retention as TranscriptRetention;
  }

  const adapters = overrides.adapters as Record<string, unknown> | undefined;
  if (adapters) {
    const claude = adapters.claude as Record<string, unknown> | undefined;
    if (claude) {
      result.adapters.claude = {
        ...result.adapters.claude,
        command: claude.command as string | undefined,
        model: claude.model as string | undefined,
      };
    }
    const codex = adapters.codex as Record<string, unknown> | undefined;
    if (codex) {
      result.adapters.codex = {
        ...result.adapters.codex,
        command: codex.command as string | undefined,
        model: codex.model as string | undefined,
      };
    }
  }

  const lanes = overrides.lanes as Record<string, unknown> | undefined;
  if (lanes) {
    if (Array.isArray(lanes.enabled)) {
      result.lanes.enabled = lanes.enabled as LaneType[];
    }
    if (typeof lanes.max_parallel === "number") {
      result.lanes.maxParallel = lanes.max_parallel;
    }
  }

  const limits = overrides.limits as Record<string, unknown> | undefined;
  if (limits) {
    if (typeof limits.max_rounds === "number") {
      result.limits.maxRounds = limits.max_rounds;
    }
    if (typeof limits.stagnation_threshold === "number") {
      result.limits.stagnationThreshold = limits.stagnation_threshold;
    }
    if (typeof limits.max_claims === "number") {
      result.limits.maxClaims = limits.max_claims;
    }
  }

  return result;
}

export function loadConfig(flags: CLIFlags = {}): ConclaveConfig {
  let config = { ...DEFAULT_CONFIG };

  // User config (~/.conclave/config.toml)
  const userConfigPath = join(homedir(), ".conclave", "config.toml");
  const userToml = loadTomlFile(userConfigPath);
  if (userToml) {
    config = mergeConfig(config, userToml);
  }

  // Project config (./conclave.toml)
  const projectConfigPath = flags.configPath || "conclave.toml";
  const projectToml = loadTomlFile(projectConfigPath);
  if (projectToml) {
    config = mergeConfig(config, projectToml);
  }

  // CLI flags (highest precedence)
  if (flags.artifactRoot) {
    config.artifactRoot = flags.artifactRoot.replace("~", homedir());
  }
  if (flags.depth) {
    config.depth = flags.depth;
  }
  if (flags.autonomy) {
    config.autonomy = flags.autonomy;
  }
  if (flags.transcriptRetention) {
    config.transcriptRetention = flags.transcriptRetention;
  }

  return config;
}

export function getDefaultConfig(): ConclaveConfig {
  return { ...DEFAULT_CONFIG };
}

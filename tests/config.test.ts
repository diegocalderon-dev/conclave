import { describe, test, expect } from "bun:test";
import { loadConfig, getDefaultConfig } from "../src/config/loader.js";
import { homedir } from "os";
import { join } from "path";

describe("Config", () => {
  test("default config has expected shape", () => {
    const config = getDefaultConfig();
    expect(config.depth).toBe("low");
    expect(config.autonomy).toBe("supervised");
    expect(config.transcriptRetention).toBe("summary");
    expect(config.artifactRoot).toBe(join(homedir(), ".conclave", "artifacts"));
    expect(config.adapters.claude).toBeDefined();
    expect(config.adapters.codex).toBeDefined();
    expect(config.lanes.enabled).toContain("independent-draft");
    expect(config.limits.maxRounds).toBeGreaterThan(0);
  });

  test("CLI flags override defaults", () => {
    const config = loadConfig({
      depth: "exhaustive",
      autonomy: "autonomous",
      artifactRoot: "/tmp/test-artifacts",
    });
    expect(config.depth).toBe("exhaustive");
    expect(config.autonomy).toBe("autonomous");
    expect(config.artifactRoot).toBe("/tmp/test-artifacts");
  });

  test("config precedence: CLI > project > user > defaults", () => {
    // Without project/user configs, CLI flags should win over defaults
    const config = loadConfig({ depth: "low" });
    expect(config.depth).toBe("low");

    const defaultConfig = getDefaultConfig();
    expect(defaultConfig.depth).toBe("low");
  });

  test("tilde expansion in artifact root", () => {
    const config = loadConfig({ artifactRoot: "~/my-artifacts" });
    expect(config.artifactRoot).toBe(join(homedir(), "my-artifacts"));
  });
});

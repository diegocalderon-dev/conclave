# Conclave

A protocol-driven, model-agnostic deliberation orchestrator.

Conclave formalizes the workflow of running multiple AI coding agents (currently Claude Code and Codex) against the same task, then consolidating their outputs into a single, ratified result. Instead of manually cross-feeding outputs between agents and eyeballing differences, Conclave runs a structured deliberation protocol that produces traceable artifacts at every step.

## Problem

When using both Codex and Claude on the same coding task, the typical workflow involves:

- Running each agent independently.
- Manually copying relevant outputs from one into the other.
- Mentally tracking where they agree and disagree.
- Making a judgment call on the final output without a clear record of why.

This is tedious, error-prone, and leaves no audit trail. Conclave replaces this manual process with a repeatable, artifact-producing protocol.

## Quick Start

```bash
# Install dependencies
bun install

# Verify adapters are available and environment is healthy
bun run doctor

# Run a deliberation
bun run dev -- run --task "Refactor the auth module to use JWT" --depth medium
```

## CLI Commands

| Command  | Description                                         |
|----------|-----------------------------------------------------|
| `run`    | Execute a deliberation against a task.              |
| `doctor` | Check adapter availability and environment health.  |
| `help`   | Show usage information.                             |

## Run Options

| Flag               | Required | Default                    | Description                                                  |
|--------------------|----------|----------------------------|--------------------------------------------------------------|
| `--task`           | **Yes**  | —                          | The task or question to deliberate.                          |
| `--target`         | No       | `"default"`                | Target workspace or topic context.                           |
| `--depth`          | No       | `medium`                   | Depth profile: `low`, `medium`, `high`, or `exhaustive`.     |
| `--autonomy`       | No       | `supervised`               | Autonomy mode: `supervised` or `autonomous`.                 |
| `--transcripts`    | No       | `summary`                  | Transcript retention: `none`, `summary`, or `full`.          |
| `--artifact-root`  | No       | `~/.conclave/artifacts`    | Directory for storing run artifacts.                         |
| `--adapters`       | No       | `claude,codex`             | Comma-separated list of adapters to use.                     |
| `--dry-run`        | No       | `false`                    | Simulate the run without invoking adapters.                  |
| `--config`         | No       | `./conclave.toml`          | Path to a project config file.                               |

`--task` is the only required flag. Everything else has sensible defaults.

## Architecture Overview

Conclave operates through a **6-phase protocol**:

1. **Input Normalization** -- Parse task, resolve config, prepare the run manifest.
2. **Discovery** -- Agents work independently to explore the problem space and produce drafts.
3. **Consolidation** -- Claims and issues are extracted and merged into shared ledgers.
4. **Validation** -- Agents review each other's claims; agreements and disputes are recorded.
5. **Ratification** -- Agents vote to approve or block the synthesized result.
6. **Synthesis** -- Final output is produced, with any unresolved disagreements labeled honestly.

Work is distributed across **5 lane types**:

- **Independent Draft** -- Each agent produces a full solution independently.
- **Atomic Claim** -- Agents extract and defend individual claims about the solution.
- **Issue Debate** -- Structured back-and-forth on specific points of disagreement.
- **Hybrid Edit** -- One agent edits another's draft with tracked changes.
- **Contrarian** -- An agent is assigned to challenge the emerging consensus.

Agents are accessed through an **adapter model**. Each adapter implements `detect` (check availability) and `invoke` (run a prompt and return structured output). This keeps the core protocol independent of any specific agent CLI.

## Configuration

Every flag can also be set via TOML config files, so you don't need to pass them on every run.

**Config files** (checked in order, later values override earlier):

1. `~/.conclave/config.toml` — user-level defaults
2. `./conclave.toml` (or path from `--config`) — project-level overrides
3. CLI flags — highest precedence, always wins

See `conclave.toml.example` for a full annotated reference.

**Built-in defaults:**

| Setting                | Default                  |
|------------------------|--------------------------|
| `depth`                | `medium`                 |
| `autonomy`             | `supervised`             |
| `transcript_retention` | `summary`                |
| `artifact_root`        | `~/.conclave/artifacts`  |
| `lanes.enabled`        | all 5 lane types         |
| `lanes.max_parallel`   | `2`                      |
| `limits.max_rounds`    | `6`                      |
| `limits.stagnation_threshold` | `2`               |
| `limits.max_claims`    | `50`                     |

## Stack

- **Language:** TypeScript
- **Runtime:** Bun
- **Config format:** TOML

## Design Decisions

See [ADR-001: V1 Foundations](docs/adr/001-v1-foundations.md) for the rationale behind the core v1 decisions.

## License

MIT

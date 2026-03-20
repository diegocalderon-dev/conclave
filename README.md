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

# Start interactive mode
bun run dev

# Or run a deliberation directly
bun run dev -- run -t "Refactor the auth module to use JWT" -d medium
```

### Without cloning the repo

You can run Conclave directly with `bunx` (no clone needed):

```bash
bunx conclave
```

Or pass the task inline:

```bash
bunx conclave run -t "Design a caching strategy" -d low
```

Or install it globally:

```bash
bun install -g .   # from inside the cloned repo
conclave
```

## CLI Commands

| Command  | Description                                         |
|----------|-----------------------------------------------------|
| `conclave` | Start interactive mode and wait for a task.       |
| `run`    | Execute a deliberation against a task.              |
| `doctor` | Check adapter availability and environment health.  |
| `help`   | Show usage information.                             |

## Run Options

| Short | Long               | Required | Default                    | Description                                          |
|-------|--------------------|----------|----------------------------|------------------------------------------------------|
| `-t`  | `--task`           | No in a TTY | --                      | The task or question to deliberate. If omitted in an interactive terminal, Conclave prompts for it. |
| `-T`  | `--target`         | No       | --                         | Label for this deliberation context (used as the folder name under artifact root). Omit for one-off runs. |
| `-d`  | `--depth`          | No       | `medium`                   | How thorough the deliberation should be. See [Depth profiles](#depth-profiles). |
| `-a`  | `--autonomy`       | No       | `supervised`               | `supervised`: normal run. `autonomous`: no human checkpoints. |
|       | `--transcripts`    | No       | `summary`                  | What to keep from raw adapter output. See [Transcript retention](#transcript-retention). |
| `-o`  | `--artifact-root`  | No       | `~/.conclave/artifacts`    | Where run output is stored.                          |
|       | `--adapters`       | No       | `claude,codex`             | Which adapters to use. Comma-separated.              |
| `-n`  | `--dry-run`        | No       | `false`                    | Simulate the full protocol with synthetic data, without calling any adapter. Useful for testing config and verifying the artifact pipeline. |
| `-c`  | `--config`         | No       | `./conclave.toml`          | Path to a project config file.                       |

In non-interactive contexts, `--task` is required. In an interactive terminal, `conclave` and `conclave run` will prompt for it when omitted. Interactive prompts accept multiple lines; press `Shift+Enter` to add a new line, `Enter` to submit the task, `Ctrl+J` as a fallback line break, and `Ctrl+C` to cancel.

### Depth profiles

Depth controls how many rounds of deliberation run and which lane types are activated.

| Profile      | Rounds | Lanes used                                                    | When to use                               |
|-------------|--------|---------------------------------------------------------------|-------------------------------------------|
| `low`       | up to 2 | independent draft, atomic claim                              | Quick sanity check. ~5-10 min.            |
| `medium`    | up to 4 | + issue debate                                                | Default. Good balance of depth and speed. |
| `high`      | up to 6 | + hybrid editing                                              | Important decisions worth more iteration. |
| `exhaustive`| up to 10| + contrarian / minority report                               | Maximum rigor. Expect longer runs.        |

Higher depth means more rounds, more lane types, and higher tolerance before stagnation stops the run.

### Transcript retention

Controls what is saved from raw adapter output alongside the canonical artifacts.

| Value     | What is kept                                          |
|-----------|-------------------------------------------------------|
| `none`    | Only canonical artifacts. No raw output saved.        |
| `summary` | Canonical artifacts + raw output per phase. Default.  |
| `full`    | Everything, including intermediate round outputs.     |

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

Agents are accessed through an **adapter model**. Each adapter implements `detect` (check availability) and `invoke` (run a prompt and return structured output). This keeps the core protocol independent of any specific agent CLI. See [Adding your own adapter](#adding-your-own-adapter).

## Configuration

Every flag can also be set via TOML config files, so you don't need to pass them on every run.

**Config files** (checked in order, later values override earlier):

1. `~/.conclave/config.toml` -- user-level defaults
2. `./conclave.toml` (or path from `--config`) -- project-level overrides
3. CLI flags -- highest precedence, always wins

See `conclave.toml.example` for a full annotated reference.

**Built-in defaults:**

| Setting                       | Default                  |
|-------------------------------|--------------------------|
| `depth`                       | `medium`                 |
| `autonomy`                    | `supervised`             |
| `transcript_retention`        | `summary`                |
| `artifact_root`               | `~/.conclave/artifacts`  |
| `lanes.enabled`               | all 5 lane types         |
| `lanes.max_parallel`          | `2`                      |
| `limits.max_rounds`           | `6`                      |
| `limits.stagnation_threshold` | `2`                      |
| `limits.max_claims`           | `50`                     |

## Adding your own adapter

Conclave ships with adapters for Claude Code and Codex, but the adapter contract is open. To add a new one:

1. Implement the `Adapter` interface in `src/adapters/your-adapter/adapter.ts`:
   - `detect()` -- return capabilities (is the CLI installed? does it support non-interactive mode?)
   - `invoke(prompt, options)` -- submit a prompt and return the output
2. Register it in `src/adapters/index.ts`
3. Add a config section in `conclave.toml`

See [docs/adapter-contract.md](docs/adapter-contract.md) for the full interface specification.

## Stack

- **Language:** TypeScript
- **Runtime:** Bun
- **Config format:** TOML

## Design Decisions

See [ADR-001: V1 Foundations](docs/adr/001-v1-foundations.md) for the rationale behind the core v1 decisions.

## License

MIT

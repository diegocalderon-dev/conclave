# Architecture

## System Overview

Conclave is a CLI tool that orchestrates multiple AI coding agents through a structured deliberation protocol. The orchestrator drives agents through a fixed sequence of phases, distributing work across typed lanes and collecting results into canonical artifacts. The core logic is agent-agnostic; all agent interaction flows through a narrow adapter interface.

## Directory Structure

```
src/
  cli/            CLI entry point, argument parsing, command dispatch
  core/           Shared types, constants, error definitions
  protocol/       Phase definitions, lane types, depth profiles, stagnation rules
  orchestration/  Run lifecycle, phase sequencing, lane scheduling
  adapters/       Adapter interface, Claude adapter, Codex adapter
  artifacts/      Artifact schema definitions, read/write operations
  config/         TOML parsing, config merging, precedence resolution
  validation/     Input validation, artifact integrity checks
```

## The 6-Phase Operating Model

Each deliberation run proceeds through these phases in order:

### 1. Input Normalization

Parse the task description, resolve configuration from all precedence layers, detect available adapters, and produce the **run manifest** that governs the rest of the execution.

### 2. Discovery

Agents work in parallel, independently exploring the problem space. Each agent produces drafts and initial claims without seeing the other's output. This phase uses **independent-draft** and **atomic-claim** lanes. The goal is to maximize the diversity of approaches before any cross-pollination.

### 3. Consolidation

The orchestrator extracts claims from each agent's discovery output and merges them into a shared **claim ledger**. Overlapping claims are grouped. Contradictions are flagged and entered into the **issue ledger** for structured debate.

### 4. Validation

Agents review the consolidated ledgers. Each agent can confirm, dispute, or refine claims made by the other. This phase uses **issue-debate**, **hybrid-edit**, and **contrarian** lanes. The output is an **agreement matrix** that records the status of every claim.

### 5. Ratification

Each agent reviews the proposed synthesis and votes to **approve** or **block**. Blocking requires a stated reason. If all agents approve, the synthesis is ratified. If any agent blocks, the orchestrator may run additional validation rounds (within the depth budget) or proceed to synthesis with labeled disagreements.

### 6. Synthesis

The final output is assembled. If ratified, it is marked as such. If not, unresolved disagreements are labeled honestly in the output. The **final synthesis** artifact is written along with the **ratification record**.

## The 5 Lane Types

Lanes are the unit of work within a phase. Each lane invocation targets a single adapter.

| Lane              | Purpose                                                              |
|-------------------|----------------------------------------------------------------------|
| Independent Draft | Produce a complete solution attempt without seeing other outputs.     |
| Atomic Claim      | Extract or defend a single, specific claim about the solution.       |
| Issue Debate      | Structured argument on a specific point of disagreement.             |
| Hybrid Edit       | Edit another agent's draft, producing tracked changes.               |
| Contrarian        | Challenge the current consensus to surface hidden assumptions.       |

## Adapter Contract

Every adapter implements two methods:

- **`detect()`** -- Returns whether the underlying agent CLI is available and functional. Used by the `doctor` command and at run startup.
- **`invoke(prompt, options)`** -- Sends a prompt to the agent and returns a structured response containing the agent's output, token usage, and any errors.

The adapter interface is intentionally minimal. The orchestrator does not know or care how an adapter communicates with its agent. See `docs/adapter-contract.md` for the full interface specification.

## Artifact Model

Every run produces up to 7 canonical artifacts, stored in the artifact root directory under a run-specific subdirectory:

| Artifact              | Description                                                        |
|-----------------------|--------------------------------------------------------------------|
| Run Manifest          | Frozen snapshot of task, config, adapters, and depth profile.      |
| Claim Ledger          | All claims extracted during discovery, with ownership and status.  |
| Issue Ledger          | All identified contradictions and points of disagreement.          |
| Agreement Matrix      | Per-claim status after validation (agreed, disputed, refined).     |
| Draft Synthesis       | Proposed combined output before ratification.                      |
| Ratification Record   | Each agent's vote (approve/block) with reasoning.                  |
| Final Synthesis       | The deliverable output, with disagreement labels if not ratified.  |

Artifacts are written as structured files (JSON or Markdown depending on type). They are append-only within a run -- no artifact is silently overwritten.

## Config Precedence

Configuration is resolved in this order (highest priority first):

1. **CLI flags** -- Explicit flags passed to the `run` command.
2. **Project config** -- `conclave.toml` in the target workspace root.
3. **User config** -- `~/.conclave/config.toml`.
4. **Defaults** -- Built-in fallback values.

## Context Pollution Controls

These rules prevent agents from biasing each other inappropriately during deliberation:

- **Shared Artifact Rule** -- Agents only see each other's work through the canonical artifacts produced by the orchestrator, never through raw transcripts.
- **Bounded Transcript Rule** -- Transcript data passed between phases is limited in size. Full transcripts are stored for audit but not fed forward.
- **Fresh Validation Rule** -- Validation-phase agents receive the consolidated ledgers, not the discovery-phase drafts. This forces validation to engage with the structured claims rather than rehashing drafts.
- **Style Decoupling Rule** -- The orchestrator strips or normalizes stylistic elements (formatting, tone) from artifacts before passing them to the next phase, so agents evaluate substance rather than presentation.
- **Stagnation Awareness** -- If successive rounds produce no meaningful change in the agreement matrix, the orchestrator detects stagnation and advances to the next phase rather than burning lane budget.

## Design Principles

- **Protocol First** -- The deliberation protocol is the product. The CLI is just a way to invoke it.
- **Artifact First** -- Every phase must produce a defined artifact. If a phase produces nothing, something is wrong.
- **Discovery Before Validation** -- Agents must explore independently before they review each other. Premature cross-pollination reduces diversity of thought.
- **Model-Agnostic Core** -- The orchestration layer has no knowledge of Claude, Codex, or any specific agent. All agent specifics live behind the adapter interface.
- **Progressive Autonomy** -- The `supervised` mode requires confirmation before each phase; `autonomous` mode runs to completion. The protocol is the same either way.
- **Harness Engineering** -- The value is in the harness (protocol, artifacts, adapter contract), not in any single agent's output.

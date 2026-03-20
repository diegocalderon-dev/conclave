# Architecture

## System Overview

Conclave is a CLI tool that orchestrates multiple AI coding agents through a structured deliberation protocol. The orchestrator drives agents through a fixed sequence of phases, distributes work across typed lanes, and collects results into canonical artifacts. The core logic is agent-agnostic; all agent interaction flows through a narrow adapter interface.

This document describes the architecture after [ADR 002](./adr/002-task-neutral-artifact-pipeline.md).

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

Parse the task description, resolve configuration from all precedence layers, detect available adapters, normalize the task into a task-neutral contract, and produce the **run manifest** that governs the rest of the execution.

### 2. Discovery

Agents work in parallel, independently exploring the problem space. Each agent produces candidate deliverables, initial claims, evidence, and open questions without seeing the other's output. This phase uses **independent-draft** and **atomic-claim** lanes. The goal is to maximize the diversity of approaches before any cross-pollination.

### 3. Consolidation

The orchestrator extracts claims from each agent's discovery output and deterministically merges them into a shared **claim ledger**. Overlapping claims are grouped, evidence references are normalized, and contradictions are flagged and entered into the **issue ledger** for structured debate. Consolidation is harness logic, not an adapter responsibility.

### 4. Validation

Agents review the consolidated ledgers. Each agent can confirm, dispute, or refine claims made by the other. This phase uses **issue-debate**, **hybrid-edit**, and **contrarian** lanes when the orchestrator determines additional work is justified. The output is an **agreement matrix** that records the status of every claim.

### 5. Ratification

Each agent reviews the proposed synthesis and votes to **approve** or **block**. Blocking requires a stated reason. If all agents approve, the synthesis is ratified. If any agent blocks, the orchestrator may run one bounded repair pass and ratify once more before proceeding to synthesis with labeled disagreements.

### 6. Synthesis

The final output is assembled around the user's requested deliverable. If ratified, it is marked as such. If not, unresolved disagreements are labeled honestly in the output. The **final synthesis** artifact is written along with the **ratification record**.

## The 5 Lane Types

Lanes are the unit of work within a phase. Each lane invocation targets a single adapter.

| Lane              | Purpose                                                              |
|-------------------|----------------------------------------------------------------------|
| Independent Draft | Produce a candidate deliverable without seeing other outputs.        |
| Atomic Claim      | Extract or defend a single, specific claim about the task.           |
| Issue Debate      | Structured argument on a specific point of disagreement.             |
| Hybrid Edit       | Edit another agent's draft, producing tracked changes.               |
| Contrarian        | Challenge the current consensus to surface hidden assumptions.       |

## Adapter Contract

Every adapter implements two methods:

- **`detect()`** -- Returns whether the underlying agent CLI is available and functional. Used by the `doctor` command and at run startup.
- **`invoke(prompt, options)`** -- Sends a prompt to the agent and returns a structured response containing the agent's output, token usage, and any errors.

The adapter interface is intentionally minimal. The orchestrator does not know or care how an adapter communicates with its agent. Adapters are responsible for normalizing success, empty output, malformed structured output, and execution failures into stable harness states. See `docs/adapter-contract.md` for the full interface specification.

## Artifact Model

Every run produces up to 7 canonical artifacts, stored in the artifact root directory under a run-specific subdirectory:

| Artifact              | Description                                                        |
|-----------------------|--------------------------------------------------------------------|
| Run Manifest          | Frozen snapshot of task, config, adapters, depth profile, and normalized task contract. |
| Claim Ledger          | All claims extracted during discovery, with ownership, evidence, and status. |
| Issue Ledger          | All identified contradictions and points of disagreement.          |
| Agreement Matrix      | Per-claim status after validation (agreed, disputed, refined).     |
| Draft Synthesis       | Proposed deliverable before ratification, including candidate deliverables, assumptions, supported claim references, and next actions. |
| Ratification Record   | Each agent's vote (approve/block) with reasoning.                  |
| Final Synthesis       | The deliverable output, with disagreement labels if not ratified.  |

Artifacts are written as structured files (JSON or Markdown depending on type). Each artifact has a stable filename within a run. Some artifacts are rewritten in place as later phases refine them; the final stored version is the canonical record for that run.

The artifact model is task-neutral. The same canonical files must support planning prompts, analytical prompts, design prompts, review prompts, and any other task the harness is asked to deliberate on.

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
- **Fast Default Rule** -- The default path should advance quickly unless disagreement, low confidence, missing evidence, or blocked ratification justifies more work.

## Design Principles

- **Protocol First** -- The deliberation protocol is the product. The CLI is just a way to invoke it.
- **Artifact First** -- Every phase must produce a defined artifact. If a phase produces nothing, something is wrong.
- **Discovery Before Validation** -- Agents must explore independently before they review each other. Premature cross-pollination reduces diversity of thought.
- **Model-Agnostic Core** -- The orchestration layer has no knowledge of Claude, Codex, or any specific agent. All agent specifics live behind the adapter interface.
- **Progressive Autonomy** -- The `supervised` mode requires confirmation before each phase; `autonomous` mode runs to completion. The protocol is the same either way.
- **Harness Engineering** -- The value is in the harness (protocol, artifacts, adapter contract), not in any single agent's output.
- **Task-Neutral Operation** -- The harness must work for arbitrary prompts without introducing prompt-type execution modes.
- **Deliverable-First UX** -- The primary Markdown output should answer the user's task directly; protocol metadata is supporting context.

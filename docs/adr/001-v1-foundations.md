# ADR 001: V1 Foundation Decisions

## Status

Accepted

## Date

2026-03-19

## Context

We have been running a manual workflow where Codex and Claude are both pointed at the same coding task, and their outputs are cross-fed by hand. This works but has several problems:

- No structured protocol governs the interaction -- the human decides ad hoc what to feed where.
- There is no audit trail of what each agent said, where they agreed, or where they disagreed.
- Consolidation is done by eyeballing, which does not scale and is error-prone.
- The workflow is not repeatable -- different runs of the same task can follow completely different paths depending on the human's judgment in the moment.

Conclave formalizes this workflow into a protocol-driven tool. This ADR locks the foundational decisions for the v1 implementation.

## Decisions

### TypeScript + Bun

The implementation language is TypeScript, running on Bun. Bun provides fast startup, built-in TypeScript support, and a built-in test runner. The target users (developers already using Claude Code and Codex) are likely to have Bun available or can install it trivially.

### CLI-First

V1 is a CLI tool. There is no web UI, no daemon, no API server. The CLI is the only interface. This keeps the scope tight and the feedback loop fast.

### Codex + Claude Only

V1 supports exactly two adapters: Claude Code and Codex. The adapter interface is designed to be extensible, but v1 does not attempt to support arbitrary agents. Supporting two well-understood agents is sufficient to validate the protocol.

### Protocol-Driven

The deliberation follows a fixed 6-phase protocol (input-normalization, discovery, consolidation, validation, ratification, synthesis). The protocol is the core product. The orchestrator enforces phase ordering and lane constraints -- agents do not self-organize.

### TOML Configuration

Configuration uses TOML files with a clear precedence: CLI flags > project-level `conclave.toml` > user-level `~/.conclave/config.toml` > built-in defaults. TOML was chosen over JSON (no comments) and YAML (ambiguous parsing) for its clarity and human-friendliness.

### External Artifact Storage

Run artifacts are stored in the filesystem, not in memory or in a database. The default location is `~/.conclave/artifacts/<run-id>/`. Artifacts are plain files (JSON and Markdown) that can be inspected with standard tools.

### Read-Only Target Workspaces

The orchestrator treats the target workspace (the codebase being discussed) as read-only. Conclave does not modify the target. If the final synthesis includes code changes, the human applies them. This avoids a class of dangerous failure modes and keeps the tool's blast radius bounded.

### Mandatory Canonical Artifacts

Every run must produce the 7 canonical artifacts: run manifest, claim ledger, issue ledger, agreement matrix, draft synthesis, ratification record, and final synthesis. Phases that fail to produce their artifacts are treated as errors. This ensures every run has a complete audit trail regardless of outcome.

### Bounded Transcripts

Raw agent transcripts are stored for audit but are not passed forward between phases in their entirety. Agents in later phases receive only the canonical artifacts (claim ledger, issue ledger, agreement matrix), not the full conversation history from earlier phases. This prevents context pollution and keeps prompts within manageable token budgets.

### Separate Discovery and Validation

Discovery and validation are distinct phases with an explicit boundary. Agents must explore independently (discovery) before they see each other's work (validation). This is a deliberate design choice to maximize diversity of thought. Combining discovery and validation into a single phase would risk premature convergence.

### Honest Disagreement Labeling

When agents disagree and the disagreement is not resolved through validation, the final synthesis must label the disagreement explicitly. Disagreements are not hidden, summarized away, or silently resolved by picking one agent's position. The human operator sees exactly where the agents diverged and why.

## Consequences

- V1 scope is constrained: two adapters, CLI only, no live workspace modification.
- The protocol is rigid by design -- flexibility comes from depth profiles, not from changing the phase order.
- Artifacts accumulate on disk and may need periodic cleanup (out of scope for v1).
- The bounded transcript rule means agents in later phases may lack context that was present in earlier phases. This is an acceptable trade-off for context pollution control.
- The read-only workspace rule means the tool produces recommendations, not applied changes. This is intentional for v1.

## Planning Source

This ADR is derived from `~/dev/docs/plans/2026-03-19-conclave-v1-standalone-plan.md`.

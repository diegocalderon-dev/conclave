# Refactor Plan: Task-Neutral Artifact Pipeline

## Purpose

This document turns [ADR 002](./adr/002-task-neutral-artifact-pipeline.md) into an execution plan.

The goal is to improve user experience without adding prompt-type modes. The harness should stay protocol-driven and task-neutral while producing faster, more reliable, and more useful outputs for any prompt.

## Goals

- Make the default run materially faster.
- Make the protocol resilient to empty, malformed, or partially structured adapter output.
- Preserve useful substance across phases with deterministic harness logic.
- Make final synthesis answer the user's task directly instead of centering protocol state.
- Keep the system model-agnostic and artifact-first.

## Non-Goals

- Adding prompt-specific modes such as code review mode or planning mode.
- Changing the fixed 6-phase protocol.
- Expanding the adapter roster.
- Allowing Conclave to edit target workspaces.

## Guiding Constraints

- The protocol remains the product.
- Canonical artifacts remain mandatory.
- Consolidation becomes orchestrator logic, not adapter work.
- Disagreements remain explicit and visible.
- Faster defaults must not come from hiding uncertainty or skipping artifact integrity.

## Execution Strategy

The refactor should be delivered in seven slices. Each slice should leave the repo in a working state with tests.

### Slice 1: Protocol and Documentation Reconciliation

Align implementation intent and repo docs before code changes spread.

Scope:

- Update `docs/protocol.md` to match the intended post-refactor responsibilities.
- Update `docs/architecture.md` where current behavior and desired harness behavior differ.
- Keep ADR 001 as v1 foundation and ADR 002 as the accepted next-step direction.

Acceptance criteria:

- No major mismatch remains between published phase semantics and planned engine behavior.
- Consolidation is clearly documented as deterministic orchestrator logic.
- Ratification and repair semantics are documented in one place.

### Slice 2: Core Type and Artifact Redesign

Introduce the task-neutral schema in `src/core/types.ts` and artifact persistence.

Scope:

- Add normalized task contract types.
- Replace the current loose discovery payload assumptions with stable task-neutral structures.
- Add identifiers needed for deterministic consolidation and disagreement tracing.
- Extend artifact validation to cover the new invariants.

Acceptance criteria:

- Every phase artifact can represent arbitrary tasks without prompt-specific fields.
- Stable IDs exist for claims, issues, and synthesis references.
- Validation rejects structurally incomplete artifacts.

### Slice 3: Adapter Response Normalization

Tighten adapter and invocation semantics so the harness receives reliable response states.

Scope:

- Normalize empty output, parse failure, timeout, and execution failure distinctly.
- Stop treating missing or malformed ratification payloads as implicit approval.
- Pass working-directory intent explicitly through the adapter interface.
- Ensure transcript capture preserves enough context for audit without becoming a dependency for later phases.

Acceptance criteria:

- The engine can distinguish successful empty output from successful structured output.
- Parse failures are surfaced as retriable or non-retriable harness errors.
- Adapter tests cover success, empty output, and malformed structured output.

### Slice 4: Discovery and Deterministic Consolidation

Refactor the protocol core to stop losing information between discovery and consolidation.

Scope:

- Replace greedy extraction and fuzzy matching with stable structured parsing.
- Keep discovery adapter-driven.
- Move consolidation fully into orchestrator logic.
- Build contradictions and overlaps directly from structured claims.

Acceptance criteria:

- Discovery preserves multiple atomic claims from a single adapter response.
- Consolidation does not invoke adapters.
- Agreement-ready ledgers can be built without substring heuristics.

### Slice 5: Validation, Ratification, and Bounded Repair

Make disagreement handling accurate and useful.

Scope:

- Validation should work from structured ledgers, not underspecified summaries.
- Ratification blocks should trigger one repair pass.
- Repair should only amend synthesis, disagreement attachment, or overstatement handling.
- After one repair pass, re-ratify once and then finalize.

Acceptance criteria:

- Blocked ratification cannot be published unchanged unless the disagreement is explicitly carried through.
- Final synthesis never reports stronger consensus than the artifacts support.
- Disagreement labels include source, scope, objection, and context.

### Slice 6: Faster Default Depth and Adaptive Escalation

Change the default experience from protocol-heavy to value-first.

Scope:

- Change the CLI default depth to `low`.
- Redefine `low` to be the fast default path.
- Add escalation triggers for additional work only when needed:
  - unresolved disagreement
  - low confidence
  - missing evidence
  - blocked ratification

Acceptance criteria:

- A normal run does less work than the current default unless the harness detects a reason to escalate.
- Depth behavior remains predictable and documented.
- Existing higher-depth profiles remain available as opt-in rigor.

### Slice 7: Deliverable-First Synthesis and Harness Tests

Rebuild the last mile and lock the behavior down.

Scope:

- Rewrite Markdown synthesis around the user task and supported claims.
- Keep protocol metadata in JSON artifacts and summaries, not as the main user-facing structure.
- Add integration tests with fake adapters covering varied prompts and failure modes.

Acceptance criteria:

- The default Markdown output reads like a deliverable for the task.
- The same harness works across heterogeneous prompt fixtures without special-case branches.
- The test suite catches the class of failures seen in early live runs.

## Test Plan

The refactor should add or expand tests in four layers.

### Unit

- artifact validation
- structured parsing
- deterministic consolidation
- repair pass decision logic
- adaptive depth escalation

### Adapter

- successful structured response
- successful empty response
- malformed structured response
- timeout and process failure normalization

### Engine Integration

- task-neutral prompt fixtures with fake adapters
- blocked ratification repaired successfully
- blocked ratification carried through honestly
- empty discovery output flagged correctly
- consolidation produces deterministic ledgers

### CLI / UX

- default depth is `low`
- summaries point to deliverable-first synthesis
- manifest and synthesis phase statuses are accurate

## Suggested PR Breakdown

1. `docs: reconcile protocol docs with ADR 002`
2. `core: introduce task-neutral artifact types`
3. `adapters: normalize response failure states`
4. `engine: deterministic consolidation and structured discovery`
5. `engine: ratification repair and strict synthesis honesty`
6. `config/cli: faster default depth and adaptive escalation`
7. `artifacts/tests: deliverable-first synthesis and harness coverage`

## Rollout Notes

- Keep migrations internal to the repo for now; there is no compatibility requirement for prior artifact formats in this slice.
- Prefer small PRs that preserve a working CLI and passing tests at each step.
- If documentation and implementation disagree during the refactor, update the documentation in the same change that resolves the mismatch.


# ADR 002: Task-Neutral Artifact Pipeline and Faster Default Runs

## Status

Accepted

## Date

2026-03-20

## Context

Conclave v1 established the core product shape: a fixed 6-phase deliberation protocol, a small adapter surface, canonical artifacts, and explicit disagreement labeling.

That foundation is sound, but early live runs exposed four user-facing failures:

- The harness is too brittle when agent output is empty, malformed, or only partially structured.
- The final synthesis over-reports protocol state and under-delivers on the user's requested outcome.
- The current default depth is too slow for the value returned in ordinary runs.
- The pipeline performs poorly on open-ended prompts because the intermediate artifacts are too generic in the wrong places and too lossy in the places that matter.

These failures are not specific to code review. They affect any prompt where the user expects a useful deliverable rather than a protocol transcript. Examples include repo review, planning from a ticket, design exploration, and refinement work.

This ADR defines the refactor direction for the next iteration of the harness.

## Decisions

### Task-Neutral Canonical Schema

Conclave will keep a single protocol for all prompts. It will not add prompt-specific modes such as "code review mode" or "planning mode."

Instead, the canonical artifacts will be refactored around a task-neutral schema that can represent any prompt:

- normalized task contract
- candidate deliverables
- atomic claims
- supporting evidence
- assumptions and constraints
- open questions
- disagreements
- recommended next actions

The orchestrator may infer the requested deliverable shape from the prompt, but this inference only affects synthesis and presentation. It does not change the protocol or introduce task-specific branches in the engine.

### Deterministic Middle of the Protocol

Consolidation will be orchestrator-owned and deterministic.

The orchestrator will no longer depend on an adapter to transform discovery output into the agreement-ready structure. Adapter output may be used in discovery, validation, and ratification, but the conversion from discovery artifacts to consolidated ledgers is harness logic.

This brings the implementation back in line with the protocol contract and reduces a major source of brittleness.

### Strict Artifact Semantics

Artifact production will become strict rather than best-effort.

- Empty or malformed phase outputs are errors, not silent fallbacks.
- Ratification parse failures are not treated as approval.
- A phase that cannot produce its required artifact is marked failed or partial in the manifest.
- The run summary must not imply agreement when the underlying artifacts do not support that claim.

The harness must prefer honest incompleteness over false confidence.

### Bounded Repair After Ratification Blocks

When ratification produces one or more blocks, Conclave will run one bounded repair pass before final synthesis.

That repair pass may:

- patch the draft synthesis
- re-attach missing disagreements
- correct overstated claims
- clarify uncertainty and scope

After that single repair pass, the orchestrator will re-run ratification once.

If the synthesis is still blocked, Conclave will produce a final synthesis with explicit disagreements. No further negotiation loops occur by default.

This preserves honesty while materially improving the user experience when the first draft synthesis is obviously fixable.

### Faster Default Depth

The default depth will change from `medium` to `low`.

The `low` profile will be redefined to be the default fast path for most tasks:

- one independent discovery pass per adapter
- deterministic consolidation
- one validation pass
- one ratification pass
- one bounded repair pass only if ratification blocks

Deeper profiles remain opt-in for users who want broader exploration or more deliberate disagreement handling.

The default experience should optimize for time-to-useful-output, not protocol maximalism.

### Deliverable-First Synthesis

Final synthesis will remain artifact-backed, but the human-readable output will be organized around the user's requested outcome rather than Conclave's internal protocol categories.

The synthesis should answer the prompt directly, then expose:

- key claims and evidence
- assumptions and constraints
- unresolved questions
- disagreements, when present
- recommended next actions

Protocol metadata remains available in structured artifacts, but the default Markdown output should feel like a deliverable, not a debug report.

### Harness-First Verification

The refactor will be verified primarily through harness tests rather than prompt-by-prompt tuning.

The new test strategy will focus on:

- empty adapter outputs
- malformed structured outputs
- disagreement propagation
- blocked ratification repair
- faster default-path execution
- prompt-agnostic behavior across varied task fixtures

Task fixtures may vary widely, but the assertions must target protocol behavior and artifact integrity, not prompt-specific formatting.

## Consequences

- The implementation becomes stricter and may surface more run failures during development. This is acceptable because hidden protocol failures are worse than explicit ones.
- The default run becomes cheaper and faster, but users seeking maximum deliberation will need to opt into deeper profiles.
- The synthesis layer becomes more useful to end users while preserving the canonical artifacts required for auditability.
- The orchestrator takes on more responsibility for normalization and consolidation, increasing harness complexity but reducing dependence on fragile adapter behavior.

## Refactor Plan

1. Reconcile documentation and implementation around phase responsibilities, especially consolidation and ratification semantics.
2. Redesign core artifact types to support the task-neutral schema without introducing prompt-type modes.
3. Replace lossy extraction and fuzzy claim matching with stable identifiers and deterministic consolidation logic.
4. Redefine depth behavior and change the CLI default to `low`.
5. Implement bounded post-ratification repair and stricter manifest/error reporting.
6. Rewrite the Markdown synthesis to be deliverable-first while preserving disagreement visibility.
7. Add harness integration tests that exercise the live protocol with controlled fake adapters.

## Non-Goals

- Adding task-specific execution modes.
- Changing the fixed 6-phase protocol.
- Expanding beyond the current adapter set as part of this refactor.
- Allowing Conclave to modify target workspaces directly.

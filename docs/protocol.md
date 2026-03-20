# Protocol

This document defines the deliberation protocol that governs every Conclave run.

This document describes the protocol semantics after [ADR 002](./adr/002-task-neutral-artifact-pipeline.md).

## Phase Definitions

### 1. Input Normalization

- **Entry condition:** CLI invocation with a valid `--task`.
- **Work:** Parse task, resolve config (CLI > project > user > defaults), detect adapters, validate inputs, generate run ID, and normalize the task into a task-neutral contract that captures the prompt, inferred deliverable intent, constraints, and available scope hints.
- **Exit condition:** Run manifest artifact is written. All required adapters are available.
- **Failure mode:** If any required adapter is unavailable, the run aborts with a diagnostic message.

### 2. Discovery

- **Entry condition:** Run manifest exists and is valid.
- **Work:** Each adapter runs independently against the task contract. Discovery produces candidate deliverables, atomic claims, evidence, assumptions, and open questions. No cross-agent information flows in this phase.
- **Exit condition:** Every successful adapter has produced at least one structured discovery artifact and a set of atomic claims. Claim ledger artifact is written.
- **Failure mode:** If an adapter fails, the orchestrator records the failure and continues with remaining adapters. A run with only one adapter's discovery output proceeds but is flagged.

### 3. Consolidation

- **Entry condition:** Claim ledger contains claims from at least one adapter.
- **Work:** The orchestrator (not an agent) deterministically merges claims, groups overlaps, normalizes evidence references, and identifies contradictions. No adapter invocations occur in this phase.
- **Exit condition:** Issue ledger artifact is written. All contradictions have been recorded, and the consolidated ledgers are ready for validation without fuzzy text matching.
- **Failure mode:** None expected -- this is deterministic orchestrator logic.

### 4. Validation

- **Entry condition:** Issue ledger exists.
- **Work:** Adapters review the consolidated claim and issue ledgers. Lanes used: issue-debate, hybrid-edit, contrarian, and any future validation lane selected by the orchestrator. Agents confirm, dispute, or refine claims against the structured ledgers rather than raw transcripts. Additional validation work is only triggered when disagreement, low confidence, or missing evidence justifies it.
- **Exit condition:** Validation findings have been applied to the structured ledgers using exact claim references. Any newly surfaced assumptions, missing constraints, or misstatements are recorded for synthesis.
- **Failure mode:** If validation output is empty or malformed, the phase is marked partial and the run proceeds with explicit error recording.

### 5. Ratification

- **Entry condition:** Agreement matrix exists. Draft synthesis has been assembled.
- **Work:** Each adapter reviews the draft synthesis and votes approve or block. Blocking requires a stated reason. If one or more blocks identify a bounded synthesis defect, the orchestrator may run one repair pass and re-run ratification once.
- **Exit condition:** Ratification record artifact is written with all votes.
- **Failure mode:** If an adapter fails to vote or returns empty/malformed ratification output, that vote is recorded as blocked.

### 6. Synthesis

- **Entry condition:** Ratification record exists.
- **Work:** Final output is assembled around the user's requested deliverable, not around protocol metadata. If all votes are approve, the output is marked as ratified. If any blocks remain after the bounded repair pass, the output includes labeled disagreements.
- **Exit condition:** Final synthesis artifact is written. Run is complete.
- **Failure mode:** None -- synthesis is orchestrator logic operating on existing artifacts.

## Lane Types

| Lane              | Expected Inputs                              | Expected Outputs                              |
|-------------------|----------------------------------------------|-----------------------------------------------|
| Independent Draft | Task contract, run manifest                  | Candidate deliverable plus structured analysis |
| Atomic Claim      | Task contract, agent's own draft             | List of atomic claims with supporting evidence |
| Issue Debate      | Specific issue from issue ledger             | Argument for/against, with evidence           |
| Hybrid Edit       | Another agent's draft, claim ledger          | Edited draft with tracked changes             |
| Contrarian        | Current consensus (agreement matrix)         | Challenges, edge cases, missed assumptions    |

## Lane Selection Policy

Lane selection is **orchestrator-decided**. The protocol determines which lane types are available in each phase. Within those constraints:

- The orchestrator selects lanes based on the current phase and depth profile.
- The orchestrator escalates work only when the current artifacts justify it.
- Agents do not choose their own lanes.
- The orchestrator may use heuristics (e.g., number of open disputes) to decide how many issue-debate lanes to run.
- In future versions, the orchestrator may accept lane suggestions from agents, but the orchestrator always has final authority.

## Adaptive Escalation

Conclave prefers a fast default path and only spends additional budget when the harness detects a reason to do so.

Common escalation triggers include:

- unresolved disagreement
- low-confidence claims
- missing evidence
- contradictory high-value claims
- blocked ratification

If none of these conditions are present, the orchestrator should advance rather than burn more rounds.

## Depth Profiles

Depth profiles control how much work the protocol does. Higher depth means more lanes, more rounds, and more thorough validation.

### Low

- **Use case:** Default profile for most tasks.
- **Discovery lanes:** 1 independent-draft per adapter.
- **Validation rounds:** 1.
- **Repair:** 1 bounded synthesis repair pass only if ratification blocks.
- **Round limit:** 2.

### Medium

- **Use case:** Deeper exploration when the default path is likely insufficient.
- **Discovery lanes:** 1 independent-draft + 1 atomic-claim per adapter.
- **Validation rounds:** Up to 2.
- **Round limit:** 4.

### High

- **Use case:** Complex refactors, architectural decisions.
- **Discovery lanes:** 1 independent-draft + 2 atomic-claim per adapter.
- **Validation rounds:** Up to 3, with contrarian lane included.
- **Round limit:** 6.

### Exhaustive

- **Use case:** High-stakes changes where thorough deliberation justifies the cost.
- **Discovery lanes:** 2 independent-draft + 2 atomic-claim per adapter.
- **Validation rounds:** Up to 5, with contrarian and hybrid-edit lanes included.
- **Round limit:** 10.

## Stagnation Detection

The orchestrator monitors the agreement matrix across validation rounds. Stagnation is detected when:

- The number of claims changing status (agreed/disputed/refined) between consecutive rounds drops below the **stagnation threshold** (default: 2).
- The same issues are being debated with no new arguments or evidence.

When stagnation is detected, the orchestrator stops running additional validation rounds and advances to ratification, regardless of remaining round budget. This prevents burning tokens on unproductive loops.

## Ratification Semantics

Each adapter casts one vote on the draft synthesis:

- **Approve** -- The agent considers the synthesis acceptable. It may note minor suggestions but does not consider them blocking.
- **Block** -- The agent considers the synthesis unacceptable and must state a specific reason. Blocks are not requests for edits -- they are statements of disagreement that will be labeled in the final output.

There are no "approve with changes" or "request changes" votes. The ratification step is deliberately binary to avoid negotiation loops. If an agent has substantive objections, it blocks.

The orchestrator may run one bounded repair pass after blocked ratification, but only to fix synthesis defects without reopening broad discovery or negotiation. After that repair pass, ratification runs once more. Any remaining block is carried through as an explicit disagreement.

## Final Outcome Policy

A deliberation produces one of two outcomes:

1. **Ratified** -- All agents approved. The final synthesis is marked as ratified and represents full consensus.
2. **Synthesis with Disagreements** -- At least one agent blocked after the bounded repair pass. The final synthesis is produced anyway, but each unresolved disagreement is labeled with:
   - Which agent raised it.
   - The specific objection.
   - The relevant claims from the agreement matrix.

Both outcomes are valid. A synthesis with disagreements is not a failure -- it is an honest representation of the state of the deliberation. The human operator uses the disagreement labels to make an informed decision.

## Disagreement Labeling Requirements

When the final synthesis includes disagreements, each one must include:

- **Source:** Which adapter raised the disagreement.
- **Scope:** Which claims or issues it relates to (by reference to the claim/issue ledgers).
- **Objection:** The specific stated reason for blocking.
- **Context:** Relevant excerpts from the validation phase that led to the disagreement.

Disagreements must not be softened, summarized away, or hidden in footnotes. They appear inline in the final synthesis at the point where the disputed content occurs.

## Deliverable-First Output

The final human-readable synthesis should answer the user's prompt directly. Protocol state is supporting context, not the primary output shape.

The default synthesis should expose:

- primary answer or recommendation
- key claims and evidence
- assumptions and constraints
- unresolved questions
- disagreements, when present
- recommended next actions

This requirement is task-neutral. It applies equally to planning prompts, analysis prompts, design prompts, and review prompts.

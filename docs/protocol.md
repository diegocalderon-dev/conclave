# Protocol

This document defines the deliberation protocol that governs every Conclave run.

## Phase Definitions

### 1. Input Normalization

- **Entry condition:** CLI invocation with a valid `--task`.
- **Work:** Parse task, resolve config (CLI > project > user > defaults), detect adapters, validate inputs, generate run ID.
- **Exit condition:** Run manifest artifact is written. All required adapters are available.
- **Failure mode:** If any required adapter is unavailable, the run aborts with a diagnostic message.

### 2. Discovery

- **Entry condition:** Run manifest exists and is valid.
- **Work:** Each adapter runs independently against the task. Lanes used: independent-draft, atomic-claim. No cross-agent information flows in this phase.
- **Exit condition:** Every adapter has produced at least one draft and a set of atomic claims. Claim ledger artifact is written.
- **Failure mode:** If an adapter fails, the orchestrator records the failure and continues with remaining adapters. A run with only one adapter's discovery output proceeds but is flagged.

### 3. Consolidation

- **Entry condition:** Claim ledger contains claims from at least one adapter.
- **Work:** The orchestrator (not an agent) merges claims, groups overlaps, and identifies contradictions. No adapter invocations occur in this phase.
- **Exit condition:** Issue ledger artifact is written. All contradictions have been recorded.
- **Failure mode:** None expected -- this is deterministic orchestrator logic.

### 4. Validation

- **Entry condition:** Issue ledger exists.
- **Work:** Adapters review the consolidated claim and issue ledgers. Lanes used: issue-debate, hybrid-edit, contrarian. Agents confirm, dispute, or refine claims. Multiple rounds may occur within the depth budget.
- **Exit condition:** Agreement matrix artifact is written. All claims have a status (agreed, disputed, or refined).
- **Failure mode:** If an adapter fails mid-validation, its pending reviews are marked as abstentions.

### 5. Ratification

- **Entry condition:** Agreement matrix exists. Draft synthesis has been assembled.
- **Work:** Each adapter reviews the draft synthesis and votes approve or block. Blocking requires a stated reason.
- **Exit condition:** Ratification record artifact is written with all votes.
- **Failure mode:** If an adapter fails to vote, it is recorded as an abstention (does not count as a block).

### 6. Synthesis

- **Entry condition:** Ratification record exists.
- **Work:** Final output is assembled. If all votes are approve, the output is marked as ratified. If any blocks exist, the output includes labeled disagreements.
- **Exit condition:** Final synthesis artifact is written. Run is complete.
- **Failure mode:** None -- synthesis is orchestrator logic operating on existing artifacts.

## Lane Types

| Lane              | Expected Inputs                              | Expected Outputs                              |
|-------------------|----------------------------------------------|-----------------------------------------------|
| Independent Draft | Task description, run manifest               | Full solution draft                           |
| Atomic Claim      | Task description, agent's own draft          | List of atomic claims with supporting evidence |
| Issue Debate      | Specific issue from issue ledger             | Argument for/against, with evidence           |
| Hybrid Edit       | Another agent's draft, claim ledger          | Edited draft with tracked changes             |
| Contrarian        | Current consensus (agreement matrix)         | Challenges, edge cases, missed assumptions    |

## Lane Selection Policy

Lane selection is **orchestrator-decided**. The protocol determines which lane types are available in each phase. Within those constraints:

- The orchestrator selects lanes based on the current phase and depth profile.
- Agents do not choose their own lanes.
- The orchestrator may use heuristics (e.g., number of open disputes) to decide how many issue-debate lanes to run.
- In future versions, the orchestrator may accept lane suggestions from agents, but the orchestrator always has final authority.

## Depth Profiles

Depth profiles control how much work the protocol does. Higher depth means more lanes, more rounds, and more thorough validation.

### Low

- **Use case:** Quick sanity check, simple tasks.
- **Discovery lanes:** 1 independent-draft per adapter.
- **Validation rounds:** 1.
- **Max total lanes:** 6.
- **Round limit:** 3.

### Medium

- **Use case:** Standard development tasks.
- **Discovery lanes:** 1 independent-draft + 1 atomic-claim per adapter.
- **Validation rounds:** Up to 2.
- **Max total lanes:** 14.
- **Round limit:** 6.

### High

- **Use case:** Complex refactors, architectural decisions.
- **Discovery lanes:** 1 independent-draft + 2 atomic-claim per adapter.
- **Validation rounds:** Up to 3, with contrarian lane included.
- **Max total lanes:** 24.
- **Round limit:** 10.

### Exhaustive

- **Use case:** High-stakes changes where thorough deliberation justifies the cost.
- **Discovery lanes:** 2 independent-draft + 2 atomic-claim per adapter.
- **Validation rounds:** Up to 5, with contrarian and hybrid-edit lanes included.
- **Max total lanes:** 40.
- **Round limit:** 20.

## Stagnation Detection

The orchestrator monitors the agreement matrix across validation rounds. Stagnation is detected when:

- The number of claims changing status (agreed/disputed/refined) between consecutive rounds drops below the **stagnation threshold** (default: 2).
- The same issues are being debated with no new arguments or evidence.

When stagnation is detected, the orchestrator stops running additional validation rounds and advances to ratification, regardless of remaining round budget. This prevents burning tokens on unproductive loops.

## Ratification Semantics

Each adapter casts one vote on the draft synthesis:

- **Approve** -- The agent considers the synthesis acceptable. It may note minor suggestions but does not consider them blocking.
- **Block** -- The agent considers the synthesis unacceptable and must state a specific reason. Blocks are not requests for edits -- they are statements of disagreement that will be labeled in the final output.

There are no "approve with changes" or "request changes" votes. The ratification step is deliberately binary to avoid negotiation loops. If an agent has substantive objections, it blocks. The final synthesis then includes those objections as labeled disagreements.

## Final Outcome Policy

A deliberation produces one of two outcomes:

1. **Ratified** -- All agents approved. The final synthesis is marked as ratified and represents full consensus.
2. **Synthesis with Disagreements** -- At least one agent blocked. The final synthesis is produced anyway, but each unresolved disagreement is labeled with:
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

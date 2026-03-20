/** Orchestration engine — runs the full deliberation protocol */

import type {
  Adapter,
  AdapterResponse,
  Claim,
  CandidateDeliverable,
  Issue,
  AgreementEntry,
  DraftSynthesis,
  FinalSynthesis,
  RatificationVote,
  RunManifest,
  Phase,
  PhaseRecord,
  LaneType,
  ConclaveConfig,
  UnresolvedDisagreement,
  NormalizedTaskContract,
  AgreementStatus,
} from "../core/types.js";
import { PHASES, DEPTH_POLICIES } from "../core/types.js";
import { generateRunId, generateClaimId, generateIssueId } from "../core/ids.js";
import { ArtifactStore } from "../artifacts/store.js";
import {
  selectLanes,
  getLanePrompt,
  validationPrompt,
  ratificationPrompt,
} from "../protocol/index.js";
import {
  takeSnapshot,
  detectStagnation,
  type RoundSnapshot,
} from "../protocol/stagnation.js";

export interface RunInput {
  task: string;
  target?: string;
  config: ConclaveConfig;
  adapters: Adapter[];
  dryRun?: boolean;
}

export interface RunResult {
  runId: string;
  artifactDir: string;
  finalSynthesis: FinalSynthesis | null;
  manifest: RunManifest;
  errors: string[];
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

function inferRequestedDeliverable(task: string): string {
  const firstNonEmptyLine = task
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstNonEmptyLine) {
    return "response";
  }

  return firstNonEmptyLine.replace(/[:\s]+$/, "").slice(0, 120) || "response";
}

function extractScopeHints(task: string, target?: string): string[] {
  const hints = new Set<string>();

  if (target) {
    hints.add(target);
  }

  const urlMatches = task.match(/https?:\/\/\S+/g) || [];
  for (const url of urlMatches) {
    hints.add(url);
  }

  return [...hints];
}

function extractConstraints(task: string): string[] {
  const constraints = new Set<string>();
  const lines = task
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let collectingBlock = false;

  for (const line of lines) {
    if (/^(constraints?|requirements?|guardrails?|rules?)\s*:/i.test(line)) {
      const [, rest = ""] = line.split(/:\s*/, 2);
      if (rest.trim()) {
        constraints.add(rest.trim());
      }
      collectingBlock = true;
      continue;
    }

    if (collectingBlock) {
      if (/^(?:[-*]\s+|\d+\.\s+)/.test(line)) {
        constraints.add(line.replace(/^(?:[-*]\s+|\d+\.\s+)/, "").trim());
        continue;
      }
      collectingBlock = false;
    }

    if (/^(?:do not|don't|must not|must|should not|avoid|only)\b/i.test(line)) {
      constraints.add(line);
    }
  }

  return [...constraints];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dedupeCandidateDeliverables(
  deliverables: CandidateDeliverable[]
): CandidateDeliverable[] {
  const byKey = new Map<string, CandidateDeliverable>();

  for (const deliverable of deliverables) {
    const key = normalizeClaimText(deliverable.summary);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, deliverable);
  }

  return [...byKey.values()];
}

function buildRecommendedNextActions(
  taskContract: NormalizedTaskContract,
  draft: DraftSynthesis,
  issues: Issue[],
  ratified: boolean
): string[] {
  const actions = [...draft.recommendedNextActions];
  const openIssues = issues.filter((issue) => issue.state !== "resolved");

  if (draft.agreedPoints.length > 0 || draft.acceptedHybrids.length > 0) {
    actions.push(
      `Use the supported points as the working basis for: ${taskContract.requestedDeliverable}.`
    );
  }

  if (openIssues.length > 0) {
    actions.push("Resolve the remaining open questions before treating the deliverable as complete.");
  }

  if (draft.unresolvedDisagreements.length > 0) {
    actions.push("Review the labeled disagreements and either gather more evidence or choose the tradeoff explicitly.");
  }

  if (!ratified) {
    actions.push("Treat this output as a working draft until the remaining ratification objections are addressed.");
  }

  if (actions.length === 0) {
    actions.push("Use this deliverable as the current baseline.");
  }

  return uniqueStrings(actions);
}

function normalizeTaskContract(
  task: string,
  target?: string
): NormalizedTaskContract {
  return {
    prompt: task.trim(),
    requestedDeliverable: inferRequestedDeliverable(task),
    scopeHints: extractScopeHints(task, target),
    constraints: extractConstraints(task),
    targetContext: target,
  };
}

function extractListClaims(content: string): string[] {
  const lines = content.split("\n");
  const items: string[] = [];
  const marker = /^\s*(?:[-*]\s+|\d+\.\s+)/;
  let current: string[] = [];

  for (const line of lines) {
    if (marker.test(line)) {
      if (current.length > 0) {
        items.push(current.join("\n").trim());
      }
      current = [line.replace(marker, "").trim()];
      continue;
    }

    if (current.length > 0) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      current.push(trimmed);
    }
  }

  if (current.length > 0) {
    items.push(current.join("\n").trim());
  }

  return items.filter(Boolean);
}

function normalizeClaimText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeDraft(task: string, draft: DraftSynthesis): string {
  const supportedPoints = [...draft.agreedPoints, ...draft.acceptedHybrids].filter(Boolean);
  if (supportedPoints.length > 0) {
    const lead = supportedPoints.slice(0, 2).join(" ");
    const more =
      supportedPoints.length > 2
        ? ` (+${supportedPoints.length - 2} more supported points.)`
        : "";
    const disagreementNote =
      draft.unresolvedDisagreements.length > 0
        ? ` Outstanding disagreement: ${draft.unresolvedDisagreements[0].title}.`
        : "";
    return `${lead}${more}${disagreementNote}`.trim();
  }

  if (draft.unresolvedDisagreements.length > 0) {
    return `No fully supported final answer was established. Primary open disagreement: ${draft.unresolvedDisagreements[0].title}.`;
  }

  return `No supported final answer was established yet for: ${task}`;
}

function buildAgreementMatrix(claims: Claim[]): AgreementEntry[] {
  const groups = new Map<string, Claim[]>();

  for (const claim of claims) {
    const fingerprint = normalizeClaimText(claim.text) || claim.id;
    const existing = groups.get(fingerprint);
    if (existing) {
      existing.push(claim);
    } else {
      groups.set(fingerprint, [claim]);
    }
  }

  const matrix: AgreementEntry[] = [];

  for (const group of groups.values()) {
    const representative = group[0];
    const positions: Record<string, string> = {};
    const distinctSources = new Set<string>();

    for (const claim of group) {
      distinctSources.add(claim.source);
      if (!(claim.source in positions)) {
        positions[claim.source] = claim.text;
      }
    }

    let status: AgreementStatus = "disputed";
    if (group.some((claim) => claim.status === "rejected" || claim.status === "withdrawn")) {
      status = group.every(
        (claim) => claim.status === "rejected" || claim.status === "withdrawn"
      )
        ? "dropped"
        : "disputed";
    } else if (
      group.some((claim) => claim.status === "accepted") ||
      distinctSources.size > 1
    ) {
      status = "agreed";
    }

    matrix.push({
      claimId: representative.id,
      claimIds: group.map((claim) => claim.id),
      status,
      positions,
    });
  }

  return matrix;
}

function applyBoundedSynthesisRepair(
  task: string,
  draft: DraftSynthesis,
  votes: RatificationVote[]
): DraftSynthesis {
  const repaired: DraftSynthesis = {
    ...draft,
    unresolvedDisagreements: [...draft.unresolvedDisagreements],
  };
  const seenIssueIds = new Set(
    repaired.unresolvedDisagreements.map((disagreement) => disagreement.issueId)
  );

  for (const vote of votes) {
    if (vote.outcome !== "blocked") continue;

    const issueId = `ratification-${vote.adapterId}`;
    if (seenIssueIds.has(issueId)) continue;

    const objectionSummary =
      vote.objections?.filter(Boolean).join(" | ") ||
      "Blocked during ratification.";
    const requestedEditSummary =
      vote.requestedEdits?.filter(Boolean).join(" ") ||
      "Ratification block requires explicit disagreement labeling.";

    repaired.unresolvedDisagreements.push({
      issueId,
      title: `Ratification objection from ${vote.adapterId}`,
      positions: { [vote.adapterId]: objectionSummary },
      reason: requestedEditSummary,
    });
    seenIssueIds.add(issueId);
  }

  repaired.summary = summarizeDraft(task, repaired);
  return repaired;
}

function parseRatificationVote(
  adapterId: string,
  content: string,
  errors: string[],
  context: string
): RatificationVote {
  if (!content.trim()) {
    const message = `${context} ${adapterId}: empty response`;
    errors.push(message);
    return {
      adapterId,
      outcome: "blocked",
      objections: ["Empty ratification response."],
      requestedEdits: ["Return a valid ratification JSON payload."],
    };
  }

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON object found in ratification response");
    }

    const vote = JSON.parse(jsonMatch[0]) as {
      outcome?: string;
      objections?: string[];
      requestedEdits?: string[];
    };

    if (vote.outcome !== "approved" && vote.outcome !== "blocked") {
      throw new Error("Ratification response missing a valid outcome");
    }

    return {
      adapterId,
      outcome: vote.outcome,
      objections: vote.objections,
      requestedEdits: vote.requestedEdits,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`${context} ${adapterId}: ${message}`);
    return {
      adapterId,
      outcome: "blocked",
      objections: [`Malformed ratification response: ${message}`],
      requestedEdits: ["Return a valid ratification JSON payload."],
    };
  }
}

export async function executeRun(input: RunInput): Promise<RunResult> {
  const { task, target, config, adapters, dryRun } = input;
  const runId = generateRunId();
  const depthPolicy = DEPTH_POLICIES[config.depth];
  const errors: string[] = [];
  const taskContract = normalizeTaskContract(task, target);

  const store = new ArtifactStore(
    config.artifactRoot,
    target || "default",
    runId
  );

  log(`Run ${runId} started — depth=${config.depth}, adapters=${adapters.map((a) => a.id).join(",")}`);

  // Initialize manifest
  const manifest: RunManifest = {
    runId,
    task,
    target,
    taskContract,
    depth: config.depth,
    autonomy: config.autonomy,
    transcriptRetention: config.transcriptRetention,
    adapters: adapters.map((a) => a.id),
    activeLanes: [],
    startedAt: new Date().toISOString(),
    artifactRoot: config.artifactRoot,
    phases: [],
  };

  store.savePrompt(task, target);

  // State
  let claims: Claim[] = [];
  let candidateDeliverables: CandidateDeliverable[] = [];
  let assumptions: string[] = [];
  let issues: Issue[] = [];
  let agreementMatrix: AgreementEntry[] = [];
  let draftSynthesis: DraftSynthesis | null = null;
  let finalSynthesis: FinalSynthesis | null = null;
  const snapshots: RoundSnapshot[] = [];

  // --- Phase helpers ---
  function startPhase(phase: Phase): PhaseRecord {
    const rec: PhaseRecord = {
      phase,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    manifest.phases.push(rec);
    log(`Phase: ${phase}`);
    return rec;
  }

  function completePhase(
    rec: PhaseRecord,
    summary?: string,
    status: PhaseRecord["status"] = "completed"
  ): void {
    rec.completedAt = new Date().toISOString();
    rec.status = status;
    rec.summary = summary;
  }

  // --- Parse adapter response into claims/issues ---
  function parseDiscoveryResponse(
    adapterId: string,
    response: AdapterResponse,
    round: number
  ): {
    candidateDeliverables: CandidateDeliverable[];
    assumptions: string[];
    claims: Claim[];
    issues: Issue[];
  } {
    const newCandidateDeliverables: CandidateDeliverable[] = [];
    const newAssumptions: string[] = [];
    const newClaims: Claim[] = [];
    const newIssues: Issue[] = [];

    let parsed: Record<string, unknown> | null = null;
    try {
      // Try to extract JSON from the response
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Can't parse — create a single claim from the raw content
    }

    if (parsed) {
      // Extract claims from structured response
      const rawClaims = (parsed.claims || []) as Array<{
        text?: string;
        evidence?: string[];
      }>;
      for (let i = 0; i < rawClaims.length; i++) {
        if (rawClaims[i].text) {
          newClaims.push({
            id: generateClaimId(round, claims.length + i),
            text: rawClaims[i].text!,
            status: "proposed",
            source: adapterId,
            round,
            evidence: rawClaims[i].evidence,
          });
        }
      }

      // Extract open questions as issues
      const openQuestions = (parsed.openQuestions || []) as string[];
      for (let i = 0; i < openQuestions.length; i++) {
        newIssues.push({
          id: generateIssueId(round, issues.length + i),
          title: openQuestions[i],
          description: openQuestions[i],
          state: "open",
          raisedBy: adapterId,
          round,
          transitions: [],
        });
      }

      const rawCandidateDeliverables = Array.isArray(parsed.candidateDeliverables)
        ? (parsed.candidateDeliverables as unknown[])
        : [];
      for (let i = 0; i < rawCandidateDeliverables.length; i++) {
        const item = rawCandidateDeliverables[i];
        const summary =
          typeof item === "string"
            ? item
            : typeof item === "object" &&
                item !== null &&
                "summary" in item &&
                typeof item.summary === "string"
              ? item.summary
              : "";
        if (!summary.trim()) continue;
        newCandidateDeliverables.push({
          id: `deliverable-r${round}-${adapterId}-${i}`,
          summary: summary.trim(),
          source: adapterId,
          round,
          confidence:
            parsed.confidence === "low" ||
            parsed.confidence === "medium" ||
            parsed.confidence === "high"
              ? parsed.confidence
              : undefined,
        });
      }

      if (Array.isArray(parsed.assumptions)) {
        newAssumptions.push(...(parsed.assumptions as string[]));
      }

      // If there's a proposal but no claims, make it a claim
      if (newClaims.length === 0 && typeof parsed.proposal === "string") {
        newClaims.push({
          id: generateClaimId(round, claims.length),
          text: parsed.proposal,
          status: "proposed",
          source: adapterId,
          round,
        });
      }

      if (
        newCandidateDeliverables.length === 0 &&
        typeof parsed.proposal === "string" &&
        parsed.proposal.trim()
      ) {
        newCandidateDeliverables.push({
          id: `deliverable-r${round}-${adapterId}-proposal`,
          summary: parsed.proposal.trim(),
          source: adapterId,
          round,
          confidence:
            parsed.confidence === "low" ||
            parsed.confidence === "medium" ||
            parsed.confidence === "high"
              ? parsed.confidence
              : undefined,
        });
      }
    } else if (response.content.trim()) {
      const extractedClaims = extractListClaims(response.content);
      if (extractedClaims.length > 0) {
        for (let i = 0; i < extractedClaims.length; i++) {
          newClaims.push({
            id: generateClaimId(round, claims.length + i),
            text: extractedClaims[i].slice(0, 500),
            status: "proposed",
            source: adapterId,
            round,
          });
        }
      } else {
        // Fallback: entire response as one claim
        newClaims.push({
          id: generateClaimId(round, claims.length),
          text: response.content.trim().slice(0, 500),
          status: "proposed",
          source: adapterId,
          round,
        });
      }

      const firstLine = response.content
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);
      if (firstLine) {
        newCandidateDeliverables.push({
          id: `deliverable-r${round}-${adapterId}-fallback`,
          summary: firstLine.slice(0, 240),
          source: adapterId,
          round,
        });
      }
    }

    return {
      candidateDeliverables: dedupeCandidateDeliverables(newCandidateDeliverables),
      assumptions: uniqueStrings(newAssumptions),
      claims: newClaims,
      issues: newIssues,
    };
  }

  function parseNegotiationResponse(
    adapterId: string,
    response: AdapterResponse,
    round: number
  ): void {
    try {
      const content = response.content;
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const decisions = JSON.parse(jsonMatch[0]) as Array<{
        claimId?: string;
        action: string;
        reason?: string;
        modifiedText?: string;
        text?: string;
        evidence?: string[];
      }>;

      for (const d of decisions) {
        if (d.action === "propose" && d.text) {
          claims.push({
            id: generateClaimId(round, claims.length),
            text: d.text,
            status: "proposed",
            source: adapterId,
            round,
            evidence: d.evidence,
          });
        } else if (d.claimId) {
          const claim = claims.find((c) => c.id === d.claimId);
          if (!claim) continue;

          switch (d.action) {
            case "accept":
              claim.status = "accepted";
              break;
            case "reject":
              claim.status = "rejected";
              break;
            case "modify":
              claim.status = "modified";
              if (d.modifiedText) {
                claims.push({
                  id: generateClaimId(round, claims.length),
                  text: d.modifiedText,
                  status: "proposed",
                  source: adapterId,
                  round,
                  modifiedFrom: claim.id,
                });
              }
              break;
            case "merge":
              claim.status = "merged";
              break;
          }
        }
      }
    } catch {
      // Parse failure — skip
    }
  }

  // --- Dry run mode ---
  if (dryRun) {
    log("Dry run — skipping adapter invocations.");
    const phaseRec = startPhase("input-normalization");
    completePhase(phaseRec, "Dry run — input normalized.");

    // Simulate a basic run
    const laneSelection = selectLanes({
      task,
      depth: config.depth,
      laneConfig: config.lanes,
      existingClaims: [],
      existingIssues: [],
      round: 1,
    });
    manifest.activeLanes = laneSelection.activeLanes;
    store.saveLaneSelection(laneSelection.rationale, laneSelection.activeLanes);

    // Synthetic claims for dry run
    claims = [
      {
        id: "claim-r1-0",
        text: "Dry run synthetic claim A",
        status: "proposed",
        source: "dry-run",
        round: 1,
      },
      {
        id: "claim-r1-1",
        text: "Dry run synthetic claim B",
        status: "proposed",
        source: "dry-run",
        round: 1,
      },
    ];
    issues = [
      {
        id: "issue-r1-0",
        title: "Dry run open question",
        description: "This is a synthetic issue for dry run validation.",
        state: "open",
        raisedBy: "dry-run",
        round: 1,
        transitions: [],
      },
    ];
    candidateDeliverables = [
      {
        id: "deliverable-r1-dry-run-0",
        summary: "Dry run candidate deliverable for the requested task",
        source: "dry-run",
        round: 1,
        confidence: "low",
      },
    ];
    assumptions = [
      "Dry run assumes the protocol wiring is the subject under inspection.",
    ];

    // Mark remaining phases
    for (const phase of PHASES.slice(1)) {
      const rec = startPhase(phase);
      completePhase(rec, `Dry run — ${phase} simulated.`);
    }

    // Build synthetic synthesis
    draftSynthesis = {
      version: 1,
      candidateDeliverables,
      agreedPoints: ["Dry run agreed point"],
      supportedClaimIds: ["claim-r1-0"],
      acceptedHybrids: [],
      assumptions,
      unresolvedDisagreements: [
        {
          issueId: "issue-r1-0",
          title: "Dry run open question",
          positions: { "dry-run": "This is a synthetic position" },
          reason: "Dry run — no real deliberation occurred.",
        },
      ],
      conditionalAgreements: [],
      recommendedNextActions: [
        "Run a non-dry execution to generate a real deliverable.",
      ],
      summary: "Dry run synthesis — no real adapter invocations.",
    };

    finalSynthesis = {
      ratified: false,
      ratificationVotes: [],
      synthesis: draftSynthesis,
      producedAt: new Date().toISOString(),
    };

    // Persist all artifacts
    store.saveClaimLedger(claims);
    store.saveIssueLedger(issues);
    agreementMatrix = [
      {
        claimId: "claim-r1-0",
        claimIds: ["claim-r1-0"],
        status: "agreed",
        positions: { "dry-run": "Accepted" },
      },
      {
        claimId: "claim-r1-1",
        claimIds: ["claim-r1-1"],
        status: "disputed",
        positions: { "dry-run": "Needs discussion" },
      },
    ];
    store.saveAgreementMatrix(agreementMatrix);
    store.saveDraftSynthesis(draftSynthesis);
    store.saveRatificationRecord([]);
    store.saveFinalSynthesis(finalSynthesis);

    manifest.completedAt = new Date().toISOString();
    store.saveManifest(manifest);
    store.saveReadme(manifest);
    store.saveSynthesisMarkdown(manifest, finalSynthesis, claims, issues, []);

    log(`Dry run complete. Artifacts: ${store.getRunDir()}`);

    return {
      runId,
      artifactDir: store.getRunDir(),
      finalSynthesis,
      manifest,
      errors,
    };
  }

  // ===== LIVE RUN =====

  // Phase 1: Input Normalization
  const p1 = startPhase("input-normalization");
  const laneSelection = selectLanes({
    task,
    depth: config.depth,
    laneConfig: config.lanes,
    existingClaims: [],
    existingIssues: [],
    round: 1,
  });
  manifest.activeLanes = laneSelection.activeLanes;
  store.saveLaneSelection(laneSelection.rationale, laneSelection.activeLanes);
  completePhase(p1, `Lanes: ${laneSelection.activeLanes.join(", ")}`);

  // Phase 2: Discovery
  const p2 = startPhase("discovery");
  let round = 1;
  let discoveryHadErrors = false;

  for (round = 1; round <= depthPolicy.maxRounds; round++) {
    log(`Discovery round ${round}/${depthPolicy.maxRounds}`);

    // Select lanes for this round
    const roundLanes = selectLanes({
      task,
      depth: config.depth,
      laneConfig: config.lanes,
      existingClaims: claims,
      existingIssues: issues,
      round,
    });

    // Execute lanes across adapters
    for (const lane of roundLanes.activeLanes) {
      const consensusSummary = claims
        .filter((c) => c.status === "accepted")
        .map((c) => c.text)
        .join("; ");

      // Run each adapter in parallel
      const adapterResults = await Promise.all(
        adapters.map(async (adapter) => {
          const lanePrompt = getLanePrompt(lane, task, {
            target,
            claims,
            issues,
            adapterId: adapter.id,
            currentDraft: draftSynthesis ? draftSynthesis.summary : undefined,
            currentConsensus: claims
              .filter((c) => c.status === "accepted")
              .map((c) => c.text)
              .join("; "),
          });

          try {
            log(`  ${adapter.id} → ${lane}`);
            const response = await adapter.invoke(lanePrompt, {
              timeout: 120_000,
            });

            if (config.transcriptRetention !== "none") {
              store.saveTranscript(
                `discovery-r${round}-${lane}`,
                adapter.id,
                response.content
              );
            }

            return { adapter, response, lane };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${adapter.id}/${lane} round ${round}: ${msg}`);
            log(`  ${adapter.id} error: ${msg}`);
            return null;
          }
        })
      );

      // Process results
      for (const result of adapterResults) {
        if (!result) {
          discoveryHadErrors = true;
          continue;
        }

        if (result.response.error) {
          errors.push(
            `${result.adapter.id}/${result.lane} round ${round}: ${result.response.error}`
          );
          discoveryHadErrors = true;
          continue;
        }

        if (!result.response.content.trim()) {
          errors.push(
            `${result.adapter.id}/${result.lane} round ${round}: empty response`
          );
          discoveryHadErrors = true;
          continue;
        }

        if (lane === "independent-draft") {
          const parsed = parseDiscoveryResponse(
            result.adapter.id,
            result.response,
            round
          );
          if (parsed.claims.length === 0 && parsed.issues.length === 0) {
            errors.push(
              `${result.adapter.id}/${lane} round ${round}: no structured discovery artifact produced`
            );
            discoveryHadErrors = true;
          }
          candidateDeliverables = dedupeCandidateDeliverables([
            ...candidateDeliverables,
            ...parsed.candidateDeliverables,
          ]);
          assumptions = uniqueStrings([
            ...assumptions,
            ...parsed.assumptions,
          ]);
          claims.push(...parsed.claims);
          issues.push(...parsed.issues);
        } else if (lane === "atomic-claim") {
          parseNegotiationResponse(
            result.adapter.id,
            result.response,
            round
          );
        }
        // Other lanes: parse similarly but simplified for v1
      }
    }

    // Snapshot and check stagnation
    snapshots.push(takeSnapshot(round, claims, issues));
    const stagnation = detectStagnation(
      snapshots,
      depthPolicy.stagnationLimit
    );
    if (stagnation.stagnant) {
      log(`Stagnation detected: ${stagnation.reason}`);
      break;
    }

    // Save intermediate state
    store.saveClaimLedger(claims);
    store.saveIssueLedger(issues);
  }

  completePhase(
    p2,
    `${round} rounds, ${claims.length} claims, ${issues.length} issues`,
    claims.length === 0 ? "failed" : discoveryHadErrors ? "partial" : "completed"
  );

  // Phase 3: Consolidation
  const p3 = startPhase("consolidation");
  agreementMatrix = buildAgreementMatrix(claims);

  store.saveAgreementMatrix(agreementMatrix);
  completePhase(
    p3,
    `${agreementMatrix.length} entries in agreement matrix`,
    claims.length === 0 ? "failed" : "completed"
  );

  // Phase 4: Validation
  const p4 = startPhase("validation");
  const validator = adapters[adapters.length > 1 ? 1 : 0]; // Use different adapter if available
  let validationStatus: PhaseRecord["status"] = "completed";
  const validationRecommendedNextActions: string[] = [];
  try {
    const validateResp = await validator.invoke(
      validationPrompt(task, agreementMatrix, claims),
      { timeout: 120_000 }
    );

    if (config.transcriptRetention !== "none") {
      store.saveTranscript("validation", validator.id, validateResp.content);
    }

    if (validateResp.error) {
      errors.push(`Validation ${validator.id}: ${validateResp.error}`);
      validationStatus = "partial";
    } else if (!validateResp.content.trim()) {
      errors.push(`Validation ${validator.id}: empty response`);
      validationStatus = "partial";
    }

    // Apply validation findings — prune weak claims
    try {
      const content = validateResp.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const findings = JSON.parse(jsonMatch[0]) as {
          unsupportedClaimIds?: string[];
          unsupportedClaims?: string[];
          missingConstraints?: string[];
          hiddenAssumptions?: string[];
          misstatements?: Array<{ claimId?: string; reason?: string }> | string[];
          recommendations?: string[];
          recommendedNextActions?: string[];
        };

        // Mark unsupported claims
        if (Array.isArray(findings.unsupportedClaimIds)) {
          for (const claimId of findings.unsupportedClaimIds) {
            const weakClaim = claims.find((c) => c.id === claimId);
            if (weakClaim) {
              weakClaim.status = "withdrawn";
            }
          }
        }
        if (Array.isArray(findings.unsupportedClaims) && findings.unsupportedClaims.length > 0) {
          errors.push(
            `Validation ${validator.id}: legacy unsupportedClaims field ignored; claim ids are required`
          );
          validationStatus = "partial";
        }
        if (Array.isArray(findings.hiddenAssumptions)) {
          assumptions = uniqueStrings([...assumptions, ...findings.hiddenAssumptions]);
        }
        if (Array.isArray(findings.missingConstraints)) {
          for (const missingConstraint of findings.missingConstraints) {
            issues.push({
              id: generateIssueId(round + 1, issues.length),
              title: `Missing constraint: ${missingConstraint}`,
              description: missingConstraint,
              state: "open",
              raisedBy: validator.id,
              round: round + 1,
              transitions: [],
            });
          }
        }
        if (Array.isArray(findings.misstatements)) {
          for (const item of findings.misstatements) {
            if (typeof item === "string") {
              issues.push({
                id: generateIssueId(round + 1, issues.length),
                title: "Validation misstatement",
                description: item,
                state: "open",
                raisedBy: validator.id,
                round: round + 1,
                transitions: [],
              });
              continue;
            }

            if (!item || typeof item !== "object") continue;
            const claimId = typeof item.claimId === "string" ? item.claimId : undefined;
            const reason =
              typeof item.reason === "string"
                ? item.reason
                : "Agreement may be overstated.";
            issues.push({
              id: generateIssueId(round + 1, issues.length),
              title: claimId ? `Misstatement on ${claimId}` : "Validation misstatement",
              description: reason,
              state: "open",
              raisedBy: validator.id,
              round: round + 1,
              transitions: [],
              relatedClaims: claimId ? [claimId] : undefined,
            });
          }
        }
        validationRecommendedNextActions.push(
          ...uniqueStrings([
            ...(Array.isArray(findings.recommendations) ? findings.recommendations : []),
            ...(Array.isArray(findings.recommendedNextActions)
              ? findings.recommendedNextActions
              : []),
          ])
        );
      } else if (validateResp.content.trim()) {
        errors.push(`Validation ${validator.id}: no JSON object found in response`);
        validationStatus = "partial";
      }
    } catch {
      errors.push(`Validation ${validator.id}: malformed JSON response`);
      validationStatus = "partial";
    }
  } catch (err) {
    errors.push(`Validation: ${err instanceof Error ? err.message : String(err)}`);
    validationStatus = "partial";
  }

  store.saveClaimLedger(claims);
  store.saveIssueLedger(issues);
  completePhase(p4, "Validation complete", validationStatus);

  // Phase 5: Ratification
  const p5 = startPhase("ratification");

  // Build draft synthesis from current state
  const agreed = agreementMatrix.filter((e) => e.status === "agreed");
  const disputed = agreementMatrix.filter((e) => e.status === "disputed");
  const hybrids = agreementMatrix.filter(
    (e) => e.status === "hybrid_proposed"
  );

  const unresolvedDisagreements: UnresolvedDisagreement[] = [];
  for (const d of disputed) {
    const relatedIssue = issues.find((i) =>
      i.relatedClaims?.includes(d.claimId)
    );
    unresolvedDisagreements.push({
      issueId: relatedIssue?.id || d.claimId,
      title: claims.find((c) => c.id === d.claimId)?.text || d.claimId,
      positions: d.positions,
      reason: "Not resolved during deliberation.",
    });
  }

  draftSynthesis = {
    version: 1,
    candidateDeliverables: dedupeCandidateDeliverables(candidateDeliverables),
    agreedPoints: agreed.map(
      (e) => claims.find((c) => c.id === e.claimId)?.text || e.claimId
    ),
    supportedClaimIds: uniqueStrings(agreed.flatMap((entry) => entry.claimIds)),
    acceptedHybrids: hybrids.map(
      (e) => e.hybridProposal || claims.find((c) => c.id === e.claimId)?.text || ""
    ),
    assumptions: uniqueStrings(assumptions),
    unresolvedDisagreements,
    conditionalAgreements: [],
    recommendedNextActions: uniqueStrings(validationRecommendedNextActions),
    summary: "",
  };
  draftSynthesis.summary = summarizeDraft(task, draftSynthesis);
  draftSynthesis.recommendedNextActions = buildRecommendedNextActions(
    taskContract,
    draftSynthesis,
    issues,
    false
  );

  store.saveDraftSynthesis(draftSynthesis);

  // Get ratification votes from each adapter
  const votes: RatificationVote[] = [];
  for (const adapter of adapters) {
    try {
      const ratResp = await adapter.invoke(
        ratificationPrompt(adapter.id, draftSynthesis),
        { timeout: 120_000 }
      );

      if (config.transcriptRetention !== "none") {
        store.saveTranscript("ratification", adapter.id, ratResp.content);
      }
      votes.push(
        parseRatificationVote(adapter.id, ratResp.content, errors, "Ratification")
      );
    } catch (err) {
      errors.push(`Ratification ${adapter.id}: ${err instanceof Error ? err.message : String(err)}`);
      votes.push({
        adapterId: adapter.id,
        outcome: "blocked",
        objections: ["Adapter invocation failed"],
      });
    }
  }

  store.saveRatificationRecord(votes);
  let repairedVotes = votes;
  let repairedDraft = draftSynthesis;
  const hasBlockedVote = votes.some((vote) => vote.outcome === "blocked");

  if (hasBlockedVote) {
    repairedDraft = applyBoundedSynthesisRepair(task, draftSynthesis, votes);
    store.saveDraftSynthesis(repairedDraft);

    const reratifiedVotes: RatificationVote[] = [];
    for (const adapter of adapters) {
      try {
        const ratResp = await adapter.invoke(
          ratificationPrompt(adapter.id, repairedDraft),
          { timeout: 120_000 }
        );

        if (config.transcriptRetention !== "none") {
          store.saveTranscript("ratification-repair", adapter.id, ratResp.content);
        }
        reratifiedVotes.push(
          parseRatificationVote(
            adapter.id,
            ratResp.content,
            errors,
            "Ratification repair"
          )
        );
      } catch (err) {
        errors.push(
          `Ratification repair ${adapter.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        reratifiedVotes.push({
          adapterId: adapter.id,
          outcome: "blocked",
          objections: ["Adapter invocation failed during repair pass"],
        });
      }
    }

    repairedVotes = reratifiedVotes;
    store.saveRatificationRecord(repairedVotes);
  }

  draftSynthesis = repairedDraft;
  const allApproved = repairedVotes.every((v) => v.outcome === "approved");
  if (allApproved) {
    draftSynthesis = {
      ...draftSynthesis,
      unresolvedDisagreements: draftSynthesis.unresolvedDisagreements.filter(
        (disagreement) => !disagreement.issueId.startsWith("ratification-")
      ),
    };
  }
  draftSynthesis.summary = summarizeDraft(task, draftSynthesis);
  draftSynthesis.recommendedNextActions = buildRecommendedNextActions(
    taskContract,
    draftSynthesis,
    issues,
    allApproved
  );
  store.saveDraftSynthesis(draftSynthesis);
  completePhase(
    p5,
    `${allApproved ? "Ratified" : "Not fully ratified"} — ${repairedVotes.length} votes`,
    allApproved ? "completed" : "partial"
  );

  // Phase 6: Final Synthesis
  const p6 = startPhase("synthesis");

  finalSynthesis = {
    ratified: allApproved,
    ratificationVotes: repairedVotes,
    synthesis: draftSynthesis,
    producedAt: new Date().toISOString(),
  };

  completePhase(
    p6,
    allApproved
      ? "Ratified synthesis produced."
      : "Synthesis with unresolved disagreements produced."
  );
  store.saveFinalSynthesis(finalSynthesis);
  manifest.completedAt = new Date().toISOString();
  store.saveManifest(manifest);
  store.saveReadme(manifest);
  store.saveSynthesisMarkdown(
    manifest,
    finalSynthesis,
    claims,
    issues,
    repairedVotes
  );

  log(`Run complete. Artifacts: ${store.getRunDir()}`);

  return {
    runId,
    artifactDir: store.getRunDir(),
    finalSynthesis,
    manifest,
    errors,
  };
}

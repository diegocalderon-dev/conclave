/** Orchestration engine — runs the full deliberation protocol */

import type {
  Adapter,
  AdapterResponse,
  Claim,
  Issue,
  AgreementEntry,
  DraftSynthesis,
  FinalSynthesis,
  RatificationVote,
  RunManifest,
  Phase,
  PhaseRecord,
  LaneType,
  LaneOutput,
  ConclaveConfig,
  DepthPolicy,
  UnresolvedDisagreement,
} from "../core/types.js";
import { PHASES, DEPTH_POLICIES } from "../core/types.js";
import { generateRunId, generateClaimId, generateIssueId } from "../core/ids.js";
import { ArtifactStore } from "../artifacts/store.js";
import {
  selectLanes,
  getLanePrompt,
  consolidationPrompt,
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

export async function executeRun(input: RunInput): Promise<RunResult> {
  const { task, target, config, adapters, dryRun } = input;
  const runId = generateRunId();
  const depthPolicy = DEPTH_POLICIES[config.depth];
  const errors: string[] = [];

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

  function completePhase(rec: PhaseRecord, summary?: string): void {
    rec.completedAt = new Date().toISOString();
    rec.status = "completed";
    rec.summary = summary;
  }

  // --- Parse adapter response into claims/issues ---
  function parseDiscoveryResponse(
    adapterId: string,
    response: AdapterResponse,
    round: number
  ): { claims: Claim[]; issues: Issue[] } {
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
    } else if (response.content.trim()) {
      // Fallback: entire response as one claim
      newClaims.push({
        id: generateClaimId(round, claims.length),
        text: response.content.trim().slice(0, 500),
        status: "proposed",
        source: adapterId,
        round,
      });
    }

    return { claims: newClaims, issues: newIssues };
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

    // Mark remaining phases
    for (const phase of PHASES.slice(1)) {
      const rec = startPhase(phase);
      completePhase(rec, `Dry run — ${phase} simulated.`);
    }

    // Build synthetic synthesis
    draftSynthesis = {
      version: 1,
      agreedPoints: ["Dry run agreed point"],
      acceptedHybrids: [],
      unresolvedDisagreements: [
        {
          issueId: "issue-r1-0",
          title: "Dry run open question",
          positions: { "dry-run": "This is a synthetic position" },
          reason: "Dry run — no real deliberation occurred.",
        },
      ],
      conditionalAgreements: [],
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
        status: "agreed",
        positions: { "dry-run": "Accepted" },
      },
      {
        claimId: "claim-r1-1",
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
        if (!result || result.response.error) continue;

        if (lane === "independent-draft") {
          const parsed = parseDiscoveryResponse(
            result.adapter.id,
            result.response,
            round
          );
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
    `${round} rounds, ${claims.length} claims, ${issues.length} issues`
  );

  // Phase 3: Consolidation
  const p3 = startPhase("consolidation");
  const consolidator = adapters[0]; // Use first available adapter for consolidation
  try {
    const consolidateResp = await consolidator.invoke(
      consolidationPrompt(task, claims, issues),
      { timeout: 120_000 }
    );

    // Build agreement matrix from consolidation
    try {
      const content = consolidateResp.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          agreedPoints?: string[];
          disputedPoints?: string[];
          candidateHybrids?: string[];
          droppedIdeas?: string[];
        };

        // Map agreed/disputed to claims
        for (const claim of claims) {
          const isAgreed = parsed.agreedPoints?.some((p: string) =>
            claim.text.toLowerCase().includes(p.toLowerCase().slice(0, 20))
          );
          const isDisputed = parsed.disputedPoints?.some((p: string) =>
            claim.text.toLowerCase().includes(p.toLowerCase().slice(0, 20))
          );

          agreementMatrix.push({
            claimId: claim.id,
            status: isAgreed
              ? "agreed"
              : isDisputed
                ? "disputed"
                : claim.status === "accepted"
                  ? "agreed"
                  : claim.status === "rejected"
                    ? "dropped"
                    : "disputed",
            positions: { [claim.source]: claim.text },
          });
        }
      }
    } catch {
      // Fallback: derive from claim statuses
      for (const claim of claims) {
        agreementMatrix.push({
          claimId: claim.id,
          status:
            claim.status === "accepted"
              ? "agreed"
              : claim.status === "rejected"
                ? "dropped"
                : "disputed",
          positions: { [claim.source]: claim.text },
        });
      }
    }

    if (config.transcriptRetention !== "none") {
      store.saveTranscript("consolidation", consolidator.id, consolidateResp.content);
    }
  } catch (err) {
    errors.push(`Consolidation: ${err instanceof Error ? err.message : String(err)}`);
    // Fallback matrix
    for (const claim of claims) {
      agreementMatrix.push({
        claimId: claim.id,
        status:
          claim.status === "accepted"
            ? "agreed"
            : claim.status === "rejected"
              ? "dropped"
              : "disputed",
        positions: { [claim.source]: claim.text },
      });
    }
  }

  store.saveAgreementMatrix(agreementMatrix);
  completePhase(p3, `${agreementMatrix.length} entries in agreement matrix`);

  // Phase 4: Validation
  const p4 = startPhase("validation");
  const validator = adapters[adapters.length > 1 ? 1 : 0]; // Use different adapter if available
  try {
    const validateResp = await validator.invoke(
      validationPrompt(task, agreementMatrix, claims),
      { timeout: 120_000 }
    );

    if (config.transcriptRetention !== "none") {
      store.saveTranscript("validation", validator.id, validateResp.content);
    }

    // Apply validation findings — prune weak claims
    try {
      const content = validateResp.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const findings = JSON.parse(jsonMatch[0]) as {
          unsupportedClaims?: string[];
          misstatements?: string[];
        };

        // Mark unsupported claims
        if (findings.unsupportedClaims) {
          for (const desc of findings.unsupportedClaims) {
            const weakClaim = claims.find(
              (c) =>
                c.status === "proposed" &&
                c.text.toLowerCase().includes(desc.toLowerCase().slice(0, 20))
            );
            if (weakClaim) {
              weakClaim.status = "withdrawn";
            }
          }
        }
      }
    } catch {
      // Validation parse failure is non-fatal
    }
  } catch (err) {
    errors.push(`Validation: ${err instanceof Error ? err.message : String(err)}`);
  }

  store.saveClaimLedger(claims);
  store.saveIssueLedger(issues);
  completePhase(p4, "Validation complete");

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
    agreedPoints: agreed.map(
      (e) => claims.find((c) => c.id === e.claimId)?.text || e.claimId
    ),
    acceptedHybrids: hybrids.map(
      (e) => e.hybridProposal || claims.find((c) => c.id === e.claimId)?.text || ""
    ),
    unresolvedDisagreements,
    conditionalAgreements: [],
    summary: `Deliberation on: ${task}. ${agreed.length} agreed, ${disputed.length} disputed, ${hybrids.length} hybrids.`,
  };

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

      // Parse vote
      try {
        const content = ratResp.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const vote = JSON.parse(jsonMatch[0]) as {
            outcome?: string;
            objections?: string[];
            requestedEdits?: string[];
          };
          votes.push({
            adapterId: adapter.id,
            outcome:
              vote.outcome === "blocked" ? "blocked" : "approved",
            objections: vote.objections,
            requestedEdits: vote.requestedEdits,
          });
        } else {
          votes.push({
            adapterId: adapter.id,
            outcome: "approved",
          });
        }
      } catch {
        votes.push({
          adapterId: adapter.id,
          outcome: "approved",
        });
      }
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
  const allApproved = votes.every((v) => v.outcome === "approved");
  completePhase(
    p5,
    `${allApproved ? "Ratified" : "Not fully ratified"} — ${votes.length} votes`
  );

  // Phase 6: Final Synthesis
  const p6 = startPhase("synthesis");

  finalSynthesis = {
    ratified: allApproved,
    ratificationVotes: votes,
    synthesis: draftSynthesis,
    producedAt: new Date().toISOString(),
  };

  store.saveFinalSynthesis(finalSynthesis);
  manifest.completedAt = new Date().toISOString();
  store.saveManifest(manifest);
  store.saveReadme(manifest);
  store.saveSynthesisMarkdown(manifest, finalSynthesis, claims, issues, votes);

  completePhase(
    p6,
    allApproved
      ? "Ratified synthesis produced."
      : "Synthesis with unresolved disagreements produced."
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

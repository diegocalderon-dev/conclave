/** Core type definitions for Conclave v1 */

// --- Phases ---

export type Phase =
  | "input-normalization"
  | "discovery"
  | "consolidation"
  | "validation"
  | "ratification"
  | "synthesis";

export const PHASES: Phase[] = [
  "input-normalization",
  "discovery",
  "consolidation",
  "validation",
  "ratification",
  "synthesis",
];

// --- Lanes ---

export type LaneType =
  | "independent-draft"
  | "atomic-claim"
  | "issue-debate"
  | "hybrid-edit"
  | "contrarian";

export const ALL_LANES: LaneType[] = [
  "independent-draft",
  "atomic-claim",
  "issue-debate",
  "hybrid-edit",
  "contrarian",
];

// --- Depth ---

export type DepthProfile = "low" | "medium" | "high" | "exhaustive";

export interface DepthPolicy {
  maxRounds: number;
  laneBudget: number;
  stagnationLimit: number;
  retryAllowance: number;
  transcriptRetention: TranscriptRetention;
  lanes: LaneType[];
}

export const DEPTH_POLICIES: Record<DepthProfile, DepthPolicy> = {
  low: {
    maxRounds: 2,
    laneBudget: 2,
    stagnationLimit: 1,
    retryAllowance: 1,
    transcriptRetention: "none",
    lanes: ["independent-draft", "atomic-claim"],
  },
  medium: {
    maxRounds: 4,
    laneBudget: 3,
    stagnationLimit: 2,
    retryAllowance: 2,
    transcriptRetention: "summary",
    lanes: ["independent-draft", "atomic-claim", "issue-debate"],
  },
  high: {
    maxRounds: 6,
    laneBudget: 4,
    stagnationLimit: 2,
    retryAllowance: 3,
    transcriptRetention: "summary",
    lanes: ["independent-draft", "atomic-claim", "issue-debate", "hybrid-edit"],
  },
  exhaustive: {
    maxRounds: 10,
    laneBudget: 5,
    stagnationLimit: 3,
    retryAllowance: 4,
    transcriptRetention: "full",
    lanes: [
      "independent-draft",
      "atomic-claim",
      "issue-debate",
      "hybrid-edit",
      "contrarian",
    ],
  },
};

// --- Autonomy ---

export type AutonomyMode = "supervised" | "autonomous";

// --- Transcripts ---

export type TranscriptRetention = "none" | "summary" | "full";

// --- Claims ---

export type ClaimStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "modified"
  | "merged"
  | "withdrawn";

export interface Claim {
  id: string;
  text: string;
  status: ClaimStatus;
  source: string; // adapter id that proposed it
  round: number;
  evidence?: string[];
  modifiedFrom?: string; // parent claim id
}

// --- Issues ---

export type IssueState =
  | "open"
  | "narrowed"
  | "hybrid_proposed"
  | "resolved"
  | "irreducible_disagreement";

export interface Issue {
  id: string;
  title: string;
  description: string;
  state: IssueState;
  raisedBy: string;
  round: number;
  transitions: IssueTransition[];
  relatedClaims?: string[];
}

export interface IssueTransition {
  from: IssueState;
  to: IssueState;
  reason: string;
  round: number;
  actor: string;
}

// --- Agreement Matrix ---

export type AgreementStatus =
  | "agreed"
  | "disputed"
  | "hybrid_proposed"
  | "dropped";

export interface AgreementEntry {
  claimId: string;
  status: AgreementStatus;
  positions: Record<string, string>; // adapter -> position summary
  hybridProposal?: string;
}

// --- Ratification ---

export type RatificationOutcome = "approved" | "blocked";

export interface RatificationVote {
  adapterId: string;
  outcome: RatificationOutcome;
  objections?: string[];
  requestedEdits?: string[];
}

// --- Run Manifest ---

export interface RunManifest {
  runId: string;
  task: string;
  target?: string;
  depth: DepthProfile;
  autonomy: AutonomyMode;
  transcriptRetention: TranscriptRetention;
  adapters: string[];
  activeLanes: LaneType[];
  startedAt: string;
  completedAt?: string;
  artifactRoot: string;
  phases: PhaseRecord[];
}

export interface PhaseRecord {
  phase: Phase;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  summary?: string;
}

// --- Draft Synthesis ---

export interface DraftSynthesis {
  version: number;
  agreedPoints: string[];
  acceptedHybrids: string[];
  unresolvedDisagreements: UnresolvedDisagreement[];
  conditionalAgreements: string[];
  summary: string;
}

export interface UnresolvedDisagreement {
  issueId: string;
  title: string;
  positions: Record<string, string>;
  reason: string;
}

// --- Final Synthesis ---

export interface FinalSynthesis {
  ratified: boolean;
  ratificationVotes: RatificationVote[];
  synthesis: DraftSynthesis;
  producedAt: string;
}

// --- Adapter Contract ---

export interface AdapterCapabilities {
  id: string;
  name: string;
  available: boolean;
  command?: string;
  version?: string;
  nonInteractiveSupported: boolean;
  structuredOutputSupported: boolean;
  features: string[];
  error?: string;
}

export interface AdapterResponse {
  content: string;
  structured?: Record<string, unknown>;
  exitCode: number;
  durationMs: number;
  error?: string;
}

export interface Adapter {
  id: string;
  detect(): Promise<AdapterCapabilities>;
  invoke(prompt: string, options?: AdapterInvokeOptions): Promise<AdapterResponse>;
}

export interface AdapterInvokeOptions {
  workingDir?: string;
  timeout?: number;
  model?: string;
  structuredOutput?: boolean;
  outputFile?: string;
}

// --- Config ---

export interface ConclaveConfig {
  artifactRoot: string;
  depth: DepthProfile;
  autonomy: AutonomyMode;
  transcriptRetention: TranscriptRetention;
  adapters: {
    claude: AdapterConfig;
    codex: AdapterConfig;
  };
  lanes: LaneConfig;
  limits: LimitsConfig;
}

export interface AdapterConfig {
  command?: string;
  model?: string;
  enabled?: boolean;
}

export interface LaneConfig {
  enabled: LaneType[];
  maxParallel: number;
}

export interface LimitsConfig {
  maxRounds: number;
  stagnationThreshold: number;
  maxClaims: number;
}

// --- Lane Output ---

export interface LaneOutput {
  lane: LaneType;
  adapterId: string;
  round: number;
  claims: Claim[];
  issues: Issue[];
  summary: string;
  raw?: string;
}

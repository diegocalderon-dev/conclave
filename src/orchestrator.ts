import type { Adapter } from "./adapters/types.ts";
import { createSession, persistSession, toAgentResult, type Session } from "./session.ts";
import { displayRound, displaySpinner, getSteerInput, hitlPrompt } from "./ui.ts";

export interface RunOptions {
  workdir?: string;
  repos?: string[];
  maxRounds: number;
  timeout?: number;
  allowWrites?: boolean;
  sessionDir?: string;
}

function buildInitialPrompt(task: string, repos?: string[]): string {
  let prompt = `You are participating in a multi-agent analysis.

Task: ${task}

Produce your independent analysis. Be thorough but concise.
Structure your response with clear sections.
Note assumptions, open questions, and confidence levels.`;

  if (repos?.length) {
    prompt += `\n\nRelevant repositories:\n${repos.map((r) => `- ${r}`).join("\n")}`;
  }

  return prompt;
}

function buildCrossReviewPrompt(
  task: string,
  ownPrevious: string,
  otherPrevious: string,
  steer?: string,
  repos?: string[],
): string {
  let prompt = `You are participating in a multi-agent analysis.

Task: ${task}

Your previous analysis:
---
${ownPrevious}
---

The other agent's latest analysis:
---
${otherPrevious}
---`;

  if (steer) {
    prompt += `\n\nOperator guidance for this round: ${steer}`;
  }

  if (repos?.length) {
    prompt += `\n\nRelevant repositories:\n${repos.map((r) => `- ${r}`).join("\n")}`;
  }

  prompt += `

Compare both analyses. Identify agreements, disagreements (with reasoning),
and produce a refined analysis incorporating the strongest elements from both.
Be specific about what changed from your previous position and why.`;

  return prompt;
}

export async function run(
  claude: Adapter,
  codex: Adapter,
  task: string,
  options: RunOptions,
): Promise<Session> {
  const session = createSession(task, {
    workdir: options.workdir,
    repos: options.repos,
    maxRounds: options.maxRounds,
  });

  const invokeOpts = {
    workdir: options.workdir,
    timeout: options.timeout,
    allowWrites: options.allowWrites,
  };

  // Round 0: Independent drafts (parallel)
  const spinner0 = displaySpinner("Round 0: agents exploring independently...");
  const [resultA, resultB] = await Promise.all([
    claude.invoke(buildInitialPrompt(task, options.repos), invokeOpts),
    codex.invoke(buildInitialPrompt(task, options.repos), invokeOpts),
  ]);
  spinner0.stop();

  session.rounds.push({
    number: 0,
    claude: toAgentResult(resultA),
    codex: toAgentResult(resultB),
  });
  persistSession(session, options.sessionDir);
  displayRound(0, session.rounds[0]!.claude, session.rounds[0]!.codex);

  // HITL loop
  let crossReviewCount = 0;
  while (true) {
    const atLimit = crossReviewCount >= options.maxRounds;
    const action = await hitlPrompt({ atLimit });

    if (action === "accept") {
      session.status = "accepted";
      session.acceptedAt = new Date().toISOString();
      break;
    }
    if (action === "quit") {
      session.status = "abandoned";
      break;
    }

    const steer = action === "steer" ? await getSteerInput() : undefined;
    const lastRound = session.rounds.at(-1)!;
    crossReviewCount++;

    // Cross-review: each agent sees own prev + other's prev (parallel, stateless)
    const spinnerN = displaySpinner(`Round ${crossReviewCount}: agents cross-reviewing...`);
    const [refinedA, refinedB] = await Promise.all([
      claude.invoke(
        buildCrossReviewPrompt(task, lastRound.claude.content, lastRound.codex.content, steer, options.repos),
        invokeOpts,
      ),
      codex.invoke(
        buildCrossReviewPrompt(task, lastRound.codex.content, lastRound.claude.content, steer, options.repos),
        invokeOpts,
      ),
    ]);
    spinnerN.stop();

    session.rounds.push({
      number: crossReviewCount,
      claude: toAgentResult(refinedA),
      codex: toAgentResult(refinedB),
      steer,
    });
    persistSession(session, options.sessionDir);
    displayRound(crossReviewCount, session.rounds.at(-1)!.claude, session.rounds.at(-1)!.codex);
  }

  // Always persist final state
  persistSession(session, options.sessionDir);
  return session;
}

export async function resumeSession(
  claude: Adapter,
  codex: Adapter,
  session: Session,
  options: RunOptions,
): Promise<Session> {
  // Display last completed round
  const lastRound = session.rounds.at(-1);
  if (lastRound) {
    console.log(`\nResuming session ${session.id} from round ${lastRound.number}`);
    displayRound(lastRound.number, lastRound.claude, lastRound.codex);
  }

  const invokeOpts = {
    workdir: options.workdir ?? session.workdir,
    timeout: options.timeout,
    allowWrites: options.allowWrites,
  };

  // Count existing cross-review rounds (round 0 is independent)
  let crossReviewCount = Math.max(0, session.rounds.length - 1);

  // HITL loop (same as run)
  while (true) {
    const atLimit = crossReviewCount >= session.maxRounds;
    const action = await hitlPrompt({ atLimit });

    if (action === "accept") {
      session.status = "accepted";
      session.acceptedAt = new Date().toISOString();
      break;
    }
    if (action === "quit") {
      session.status = "abandoned";
      break;
    }

    const steer = action === "steer" ? await getSteerInput() : undefined;
    const lastRound = session.rounds.at(-1)!;
    crossReviewCount++;

    const spinnerN = displaySpinner(`Round ${crossReviewCount}: agents cross-reviewing...`);
    const [refinedA, refinedB] = await Promise.all([
      claude.invoke(
        buildCrossReviewPrompt(session.task, lastRound.claude.content, lastRound.codex.content, steer, session.repos),
        invokeOpts,
      ),
      codex.invoke(
        buildCrossReviewPrompt(session.task, lastRound.codex.content, lastRound.claude.content, steer, session.repos),
        invokeOpts,
      ),
    ]);
    spinnerN.stop();

    session.rounds.push({
      number: crossReviewCount,
      claude: toAgentResult(refinedA),
      codex: toAgentResult(refinedB),
      steer,
    });
    persistSession(session, options.sessionDir);
    displayRound(crossReviewCount, session.rounds.at(-1)!.claude, session.rounds.at(-1)!.codex);
  }

  persistSession(session, options.sessionDir);
  return session;
}

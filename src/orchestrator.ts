import type { Adapter } from "./adapters/types.ts";
import { createSession, persistSession, toStep, type Session } from "./session.ts";
import {
  displayCompletion,
  displayStep,
  displaySessionHeader,
  getSteerInput,
  hitlPrompt,
  startProgress,
} from "./ui.ts";

export interface RunOptions {
  workdir?: string;
  repos?: string[];
  maxSteps: number;
  timeout?: number;
  allowWrites?: boolean;
  sessionDir?: string;
}

function buildAnalyzePrompt(task: string, repos?: string[]): string {
  let prompt = `Task: ${task}

Produce your analysis. Be thorough but concise.
Structure your response with clear sections.
Note assumptions, open questions, and confidence levels.`;

  if (repos?.length) {
    prompt += `\n\nRelevant repositories:\n${repos.map((r) => `- ${r}`).join("\n")}`;
  }

  return prompt;
}

function buildReviewPrompt(task: string, previousOutput: string, steer?: string): string {
  let prompt = `Task: ${task}

The following analysis was produced:
---
${previousOutput}
---`;

  if (steer) {
    prompt += `\n\nOperator guidance: ${steer}`;
  }

  prompt += `

Review this analysis critically. Identify:
- Strengths and valid points
- Gaps, errors, or missing considerations
- Specific improvements or alternative approaches

Be constructive but thorough. Challenge weak reasoning.`;

  return prompt;
}

function buildRefinePrompt(task: string, ownPrevious: string, reviewOutput: string, steer?: string): string {
  let prompt = `Task: ${task}

Your previous analysis:
---
${ownPrevious}
---

A review of your analysis:
---
${reviewOutput}
---`;

  if (steer) {
    prompt += `\n\nOperator guidance: ${steer}`;
  }

  prompt += `

Address the review feedback. Refine your analysis incorporating valid
criticisms and defending positions where the review was wrong.
Be specific about what changed and why.`;

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
    maxSteps: options.maxSteps,
  });

  displaySessionHeader(task, options.maxSteps, options.workdir);

  const invokeOpts = {
    workdir: options.workdir,
    timeout: options.timeout,
    allowWrites: options.allowWrites,
  };

  // Step 0: Claude initial analysis
  const progress0 = startProgress("claude", "analyzing");
  const result0 = await claude.invoke(buildAnalyzePrompt(task, options.repos), invokeOpts);
  progress0.stop(result0.durationMs, !!result0.error);

  const step0 = toStep(result0, 0, "claude", "analyze");
  session.steps.push(step0);
  persistSession(session, options.sessionDir);
  displayStep(step0, options.maxSteps);

  // Relay loop
  let stepCount = 0; // steps after initial (budget counter)
  while (true) {
    const stepsLeft = options.maxSteps - stepCount;
    const atLimit = stepsLeft <= 0;
    const action = await hitlPrompt({ atLimit, stepsLeft });

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
    const lastStep = session.steps.at(-1)!;
    stepCount++;
    const stepNumber = session.steps.length;

    if (lastStep.agent === "claude") {
      // Next: Codex reviews
      const progress = startProgress("codex", "reviewing");
      const result = await codex.invoke(
        buildReviewPrompt(task, lastStep.content, steer),
        invokeOpts,
      );
      progress.stop(result.durationMs, !!result.error);

      const step = toStep(result, stepNumber, "codex", "review", steer);
      session.steps.push(step);
    } else {
      // Next: Claude refines based on review
      // Find Claude's last output to pass as "own previous"
      const claudePrevious = findLastByAgent(session.steps, "claude");
      const progress = startProgress("claude", "refining");
      const result = await claude.invoke(
        buildRefinePrompt(task, claudePrevious?.content ?? "", lastStep.content, steer),
        invokeOpts,
      );
      progress.stop(result.durationMs, !!result.error);

      const step = toStep(result, stepNumber, "claude", "refine", steer);
      session.steps.push(step);
    }

    persistSession(session, options.sessionDir);
    displayStep(session.steps.at(-1)!, options.maxSteps - stepCount);
  }

  persistSession(session, options.sessionDir);
  return session;
}

export async function resumeSession(
  claude: Adapter,
  codex: Adapter,
  session: Session,
  options: RunOptions,
): Promise<Session> {
  const lastStep = session.steps.at(-1);
  if (lastStep) {
    displaySessionHeader(session.task, session.maxSteps, session.workdir);
    console.log(`  Resuming from step ${lastStep.number}\n`);
    displayStep(lastStep, session.maxSteps - (session.steps.length - 1));
  }

  const invokeOpts = {
    workdir: options.workdir ?? session.workdir,
    timeout: options.timeout,
    allowWrites: options.allowWrites,
  };

  let stepCount = session.steps.length - 1; // exclude step 0

  while (true) {
    const stepsLeft = session.maxSteps - stepCount;
    const atLimit = stepsLeft <= 0;
    const action = await hitlPrompt({ atLimit, stepsLeft });

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
    const lastStep = session.steps.at(-1)!;
    stepCount++;
    const stepNumber = session.steps.length;

    if (lastStep.agent === "claude") {
      const progress = startProgress("codex", "reviewing");
      const result = await codex.invoke(
        buildReviewPrompt(session.task, lastStep.content, steer),
        invokeOpts,
      );
      progress.stop(result.durationMs, !!result.error);

      session.steps.push(toStep(result, stepNumber, "codex", "review", steer));
    } else {
      const claudePrevious = findLastByAgent(session.steps, "claude");
      const progress = startProgress("claude", "refining");
      const result = await claude.invoke(
        buildRefinePrompt(session.task, claudePrevious?.content ?? "", lastStep.content, steer),
        invokeOpts,
      );
      progress.stop(result.durationMs, !!result.error);

      session.steps.push(toStep(result, stepNumber, "claude", "refine", steer));
    }

    persistSession(session, options.sessionDir);
    displayStep(session.steps.at(-1)!, session.maxSteps - stepCount);
  }

  persistSession(session, options.sessionDir);
  return session;
}

function findLastByAgent(steps: readonly { agent: string; content: string }[], agent: string) {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i]!.agent === agent) return steps[i]!;
  }
  return null;
}

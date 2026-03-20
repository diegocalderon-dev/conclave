import { createInterface } from "readline";

export interface PromptForTaskOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  intro?: string;
  prompt?: string;
  continuationPrompt?: string;
  emptyTaskMessage?: string;
}

function trimEmptyBoundaryLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim().length === 0) {
    start += 1;
  }

  while (end > start && lines[end - 1]?.trim().length === 0) {
    end -= 1;
  }

  return lines.slice(start, end);
}

export async function promptForTask(
  options: PromptForTaskOptions = {}
): Promise<string | null> {
  const {
    input = process.stdin,
    output = process.stdout,
    intro = "",
    prompt = "Task> ",
    continuationPrompt = "... ",
    emptyTaskMessage =
      "Task cannot be empty. Enter at least one line, then press Ctrl+D to submit or Ctrl+C to cancel.\n",
  } = options;

  const rl = createInterface({ input, output });
  const lines: string[] = [];
  let cancelled = false;

  const handleSigint = () => {
    cancelled = true;
    rl.close();
  };
  rl.on("SIGINT", handleSigint);

  try {
    if (intro) {
      output.write(intro);
    }

    output.write(prompt);

    for await (const answer of rl) {
      if (lines.length === 0 && answer.trim().length === 0) {
        output.write(emptyTaskMessage);
        output.write(prompt);
        continue;
      }

      lines.push(answer);
      output.write(continuationPrompt);
    }

    output.write("\n");

    if (cancelled) {
      return null;
    }

    const task = trimEmptyBoundaryLines(lines).join("\n").trimEnd();
    return task.trim().length > 0 ? task : null;
  } finally {
    rl.off("SIGINT", handleSigint);
    rl.close();
  }
}

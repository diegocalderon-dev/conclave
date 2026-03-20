import { createInterface } from "readline";

export interface PromptForTaskOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  intro?: string;
  prompt?: string;
  emptyTaskMessage?: string;
}

export async function promptForTask(
  options: PromptForTaskOptions = {}
): Promise<string | null> {
  const {
    input = process.stdin,
    output = process.stdout,
    intro = "",
    prompt = "Task> ",
    emptyTaskMessage = "Task cannot be empty. Enter a task or press Ctrl+C to cancel.\n",
  } = options;

  const rl = createInterface({ input, output });
  const handleSigint = () => rl.close();
  rl.on("SIGINT", handleSigint);

  try {
    if (intro) {
      output.write(intro);
    }

    output.write(prompt);

    for await (const answer of rl) {
      const task = answer.trim();
      if (task.length > 0) {
        return task;
      }

      output.write(emptyTaskMessage);
      output.write(prompt);
    }

    return null;
  } finally {
    rl.off("SIGINT", handleSigint);
    rl.close();
  }
}

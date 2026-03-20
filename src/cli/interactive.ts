import { createInterface } from "readline";
import { StringDecoder } from "string_decoder";

export interface PromptForTaskOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  intro?: string;
  prompt?: string;
  continuationPrompt?: string;
  emptyTaskMessage?: string;
}

type RawModeReadable = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
};

const SHIFT_ENTER_SEQUENCES = ["\x1b[13;2u", "\x1b[27;2;13~"];
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

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

function normalizeTask(taskBuffer: string): string | null {
  const task = trimEmptyBoundaryLines(taskBuffer.split("\n")).join("\n").trimEnd();
  return task.trim().length > 0 ? task : null;
}

function supportsRawMode(input: NodeJS.ReadableStream): input is RawModeReadable {
  const candidate = input as RawModeReadable;
  return Boolean(candidate.isTTY) && typeof candidate.setRawMode === "function";
}

function formatPrompt(
  taskBuffer: string,
  prompt: string,
  continuationPrompt: string
): string {
  const lines = taskBuffer.split("\n");
  return lines
    .map((line, index) =>
      `${index === 0 ? prompt : continuationPrompt}${line}`
    )
    .join("\n");
}

function clearPrompt(output: NodeJS.WritableStream, lineCount: number): void {
  if (lineCount <= 0) {
    return;
  }

  output.write("\r");
  if (lineCount > 1) {
    output.write(`\x1b[${lineCount - 1}A`);
  }
  output.write("\x1b[J");
}

function renderPrompt(
  output: NodeJS.WritableStream,
  taskBuffer: string,
  prompt: string,
  continuationPrompt: string,
  previousLineCount: number
): number {
  clearPrompt(output, previousLineCount);

  const rendered = formatPrompt(taskBuffer, prompt, continuationPrompt);
  output.write(rendered);
  return rendered.split("\n").length;
}

function removeLastCharacter(value: string): string {
  const characters = Array.from(value);
  characters.pop();
  return characters.join("");
}

function normalizePastedText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function trailingPrefixLength(value: string, target: string): number {
  const maxLength = Math.min(value.length, target.length - 1);

  for (let length = maxLength; length > 0; length -= 1) {
    if (target.startsWith(value.slice(-length))) {
      return length;
    }
  }

  return 0;
}

async function promptForTaskRaw(
  input: RawModeReadable,
  output: NodeJS.WritableStream,
  intro: string,
  prompt: string,
  continuationPrompt: string,
  emptyTaskMessage: string
): Promise<string | null> {
  const decoder = new StringDecoder("utf8");

  return await new Promise<string | null>((resolve, reject) => {
    let taskBuffer = "";
    let pending = "";
    let renderedLineCount = 0;
    let pasteMode = false;
    let settled = false;

    const render = () => {
      renderedLineCount = renderPrompt(
        output,
        taskBuffer,
        prompt,
        continuationPrompt,
        renderedLineCount
      );
    };

    const cleanup = () => {
      input.off("data", handleData);
      input.off("end", handleEnd);
      input.off("error", handleError);
      output.write("\x1b[?2004l");
      input.setRawMode?.(false);
      input.pause?.();
    };

    const finish = (result: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(result);
    };

    const showEmptyTaskMessage = () => {
      taskBuffer = "";
      output.write("\n");
      output.write(emptyTaskMessage);
      renderedLineCount = 0;
      render();
    };

    const submit = () => {
      const task = normalizeTask(taskBuffer);
      if (!task) {
        showEmptyTaskMessage();
        return;
      }

      output.write("\n");
      finish(task);
    };

    const cancel = () => {
      output.write("\n");
      finish(null);
    };

    const processPending = () => {
      let needsRender = false;

      while (!settled && pending.length > 0) {
        if (pasteMode) {
          const endIndex = pending.indexOf(BRACKETED_PASTE_END);

          if (endIndex >= 0) {
            taskBuffer += normalizePastedText(pending.slice(0, endIndex));
            pending = pending.slice(endIndex + BRACKETED_PASTE_END.length);
            pasteMode = false;
            needsRender = true;
            continue;
          }

          const overlap = trailingPrefixLength(pending, BRACKETED_PASTE_END);
          const contentEnd = overlap > 0 ? pending.length - overlap : pending.length;
          taskBuffer += normalizePastedText(pending.slice(0, contentEnd));
          pending = pending.slice(contentEnd);
          needsRender = contentEnd > 0 || needsRender;
          break;
        }

        if (pending.startsWith(BRACKETED_PASTE_START)) {
          pending = pending.slice(BRACKETED_PASTE_START.length);
          pasteMode = true;
          continue;
        }

        if (
          BRACKETED_PASTE_START.startsWith(pending) ||
          BRACKETED_PASTE_END.startsWith(pending) ||
          SHIFT_ENTER_SEQUENCES.some((sequence) => sequence.startsWith(pending))
        ) {
          break;
        }

        const shiftEnterSequence = SHIFT_ENTER_SEQUENCES.find((sequence) =>
          pending.startsWith(sequence)
        );
        if (shiftEnterSequence) {
          taskBuffer += "\n";
          pending = pending.slice(shiftEnterSequence.length);
          needsRender = true;
          continue;
        }

        if (pending.startsWith("\r\n")) {
          pending = pending.slice(2);
          submit();
          return;
        }

        const nextCharacter = pending[0];
        if (!nextCharacter) {
          break;
        }

        if (nextCharacter === "\r" || nextCharacter === "\n") {
          pending = pending.slice(1);
          submit();
          return;
        }

        if (nextCharacter === "\x03") {
          pending = pending.slice(1);
          cancel();
          return;
        }

        if (nextCharacter === "\x04") {
          pending = pending.slice(1);
          submit();
          return;
        }

        if (nextCharacter === "\x7f" || nextCharacter === "\b") {
          taskBuffer = removeLastCharacter(taskBuffer);
          pending = pending.slice(1);
          needsRender = true;
          continue;
        }

        if (nextCharacter === "\x1b") {
          if (pending.length === 1) {
            break;
          }

          if (pending.startsWith("\x1b[")) {
            const csiSequence = pending.match(/^\x1b\[[0-9;?]*[A-Za-z~]/u)?.[0];
            if (!csiSequence) {
              break;
            }

            pending = pending.slice(csiSequence.length);
            continue;
          }

          if (pending.startsWith("\x1bO")) {
            if (pending.length < 3) {
              break;
            }

            pending = pending.slice(3);
            continue;
          }

          if (pending[1] === "\r" || pending[1] === "\n") {
            taskBuffer += "\n";
            pending = pending.slice(2);
            needsRender = true;
            continue;
          }

          const metaCharacter = Array.from(pending.slice(1))[0];
          if (!metaCharacter) {
            break;
          }

          pending = pending.slice(1 + metaCharacter.length);
          continue;
        }

        const textMatch = pending.match(/^[^\x00-\x1f\x7f\x1b]+/u)?.[0];
        if (textMatch) {
          taskBuffer += textMatch;
          pending = pending.slice(textMatch.length);
          needsRender = true;
          continue;
        }

        pending = pending.slice(nextCharacter.length);
      }

      if (needsRender && !settled) {
        render();
      }
    };

    const handleData = (chunk: string | Buffer) => {
      pending += Buffer.isBuffer(chunk)
        ? decoder.write(chunk)
        : decoder.write(Buffer.from(chunk));
      processPending();
    };

    const handleEnd = () => {
      pending += decoder.end();
      processPending();

      if (settled) {
        return;
      }

      output.write("\n");
      finish(normalizeTask(taskBuffer));
    };

    const handleError = (error: Error) => {
      if (settled) {
        return;
      }

      cleanup();
      reject(error);
    };

    if (intro) {
      output.write(intro);
    }

    output.write("\x1b[?2004h");
    input.setRawMode?.(true);
    input.resume?.();
    render();

    input.on("data", handleData);
    input.on("end", handleEnd);
    input.on("error", handleError);
  });
}

async function promptForTaskLineInput(
  options: PromptForTaskOptions
): Promise<string | null> {
  const {
    input = process.stdin,
    output = process.stdout,
    intro = "",
    prompt = "Task> ",
    continuationPrompt = "... ",
    emptyTaskMessage =
      "Task cannot be empty. Enter at least one line, then press Shift+Enter for a new line, Enter to submit, or Ctrl+C to cancel.\n",
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

    return normalizeTask(lines.join("\n"));
  } finally {
    rl.off("SIGINT", handleSigint);
    rl.close();
  }
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
      "Task cannot be empty. Enter at least one line, then press Shift+Enter for a new line, Enter to submit, or Ctrl+C to cancel.\n",
  } = options;

  if (supportsRawMode(input)) {
    return promptForTaskRaw(
      input,
      output,
      intro,
      prompt,
      continuationPrompt,
      emptyTaskMessage
    );
  }

  return promptForTaskLineInput({
    input,
    output,
    intro,
    prompt,
    continuationPrompt,
    emptyTaskMessage,
  });
}

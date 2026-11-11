import { spawn } from "node:child_process";

export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Written to the child's stdin, which is then closed. */
  input?: string;
  /** Receives batches of fresh output lines while the command runs. */
  onOutput?: (text: string) => void;
  /** Receives every complete stdout line as soon as it arrives. */
  onLine?: (line: string) => void;
  /** How often `onOutput` is flushed. */
  flushMs?: number;
};

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KEEP_BYTES = 2 * 1024 * 1024;

/**
 * Runs a command without a shell, capturing stdout and stderr (bounded) and
 * streaming tails of the combined output to `onOutput` in batches.
 */
export function exec(
  cmd: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let pending: string[] = [];
    let partialLine = "";
    let timedOut = false;

    const flush = () => {
      if (!pending.length || !options.onOutput) return;
      const lines = pending;
      pending = [];
      options.onOutput(tail(lines.join("\n"), 40));
    };
    const flusher = options.onOutput
      ? setInterval(flush, options.flushMs ?? 2000)
      : undefined;

    const collect = (which: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (which === "stdout") {
        stdout = keepTail(stdout + text);
        if (options.onLine) {
          const lines = (partialLine + text).split(/\r?\n/);
          partialLine = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) options.onLine(line);
        }
      } else stderr = keepTail(stderr + text);
      if (options.onOutput) {
        for (const line of text.split(/\r?\n/)) if (line.trim()) pending.push(line);
      }
    };
    child.stdout?.on("data", collect("stdout"));
    child.stderr?.on("data", collect("stderr"));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (flusher) clearInterval(flusher);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (flusher) clearInterval(flusher);
      flush();
      if (partialLine.trim() && options.onLine) options.onLine(partialLine);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input);
    }
  });
}

function keepTail(text: string): string {
  return text.length > KEEP_BYTES ? text.slice(text.length - KEEP_BYTES) : text;
}

/** The last `lines` lines of `text`. */
export function tail(text: string, lines = 60): string {
  const all = text.trimEnd().split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

/** stdout and stderr together, for error messages and agent feedback. */
export function combined(result: ExecResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim()).join("\n");
}

export function describeFailure(label: string, result: ExecResult): string {
  const reason = result.timedOut ? "timed out" : `exited with code ${result.code}`;
  return `${label} ${reason}`;
}

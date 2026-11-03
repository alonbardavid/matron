import type { StepLine } from "./types.js";

/**
 * A step's channel to the Worker: one JSON line per event on stdout. The
 * BuilderObject reads the step's output file and relays progress lines to the
 * chat, keeps log lines for operators, and takes `result` or `error` as the
 * step's end.
 */
export function emit(line: StepLine): void {
  process.stdout.write(JSON.stringify(line) + "\n");
}

export function progress(text: string): void {
  emit({ type: "progress", text });
}

export function log(text: string): void {
  emit({ type: "log", text });
}

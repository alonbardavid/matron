import { emit } from "./emit.js";
import { ensureDirs, paths } from "./state.js";
import { Steps } from "./steps.js";
import { JobError, type StepName, type TurnRequest } from "./types.js";

/**
 * `node /app/dist/cli.js <step>`, with the step's {@link TurnRequest} on
 * stdin: runs one step of a job and prints its result as the last line. A
 * failure prints an `error` line and exits 1.
 */
async function main(step: StepName): Promise<unknown> {
  const request = JSON.parse(await readStdin()) as TurnRequest;
  if (request.kind !== "step" || request.step !== step) {
    throw new JobError(`stdin does not carry a ${step} request`);
  }
  const p = paths();
  ensureDirs(p);
  const steps = new Steps(request.job, p);
  switch (step) {
    case "prepare-build":
      return steps.prepareBuild();
    case "prepare-continue":
      return steps.prepareContinue();
    case "prepare-cleanup":
      return steps.prepareCleanup();
    case "install":
      await steps.install();
      return steps.warmServers();
    case "verify":
      return steps.verify();
    case "commit-push":
      if (!request.input) throw new JobError("commit-push needs its input");
      return steps.commitPush(request.input);
    case "deploy-preview":
      return steps.deployPreview();
    case "merge-main":
      return steps.mergeMain();
    case "deploy-production":
      return steps.deployProduction();
    case "cleanup":
      return steps.cleanup();
    case "revert-main":
      return steps.revertMain();
    default:
      throw new JobError(`Unknown step ${String(step)}`);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

const step = process.argv[2] as StepName | undefined;
if (!step) {
  emit({ type: "error", message: "usage: cli.js <step>" });
  process.exit(2);
}
main(step).then(
  (data) => {
    emit({ type: "result", data: data ?? {} });
    process.exit(0);
  },
  (error: unknown) => {
    emit({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof JobError && error.output ? { output: error.output } : {}),
    });
    process.exit(1);
  },
);

import { Alert, Code, Text } from "@mantine/core";
import type { ApiProblem } from "@shared/contract/arch/troubleshooting";

/** Why a section could not be read, and what would let it be. */
export function ProblemNotice({ problem }: { problem: ApiProblem }) {
  if (problem.kind === "permission") {
    return (
      <Alert color="yellow" title="The API token cannot read this">
        <Text size="sm">
          Cloudflare refused the request: {problem.message}. Add the permission{" "}
          <Code>{problem.permission}</Code> to the token this deployment holds, then set
          it on the Worker again.
        </Text>
      </Alert>
    );
  }
  if (problem.kind === "missing-token") {
    return (
      <Alert color="yellow" title="No API token">
        <Text size="sm">{problem.message}</Text>
      </Alert>
    );
  }
  return (
    <Alert color="red" title="Cloudflare did not answer">
      <Text size="sm">{problem.message}</Text>
    </Alert>
  );
}

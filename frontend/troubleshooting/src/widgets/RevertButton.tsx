import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import type { TroubleshootingBranch } from "@shared/contract/arch/troubleshooting";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { formatWhen } from "../format";

/** Takes production back to where a merged branch was cut, after a confirmation that says what is lost. */
export function RevertButton({ branch }: { branch: TroubleshootingBranch }) {
  const revert = useMutation(
    orpc.troubleshooting.branches.revert.mutationOptions({
      onSuccess: () =>
        notifications.show({
          message: "Revert started; its progress is in the branch's build chat",
        }),
      onError: (err) => notifyError(err, "Could not start the revert"),
    }),
  );
  return (
    <ConfirmButton
      size="xs"
      variant="subtle"
      color="red"
      confirmLabel="Revert"
      message={
        `Revert to before ${branch.name}? Main goes back to the commit this branch started from, ` +
        `and every merge since goes with it. The production database is restored to ` +
        `${formatWhen(branch.createdAt)}, when the branch was created: everything written since is lost, ` +
        `the household's data and also users, sign-ins and branches.`
      }
      onConfirm={() => revert.mutateAsync({ id: branch.id }).catch(() => undefined)}
    >
      Revert
    </ConfirmButton>
  );
}

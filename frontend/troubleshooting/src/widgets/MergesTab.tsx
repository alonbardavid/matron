import { useMemo } from "react";
import { Badge, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import type { TroubleshootingMerge } from "@shared/contract/arch/troubleshooting";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { formatAgo, formatWhen } from "../format";
import { useTableView } from "../urlState";
import { DataTable } from "./DataTable";
import { ProblemNotice } from "./ProblemNotice";
import { RefreshButton } from "./RefreshButton";
import { TableLoading } from "./TableLoading";

const column = createColumnHelper<TroubleshootingMerge>();

const REVERT_COLORS = { reverting: "blue", reverted: "gray", failed: "red" } as const;

/** What a revert of `merge` does, for the confirmation. */
function revertMessage(merge: TroubleshootingMerge): string {
  const later = merge.later.length
    ? ` Later merges are taken out with it: ${merge.later.join(", ")}.`
    : "";
  return (
    `Revert ${merge.name}? Main goes back to ${merge.baseCommit.slice(0, 12)} and production is deployed from it.` +
    ` The production database is restored to ${formatWhen(merge.createdAt)}, when the branch was created:` +
    ` every change to the household's data since then is lost. Users, sign-ins, build sessions, branches and settings are kept.${later}`
  );
}

/** Merged branches, the latest first; one can be reverted while Time Travel still reaches its start. */
export function MergesTab() {
  const queryClient = useQueryClient();
  const view = useTableView([{ id: "mergedAt", desc: true }]);
  const query = useQuery(
    orpc.troubleshooting.merges.list.queryOptions({
      // A revert takes minutes: follow it while one is under way.
      refetchInterval: (q) =>
        q.state.data?.items.some((item) => item.revertStatus === "reverting")
          ? 5_000
          : false,
    }),
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.troubleshooting.merges.list.key() });
  const revert = useMutation(
    orpc.troubleshooting.merges.revert.mutationOptions({
      onSuccess: () => {
        notifications.show({
          message: "Revert started; its progress is written into the branch's build chat",
        });
        void refresh();
      },
      onError: (err) => {
        notifyError(err, "Could not start the revert");
        void refresh();
      },
    }),
  );

  const now = Date.now();
  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: "Branch",
        cell: ({ row }) => (
          <Stack gap={0}>
            <Text size="sm" fw={500}>
              {row.original.name}
            </Text>
            <Text size="xs" c="dimmed">
              {row.original.userName}
              {row.original.sessionTitle ? ` · ${row.original.sessionTitle}` : ""}
            </Text>
          </Stack>
        ),
      }),
      column.accessor("createdAt", {
        header: "Created",
        cell: ({ getValue }) => (
          <Tooltip label={formatWhen(getValue())}>
            <Text size="sm">{formatAgo(getValue(), now)}</Text>
          </Tooltip>
        ),
      }),
      column.accessor("mergedAt", {
        header: "Merged",
        cell: ({ getValue }) => {
          const at = getValue();
          return at ? (
            <Tooltip label={formatWhen(at)}>
              <Text size="sm">{formatAgo(at, now)}</Text>
            </Tooltip>
          ) : (
            "–"
          );
        },
      }),
      column.accessor("baseCommit", {
        header: "Main before",
        enableSorting: false,
        cell: ({ getValue }) => (
          <Text size="sm" ff="monospace">
            {getValue().slice(0, 12)}
          </Text>
        ),
      }),
      column.accessor("revertStatus", {
        header: "Revert",
        size: 130,
        cell: ({ row }) => {
          const status = row.original.revertStatus;
          if (!status) return null;
          const badge = (
            <Badge
              size="xs"
              variant="light"
              color={REVERT_COLORS[status]}
              leftSection={status === "reverting" ? <Loader size={8} /> : undefined}
            >
              {status}
            </Badge>
          );
          if (status === "failed" && row.original.revertError)
            return <Tooltip label={row.original.revertError}>{badge}</Tooltip>;
          if (status === "reverted" && row.original.revertedAt)
            return <Tooltip label={formatWhen(row.original.revertedAt)}>{badge}</Tooltip>;
          return badge;
        },
      }),
      column.display({
        id: "actions",
        header: "",
        size: 110,
        cell: ({ row }) => {
          const merge = row.original;
          if (merge.revertStatus === "reverted") return null;
          const button = (
            <ConfirmButton
              size="xs"
              variant="subtle"
              color="red"
              message={revertMessage(merge)}
              confirmLabel="Revert"
              disabled={merge.refusal !== null}
              onConfirm={() => revert.mutateAsync({ id: merge.id })}
            >
              Revert
            </ConfirmButton>
          );
          return merge.refusal ? (
            <Tooltip label={merge.refusal} multiline maw={280}>
              <span>{button}</span>
            </Tooltip>
          ) : (
            button
          );
        },
      }),
    ],
    [now, revert],
  );

  if (query.isPending) return <TableLoading />;
  if (query.isError)
    return (
      <ProblemNotice
        problem={{ kind: "error", message: query.error.message, permission: null }}
      />
    );

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Merged branches. A revert takes main and the production database back to before
          the branch; the database only reaches 30 days back.
        </Text>
        <RefreshButton
          label="Refresh merges"
          fetching={query.isFetching}
          onClick={() => void refresh()}
        />
      </Group>
      {query.data.problem ? (
        <ProblemNotice problem={query.data.problem} />
      ) : (
        <DataTable
          data={query.data.items}
          columns={columns}
          rowId={(row) => row.id}
          emptyText="Nothing has been merged yet."
          minWidth={800}
          {...view}
        />
      )}
    </Stack>
  );
}

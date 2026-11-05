import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Group, Loader, Stack, Switch, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import type { TroubleshootingContainer } from "@shared/contract/arch/troubleshooting";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { formatAgo, formatDuration, formatUsd, formatWhen } from "../format";
import { useFilterParam, useTableView } from "../urlState";
import { DataTable } from "./DataTable";
import { usePending } from "./pending";
import { ProblemNotice } from "./ProblemNotice";
import { RefreshButton } from "./RefreshButton";
import { TableLoading } from "./TableLoading";

const column = createColumnHelper<TroubleshootingContainer>();

/** The builder's container instances: what runs, for how long, and at what cost. */
export function ContainersTab() {
  const queryClient = useQueryClient();
  const [stopped, setStopped] = useFilterParam("stopped", "0");
  const showStopped = stopped === "1";
  const view = useTableView([{ id: "lastActivityAt", desc: true }]);
  const [listed, setListed] = useState<TroubleshootingContainer[]>([]);
  // A stop is under way until the listing shows the instance stopped.
  const stillPending = useCallback(
    (name: string) => listed.some((item) => item.name === name && item.running),
    [listed],
  );
  const pending = usePending(stillPending, listed);
  const query = useQuery(
    orpc.troubleshooting.containers.list.queryOptions({
      // Cloudflare reports a stop a little after it happens: look often while one is under way.
      refetchInterval: pending.any ? 3_000 : 30_000,
    }),
  );
  useEffect(() => {
    if (query.data) setListed(query.data.items);
  }, [query.data]);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.troubleshooting.containers.list.key(),
    });
  const stop = useMutation(
    orpc.troubleshooting.containers.stop.mutationOptions({
      onSuccess: () => {
        notifications.show({ message: "Container stopped" });
        void refresh();
      },
      onError: (err) => notifyError(err, "Could not stop the container"),
    }),
  );
  const clear = useMutation(
    orpc.troubleshooting.containers.clear.mutationOptions({
      onSuccess: () => {
        notifications.show({ message: "Every container is stopping" });
        void refresh();
      },
      onError: (err) => {
        notifyError(err, "Could not stop every container");
        void refresh();
      },
    }),
  );

  const now = Date.now();
  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: "Session",
        cell: ({ row }) => (
          <Stack gap={0}>
            <Text size="sm" fw={500}>
              {row.original.sessionTitle ?? row.original.name}
            </Text>
            <Text size="xs" c="dimmed">
              {row.original.userName ?? "unknown user"} · {row.original.name}
            </Text>
          </Stack>
        ),
      }),
      column.accessor("state", {
        header: "State",
        size: 110,
        cell: ({ row }) =>
          pending.has(row.original.name) ? (
            <Badge
              size="xs"
              variant="light"
              color="yellow"
              leftSection={<Loader size={8} />}
            >
              stopping
            </Badge>
          ) : (
            <Badge
              size="xs"
              variant="light"
              color={row.original.running ? "sage" : "gray"}
            >
              {row.original.state}
            </Badge>
          ),
      }),
      column.accessor("startedAt", {
        header: "Started",
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
      column.accessor((row) => runFor(row, now), {
        id: "ranFor",
        header: "Running for",
        cell: ({ getValue, row }) => {
          const ms = getValue();
          return ms === null
            ? "–"
            : `${formatDuration(ms)}${row.original.running ? "" : " (ran)"}`;
        },
      }),
      column.accessor("lastActivityAt", {
        header: "Last activity",
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
      column.accessor("costUsd", {
        header: "Cost (up to)",
        cell: ({ getValue, row }) => {
          const cost = getValue();
          return cost === null ? (
            "–"
          ) : (
            <Tooltip
              label={`${row.original.vcpu ?? "?"} vCPU, ${row.original.memoryMiB ?? "?"} MiB, ${row.original.diskMB ?? "?"} MB disk at list prices; the CPU part assumes it was busy the whole time`}
            >
              <Text size="sm">{formatUsd(cost)}</Text>
            </Tooltip>
          );
        },
      }),
      column.display({
        id: "actions",
        header: "",
        size: 110,
        cell: ({ row }) =>
          row.original.running ? (
            <ConfirmButton
              size="xs"
              variant="subtle"
              color="red"
              message="Stop this container? Its workspace is snapshotted first, and a running job parks until the next message."
              confirmLabel="Stop"
              disabled={pending.has(row.original.name)}
              onConfirm={() => {
                pending.mark(row.original.name);
                return stop.mutateAsync({ name: row.original.name });
              }}
            >
              Stop
            </ConfirmButton>
          ) : null,
      }),
    ],
    [now, pending, stop],
  );

  if (query.isPending) return <TableLoading />;
  if (query.isError)
    return (
      <ProblemNotice
        problem={{ kind: "error", message: query.error.message, permission: null }}
      />
    );

  const items = showStopped
    ? query.data.items
    : query.data.items.filter((item) => item.running);
  const running = query.data.items.filter((item) => item.running).length;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap">
          <Switch
            label="Show stopped"
            checked={showStopped}
            onChange={(event) => setStopped(event.currentTarget.checked ? "1" : "0")}
          />
          <Text size="sm" c="dimmed">
            {running} running
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <ConfirmButton
            size="xs"
            variant="default"
            message="Stop every running container? Each workspace is snapshotted first, and running jobs park until their next message."
            confirmLabel="Stop all"
            onConfirm={() => {
              pending.mark(
                ...query.data.items
                  .filter((item) => item.running)
                  .map((item) => item.name),
              );
              return clear.mutateAsync({});
            }}
            disabled={running === 0}
          >
            Stop all
          </ConfirmButton>
          <RefreshButton
            label="Refresh containers"
            fetching={query.isFetching}
            onClick={() => void refresh()}
          />
        </Group>
      </Group>
      {query.data.problem ? (
        <ProblemNotice problem={query.data.problem} />
      ) : (
        <DataTable
          data={items}
          columns={columns}
          rowId={(row) => row.id}
          emptyText={showStopped ? "No instances." : "Nothing is running."}
          minWidth={900}
          {...view}
        />
      )}
    </Stack>
  );
}

/** How long the instance has run, or ran. */
function runFor(row: TroubleshootingContainer, now: number): number | null {
  if (row.startedAt === null) return null;
  const end = row.running ? now : (row.lastActivityAt ?? now);
  return Math.max(0, end - row.startedAt);
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Group, Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import type { TroubleshootingDatabase } from "@shared/contract/arch/troubleshooting";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { formatBytes, formatWhen } from "../format";
import { useTableView } from "../urlState";
import { DataTable } from "./DataTable";
import { usePending } from "./pending";
import { ProblemNotice } from "./ProblemNotice";
import { RefreshButton } from "./RefreshButton";
import { TableLoading } from "./TableLoading";

const column = createColumnHelper<TroubleshootingDatabase>();

/** Yellow past half, red past four fifths of what a database may hold. */
function sizeColor(used: number, max: number): string | undefined {
  const share = max > 0 ? used / max : 0;
  if (share > 0.8) return "red";
  if (share > 0.5) return "yellow";
  return undefined;
}

/** The production database and every Preview's; Previews can be removed. */
export function DatabasesTab() {
  const queryClient = useQueryClient();
  const view = useTableView([{ id: "name", desc: false }]);
  const [listed, setListed] = useState<TroubleshootingDatabase[]>([]);
  const stillPending = useCallback(
    (id: string) => listed.some((item) => item.id === id),
    [listed],
  );
  const pending = usePending(stillPending, listed);
  const query = useQuery(
    orpc.troubleshooting.databases.list.queryOptions({
      refetchInterval: pending.any ? 3_000 : false,
    }),
  );
  useEffect(() => {
    if (query.data) setListed(query.data.items);
  }, [query.data]);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.troubleshooting.databases.list.key(),
    });
  const remove = useMutation(
    orpc.troubleshooting.databases.remove.mutationOptions({
      onSuccess: () => {
        notifications.show({ message: "Database removed" });
        void refresh();
      },
      onError: (err) => notifyError(err, "Could not remove the database"),
    }),
  );

  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: "Database",
        cell: ({ row }) => (
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={500} style={{ whiteSpace: "nowrap" }}>
              {row.original.name}
            </Text>
            <Badge
              size="xs"
              variant="light"
              color={row.original.kind === "production" ? "sage" : "gray"}
              style={{ flexShrink: 0 }}
            >
              {row.original.kind}
            </Badge>
            {row.original.branchName && (
              <Text size="xs" c="dimmed">
                branch {row.original.branchName}
              </Text>
            )}
          </Group>
        ),
      }),
      column.accessor("sizeBytes", {
        header: "Size",
        cell: ({ row }) => (
          <Text size="sm" c={sizeColor(row.original.sizeBytes, row.original.maxBytes)}>
            {formatBytes(row.original.sizeBytes)} / {formatBytes(row.original.maxBytes)}
          </Text>
        ),
      }),
      column.accessor("tables", {
        header: "Tables",
        cell: ({ getValue }) => getValue() ?? "–",
        size: 90,
      }),
      column.accessor("createdAt", {
        header: "Created",
        cell: ({ getValue }) => {
          const at = getValue();
          return at ? formatWhen(at) : "–";
        },
      }),
      column.display({
        id: "actions",
        header: "",
        size: 120,
        cell: ({ row }) =>
          pending.has(row.original.id) ? (
            <Group gap={6} wrap="nowrap">
              <Loader size={12} />
              <Text size="xs" c="dimmed">
                removing
              </Text>
            </Group>
          ) : row.original.kind === "preview" ? (
            <ConfirmButton
              size="xs"
              variant="subtle"
              color="red"
              message={`Remove the database ${row.original.name}? Its Preview loses its data.`}
              confirmLabel="Remove"
              onConfirm={() => {
                pending.mark(row.original.id);
                return remove.mutateAsync({ id: row.original.id });
              }}
            >
              Delete
            </ConfirmButton>
          ) : null,
      }),
    ],
    [pending, remove],
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
      <Group justify="flex-end">
        <RefreshButton
          label="Refresh databases"
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
          emptyText="No databases."
          {...view}
        />
      )}
    </Stack>
  );
}

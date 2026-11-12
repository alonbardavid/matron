import { useMemo } from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import type { TroubleshootingBranch } from "@shared/contract/arch/troubleshooting";
import { BRANCH_PARAM } from "@frontend/api/branch";
import { orpc } from "@frontend/api/orpc";
import { BranchStatusBadge } from "@frontend/branches/widgets/BranchStatusBadge";
import { useBuildChat } from "@frontend/build/BuildChatContext";
import { formatAgo, formatWhen } from "../format";
import { useFilterParam, useTableView } from "../urlState";
import { DataTable } from "./DataTable";
import {
  CheckUpdatesButton,
  UpstreamUpdatesResult,
  useUpstreamUpdates,
} from "@frontend/upstream/widgets/UpstreamUpdates";
import { ProblemNotice } from "./ProblemNotice";
import { RefreshButton } from "./RefreshButton";
import { TableLoading } from "./TableLoading";

const column = createColumnHelper<TroubleshootingBranch>();

/** Every branch with who made it; and whether upstream has something new to merge. */
export function BranchesTab() {
  const queryClient = useQueryClient();
  const buildChat = useBuildChat();
  const [archived, setArchived] = useFilterParam("archived", "0");
  const showArchived = archived === "1";
  const view = useTableView([{ id: "createdAt", desc: true }]);
  const query = useQuery(orpc.troubleshooting.branches.list.queryOptions());
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.troubleshooting.branches.list.key(),
    });

  const now = Date.now();
  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: "Branch",
        size: 320,
        cell: ({ row }) => (
          <Stack gap={0}>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" fw={500} style={{ whiteSpace: "nowrap" }}>
                {row.original.name}
              </Text>
              {row.original.type === "upstream-pull" && (
                <Badge size="xs" variant="light" color="blue" style={{ flexShrink: 0 }}>
                  upstream update
                </Badge>
              )}
            </Group>
            {row.original.sessionTitle && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {row.original.sessionTitle}
              </Text>
            )}
          </Stack>
        ),
      }),
      column.accessor("userName", { header: "Created by" }),
      column.accessor("status", {
        header: "Status",
        cell: ({ row }) => (
          <Group gap={4} wrap="nowrap">
            <BranchStatusBadge branch={row.original} />
            {row.original.behindMain && (
              <Badge size="xs" variant="light" color="yellow">
                behind main
              </Badge>
            )}
          </Group>
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
      column.accessor("updatedAt", {
        header: "Last change",
        cell: ({ row }) => {
          const { revertedAt, archivedAt, updatedAt } = row.original;
          const at = revertedAt ?? archivedAt ?? updatedAt;
          return (
            <Tooltip label={formatWhen(at)}>
              <Text size="sm">
                {revertedAt !== null
                  ? "reverted "
                  : archivedAt !== null
                    ? "archived "
                    : ""}
                {formatAgo(at, now)}
              </Text>
            </Tooltip>
          );
        },
      }),
      column.display({
        id: "actions",
        header: "",
        size: 170,
        cell: ({ row }) => (
          <Group gap="xs" wrap="nowrap" justify="flex-end">
            {row.original.archivedAt === null && row.original.status === "ready" && (
              <Anchor
                size="xs"
                href={`/?${BRANCH_PARAM}=${encodeURIComponent(row.original.id)}`}
              >
                Open
              </Anchor>
            )}
            {row.original.sessionViewable ? (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => buildChat.open(row.original.buildSessionId)}
              >
                Session
              </Button>
            ) : (
              <Text size="xs" c="dimmed">
                session cleared
              </Text>
            )}
          </Group>
        ),
      }),
    ],
    [now, buildChat],
  );

  const items = (query.data?.items ?? []).filter(
    (item) => showArchived || item.archivedAt === null,
  );
  const live = (query.data?.items ?? []).filter(
    (item) => item.archivedAt === null,
  ).length;

  const upstream = useUpstreamUpdates({ onStarted: () => void refresh() });

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap">
          <Switch
            label="Show archived"
            checked={showArchived}
            onChange={(event) => setArchived(event.currentTarget.checked ? "1" : "0")}
          />
          {query.data && (
            <Text size="sm" c="dimmed">
              {live} open
            </Text>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <CheckUpdatesButton upstream={upstream} />
          <RefreshButton
            label="Refresh branches"
            fetching={query.isFetching}
            onClick={() => void refresh()}
          />
        </Group>
      </Group>
      <UpstreamUpdatesResult upstream={upstream} />
      {query.isPending ? (
        <TableLoading />
      ) : query.isError ? (
        <ProblemNotice
          problem={{ kind: "error", message: query.error.message, permission: null }}
        />
      ) : query.data.problem ? (
        <ProblemNotice problem={query.data.problem} />
      ) : (
        <DataTable
          data={items}
          columns={columns}
          rowId={(row) => row.id}
          emptyText={showArchived ? "No branches yet." : "No open branches."}
          minWidth={900}
          {...view}
        />
      )}
    </Stack>
  );
}

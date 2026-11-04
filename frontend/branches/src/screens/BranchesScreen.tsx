import { useState } from "react";
import { Group, Loader, Stack, Switch, Table } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Card } from "@frontend/ds/Card";
import { EmptyState } from "@frontend/ds/EmptyState";
import { Page } from "@frontend/ds/Page";
import type { OnOutOfDate } from "../useBranchActions";
import { useBranches } from "../useBranches";
import { BranchCard, BranchRow } from "../widgets/BranchRow";

interface BranchesScreenProps {
  onOutOfDate?: OnOutOfDate;
  onViewSession?: (sessionId: string) => void;
}

export function BranchesScreen({ onOutOfDate, onViewSession }: BranchesScreenProps) {
  const { query, branches, archived, current } = useBranches();
  const [showArchived, setShowArchived] = useState(false);
  const rows = showArchived ? archived : branches;
  // A phone gets a card per branch; the table needs the width.
  const narrow = useMediaQuery("(max-width: 48em)");

  return (
    <Page
      size="md"
      title="Branches"
      description="Every change built from a chat lives on its own branch until it is merged into main."
      action={
        archived.length > 0 ? (
          <Switch
            size="sm"
            label={`Show archived (${archived.length})`}
            checked={showArchived}
            onChange={(event) => setShowArchived(event.currentTarget.checked)}
          />
        ) : undefined
      }
    >
      {narrow && !query.isLoading && !query.isError && rows.length > 0 ? (
        <Stack gap="sm">
          {rows.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              current={current}
              onOutOfDate={onOutOfDate}
              onViewSession={onViewSession}
            />
          ))}
        </Stack>
      ) : (
        <Card p={0}>
          {query.isLoading ? (
            <Group justify="center" p="xl">
              <Loader size="sm" />
            </Group>
          ) : query.isError ? (
            <EmptyState
              title="Could not load branches"
              description={query.error.message}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No open branches"
              description="Ask for a change with the Build button; the builder deploys it to a branch you can try here."
            />
          ) : (
            // Wider than a phone: the table scrolls inside its card rather than the page.
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Branch</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((branch) => (
                    <BranchRow
                      key={branch.id}
                      branch={branch}
                      current={current}
                      onOutOfDate={onOutOfDate}
                      onViewSession={onViewSession}
                    />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}
    </Page>
  );
}

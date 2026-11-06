import {
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Branch } from "@shared/contract/arch/branches";
import type { BranchReview, ReviewMessage } from "@shared/contract/arch/review";
import { withBranch } from "@frontend/api/branch";
import { errorMessage } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconMessages } from "@frontend/ds/icons";
import { reviewModel } from "../model";
import { useViewed } from "../viewed";
import { AskPanel } from "../widgets/AskPanel";
import { BracketsTab } from "../widgets/BracketsTab";
import { FilesTab } from "../widgets/FilesTab";
import { OverviewTab } from "../widgets/OverviewTab";

const TABS = ["overview", "brackets", "files"] as const;
type Tab = (typeof TABS)[number];

interface ReviewScreenProps {
  /** What can be done with the branch from here, such as merging it. */
  actions?: (branch: Branch) => ReactNode;
}

/** The owner's read of a branch before merging it. The tab, bracket and file shown are in the URL. */
export function ReviewScreen({ actions }: ReviewScreenProps) {
  const { id = "" } = useParams();
  // The whole branch comes at once; refetched only when it is a minute old.
  const query = useQuery({
    ...orpc.review.get.queryOptions({ input: { id } }),
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (!query.data) {
    return (
      <Container size="sm" py="lg">
        <EmptyState
          title="Could not load the review"
          description={errorMessage(query.error)}
        />
      </Container>
    );
  }
  return <Review key={query.data.headCommit} review={query.data} actions={actions} />;
}

function Review({
  review,
  actions,
}: {
  review: BranchReview;
  actions?: ReviewScreenProps["actions"];
}) {
  const [params, setParams] = useSearchParams();
  const model = useMemo(() => reviewModel(review), [review]);
  const viewed = useViewed(review.branch.id);
  const [askOpen, setAskOpen] = useState(false);
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const tabParam = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as Tab)
    : "overview";
  const show = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: false },
    );
  const latest = review.commits.find((commit) => !commit.merge);

  return (
    <Container size="xl" py="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" gap="sm">
          <Box style={{ minWidth: 0, flex: "1 1 320px" }}>
            <Anchor component={Link} to={withBranch("/branches")} size="sm">
              ← Branches
            </Anchor>
            <Title order={2} mt={4}>
              {latest?.title ?? review.branch.name}
            </Title>
            <Group gap="xs" mt={6}>
              <Badge variant="light" color="sage" tt="none">
                {review.branch.name}
              </Badge>
              <Text size="sm" c="dimmed">
                by {review.branch.userName} · into main · {review.baseCommit.slice(0, 7)}…
                {review.headCommit.slice(0, 7)}
              </Text>
            </Group>
          </Box>
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconMessages />}
              onClick={() => setAskOpen((open) => !open)}
            >
              Ask about the code
            </Button>
            {actions?.(review.branch)}
          </Group>
        </Group>

        <Tabs
          value={tab}
          onChange={(value) => show({ tab: value === "overview" ? null : value })}
          keepMounted={false}
        >
          <Tabs.List mb="md">
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab
              value="brackets"
              rightSection={<Count value={model.brackets.length} />}
            >
              Brackets
            </Tabs.Tab>
            <Tabs.Tab value="files" rightSection={<Count value={model.paths.length} />}>
              Files
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="overview">
            <OverviewTab review={review} model={model} viewed={viewed} />
          </Tabs.Panel>
          <Tabs.Panel value="brackets">
            <BracketsTab
              model={model}
              viewed={viewed}
              selected={Number(params.get("bracket") ?? 1) - 1}
              onSelect={(index) => show({ bracket: String(index + 1) })}
              onOpenFile={(path) => show({ tab: "files", file: path })}
            />
          </Tabs.Panel>
          <Tabs.Panel value="files">
            <FilesTab
              model={model}
              viewed={viewed}
              selected={params.get("file")}
              onSelect={(path) => show({ file: path })}
            />
          </Tabs.Panel>
        </Tabs>
      </Stack>
      <AskPanel
        branchId={review.branch.id}
        opened={askOpen}
        onClose={() => setAskOpen(false)}
        messages={messages}
        onMessages={setMessages}
      />
    </Container>
  );
}

function Count({ value }: { value: number }) {
  return (
    <Badge size="sm" variant="light" color="gray" circle={value < 10}>
      {value}
    </Badge>
  );
}

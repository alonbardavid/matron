import { Accordion, Box, Group, Paper, Stack, Text, Title } from "@mantine/core";
import type { BranchReview } from "@shared/contract/arch/review";
import { Markdown } from "@frontend/ds/Markdown";
import type { ReviewModel } from "../model";
import type { Viewed } from "../viewed";
import { plural, ViewedBar } from "./Progress";

interface OverviewTabProps {
  review: BranchReview;
  model: ReviewModel;
  viewed: Viewed;
}

/** The builder's summary of the branch and, commit by commit, what it was asked and why it did what it did. */
export function OverviewTab({ review, model, viewed }: OverviewTabProps) {
  const done = viewed.count(model.keys);
  const added = [...model.files.values()].reduce((sum, file) => sum + file.added, 0);
  const removed = [...model.files.values()].reduce((sum, file) => sum + file.removed, 0);
  const commits = review.commits.filter((commit) => !commit.merge);
  const merges = review.commits.length - commits.length;

  return (
    <Stack gap="md" maw={880}>
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Title order={4}>Summary</Title>
          {review.summary ? (
            <Markdown text={review.summary} />
          ) : (
            <Text size="sm" c="dimmed">
              The builder left no summary on this branch; it was built before reviews were
              recorded. The commits below still say what was asked.
            </Text>
          )}
          <Group gap="md">
            <Box w={220}>
              <ViewedBar done={done} total={model.keys.length} />
            </Box>
            <Text size="sm" c="dimmed">
              {plural(model.paths.length, "file")} ·{" "}
              <Text span c="green.7" ff="monospace" fz="sm">
                +{added}
              </Text>{" "}
              <Text span c="red.7" ff="monospace" fz="sm">
                −{removed}
              </Text>{" "}
              · {done} of {plural(model.keys.length, "change")} viewed
            </Text>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Stack gap="sm">
          <Title order={4}>How it was built</Title>
          <Text size="sm" c="dimmed">
            {plural(commits.length, "commit")} by the builder, newest first
            {merges > 0 && `; main was taken in ${plural(merges, "time")}`}.
          </Text>
          {commits.length > 0 && (
            <Accordion variant="separated" multiple defaultValue={[commits[0]!.hash]}>
              {commits.map((commit) => (
                <Accordion.Item key={commit.hash} value={commit.hash}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text size="sm" fw={500}>
                        {commit.title}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace" style={{ flexShrink: 0 }}>
                        {commit.hash.slice(0, 7)} ·{" "}
                        {new Date(commit.committedAt).toLocaleString()}
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                        Request
                      </Text>
                      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                        {commit.request || "(not recorded)"}
                      </Text>
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                        Reasoning
                      </Text>
                      {commit.reasoning ? (
                        <Markdown text={commit.reasoning} />
                      ) : (
                        <Text size="sm">(not recorded)</Text>
                      )}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

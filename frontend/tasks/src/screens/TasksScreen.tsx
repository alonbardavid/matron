import { useState } from "react";
import { Button, Divider, Group, Loader, Stack, Switch, Text } from "@mantine/core";
import type { Task } from "@shared/contract/app/tasks";
import { Card } from "@frontend/ds/Card";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconPlus } from "@frontend/ds/icons";
import { Page } from "@frontend/ds/Page";
import { useTaskActions, useTasks } from "../useTasks";
import { TaskModal, type TaskValues } from "../widgets/TaskModal";
import { TaskRow } from "../widgets/TaskRow";

export function TasksScreen() {
  const tasks = useTasks();
  const { create, update, remove } = useTaskActions();
  const [hideCompleted, setHideCompleted] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [opened, setOpened] = useState(false);

  const all = tasks.data ?? [];
  const open = all.filter((task) => task.completedAt === null);
  const completed = all.filter((task) => task.completedAt !== null);

  const save = async (values: TaskValues) => {
    if (editing) await update.mutateAsync({ id: editing.id, ...values });
    else await create.mutateAsync(values);
  };

  const rows = (items: Task[]) => (
    <Stack gap={0}>
      {items.map((task, index) => (
        <div key={task.id}>
          {index > 0 && <Divider />}
          <TaskRow
            task={task}
            onToggle={(completed) => update.mutate({ id: task.id, completed })}
            onOpen={() => {
              setEditing(task);
              setOpened(true);
            }}
          />
        </div>
      ))}
    </Stack>
  );

  return (
    <Page
      title="Tasks"
      description="What needs doing, for you and the household."
      size="md"
      action={
        <Button
          leftSection={<IconPlus />}
          onClick={() => {
            setEditing(null);
            setOpened(true);
          }}
        >
          New task
        </Button>
      }
    >
      <Group justify="flex-end">
        <Switch
          label="Hide completed"
          checked={hideCompleted}
          onChange={(event) => setHideCompleted(event.currentTarget.checked)}
        />
      </Group>
      <Card p={0}>
        {tasks.isLoading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : open.length === 0 ? (
          <EmptyState title="Nothing to do" description="Add a task to get started." />
        ) : (
          rows(open)
        )}
      </Card>
      {!hideCompleted && completed.length > 0 && (
        <Stack gap="xs" component="section" aria-label="Completed">
          <Text size="sm" fw={600} c="dimmed" px="xs">
            Completed
          </Text>
          <Card p={0}>{rows(completed)}</Card>
        </Stack>
      )}
      <TaskModal
        opened={opened}
        onClose={() => setOpened(false)}
        task={editing}
        onSave={save}
        onRemove={
          editing
            ? async () => {
                await remove.mutateAsync({ id: editing.id });
              }
            : undefined
        }
      />
    </Page>
  );
}

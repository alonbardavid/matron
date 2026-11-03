import { Divider, Group, Loader, Stack, Text } from "@mantine/core";
import type { TodoItem } from "@shared/contract/app/todo";
import { Card } from "@frontend/ds/Card";
import { EmptyState } from "@frontend/ds/EmptyState";
import { Page } from "@frontend/ds/Page";
import { useTodos } from "../useTodos";
import { NewTodoInput } from "../widgets/NewTodoInput";
import { TodoRow } from "../widgets/TodoRow";

export function TodoListScreen() {
  const { todos, create, update, remove } = useTodos();
  const items = todos.data ?? [];
  const open = items.filter((todo) => todo.status === "unchecked");
  const done = items.filter((todo) => todo.status === "checked");

  const toggle = (todo: TodoItem) =>
    update.mutate({
      id: todo.id,
      status: todo.status === "checked" ? "unchecked" : "checked",
    });
  const rename = (todo: TodoItem, text: string) =>
    update.mutateAsync({ id: todo.id, text });
  const del = (todo: TodoItem) => remove.mutate({ id: todo.id });

  const renderRows = (list: TodoItem[]) =>
    list.map((todo) => (
      <TodoRow
        key={todo.id}
        todo={todo}
        onToggle={toggle}
        onRename={rename}
        onDelete={del}
      />
    ));

  return (
    <Page title="To do" description="Shared by everyone in the household.">
      <NewTodoInput
        onAdd={(text) => create.mutateAsync({ text })}
        busy={create.isPending}
      />
      <Card>
        {todos.isLoading ? (
          <Group justify="center" p="lg">
            <Loader size="sm" />
          </Group>
        ) : todos.isError ? (
          <EmptyState title="Could not load the list" description={todos.error.message} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing to do"
            description="Add the first item above. Everyone in the household sees the same list."
          />
        ) : (
          <Stack gap={0}>
            {renderRows(open)}
            {done.length > 0 && (
              <>
                {open.length > 0 && <Divider my="xs" />}
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} mt={4} mb={2}>
                  Done
                </Text>
                {renderRows(done)}
              </>
            )}
          </Stack>
        )}
      </Card>
    </Page>
  );
}

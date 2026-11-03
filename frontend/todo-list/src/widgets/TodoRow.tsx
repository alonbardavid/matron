import { useEffect, useState } from "react";
import { ActionIcon, Checkbox, Group, Text, TextInput } from "@mantine/core";
import type { TodoItem } from "@shared/contract/app/todo";
import { IconPencil, IconTrash } from "@frontend/ds/icons";

interface TodoRowProps {
  todo: TodoItem;
  onToggle: (todo: TodoItem) => void;
  onRename: (todo: TodoItem, text: string) => Promise<unknown>;
  onDelete: (todo: TodoItem) => void;
}

export function TodoRow({ todo, onToggle, onRename, onDelete }: TodoRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  // Flips at once on click; the server's answer re-syncs it.
  const [checked, setChecked] = useState(todo.status === "checked");
  useEffect(() => setChecked(todo.status === "checked"), [todo.status]);

  const startEditing = () => {
    setDraft(todo.text);
    setEditing(true);
  };

  const commit = async () => {
    const text = draft.trim();
    setEditing(false);
    if (!text || text === todo.text) return;
    await onRename(todo, text);
  };

  return (
    <Group gap="sm" wrap="nowrap" py={6}>
      <Checkbox
        checked={checked}
        onChange={() => {
          setChecked(!checked);
          onToggle(todo);
        }}
        aria-label={todo.text}
        color="sage"
      />
      {editing ? (
        <TextInput
          size="sm"
          flex={1}
          autoFocus
          aria-label={`Edit ${todo.text}`}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit();
            if (event.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <Text
          flex={1}
          td={checked ? "line-through" : undefined}
          c={checked ? "dimmed" : undefined}
          onDoubleClick={startEditing}
          style={{ wordBreak: "break-word" }}
        >
          {todo.text}
        </Text>
      )}
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={`Edit ${todo.text}`}
        onClick={startEditing}
      >
        <IconPencil />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Delete ${todo.text}`}
        onClick={() => onDelete(todo)}
      >
        <IconTrash />
      </ActionIcon>
    </Group>
  );
}

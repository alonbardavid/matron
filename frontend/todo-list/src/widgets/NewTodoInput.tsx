import { useState } from "react";
import { TextInput } from "@mantine/core";
import { IconPlus } from "@frontend/ds/icons";

interface NewTodoInputProps {
  onAdd: (text: string) => Promise<unknown>;
  busy: boolean;
}

export function NewTodoInput({ onAdd, busy }: NewTodoInputProps) {
  const [text, setText] = useState("");

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    await onAdd(trimmed);
    setText("");
  };

  return (
    <TextInput
      size="md"
      placeholder="Add a todo"
      leftSection={<IconPlus />}
      value={text}
      disabled={busy}
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      }}
    />
  );
}

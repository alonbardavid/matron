import { useState } from "react";
import { ColorSwatch, Group, MultiSelect, Text } from "@mantine/core";
import { CALENDAR_COLORS } from "@shared/contract/app/calendar";
import { useLabelActions, useLabels } from "../useCalendar";

/** The option that makes a label of what was typed. */
const NEW = "__new_label__";

interface LabelPickerProps {
  value: string[];
  onChange: (labelIds: string[]) => void;
  disabled?: boolean;
}

/** The household's labels as a multi-select; typing a new name offers to make it. */
export function LabelPicker({ value, onChange, disabled }: LabelPickerProps) {
  const labels = useLabels();
  const { create } = useLabelActions();
  const [search, setSearch] = useState("");
  const list = labels.data ?? [];
  const typed = search.trim();
  const exists = list.some((label) => label.name.toLowerCase() === typed.toLowerCase());
  const data = [
    ...list.map((label) => ({ value: label.id, label: label.name })),
    ...(typed && !exists ? [{ value: NEW, label: `Create “${typed}”` }] : []),
  ];
  const colorOf = (id: string) => list.find((label) => label.id === id)?.color;

  const change = async (ids: string[]) => {
    if (!ids.includes(NEW)) {
      onChange(ids);
      return;
    }
    const made = await create.mutateAsync({
      name: typed,
      color: CALENDAR_COLORS[list.length % CALENDAR_COLORS.length] ?? CALENDAR_COLORS[0],
    });
    setSearch("");
    onChange([...ids.filter((id) => id !== NEW), made.id]);
  };

  return (
    <MultiSelect
      label="Labels"
      placeholder={value.length ? undefined : "No labels"}
      data={data}
      value={value.filter((id) => list.some((label) => label.id === id))}
      onChange={(ids) => void change(ids)}
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      clearable
      disabled={disabled}
      nothingFoundMessage="Type a name to make a label"
      renderOption={({ option }) =>
        option.value === NEW ? (
          <Text size="sm" c="dimmed">
            {option.label}
          </Text>
        ) : (
          <Group gap="xs" wrap="nowrap">
            <ColorSwatch color={colorOf(option.value) ?? "gray"} size={12} />
            <Text size="sm">{option.label}</Text>
          </Group>
        )
      }
    />
  );
}

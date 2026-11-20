import { useEffect, useState } from "react";
import { Button, Group, Modal, Text, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import type { ListItem } from "@shared/contract/app/lists";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { Form } from "@frontend/ds/forms/Form";
import { ItemAlarm } from "./ItemAlarm";

export interface ItemValues {
  title: string;
  description: string;
  dueDate: string | null;
  assignees: string[];
}

interface ItemModalProps {
  opened: boolean;
  onClose: () => void;
  /** The item being changed, or null for a new one. */
  item: ListItem | null;
  /** For a new item under another: that item's title. */
  under?: string | null;
  /** Who sees the list, and so may be assigned. */
  people: string[];
  /** Whether the caller may change the list's items. */
  editable: boolean;
  /** Makes the change; it shows at once, so the dialog closes. */
  onSave: (values: ItemValues) => void;
  onRemove?: () => void;
}

const EMPTY: ItemValues = { title: "", description: "", dueDate: null, assignees: [] };

function valuesOf(item: ListItem | null): ItemValues {
  return item
    ? {
        title: item.title,
        description: item.description,
        dueDate: item.dueDate,
        assignees: item.assignees,
      }
    : EMPTY;
}

/**
 * A new or existing item: title, notes, due day and who it is assigned to. A
 * saved item with a due day also offers the caller's own reminder, set at
 * once and not with the form; it is theirs even on a list they only view.
 */
export function ItemModal({
  opened,
  onClose,
  item,
  under,
  people,
  editable,
  onSave,
  onRemove,
}: ItemModalProps) {
  const [values, setValues] = useState<ItemValues>(valuesOf(item));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (opened) {
      setValues(valuesOf(item));
      setError(null);
    }
  }, [opened, item]);

  const set = <K extends keyof ItemValues>(key: K, value: ItemValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const save = () => {
    if (!editable) return onClose();
    if (!values.title.trim()) {
      setError("Give the item a title");
      return;
    }
    onSave({ ...values, title: values.title.trim() });
    onClose();
  };

  const title = item
    ? editable
      ? "Edit item"
      : "Item"
    : under
      ? "New subitem"
      : "New item";
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Form onSubmit={save}>
        {under && !item && (
          <Text size="sm" c="dimmed">
            Under “{under}”
          </Text>
        )}
        <TextInput
          label="Title"
          value={values.title}
          onChange={(e) => set("title", e.currentTarget.value)}
          error={error && !values.title.trim() ? error : undefined}
          readOnly={!editable}
          data-autofocus
        />
        <Textarea
          label="Notes"
          autosize
          minRows={2}
          value={values.description}
          onChange={(e) => set("description", e.currentTarget.value)}
          readOnly={!editable}
        />
        <DateInput
          label="Due date"
          placeholder="No due date"
          clearable
          valueFormat="ddd D MMM YYYY"
          value={values.dueDate}
          onChange={(value) => set("dueDate", value)}
          readOnly={!editable}
        />
        {item?.dueDate && item.completedAt === null && <ItemAlarm itemId={item.id} />}
        <PeoplePicker
          label="Assigned to"
          placeholder="No one in particular"
          value={values.assignees}
          onChange={(ids) => set("assignees", ids)}
          only={people}
          disabled={!editable}
        />
        <Group justify="space-between" mt="xs">
          {item && onRemove && editable ? (
            <ConfirmButton
              variant="subtle"
              color="red"
              message="Remove this item and everything under it?"
              confirmLabel="Remove"
              onConfirm={() => {
                onRemove();
                onClose();
              }}
            >
              Remove
            </ConfirmButton>
          ) : (
            <span />
          )}
          <Button type="submit">
            {!editable ? "Close" : item ? "Save" : "Add item"}
          </Button>
        </Group>
      </Form>
    </Modal>
  );
}

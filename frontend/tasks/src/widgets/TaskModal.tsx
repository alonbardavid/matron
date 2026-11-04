import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import type { Task, TaskCreate } from "@shared/contract/app/tasks";
import { useMe } from "@frontend/auth/useMe";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";

export interface TaskValues {
  title: string;
  description: string;
  dueDate: string | null;
  sharedWith: string[];
  assignees: string[];
}

interface TaskModalProps {
  opened: boolean;
  onClose: () => void;
  /** The task being edited, or null for a new one. */
  task: Task | null;
  onSave: (values: TaskValues) => Promise<void>;
  onRemove?: () => Promise<void>;
}

const EMPTY: TaskValues = {
  title: "",
  description: "",
  dueDate: null,
  sharedWith: [],
  assignees: [],
};

function valuesOf(task: Task | null): TaskValues {
  return task
    ? {
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        sharedWith: task.sharedWith,
        assignees: task.assignees,
      }
    : EMPTY;
}

/** New or existing task: title, notes, due day, who it is shared with and assigned to. */
export function TaskModal({ opened, onClose, task, onSave, onRemove }: TaskModalProps) {
  const { me } = useMe();
  const [values, setValues] = useState<TaskValues>(valuesOf(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (opened) {
      setValues(valuesOf(task));
      setError(null);
    }
  }, [opened, task]);

  const creatorId = task?.creatorId ?? me?.id ?? "";
  const mine = !task || task.creatorId === me?.id || me?.role === "owner";
  const set = <K extends keyof TaskValues>(key: K, value: TaskValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!values.title.trim()) {
      setError("Give the task a title");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...values,
        title: values.title.trim(),
        // Only people the task is shared with (or its creator) can be assigned.
        assignees: values.assignees.filter(
          (id) => id === creatorId || values.sharedWith.includes(id),
        ),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      centered
    >
      <Stack gap="sm">
        <TextInput
          label="Title"
          value={values.title}
          onChange={(e) => set("title", e.currentTarget.value)}
          error={error && !values.title.trim() ? error : undefined}
          data-autofocus
        />
        <Textarea
          label="Description"
          autosize
          minRows={2}
          value={values.description}
          onChange={(e) => set("description", e.currentTarget.value)}
        />
        <DateInput
          label="Due date"
          placeholder="No due date"
          clearable
          valueFormat="ddd D MMM YYYY"
          value={values.dueDate}
          onChange={(value) => set("dueDate", value)}
        />
        <PeoplePicker
          label="Shared with"
          placeholder="Only you"
          value={values.sharedWith}
          onChange={(ids) => set("sharedWith", ids)}
          exclude={[creatorId]}
          disabled={!mine}
        />
        <PeoplePicker
          label="Assigned to"
          placeholder="No one in particular"
          value={values.assignees}
          onChange={(ids) => set("assignees", ids)}
          only={[creatorId, ...values.sharedWith]}
        />
        {error && values.title.trim() && (
          <Group c="red" fz="sm">
            {error}
          </Group>
        )}
        <Group justify="space-between" mt="xs">
          {task && onRemove && mine ? (
            <ConfirmButton
              variant="subtle"
              color="red"
              message="Remove this task?"
              confirmLabel="Remove"
              onConfirm={async () => {
                await onRemove();
                onClose();
              }}
            >
              Remove
            </ConfirmButton>
          ) : (
            <span />
          )}
          <Button loading={saving} onClick={() => void save()}>
            {task ? "Save" : "Add task"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export type { TaskCreate };

import { Badge, Checkbox, Group, Text, UnstyledButton } from "@mantine/core";
import type { Task } from "@shared/contract/app/tasks";
import { PeopleAvatars } from "@frontend/auth/widgets/PeopleAvatars";
import { describeDay, isPast } from "../dates";

interface TaskRowProps {
  task: Task;
  onToggle: (completed: boolean) => void;
  onOpen: () => void;
}

export function TaskRow({ task, onToggle, onOpen }: TaskRowProps) {
  const done = task.completedAt !== null;
  const overdue = !done && task.dueDate !== null && isPast(task.dueDate);
  return (
    <Group gap="sm" wrap="nowrap" py={8} px="md" data-task-row>
      <Checkbox
        checked={done}
        onChange={(e) => onToggle(e.currentTarget.checked)}
        aria-label={task.title}
        radius="xl"
      />
      <UnstyledButton onClick={onOpen} style={{ flex: 1, minWidth: 0 }}>
        <Text
          size="sm"
          truncate
          c={done ? "dimmed" : undefined}
          td={done ? "line-through" : undefined}
        >
          {task.title}
        </Text>
        {task.description && (
          <Text size="xs" c="dimmed" truncate>
            {task.description}
          </Text>
        )}
      </UnstyledButton>
      {task.dueDate && (
        <Badge size="sm" variant="light" color={overdue ? "red" : done ? "gray" : "rose"}>
          {describeDay(task.dueDate)}
        </Badge>
      )}
      <PeopleAvatars ids={task.assignees} max={3} />
    </Group>
  );
}

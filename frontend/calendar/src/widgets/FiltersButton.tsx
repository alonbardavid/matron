import { useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  ColorSwatch,
  Divider,
  Group,
  Indicator,
  Popover,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import type { Calendar } from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { IconFilter } from "@frontend/ds/icons";
import { filtering, type CalendarFilters } from "../filters";

interface FiltersButtonProps {
  filters: CalendarFilters;
  onChange: (changes: Partial<CalendarFilters>) => void;
  onReset: () => void;
  calendars: Calendar[];
  /** A phone's toolbar has room for an icon only. */
  compact?: boolean;
}

/** What the calendar shows on this device: which calendars, tasks and hidden events. */
export function FiltersButton({
  filters,
  onChange,
  onReset,
  calendars,
  compact = false,
}: FiltersButtonProps) {
  const [opened, setOpened] = useState(false);
  const { nameOf } = useHouseholdMembers();
  const active = filtering(filters);
  const toggleCalendar = (id: string, shown: boolean) =>
    onChange({
      hiddenCalendars: shown
        ? filters.hiddenCalendars.filter((hidden) => hidden !== id)
        : [...filters.hiddenCalendars, id],
    });
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      width={300}
    >
      <Popover.Target>
        <Indicator disabled={!active} size={9} offset={4} withBorder>
          {compact ? (
            <ActionIcon
              size={36}
              variant="default"
              aria-label="Filters"
              onClick={() => setOpened((open) => !open)}
            >
              <IconFilter size={18} />
            </ActionIcon>
          ) : (
            <Button
              variant="default"
              leftSection={<IconFilter size={16} />}
              onClick={() => setOpened((open) => !open)}
            >
              Filters
            </Button>
          )}
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm" role="group" aria-label="Calendar filters">
          <Text size="xs" c="dimmed">
            Kept on this device only.
          </Text>
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Calendars
            </Text>
            {calendars.map((calendar) => (
              <Checkbox
                key={calendar.id}
                checked={!filters.hiddenCalendars.includes(calendar.id)}
                onChange={(e) => toggleCalendar(calendar.id, e.currentTarget.checked)}
                color={calendar.color}
                label={
                  <Group gap={6} wrap="nowrap">
                    <ColorSwatch color={calendar.color} size={10} />
                    <Text size="sm" truncate>
                      {calendar.name}
                      {calendar.access === "viewer" && (
                        <Text span size="sm" c="dimmed">
                          {" "}
                          · {nameOf(calendar.ownerId)}
                        </Text>
                      )}
                    </Text>
                  </Group>
                }
              />
            ))}
          </Stack>
          <Divider />
          <Switch
            label="Tasks with a due date"
            checked={filters.showTasks}
            onChange={(e) => onChange({ showTasks: e.currentTarget.checked })}
          />
          <Switch
            label="Hidden events"
            description="Faded; open one to unhide it."
            checked={filters.showHidden}
            onChange={(e) => onChange({ showHidden: e.currentTarget.checked })}
          />
          {active && (
            <Button size="compact-sm" variant="subtle" w="fit-content" onClick={onReset}>
              Reset filters
            </Button>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

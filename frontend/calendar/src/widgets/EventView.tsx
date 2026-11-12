import type { ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  ColorSwatch,
  Group,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import dayjs from "dayjs";
import type { Calendar, CalendarEvent } from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { UserAvatar } from "@frontend/auth/widgets/UserAvatar";
import {
  IconCalendar,
  IconEyeOff,
  IconNotes,
  IconPencil,
  IconRepeat,
  IconTag,
  IconUsers,
  IconX,
} from "@frontend/ds/icons";
import { describeRule } from "../rrule";
import { useLabels } from "../useCalendar";
import { labelsOf } from "./LabelBars";

interface EventViewProps {
  event: CalendarEvent;
  /** What is shown: the opened occurrence's own title, times and description, or the event's. */
  title: string;
  description: string;
  startAt: number;
  endAt: number;
  /** The calendar the event shows in for the caller. */
  calendar?: Calendar;
  /** The caller's own calendars an event shared with them can show in; empty when not theirs to place. */
  placeIn: Calendar[];
  onPlace?: (calendarId: string) => void;
  /** Absent when nothing about the event is the caller's to change. */
  onEdit?: () => void;
  /** Hides the event from the caller's own calendar, or shows it again. */
  onHide?: (hidden: boolean) => void | Promise<void>;
  onClose: () => void;
}

/** When the event is, in words: one day, a span of days, or hours within a day. */
export function describeWhen(allDay: boolean, startAt: number, endAt: number): string {
  const start = dayjs(startAt);
  const end = dayjs(endAt);
  const sameDay = start.isSame(end, "day");
  if (allDay) {
    return sameDay
      ? start.format("dddd, MMMM D")
      : `${start.format("MMM D")} – ${end.format("MMM D, YYYY")}`;
  }
  return sameDay
    ? `${start.format("dddd, MMMM D")} ⋅ ${start.format("HH:mm")} – ${end.format("HH:mm")}`
    : `${start.format("MMM D, HH:mm")} – ${end.format("MMM D, HH:mm")}`;
}

/** One line of the view: an icon in the gutter, the content beside it. */
function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Group gap="md" align="flex-start" wrap="nowrap">
      <Box w={20} pt={2} c="dimmed" style={{ flexShrink: 0, display: "flex" }}>
        {icon}
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

/** An event as it reads: what, when, who and where it comes from. */
export function EventView({
  event,
  title,
  description,
  startAt,
  endAt,
  calendar,
  placeIn,
  onPlace,
  onEdit,
  onHide,
  onClose,
}: EventViewProps) {
  const { nameOf, avatarUrlOf } = useHouseholdMembers();
  const labels = labelsOf(event.labelIds, useLabels().data ?? []);
  const repeats = event.rrule
    ? describeRule(event.rrule)
    : event.repeatsAtSource
      ? "Repeats in Google Calendar"
      : null;
  const alsoSharedWith = event.sharedWith.filter((id) => !event.attendees.includes(id));
  const origin =
    event.access === "read"
      ? "Shared with you, read-only"
      : event.source === "google"
        ? "From Google Calendar"
        : `Created by ${nameOf(event.creatorId)}`;
  return (
    <Stack gap="md">
      <Group justify="flex-end" gap={4}>
        {onHide && !event.hidden && (
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={event.rrule ? "Hide series" : "Hide event"}
            title={
              event.rrule
                ? "Hide every occurrence from your calendar"
                : "Hide from your calendar"
            }
            onClick={() => void onHide(true)}
          >
            <IconEyeOff size={18} />
          </ActionIcon>
        )}
        {onEdit && (
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Edit event"
            onClick={onEdit}
          >
            <IconPencil size={18} />
          </ActionIcon>
        )}
        <ActionIcon variant="subtle" color="gray" aria-label="Close" onClick={onClose}>
          <IconX size={18} />
        </ActionIcon>
      </Group>
      {event.hidden && onHide && (
        <Alert color="gray" variant="light" icon={<IconEyeOff size={18} />} p="xs">
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm">
              Hidden from your calendar
              {event.rrule ? ", every occurrence" : ""}; others still see it.
            </Text>
            <Button size="compact-sm" variant="light" onClick={() => void onHide(false)}>
              Unhide
            </Button>
          </Group>
        </Alert>
      )}
      <Row
        icon={
          <Box
            w={14}
            h={14}
            mt={6}
            bg={calendar?.color ?? "gray"}
            style={{ borderRadius: 4 }}
          />
        }
      >
        <Title order={3} fw={500} style={{ overflowWrap: "anywhere" }}>
          {title}
        </Title>
        <Text size="sm">{describeWhen(event.allDay, startAt, endAt)}</Text>
      </Row>
      {labels.length > 0 && (
        <Row icon={<IconTag size={18} />}>
          <Group gap={6}>
            {labels.map((label) => (
              <Badge
                key={label.id}
                variant="light"
                color={label.color}
                leftSection={
                  <ColorSwatch color={label.color} size={8} withShadow={false} />
                }
                styles={{ root: { textTransform: "none" } }}
              >
                {label.name}
              </Badge>
            ))}
          </Group>
        </Row>
      )}
      {repeats && (
        <Row icon={<IconRepeat size={18} />}>
          <Text size="sm">{repeats}</Text>
        </Row>
      )}
      {description && (
        <Row icon={<IconNotes size={18} />}>
          <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {description}
          </Text>
        </Row>
      )}
      {(event.attendees.length > 0 || alsoSharedWith.length > 0) && (
        <Row icon={<IconUsers size={18} />}>
          <Stack gap={6}>
            {event.attendees.map((id) => (
              <Group key={id} gap="xs" wrap="nowrap">
                <UserAvatar size="sm" name={nameOf(id)} avatarUrl={avatarUrlOf(id)} />
                <Text size="sm">{nameOf(id)}</Text>
              </Group>
            ))}
            {alsoSharedWith.length > 0 && (
              <Text size="sm" c="dimmed">
                Shared with {alsoSharedWith.map(nameOf).join(", ")}
              </Text>
            )}
          </Stack>
        </Row>
      )}
      <Row icon={<IconCalendar size={18} />}>
        <Text size="sm">{calendar?.name ?? "Calendar"}</Text>
        <Text size="xs" c="dimmed">
          {origin}
        </Text>
        {event.externalUrl && (
          <Anchor href={event.externalUrl} target="_blank" size="sm">
            Open in Google Calendar
          </Anchor>
        )}
        {onPlace && placeIn.length > 0 && (
          <Select
            mt="xs"
            label="Show in my calendar"
            data={placeIn.map((c) => ({ value: c.id, label: c.name }))}
            value={placeIn.some((c) => c.id === event.shownIn) ? event.shownIn : null}
            onChange={(value) => value && onPlace(value)}
            allowDeselect={false}
            maw={280}
          />
        )}
      </Row>
    </Stack>
  );
}

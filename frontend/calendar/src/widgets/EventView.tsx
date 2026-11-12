import type { ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  ColorSwatch,
  Divider,
  Group,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import dayjs from "dayjs";
import type {
  Calendar,
  CalendarEvent,
  EventResponse,
} from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { UserAvatar } from "@frontend/auth/widgets/UserAvatar";
import {
  IconCalendar,
  IconEyeOff,
  IconFile,
  IconLink,
  IconMapPin,
  IconPaperclip,
  IconNotes,
  IconPencil,
  IconRepeat,
  IconTag,
  IconUsers,
  IconX,
} from "@frontend/ds/icons";
import { isLink, mapsUrl } from "../places";
import { describeRule } from "../rrule";
import { ExternalGuestsList, ReplyControl, ResponseBadge, summary } from "./GuestReplies";
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
  /** The caller's own answer, when theirs to give: going, maybe or not. */
  reply?: {
    value: EventResponse | null;
    onChange: (response: Exclude<EventResponse, "needs_action">) => void;
  };
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
  reply,
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
      {event.location && (
        <Row icon={<IconMapPin size={18} />}>
          <Text size="sm" style={{ overflowWrap: "anywhere" }}>
            {event.location}
          </Text>
          <Anchor
            href={mapsUrl(event.location)}
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
          >
            {isLink(event.location) ? "Open link" : "Open in Maps"}
          </Anchor>
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
      {event.attachments.length > 0 && (
        <Row icon={<IconPaperclip size={18} />}>
          <Stack gap={4}>
            {event.attachments.map((attachment) => (
              <Group key={attachment.id} gap="xs" wrap="nowrap">
                {attachment.kind === "file" ? (
                  <IconFile size={14} />
                ) : (
                  <IconLink size={14} />
                )}
                <Anchor
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  truncate
                  style={{ minWidth: 0 }}
                >
                  {attachment.title}
                </Anchor>
                {attachment.source === "google" && (
                  <Badge variant="light" color="gray" size="xs">
                    Google
                  </Badge>
                )}
              </Group>
            ))}
          </Stack>
        </Row>
      )}
      {(event.attendees.length > 0 || alsoSharedWith.length > 0) && (
        <Row icon={<IconUsers size={18} />}>
          <Stack gap={6}>
            {event.attendees.length > 0 && (
              <Text size="xs" c="dimmed">
                {summary(
                  event.attendees.map((id) => event.replies[id] ?? "needs_action"),
                )}
              </Text>
            )}
            {event.attendees.map((id) => (
              <Group
                key={id}
                gap="xs"
                wrap="nowrap"
                role="listitem"
                aria-label={nameOf(id)}
              >
                <UserAvatar size="sm" name={nameOf(id)} avatarUrl={avatarUrlOf(id)} />
                <Text size="sm" style={{ flex: 1 }} truncate>
                  {nameOf(id)}
                </Text>
                <ResponseBadge response={event.replies[id] ?? "needs_action"} />
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
      {event.externalGuests.length > 0 && (
        <Row icon={<IconUsers size={18} />}>
          <ExternalGuestsList guests={event.externalGuests} />
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
      {reply && (
        <>
          <Divider />
          <ReplyControl value={reply.value} onChange={reply.onChange} />
        </>
      )}
    </Stack>
  );
}

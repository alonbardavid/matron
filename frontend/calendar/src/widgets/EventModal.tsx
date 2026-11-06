import { useEffect, useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import dayjs from "dayjs";
import type {
  Calendar,
  CalendarEvent,
  OccurrenceUpdate,
} from "@shared/contract/app/calendar";
import { useMe } from "@frontend/auth/useMe";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { describeRule } from "../rrule";
import { allDaySpan, fromDateTimeString, toDateTimeString, toDayString } from "../times";
import { RecurrenceEditor } from "./RecurrenceEditor";

/** What the modal edits; times as Mantine strings in local time. */
export interface EventDraft {
  title: string;
  description: string;
  allDay: boolean;
  /** `YYYY-MM-DD` when all day, `YYYY-MM-DD HH:mm:ss` otherwise. */
  start: string;
  end: string;
  /** The iCalendar RRULE, or null for a single event. */
  rrule: string | null;
  sharedWith: string[];
  attendees: string[];
  /** One of the creator's Matron calendars; null for their default. */
  calendarId: string | null;
}

export interface EventSubmit {
  title: string;
  description: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  rrule: string | null;
  sharedWith: string[];
  attendees: string[];
  calendarId?: string;
}

/** The occurrence of a series that was opened. */
export interface OpenedOccurrence {
  originalStartAt: number;
  startAt: number;
  endAt: number;
  title: string;
}

interface EventModalProps {
  opened: boolean;
  onClose: () => void;
  /** The series being edited, or null for a new event; the draft is built from `initial` meanwhile. */
  event: CalendarEvent | null;
  loading?: boolean;
  /** For a new event: where the user clicked. */
  initial?: { allDay: boolean; startAt: number; endAt: number } | null;
  /** The caller's own calendars, to pick where the event goes. */
  calendars?: Calendar[];
  /** The occurrence of a series that was opened: it alone can be changed or removed. */
  occurrence?: OpenedOccurrence | null;
  onSave: (values: EventSubmit) => Promise<void>;
  onRemove?: () => Promise<void>;
  onStop?: (fromDay: string) => Promise<void>;
  onEditOccurrence?: (
    originalStartAt: number,
    changes: OccurrenceUpdate,
  ) => Promise<void>;
  onCancelOccurrence?: (originalStartAt: number) => Promise<void>;
  /** For an event someone shared with the caller: which of their calendars it shows in. */
  onPlace?: (calendarId: string) => Promise<void>;
}

/** "one": the opened occurrence alone; "all": the whole series. */
type Scope = "one" | "all";

function draftOf(
  event: CalendarEvent | null,
  initial: EventModalProps["initial"],
  occurrence: OpenedOccurrence | null,
): EventDraft {
  const allDay = event?.allDay ?? initial?.allDay ?? false;
  // One occurrence shows its own times and title, its description if changed.
  const own = occurrence
    ? event?.exceptions.find((e) => e.originalStartAt === occurrence.originalStartAt)
    : undefined;
  const startAt = occurrence?.startAt ?? event?.startAt ?? initial?.startAt ?? Date.now();
  const endAt =
    occurrence?.endAt ?? event?.endAt ?? initial?.endAt ?? startAt + 60 * 60_000;
  return {
    title: occurrence?.title ?? event?.title ?? "",
    description: own?.description ?? event?.description ?? "",
    allDay,
    start: allDay ? toDayString(startAt) : toDateTimeString(startAt),
    end: allDay ? toDayString(endAt) : toDateTimeString(endAt),
    rrule: event?.rrule ?? null,
    sharedWith: event?.sharedWith ?? [],
    attendees: event?.attendees ?? [],
    calendarId: event?.calendarId ?? null,
  };
}

/** New or existing event: when, whether it repeats, and who is in on it. */
export function EventModal({
  opened,
  onClose,
  event,
  loading = false,
  initial = null,
  calendars = [],
  occurrence = null,
  onSave,
  onRemove,
  onStop,
  onPlace,
  onEditOccurrence,
  onCancelOccurrence,
}: EventModalProps) {
  const { me } = useMe();
  const [scope, setScope] = useState<Scope>("all");
  const [draft, setDraft] = useState<EventDraft>(() => draftOf(event, initial, null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An occurrence of a series opens on itself; anything else on the whole event.
  const series = Boolean(event?.rrule && occurrence);
  useEffect(() => {
    if (opened && !loading) {
      const start: Scope = event?.rrule && occurrence ? "one" : "all";
      setScope(start);
      setDraft(draftOf(event, initial, start === "one" ? occurrence : null));
      setError(null);
    }
  }, [opened, loading, event, initial, occurrence]);
  const changeScope = (next: Scope) => {
    setScope(next);
    setDraft(draftOf(event, initial, next === "one" ? occurrence : null));
  };
  const one = scope === "one" && series;

  const creatorId = event?.creatorId ?? me?.id ?? "";
  const mine = !event || event.creatorId === me?.id || me?.role === "owner";
  // An event imported from Google changes there; here only who it is shared with.
  const imported = event?.source === "google";
  // Seen only through a calendar shared with the caller: nothing here changes it.
  const readOnly = event?.access === "read";
  // Shared with the caller by someone else: they choose which of their calendars shows it.
  const placing =
    !!event &&
    !readOnly &&
    event.creatorId !== me?.id &&
    event.sharedWith.includes(me?.id ?? "");
  const shownCalendar = event ? calendars.find((c) => c.id === event.shownIn) : undefined;
  const writable = calendars.filter((c) => c.access === "owner" && c.source === "matron");
  const defaultCalendar = writable.find((c) => c.isDefault) ?? writable[0];
  // Moving between calendars is the creator's, among their own Matron calendars.
  const pickCalendar =
    !imported && writable.length > 1 && (!event || event.creatorId === me?.id);
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const toggleAllDay = (allDay: boolean) => {
    setDraft((prev) => {
      const startAt = prev.allDay
        ? dayjs(prev.start).hour(9).valueOf()
        : fromDateTimeString(prev.start);
      const endAt = prev.allDay
        ? dayjs(prev.end).hour(10).valueOf()
        : fromDateTimeString(prev.end);
      return {
        ...prev,
        allDay,
        start: allDay ? toDayString(startAt) : toDateTimeString(startAt),
        end: allDay ? toDayString(endAt) : toDateTimeString(endAt),
      };
    });
  };

  const save = async () => {
    if (!draft.title.trim()) {
      setError("Give the event a title");
      return;
    }
    const span = draft.allDay
      ? allDaySpan(draft.start, draft.end)
      : {
          startAt: fromDateTimeString(draft.start),
          endAt: fromDateTimeString(draft.end),
        };
    if (!(span.endAt > span.startAt)) {
      setError("The event must end after it starts");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (one && occurrence && onEditOccurrence) {
        await onEditOccurrence(occurrence.originalStartAt, {
          title: draft.title.trim(),
          description: draft.description.trim(),
          ...span,
        });
        onClose();
        return;
      }
      await onSave({
        title: draft.title.trim(),
        description: draft.description.trim(),
        allDay: draft.allDay,
        ...span,
        rrule: draft.rrule,
        sharedWith: draft.sharedWith,
        attendees: draft.attendees,
        ...(pickCalendar && draft.calendarId && { calendarId: draft.calendarId }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event");
    } finally {
      setSaving(false);
    }
  };

  const startForRule = draft.allDay
    ? dayjs(draft.start).valueOf()
    : fromDateTimeString(draft.start);
  const editable = !imported && !readOnly;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        readOnly
          ? "Shared calendar event"
          : imported
            ? "Google Calendar event"
            : event
              ? "Edit event"
              : "New event"
      }
      centered
      size="lg"
    >
      {loading ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack gap="sm">
          {event && (imported || readOnly || placing) && (
            <Group gap="xs">
              <Badge
                variant="light"
                color={shownCalendar?.color ?? "gray"}
                styles={{ root: { textTransform: "none" } }}
              >
                {shownCalendar?.name ?? "Calendar"}
              </Badge>
              <Text size="sm" c="dimmed">
                {readOnly
                  ? "From a calendar shared with you, read-only."
                  : imported
                    ? "From Google Calendar: change it there. Here you can share it."
                    : "Shared with you."}
                {imported &&
                  (event.rrule
                    ? ` ${describeRule(event.rrule)}.`
                    : event.repeatsAtSource && " It repeats in Google Calendar.")}
              </Text>
              {event.externalUrl && (
                <Anchor href={event.externalUrl} target="_blank" size="sm">
                  Open in Google Calendar
                </Anchor>
              )}
            </Group>
          )}
          {placing && onPlace && writable.length > 0 && (
            <Select
              label="Show in my calendar"
              data={writable.map((c) => ({ value: c.id, label: c.name }))}
              value={
                writable.some((c) => c.id === event?.shownIn) ? event!.shownIn : null
              }
              onChange={(value) => value && void onPlace(value)}
              allowDeselect={false}
              maw={280}
            />
          )}
          {series && editable && (
            <SegmentedControl
              value={scope}
              onChange={(value) => changeScope(value as Scope)}
              data={[
                { value: "one", label: "This event" },
                { value: "all", label: "All events" },
              ]}
              w="fit-content"
              aria-label="Change"
            />
          )}
          <fieldset
            disabled={imported || readOnly}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <Stack gap="sm">
              <TextInput
                label="Title"
                value={draft.title}
                onChange={(e) => set("title", e.currentTarget.value)}
                data-autofocus
              />
              {pickCalendar && !one && (
                <Select
                  label="Calendar"
                  data={writable.map((c) => ({ value: c.id, label: c.name }))}
                  value={draft.calendarId ?? defaultCalendar?.id ?? null}
                  onChange={(value) => value && set("calendarId", value)}
                  allowDeselect={false}
                  maw={280}
                />
              )}
              {!one && (
                <Switch
                  label="All day"
                  checked={draft.allDay}
                  onChange={(e) => toggleAllDay(e.currentTarget.checked)}
                />
              )}
              <Group grow align="flex-start">
                {draft.allDay ? (
                  <>
                    <DateInput
                      label="From"
                      value={draft.start}
                      onChange={(v) => v && set("start", v)}
                      valueFormat="ddd D MMM YYYY"
                    />
                    <DateInput
                      label="To"
                      value={draft.end}
                      onChange={(v) => v && set("end", v)}
                      valueFormat="ddd D MMM YYYY"
                      minDate={draft.start}
                    />
                  </>
                ) : (
                  <>
                    <DateTimePicker
                      label="Starts"
                      value={draft.start}
                      onChange={(v) => v && set("start", v)}
                      valueFormat="ddd D MMM, HH:mm"
                    />
                    <DateTimePicker
                      label="Ends"
                      value={draft.end}
                      onChange={(v) => v && set("end", v)}
                      valueFormat="ddd D MMM, HH:mm"
                    />
                  </>
                )}
              </Group>
              <Textarea
                label="Description"
                autosize
                minRows={2}
                value={draft.description}
                onChange={(e) => set("description", e.currentTarget.value)}
              />
              {editable && !one && (
                <RecurrenceEditor
                  value={draft.rrule}
                  onChange={(rule) => set("rrule", rule)}
                  startAt={startForRule}
                />
              )}
            </Stack>
          </fieldset>
          <fieldset
            disabled={readOnly}
            hidden={one}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <Stack gap="sm">
              {!readOnly && (
                <PeoplePicker
                  label="Shared with"
                  placeholder="Only you"
                  value={draft.sharedWith}
                  onChange={(ids) =>
                    setDraft((prev) => ({
                      ...prev,
                      sharedWith: ids,
                      // Everyone newly shared with attends by default.
                      attendees: [
                        ...new Set([
                          ...prev.attendees,
                          ...ids.filter((id) => !prev.sharedWith.includes(id)),
                        ]),
                      ],
                    }))
                  }
                  exclude={[creatorId]}
                  disabled={!mine}
                />
              )}
              <PeoplePicker
                label="Attending"
                description="Anyone attending sees the event too."
                placeholder="No one"
                value={draft.attendees}
                onChange={(ids) => set("attendees", ids)}
              />
            </Stack>
          </fieldset>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group justify="space-between" mt="xs">
            <Group gap="xs">
              {one && occurrence && onCancelOccurrence && (
                <ConfirmButton
                  variant="subtle"
                  color="red"
                  message="Remove this one? The others stay."
                  confirmLabel="Remove"
                  onConfirm={async () => {
                    await onCancelOccurrence(occurrence.originalStartAt);
                    onClose();
                  }}
                >
                  Remove this one
                </ConfirmButton>
              )}
              {event && onRemove && mine && editable && !one && (
                <ConfirmButton
                  variant="subtle"
                  color="red"
                  message={
                    event.rrule
                      ? "Remove this event and every repetition?"
                      : "Remove this event?"
                  }
                  confirmLabel="Remove"
                  onConfirm={async () => {
                    await onRemove();
                    onClose();
                  }}
                >
                  Remove
                </ConfirmButton>
              )}
              {event?.rrule && onStop && occurrence && mine && editable && (
                <ConfirmButton
                  variant="subtle"
                  message="Stop repeating from this one on? Earlier ones stay."
                  confirmLabel="Stop repeating"
                  onConfirm={async () => {
                    await onStop(toDayString(occurrence.originalStartAt));
                    onClose();
                  }}
                >
                  Stop repeating
                </ConfirmButton>
              )}
            </Group>
            {readOnly ? (
              <Button variant="default" onClick={onClose}>
                Close
              </Button>
            ) : (
              <Button loading={saving} onClick={() => void save()}>
                {event ? "Save" : "Add event"}
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

import { useEffect, useState } from "react";
import {
  Anchor,
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
import { parseISO, setHours } from "date-fns";
import type {
  Calendar,
  CalendarEvent,
  OccurrenceUpdate,
  LocationMetadata,
  SharePermission,
} from "@shared/contract/app/calendar";
import { useMe } from "@frontend/auth/useMe";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { Form } from "@frontend/ds/forms/Form";
import { allDaySpan, fromDateTimeString, toDateTimeString, toDayString } from "../times";
import { EventView } from "./EventView";
import { isLink, mapsUrl } from "../places";
import { LocationInput } from "./LocationInput";
import { SharePermissions } from "./SharePermissions";
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
  location: string;
  /** What Google gave for the location when it was picked from its suggestions; null when typed. */
  locationMetadata: LocationMetadata | null;
  permissions: Record<string, SharePermission>;
}

export interface EventSubmit {
  title: string;
  description: string;
  location: string;
  locationMetadata: LocationMetadata | null;
  allDay: boolean;
  startAt: number;
  endAt: number;
  rrule: string | null;
  /** Who it is shared with and who attends; absent when that is not the caller's to change. */
  sharedWith?: string[];
  attendees?: string[];
  calendarId?: string;
  /** What each member it is shared with may do; sent only by whoever may share it. */
  permissions?: Record<string, SharePermission>;
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
  /** Hides the event from the caller's own calendar, or shows it again. */
  onHide?: (hidden: boolean) => Promise<void>;
  /** Stops the event someone shared with the caller being theirs. */
  onLeave?: () => Promise<void>;
}

/** An existing event opens as it reads; changing it is a step further. */
type Mode = "view" | "edit";

/** "one": the opened occurrence alone; "all": the whole series. */
type Scope = "one" | "all";

function draftOf(
  event: CalendarEvent | null,
  initial: EventModalProps["initial"],
  occurrence: OpenedOccurrence | null,
  creatorId: string | undefined,
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
    location: own?.location ?? event?.location ?? "",
    locationMetadata:
      own && own.location !== null
        ? own.locationMetadata
        : (event?.locationMetadata ?? null),
    allDay,
    start: allDay ? toDayString(startAt) : toDateTimeString(startAt),
    end: allDay ? toDayString(endAt) : toDateTimeString(endAt),
    rrule: event?.rrule ?? null,
    sharedWith: event?.sharedWith ?? [],
    // Whoever makes an event attends it, unless they take themselves off.
    attendees: event?.attendees ?? (creatorId ? [creatorId] : []),
    calendarId: event?.calendarId ?? null,
    permissions: event?.permissions ?? {},
  };
}

/** An event: read first when it exists, then changed; a new one starts as a form. */
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
  onHide,
  onLeave,
}: EventModalProps) {
  const { me } = useMe();
  const [mode, setMode] = useState<Mode>("edit");
  const [scope, setScope] = useState<Scope>("all");
  const [draft, setDraft] = useState<EventDraft>(() =>
    draftOf(event, initial, null, me?.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An occurrence of a series opens on itself; anything else on the whole event.
  const series = Boolean(event?.rrule && occurrence);
  useEffect(() => {
    if (opened && !loading) {
      const start: Scope = event?.rrule && occurrence ? "one" : "all";
      setScope(start);
      setDraft(draftOf(event, initial, start === "one" ? occurrence : null, me?.id));
      setError(null);
    }
  }, [opened, loading, event, initial, occurrence, me?.id]);
  const eventId = event?.id;
  useEffect(() => {
    if (opened && !loading) setMode(eventId ? "view" : "edit");
  }, [opened, loading, eventId]);
  const changeScope = (next: Scope) => {
    setScope(next);
    setDraft(draftOf(event, initial, next === "one" ? occurrence : null, me?.id));
  };

  const creatorId = event?.creatorId ?? me?.id ?? "";
  // What the caller may do, as the server says: share it (who it is shared
  // with, who attends), and edit its details or remove it too.
  const canShare = !event || event.can.share;
  const canEdit = !event || event.can.edit;
  // An event imported from Google changes there; here only who it is shared with.
  const imported = event?.source === "google";
  // Seen only through a calendar shared with the caller: nothing here changes it.
  const readOnly = event?.access === "read";
  const editable = !imported && !readOnly && canEdit;
  // Sharing is all a Google event has to change here, and all a guest who
  // may share but not edit has.
  const changeable = !readOnly && canShare;
  // One occurrence is changed on its own only in what editing changes.
  const one = scope === "one" && series && editable;
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
        ? setHours(parseISO(prev.start), 9).getTime()
        : fromDateTimeString(prev.start);
      const endAt = prev.allDay
        ? setHours(parseISO(prev.end), 10).getTime()
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
          location: draft.location.trim(),
          locationMetadata: draft.locationMetadata,
          ...span,
        });
        onClose();
        return;
      }
      await onSave({
        title: draft.title.trim(),
        description: draft.description.trim(),
        location: draft.location.trim(),
        locationMetadata: draft.locationMetadata,
        allDay: draft.allDay,
        ...span,
        rrule: draft.rrule,
        // Who it is shared with, who attends and at what level.
        ...(canShare && {
          sharedWith: draft.sharedWith,
          attendees: draft.attendees,
          permissions: draft.permissions,
        }),
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
    ? parseISO(draft.start).getTime()
    : fromDateTimeString(draft.start);
  const viewing = mode === "view" && !!event && !loading;
  const shown = draftOf(event, initial, series ? occurrence : null, me?.id);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        viewing
          ? undefined
          : !event
            ? "New event"
            : editable
              ? "Edit event"
              : "Share event"
      }
      withCloseButton={!viewing}
      centered
      size="lg"
    >
      {loading ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
        </Group>
      ) : viewing && event ? (
        <EventView
          event={event}
          title={shown.title}
          description={shown.description}
          startAt={occurrence?.startAt ?? event.startAt}
          endAt={occurrence?.endAt ?? event.endAt}
          calendar={shownCalendar}
          placeIn={placing ? writable : []}
          onPlace={onPlace && ((calendarId) => void onPlace(calendarId))}
          onEdit={changeable ? () => setMode("edit") : undefined}
          onLeave={
            placing && onLeave
              ? async () => {
                  await onLeave();
                  onClose();
                }
              : undefined
          }
          onHide={
            onHide &&
            (async (hidden) => {
              await onHide(hidden);
              onClose();
            })
          }
          onClose={onClose}
        />
      ) : (
        <Form onSubmit={() => void save()}>
          {event && !editable && (
            <Text size="sm" c="dimmed">
              {draft.title}:{imported && " it changes in Google Calendar."} Here you choose
              who sees it.
            </Text>
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
          {editable && (
            <Stack gap="sm">
              <TextInput
                label="Title"
                value={draft.title}
                onChange={(e) => set("title", e.currentTarget.value)}
                data-autofocus
              />
              <Stack gap={2}>
                <LocationInput
                  value={draft.location}
                  onChange={(location, locationMetadata) =>
                    setDraft((prev) => ({ ...prev, location, locationMetadata }))
                  }
                />
                {draft.location.trim() && (
                  <Anchor
                    href={mapsUrl(draft.location.trim(), draft.locationMetadata)}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="xs"
                    w="fit-content"
                  >
                    {isLink(draft.location) ? "Open link" : "Open in Maps"}
                  </Anchor>
                )}
              </Stack>
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
              {!one && (
                <RecurrenceEditor
                  value={draft.rrule}
                  onChange={(rule) => set("rrule", rule)}
                  startAt={startForRule}
                />
              )}
            </Stack>
          )}
          {!one && canShare && (
            <Stack gap="sm">
              <PeoplePicker
                label="Shared with"
                placeholder={draft.sharedWith.length ? undefined : "Only you"}
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
              />
              <SharePermissions
                people={draft.sharedWith}
                value={draft.permissions}
                upTo={canEdit ? "edit" : "share"}
                onChange={(permissions) => set("permissions", permissions)}
              />
              <PeoplePicker
                label="Attending"
                description="Anyone attending sees the event too."
                placeholder={draft.attendees.length ? undefined : "No one"}
                value={draft.attendees}
                onChange={(ids) => set("attendees", ids)}
              />
            </Stack>
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group justify="space-between" mt="xs">
            <Group gap="xs">
              {one && editable && occurrence && onCancelOccurrence && (
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
              {event && onRemove && editable && !one && (
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
              {event?.rrule && onStop && occurrence && editable && (
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
            <Button type="submit" loading={saving}>
              {event ? "Save" : "Add event"}
            </Button>
          </Group>
        </Form>
      )}
    </Modal>
  );
}

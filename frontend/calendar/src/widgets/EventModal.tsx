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
import dayjs from "dayjs";
import type {
  Calendar,
  CalendarEvent,
  OccurrenceUpdate,
} from "@shared/contract/app/calendar";
import { useMe } from "@frontend/auth/useMe";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { Form } from "@frontend/ds/forms/Form";
import { allDaySpan, fromDateTimeString, toDateTimeString, toDayString } from "../times";
import { EventView } from "./EventView";
import { IconMapPin } from "@frontend/ds/icons";
import { isLink, mapsUrl } from "../places";
import {
  AttachmentsField,
  attachmentProblem,
  type AttachmentItem,
  type LinkDraft,
} from "./AttachmentsField";
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
}

export interface EventSubmit {
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  rrule: string | null;
  /** Who it is shared with and who attends; absent when that is not the caller's to change. */
  sharedWith?: string[];
  attendees?: string[];
  calendarId?: string;
  /** For a new event: files and links to attach once it is saved. */
  pendingFiles: File[];
  pendingLinks: LinkDraft[];
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
  /** For an existing event: attach at once, or remove one attached here. */
  onAttachFiles?: (files: File[]) => Promise<void>;
  onAttachLink?: (link: LinkDraft) => Promise<void>;
  onDetach?: (attachmentId: string) => Promise<void>;
}

/** An existing event opens as it reads; changing it is a step further. */
type Mode = "view" | "edit";

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
    location: own?.location ?? event?.location ?? "",
    allDay,
    start: allDay ? toDayString(startAt) : toDateTimeString(startAt),
    end: allDay ? toDayString(endAt) : toDateTimeString(endAt),
    rrule: event?.rrule ?? null,
    sharedWith: event?.sharedWith ?? [],
    attendees: event?.attendees ?? [],
    calendarId: event?.calendarId ?? null,
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
  onAttachFiles,
  onAttachLink,
  onDetach,
}: EventModalProps) {
  const { me } = useMe();
  const [mode, setMode] = useState<Mode>("edit");
  const [scope, setScope] = useState<Scope>("all");
  const [draft, setDraft] = useState<EventDraft>(() => draftOf(event, initial, null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new event's attachments wait for it to be saved.
  const [pending, setPending] = useState<AttachmentItem[]>([]);
  // An occurrence of a series opens on itself; anything else on the whole event.
  const series = Boolean(event?.rrule && occurrence);
  useEffect(() => {
    if (opened && !loading) {
      const start: Scope = event?.rrule && occurrence ? "one" : "all";
      setScope(start);
      setDraft(draftOf(event, initial, start === "one" ? occurrence : null));
      setError(null);
      setPending([]);
    }
  }, [opened, loading, event, initial, occurrence]);
  const eventId = event?.id;
  useEffect(() => {
    if (opened && !loading) setMode(eventId ? "view" : "edit");
  }, [opened, loading, eventId]);
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
          location: draft.location.trim(),
          ...span,
        });
        onClose();
        return;
      }
      await onSave({
        title: draft.title.trim(),
        description: draft.description.trim(),
        location: draft.location.trim(),
        allDay: draft.allDay,
        ...span,
        rrule: draft.rrule,
        ...(mine && { sharedWith: draft.sharedWith, attendees: draft.attendees }),
        ...(pickCalendar && draft.calendarId && { calendarId: draft.calendarId }),
        pendingFiles: pending.flatMap((item) =>
          item.state === "pending-file" ? [item.file] : [],
        ),
        pendingLinks: pending.flatMap((item) =>
          item.state === "pending-link" ? [item.link] : [],
        ),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event");
    } finally {
      setSaving(false);
    }
  };

  // Attached ones act at once on a saved event; a new one keeps them until it is saved.
  const attachmentItems: AttachmentItem[] = [
    ...(event?.attachments ?? []).map((attachment): AttachmentItem => ({
      state: "attached",
      attachment,
    })),
    ...pending,
  ];
  const addFiles = async (files: File[]) => {
    const problem = files.map(attachmentProblem).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    if (event && onAttachFiles) {
      await onAttachFiles(files).catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not attach the file"),
      );
      return;
    }
    setPending((prev) => [
      ...prev,
      ...files.map((file): AttachmentItem => ({
        state: "pending-file",
        key: crypto.randomUUID(),
        file,
      })),
    ]);
  };
  const addLink = async (link: LinkDraft) => {
    if (event && onAttachLink) {
      await onAttachLink(link).catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not add the link"),
      );
      return;
    }
    setPending((prev) => [
      ...prev,
      { state: "pending-link", key: crypto.randomUUID(), link },
    ]);
  };
  const removeAttachment = async (item: AttachmentItem) => {
    if (item.state === "attached") await onDetach?.(item.attachment.id);
    else setPending((prev) => prev.filter((p) => p !== item));
  };

  const startForRule = draft.allDay
    ? dayjs(draft.start).valueOf()
    : fromDateTimeString(draft.start);
  const editable = !imported && !readOnly;
  // A Google event has only its sharing to change here, and that is its creator's.
  const changeable = !readOnly && (!imported || mine);
  const viewing = mode === "view" && !!event && !loading;
  const shown = draftOf(event, initial, series ? occurrence : null);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        viewing
          ? undefined
          : imported
            ? "Share event"
            : event
              ? "Edit event"
              : "New event"
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
          {imported && (
            <Text size="sm" c="dimmed">
              {draft.title}: it changes in Google Calendar. Here you choose who sees it.
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
                <TextInput
                  label="Location"
                  placeholder="Add a place or a link"
                  leftSection={<IconMapPin size={16} />}
                  value={draft.location}
                  onChange={(e) => set("location", e.currentTarget.value)}
                />
                {draft.location.trim() && (
                  <Anchor
                    href={mapsUrl(draft.location.trim())}
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
          {!one && changeable && (
            <AttachmentsField
              items={attachmentItems}
              canEdit
              onAddFiles={addFiles}
              onAddLink={addLink}
              onRemove={removeAttachment}
            />
          )}
          {!one && mine && (
            <Stack gap="sm">
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
              />
              <PeoplePicker
                label="Attending"
                description="Anyone attending sees the event too."
                placeholder="No one"
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
            <Button type="submit" loading={saving}>
              {event ? "Save" : "Add event"}
            </Button>
          </Group>
        </Form>
      )}
    </Modal>
  );
}

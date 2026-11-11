import { useEffect, useState } from "react";
import {
  Button,
  Chip,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import dayjs from "dayjs";
import type { CalendarEvent, Recurrence } from "@shared/contract/app/calendar";
import { useMe } from "@frontend/auth/useMe";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { Form } from "@frontend/ds/forms/Form";
import { allDaySpan, fromDateTimeString, toDateTimeString, toDayString } from "../times";

/** What the modal edits; times as Mantine strings in local time. */
export interface EventDraft {
  title: string;
  description: string;
  allDay: boolean;
  /** `YYYY-MM-DD` when all day, `YYYY-MM-DD HH:mm:ss` otherwise. */
  start: string;
  end: string;
  repeat: "none" | "weekly" | "monthly";
  days: number[];
  ends: "never" | "on" | "after";
  until: string | null;
  count: number;
  sharedWith: string[];
  attendees: string[];
}

export interface EventSubmit {
  title: string;
  description: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  recurrence: Recurrence | null;
  sharedWith: string[];
  attendees: string[];
}

interface EventModalProps {
  opened: boolean;
  onClose: () => void;
  /** The series being edited, or null for a new event; the draft is built from `initial` meanwhile. */
  event: CalendarEvent | null;
  loading?: boolean;
  /** For a new event: where the user clicked. */
  initial?: { allDay: boolean; startAt: number; endAt: number } | null;
  /** The occurrence that was opened, for "stop repeating from here". */
  occurrenceDay?: string | null;
  onSave: (values: EventSubmit) => Promise<void>;
  onRemove?: () => Promise<void>;
  onStop?: (fromDay: string) => Promise<void>;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function draftOf(
  event: CalendarEvent | null,
  initial: EventModalProps["initial"],
): EventDraft {
  const allDay = event?.allDay ?? initial?.allDay ?? false;
  const startAt = event?.startAt ?? initial?.startAt ?? Date.now();
  const endAt = event?.endAt ?? initial?.endAt ?? startAt + 60 * 60_000;
  const recurrence = event?.recurrence ?? null;
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    allDay,
    start: allDay ? toDayString(startAt) : toDateTimeString(startAt),
    end: allDay ? toDayString(endAt) : toDateTimeString(endAt),
    repeat: recurrence?.frequency ?? "none",
    days: recurrence?.days ?? [dayjs(startAt).day()],
    ends: recurrence?.until ? "on" : recurrence?.count ? "after" : "never",
    until: recurrence?.until ?? null,
    count: recurrence?.count ?? 10,
    sharedWith: event?.sharedWith ?? [],
    attendees: event?.attendees ?? [],
  };
}

/** New or existing event: when, whether it repeats, and who is in on it. */
export function EventModal({
  opened,
  onClose,
  event,
  loading = false,
  initial = null,
  occurrenceDay = null,
  onSave,
  onRemove,
  onStop,
}: EventModalProps) {
  const { me } = useMe();
  const [draft, setDraft] = useState<EventDraft>(() => draftOf(event, initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (opened && !loading) {
      setDraft(draftOf(event, initial));
      setError(null);
    }
  }, [opened, loading, event, initial]);

  const creatorId = event?.creatorId ?? me?.id ?? "";
  const mine = !event || event.creatorId === me?.id || me?.role === "owner";
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
    const recurrence: Recurrence | null =
      draft.repeat === "none"
        ? null
        : {
            frequency: draft.repeat,
            days: draft.days.length ? draft.days : [dayjs(span.startAt).date()],
            until: draft.ends === "on" ? draft.until : null,
            count: draft.ends === "after" ? draft.count : null,
          };
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: draft.title.trim(),
        description: draft.description.trim(),
        allDay: draft.allDay,
        ...span,
        recurrence,
        sharedWith: draft.sharedWith,
        attendees: draft.attendees,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event");
    } finally {
      setSaving(false);
    }
  };

  const dayChips =
    draft.repeat === "weekly"
      ? WEEKDAYS.map((label, index) => ({ value: index, label }))
      : Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      centered
      size="lg"
    >
      {loading ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
        </Group>
      ) : (
        <Form onSubmit={() => void save()}>
          <TextInput
            label="Title"
            value={draft.title}
            onChange={(e) => set("title", e.currentTarget.value)}
            data-autofocus
          />
          <Switch
            label="All day"
            checked={draft.allDay}
            onChange={(e) => toggleAllDay(e.currentTarget.checked)}
          />
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
          <div>
            <Text size="sm" fw={500} mb={4}>
              Repeats
            </Text>
            <SegmentedControl
              value={draft.repeat}
              onChange={(value) => {
                const repeat = value as EventDraft["repeat"];
                setDraft((prev) => ({
                  ...prev,
                  repeat,
                  days:
                    repeat === "weekly"
                      ? [
                          dayjs(
                            prev.allDay ? prev.start : fromDateTimeString(prev.start),
                          ).day(),
                        ]
                      : repeat === "monthly"
                        ? [
                            dayjs(
                              prev.allDay ? prev.start : fromDateTimeString(prev.start),
                            ).date(),
                          ]
                        : prev.days,
                }));
              }}
              data={[
                { value: "none", label: "Never" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
          </div>
          {draft.repeat !== "none" && (
            <>
              <Chip.Group
                multiple
                value={draft.days.map(String)}
                onChange={(values) =>
                  set(
                    "days",
                    values.map(Number).sort((a, b) => a - b),
                  )
                }
              >
                <Group gap={4}>
                  {dayChips.map((chip) => (
                    <Chip
                      key={chip.value}
                      value={String(chip.value)}
                      size="xs"
                      radius="xl"
                    >
                      {chip.label}
                    </Chip>
                  ))}
                </Group>
              </Chip.Group>
              <Group align="flex-end" gap="sm">
                <SegmentedControl
                  value={draft.ends}
                  onChange={(value) => set("ends", value as EventDraft["ends"])}
                  data={[
                    { value: "never", label: "Forever" },
                    { value: "on", label: "Until a day" },
                    { value: "after", label: "A number of times" },
                  ]}
                />
                {draft.ends === "on" && (
                  <DateInput
                    label="Until"
                    value={draft.until}
                    onChange={(v) => set("until", v)}
                    valueFormat="ddd D MMM YYYY"
                  />
                )}
                {draft.ends === "after" && (
                  <NumberInput
                    label="Times"
                    min={1}
                    max={1000}
                    value={draft.count}
                    onChange={(v) => set("count", typeof v === "number" ? v : 1)}
                    w={110}
                  />
                )}
              </Group>
            </>
          )}
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
          <PeoplePicker
            label="Attending"
            description="Anyone attending sees the event too."
            placeholder="No one"
            value={draft.attendees}
            onChange={(ids) => set("attendees", ids)}
          />
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group justify="space-between" mt="xs">
            <Group gap="xs">
              {event && onRemove && mine && (
                <ConfirmButton
                  variant="subtle"
                  color="red"
                  message={
                    event.recurrence
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
              {event?.recurrence && onStop && occurrenceDay && mine && (
                <ConfirmButton
                  variant="subtle"
                  message="Stop repeating from this one on? Earlier ones stay."
                  confirmLabel="Stop repeating"
                  onConfirm={async () => {
                    await onStop(occurrenceDay);
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

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Popover,
  Select,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  MobileMonthView,
  Schedule,
  type ScheduleEventData,
  type WeekViewProps,
} from "@mantine/schedule";
import dayjs from "dayjs";
import type { Label, Occurrence } from "@shared/contract/app/calendar";
import type { Task } from "@shared/contract/app/tasks";
import { IconChevronDown, IconPlus } from "@frontend/ds/icons";
import { useTaskActions, useTasks } from "@frontend/tasks/useTasks";
import { TaskModal } from "@frontend/tasks/widgets/TaskModal";
import { useCalendarFilters } from "../filters";
import {
  allDayBlock,
  allDaySpan,
  fromDateTimeString,
  loadWindow,
  localTimeZone,
  toDayString,
} from "../times";
import {
  useCalendars,
  useEvent,
  useEventActions,
  useLabels,
  useOccurrences,
} from "../useCalendar";
import { FiltersButton } from "../widgets/FiltersButton";
import { InlineLabelBars, LabelledEvent, labelsOf } from "../widgets/LabelBars";
import {
  EventModal,
  type EventSubmit,
  type OpenedOccurrence,
} from "../widgets/EventModal";
import classes from "./CalendarScreen.module.css";

type View = "day" | "week" | "month" | "year";

const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
/** The day view's hour, in the week view's proportion; a shorter one shows more of the day. */
const HOUR_MINUTES = 60;

const QUARTER_MS = 15 * 60_000;

/** The whole quarters of an hour a span touches, and at least one: 7:00 to 7:12 is 7:00 to 7:15. */
function quarterSpan(startAt: number, endAt: number): { start: Date; end: Date } {
  // Quarters are counted from local midnight, whatever the zone's offset.
  const offset = new Date(startAt).getTimezoneOffset() * 60_000;
  const start = Math.floor((startAt - offset) / QUARTER_MS) * QUARTER_MS + offset;
  const end = Math.ceil((endAt - offset) / QUARTER_MS) * QUARTER_MS + offset;
  return { start: new Date(start), end: new Date(Math.max(end, start + QUARTER_MS)) };
}

/** What the phone's toolbar calls the shown date: the day, the week's span or the month. */
function dateLabel(date: string, view: View): string {
  const day = dayjs(date);
  if (view === "day") return day.format("ddd, MMM D");
  if (view === "week") {
    const start = day.subtract((day.day() + 6) % 7, "day"); // the week starts on Monday
    const end = start.add(6, "day");
    return `${start.format("MMM D")} – ${end.format(end.month() === start.month() ? "D" : "MMM D")}`;
  }
  return day.format("MMMM YYYY");
}

interface Opening {
  eventId: string | null;
  occurrence: OpenedOccurrence | null;
  initial: { allDay: boolean; startAt: number; endAt: number } | null;
}

/** What the screen puts on each item it hands the schedule. */
type ItemPayload =
  | {
      kind: "event";
      eventId: string;
      occurrence: OpenedOccurrence | null;
      labels: Label[];
      hidden: boolean;
      location: string;
      /** The caller said they are not going: drawn crossed out. */
      declined: boolean;
    }
  | { kind: "task"; task: Task };

function payloadOf(item: ScheduleEventData): ItemPayload | undefined {
  return item.payload as ItemPayload | undefined;
}

/**
 * An item drawn with its labels as bars down its side, in every view: a hidden
 * event faded, a completed task crossed out.
 */
const renderLabelledEvent: NonNullable<WeekViewProps["renderEvent"]> = (item, props) => {
  const payload = payloadOf(item);
  return (
    <LabelledEvent
      {...props}
      // The tooltip names the place too.
      title={
        payload?.kind === "event" && payload.location
          ? `${item.title} · ${payload.location}`
          : props.title
      }
      labels={payload?.kind === "event" ? payload.labels : []}
      muted={payload?.kind === "event" && payload.hidden}
      struck={
        (payload?.kind === "task" && payload.task.completedAt !== null) ||
        (payload?.kind === "event" && payload.declined)
      }
    />
  );
};

/** Day, week and month views of the household's calendar. */
export function CalendarScreen() {
  const narrow = useMediaQuery("(max-width: 48em)");
  const [date, setDate] = useState(() => toDayString(Date.now()));
  // A phone starts on the day, a wider screen on the week.
  const [view, setView] = useState<View | null>(null);
  const shownView: View = view ?? (narrow ? "day" : "week");
  const window = useMemo(() => loadWindow(date), [date]);
  const occurrences = useOccurrences(window.from, window.to);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  const event = useEvent(opening?.eventId ?? null);
  const {
    create,
    update,
    stop,
    remove,
    place,
    editOccurrence,
    cancelOccurrence,
    hide,
    attachFile,
    attachLink,
    detach,
    reply,
  } = useEventActions();
  const calendars = useCalendars();
  const labels = useLabels();
  const { filters, update: setFilters, reset: resetFilters } = useCalendarFilters();
  const tasks = useTasks();
  const taskActions = useTaskActions();
  const [openTask, setOpenTask] = useState<Task | null>(null);

  // What this device's filters leave on the calendar.
  const shown = (occurrences.data ?? []).filter(
    (item) =>
      (filters.showHidden || !item.hidden) &&
      !filters.hiddenCalendars.includes(item.calendarId) &&
      (filters.labels.length === 0 ||
        item.labelIds.some((id) => filters.labels.includes(id))),
  );
  // The day and the week draw a block over whole quarters of an hour.
  const timeGrid = shownView === "day" || shownView === "week";
  const events: ScheduleEventData[] = shown.map((item: Occurrence) => ({
    id: item.id,
    title: item.title,
    ...(item.allDay
      ? allDayBlock(item.startAt, item.endAt, item.timeZone)
      : timeGrid
        ? quarterSpan(item.startAt, item.endAt)
        : { start: new Date(item.startAt), end: new Date(item.endAt) }),
    // The colour of the calendar it shows in for you, as you set it.
    color: item.color,
    // Solid, so an event reads the same over the grid and over another event.
    variant: "filled",
    payload: {
      kind: "event",
      eventId: item.eventId,
      labels: labelsOf(item.labelIds, labels.data ?? []),
      hidden: item.hidden,
      location: item.location,
      declined: item.response === "declined",
      occurrence:
        item.originalStartAt === null
          ? null
          : {
              originalStartAt: item.originalStartAt,
              startAt: item.startAt,
              endAt: item.endAt,
              title: item.title,
            },
    } satisfies ItemPayload,
  }));
  if (filters.showTasks) {
    // Tasks with a due date, as all-day items on that day.
    for (const task of tasks.data ?? []) {
      if (!task.dueDate) continue;
      const span = allDaySpan(task.dueDate, task.dueDate);
      events.push({
        id: `task:${task.id}`,
        title: `${task.completedAt === null ? "☐" : "☑"} ${task.title}`,
        ...allDayBlock(span.startAt, span.endAt, localTimeZone()),
        color: "gray",
        payload: { kind: "task", task } satisfies ItemPayload,
      });
    }
  }

  const openNew = (initial: Opening["initial"]) =>
    setOpening({ eventId: null, occurrence: null, initial });
  const openEvent = (item: ScheduleEventData) => {
    const payload = payloadOf(item);
    if (payload?.kind === "task") setOpenTask(payload.task);
    else if (payload)
      setOpening({
        eventId: payload.eventId,
        occurrence: payload.occurrence,
        initial: null,
      });
  };
  const openNextHour = () =>
    openNew({
      allDay: false,
      startAt: dayjs().add(1, "hour").startOf("hour").valueOf(),
      endAt: dayjs().add(2, "hour").startOf("hour").valueOf(),
    });

  const save = async ({ pendingFiles, pendingLinks, ...values }: EventSubmit) => {
    if (opening?.eventId && event.data?.source === "google") {
      // An imported event is Google's; only who it is shared with is Matron's.
      await update.mutateAsync({
        id: opening.eventId,
        sharedWith: values.sharedWith,
        attendees: values.attendees,
        labelIds: values.labelIds,
      });
      return;
    }
    const input = { ...values, timeZone: localTimeZone() };
    if (opening?.eventId) {
      await update.mutateAsync({ id: opening.eventId, ...input });
      return;
    }
    const made = await create.mutateAsync(input);
    // What was attached before the event existed goes on now.
    for (const file of pendingFiles) await attachFile.mutateAsync({ id: made.id, file });
    for (const link of pendingLinks)
      await attachLink.mutateAsync({ id: made.id, url: link.url, title: link.title });
  };

  const filtersButton = (compact: boolean) => (
    <FiltersButton
      compact={compact}
      filters={filters}
      onChange={setFilters}
      onReset={resetFilters}
      calendars={calendars.data ?? []}
      labels={labels.data ?? []}
    />
  );

  return (
    <Box p="md">
      {narrow ? (
        // One line: the date opens a month to pick from, then the view and a new event.
        <Group justify="space-between" wrap="nowrap" gap="xs" mb="sm">
          <Popover
            opened={pickingDate}
            onChange={setPickingDate}
            position="bottom-start"
            shadow="md"
          >
            <Popover.Target>
              <UnstyledButton
                onClick={() => setPickingDate((open) => !open)}
                aria-label="Pick a date"
                miw={0}
              >
                <Group gap={4} wrap="nowrap">
                  <Text fw={700} fz="lg" truncate>
                    {dateLabel(date, shownView)}
                  </Text>
                  <IconChevronDown size={18} />
                </Group>
              </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown p="xs">
              <DatePicker
                value={date}
                onChange={(picked) => {
                  if (!picked) return;
                  setDate(picked);
                  setPickingDate(false);
                }}
              />
            </Popover.Dropdown>
          </Popover>
          <Group gap="xs" wrap="nowrap">
            <Select
              aria-label="View"
              data={VIEW_OPTIONS}
              value={shownView === "year" ? "month" : shownView}
              onChange={(next) => next && setView(next as View)}
              allowDeselect={false}
              w={104}
              comboboxProps={{ width: 120, position: "bottom-end" }}
            />
            {filtersButton(true)}
            <ActionIcon size={36} aria-label="New event" onClick={openNextHour}>
              <IconPlus />
            </ActionIcon>
          </Group>
        </Group>
      ) : (
        <Group justify="space-between" mb="sm">
          <Title order={2}>Calendar</Title>
          <Group gap="xs">
            {filtersButton(false)}
            <Button leftSection={<IconPlus />} onClick={openNextHour}>
              New event
            </Button>
          </Group>
        </Group>
      )}
      {narrow && shownView === "month" ? (
        // A month that fits a phone: the grid on top, the chosen day's events below.
        <MobileMonthView
          events={events}
          date={date}
          onDateChange={setDate}
          defaultSelectedDate={date}
          renderHeader={() => null}
          onEventClick={openEvent}
          renderEvent={(item, { children, ...props }) => {
            const payload = payloadOf(item);
            return (
              <UnstyledButton
                {...props}
                style={{
                  ...props.style,
                  opacity: payload?.kind === "event" && payload.hidden ? 0.5 : undefined,
                }}
              >
                {children}
                <InlineLabelBars
                  labels={payload?.kind === "event" ? payload.labels : []}
                />
              </UnstyledButton>
            );
          }}
        />
      ) : (
        <Schedule
          events={events}
          date={date}
          onDateChange={setDate}
          view={shownView}
          onViewChange={(next) => setView(next)}
          layout="default"
          withDragSlotSelect
          onTimeSlotClick={({ slotStart, slotEnd }) =>
            openNew({
              allDay: false,
              startAt: fromDateTimeString(slotStart),
              endAt: fromDateTimeString(slotEnd),
            })
          }
          onSlotDragEnd={(rangeStart, rangeEnd) =>
            openNew({
              allDay: false,
              startAt: fromDateTimeString(rangeStart),
              endAt: fromDateTimeString(rangeEnd),
            })
          }
          onAllDaySlotClick={(day) => openNew({ allDay: true, ...allDaySpan(day, day) })}
          onDayClick={(day) => {
            if (shownView === "month" || shownView === "year")
              openNew({ allDay: true, ...allDaySpan(day, day) });
          }}
          onEventClick={openEvent}
          renderEventBody={(item) => (
            <span className={classes.eventText}>{item.title}</span>
          )}
          // A phone's narrow label column has room for one word.
          labels={narrow ? { allDay: "All" } : undefined}
          // Each view takes its own class names; the Schedule passes none down.
          // The phone's toolbar above stands in for each view's own header.
          dayViewProps={{
            startTime: "06:00",
            endTime: "23:00",
            intervalMinutes: HOUR_MINUTES,
            withHeader: !narrow,
            classNames: classes,
            renderEvent: renderLabelledEvent,
          }}
          weekViewProps={{
            renderEvent: renderLabelledEvent,
            classNames: classes,
            startTime: "06:00",
            endTime: "23:00",
            withWeekNumber: false,
            highlightToday: true,
            withHeader: !narrow,
            // The bubble with the time would cover a phone's narrow label column.
            withCurrentTimeBubble: !narrow,
          }}
          monthViewProps={{ withHeader: !narrow, renderEvent: renderLabelledEvent }}
        />
      )}
      <EventModal
        opened={opening !== null}
        onClose={() => setOpening(null)}
        event={opening?.eventId ? (event.data ?? null) : null}
        loading={opening?.eventId ? event.isLoading : false}
        initial={opening?.initial ?? null}
        calendars={calendars.data ?? []}
        occurrence={opening?.occurrence ?? null}
        onEditOccurrence={
          opening?.eventId
            ? async (originalStartAt, changes) => {
                await editOccurrence.mutateAsync({
                  id: opening.eventId!,
                  originalStartAt,
                  ...changes,
                });
              }
            : undefined
        }
        onCancelOccurrence={
          opening?.eventId
            ? async (originalStartAt) => {
                await cancelOccurrence.mutateAsync({
                  id: opening.eventId!,
                  originalStartAt,
                });
              }
            : undefined
        }
        onSave={save}
        onRemove={
          opening?.eventId
            ? async () => {
                await remove.mutateAsync({ id: opening.eventId! });
              }
            : undefined
        }
        onPlace={
          opening?.eventId
            ? async (calendarId) => {
                await place.mutateAsync({ id: opening.eventId!, calendarId });
              }
            : undefined
        }
        onStop={
          opening?.eventId
            ? async (fromDay) => {
                await stop.mutateAsync({ id: opening.eventId!, from: fromDay });
              }
            : undefined
        }
        onAttachFiles={
          opening?.eventId
            ? async (files) => {
                for (const file of files)
                  await attachFile.mutateAsync({ id: opening.eventId!, file });
              }
            : undefined
        }
        onAttachLink={
          opening?.eventId
            ? async (link) => {
                await attachLink.mutateAsync({
                  id: opening.eventId!,
                  url: link.url,
                  title: link.title,
                });
              }
            : undefined
        }
        onDetach={
          opening?.eventId
            ? async (attachmentId) => {
                await detach.mutateAsync({ id: opening.eventId!, attachmentId });
              }
            : undefined
        }
        onReply={
          opening?.eventId
            ? async (response) => {
                await reply.mutateAsync({ id: opening.eventId!, response });
              }
            : undefined
        }
        onHide={
          opening?.eventId
            ? async (hidden) => {
                await hide.mutateAsync({ id: opening.eventId!, hidden });
              }
            : undefined
        }
      />
      <TaskModal
        opened={openTask !== null}
        onClose={() => setOpenTask(null)}
        task={openTask}
        onSave={async (values) => {
          if (openTask)
            await taskActions.update.mutateAsync({ id: openTask.id, ...values });
        }}
        onRemove={
          openTask
            ? async () => {
                await taskActions.remove.mutateAsync({ id: openTask.id });
              }
            : undefined
        }
      />
    </Box>
  );
}

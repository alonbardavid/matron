import { useEffect, useMemo, useState } from "react";
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
import {
  addDays,
  addHours,
  format,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfHour,
  startOfWeek,
} from "date-fns";
import type { Occurrence } from "@shared/contract/app/calendar";
import { IconChevronDown, IconPlus } from "@frontend/ds/icons";
import { type DueItem, useDueItems, useItemActions } from "@frontend/lists/useLists";
import { ItemModal } from "@frontend/lists/widgets/ItemModal";
import { useCalendarFilters } from "../filters";
import {
  allDayBlock,
  allDaySpan,
  fromDateTimeString,
  loadWindow,
  localTimeZone,
  toDayString,
} from "../times";
import { useTimeGrid } from "../timeGrid";
import { enableTouchDrag } from "../touchDrag";
import {
  useCalendars,
  useEvent,
  useEventActions,
  useMoveEvent,
  useOccurrences,
} from "../useCalendar";
import { useCalendarDisplay, type View } from "../display";
import { CalendarItem } from "../widgets/CalendarItem";
import { FiltersButton } from "../widgets/FiltersButton";
import {
  EventModal,
  type EventSubmit,
  type OpenedOccurrence,
} from "../widgets/EventModal";
import classes from "./CalendarScreen.module.css";

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
  const day = parseISO(date);
  if (view === "day") return format(day, "EEE, MMM d");
  if (view === "week") {
    const start = startOfWeek(day, { weekStartsOn: 1 }); // the week starts on Monday
    const end = addDays(start, 6);
    return `${format(start, "MMM d")} – ${format(end, isSameMonth(end, start) ? "d" : "MMM d")}`;
  }
  return format(day, "MMMM yyyy");
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
      hidden: boolean;
      location: string;
      /** Whether the caller may drag it to move or resize it. */
      editable: boolean;
      allDay: boolean;
      startAt: number;
      endAt: number;
    }
  | { kind: "item"; item: DueItem };

function payloadOf(item: ScheduleEventData): ItemPayload | undefined {
  return item.payload as ItemPayload | undefined;
}

/**
 * An item as the schedule draws it, in every view: a hidden event faded, a
 * list item that is done crossed out.
 */
const renderItem: NonNullable<WeekViewProps["renderEvent"]> = (item, props) => {
  const payload = payloadOf(item);
  return (
    <CalendarItem
      {...props}
      // The tooltip names the place too.
      title={
        payload?.kind === "event" && payload.location
          ? `${item.title} · ${payload.location}`
          : props.title
      }
      muted={payload?.kind === "event" && payload.hidden}
      struck={payload?.kind === "item" && payload.item.completedAt !== null}
    />
  );
};

/** Day, week and month views of the household's calendar. */
export function CalendarScreen() {
  const narrow = useMediaQuery("(max-width: 48em)");
  // Until a view is chosen, a phone starts on the day, a wider screen on the week.
  const {
    view: shownView,
    setView,
    date,
    setDate,
  } = useCalendarDisplay(narrow ? "day" : "week");
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
    leave,
  } = useEventActions();
  const calendars = useCalendars();
  const { filters, update: setFilters, reset: resetFilters } = useCalendarFilters();
  const dueItems = useDueItems();
  const itemActions = useItemActions();
  const [openItem, setOpenItem] = useState<DueItem | null>(null);
  const { viewportRef, maxHeight } = useTimeGrid();
  useEffect(enableTouchDrag, []);
  const scrollAreaProps = { viewportRef, mah: maxHeight };

  // What this device's filters leave on the calendar.
  const shown = (occurrences.data ?? []).filter(
    (item) =>
      (filters.showHidden || !item.hidden) &&
      !filters.hiddenCalendars.includes(item.calendarId),
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
      hidden: item.hidden,
      location: item.location,
      editable: item.editable,
      allDay: item.allDay,
      startAt: item.startAt,
      endAt: item.endAt,
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
  if (filters.showItems) {
    // List items with a due date, as all-day items on that day, in their list's colour.
    for (const item of dueItems) {
      if (!item.dueDate) continue;
      const span = allDaySpan(item.dueDate, item.dueDate);
      events.push({
        id: `item:${item.id}`,
        title: `${item.completedAt === null ? "☐" : "☑"} ${item.title}`,
        ...allDayBlock(span.startAt, span.endAt, localTimeZone()),
        color: item.listColor,
        payload: { kind: "item", item } satisfies ItemPayload,
      });
    }
  }

  const openNew = (initial: Opening["initial"]) =>
    setOpening({ eventId: null, occurrence: null, initial });
  const openEvent = (item: ScheduleEventData) => {
    const payload = payloadOf(item);
    if (payload?.kind === "item") setOpenItem(payload.item);
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
      startAt: startOfHour(addHours(new Date(), 1)).getTime(),
      endAt: startOfHour(addHours(new Date(), 2)).getTime(),
    });

  const save = async (values: EventSubmit) => {
    if (
      opening?.eventId &&
      (event.data?.source === "google" || !event.data?.myPermissions.includes("edit"))
    ) {
      // Only who it is shared with changes: an imported event is Google's, and
      // a guest who may share it does not edit it.
      await update.mutateAsync({
        id: opening.eventId,
        sharedWith: values.sharedWith,
        attendees: values.attendees,
        permissions: values.permissions,
      });
      return;
    }
    const input = { ...values, timeZone: localTimeZone() };
    if (opening?.eventId) await update.mutateAsync({ id: opening.eventId, ...input });
    else await create.mutateAsync(input);
  };

  const moveEvent = useMoveEvent(window.from, window.to);
  /**
   * Drops an item where it was dragged (`move`), or stretches it to its new
   * edges (`resize`). The calendar draws a timed event over whole quarters of
   * an hour, so its times shift by as much as its block did rather than taking
   * the block's edges: 7:05 to 7:12 dragged an hour on is 8:05 to 8:12. An
   * all-day event keeps its length in days; a list item takes the day as its due date.
   */
  const dropped = (
    kind: "move" | "resize",
    {
      event: item,
      newStart,
      newEnd,
    }: {
      event: ScheduleEventData;
      newStart: string;
      newEnd: string;
    },
  ) => {
    const payload = payloadOf(item);
    if (payload?.kind === "item") {
      const day = toDayString(fromDateTimeString(newStart));
      if (payload.item.editable && day !== payload.item.dueDate)
        itemActions.update(payload.item.id, { dueDate: day });
      return;
    }
    if (!payload?.editable) return;
    const shownStart = new Date(item.start).getTime();
    const shownEnd = new Date(item.end).getTime();
    const startShift = fromDateTimeString(newStart) - shownStart;
    const endShift = fromDateTimeString(newEnd) - shownEnd;
    let startAt: number;
    let endAt: number;
    if (payload.allDay) {
      startAt = startOfDay(parseISO(newStart)).getTime();
      endAt = startAt + (payload.endAt - payload.startAt);
    } else if (kind === "move") {
      startAt = payload.startAt + startShift;
      endAt = payload.endAt + startShift;
    } else {
      // Only the edge that was pulled moves.
      startAt = startShift ? fromDateTimeString(newStart) : payload.startAt;
      endAt = endShift ? fromDateTimeString(newEnd) : payload.endAt;
      if (endAt <= startAt) return;
    }
    if (startAt === payload.startAt && endAt === payload.endAt) return;
    void moveEvent({
      occurrenceId: String(item.id),
      eventId: payload.eventId,
      originalStartAt: payload.occurrence?.originalStartAt ?? null,
      startAt,
      endAt,
    });
  };
  const draggable = (item: ScheduleEventData) => {
    const payload = payloadOf(item);
    return (
      (payload?.kind === "item" && payload.item.editable) ||
      (payload?.kind === "event" && payload.editable)
    );
  };
  const resizable = (item: ScheduleEventData) => {
    const payload = payloadOf(item);
    return payload?.kind === "event" && payload.editable && !payload.allDay;
  };

  const filtersButton = (compact: boolean) => (
    <FiltersButton
      compact={compact}
      filters={filters}
      onChange={setFilters}
      onReset={resetFilters}
      calendars={calendars.data ?? []}
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
            trapFocus
            returnFocus
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
          withEventsDragAndDrop
          canDragEvent={draggable}
          onEventDrop={(data) => dropped("move", data)}
          withEventResize
          canResizeEvent={resizable}
          onEventResize={(data) => dropped("resize", data)}
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
            scrollAreaProps,
            intervalMinutes: HOUR_MINUTES,
            withHeader: !narrow,
            classNames: classes,
            renderEvent: renderItem,
          }}
          weekViewProps={{
            renderEvent: renderItem,
            classNames: classes,
            scrollAreaProps,
            withWeekNumber: false,
            highlightToday: true,
            withHeader: !narrow,
            // The bubble with the time would cover a phone's narrow label column.
            withCurrentTimeBubble: !narrow,
          }}
          monthViewProps={{ withHeader: !narrow, renderEvent: renderItem }}
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
        onLeave={
          opening?.eventId
            ? async () => {
                await leave.mutateAsync({ id: opening.eventId! });
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
      <ItemModal
        opened={openItem !== null}
        onClose={() => setOpenItem(null)}
        item={openItem}
        people={openItem?.people ?? []}
        editable={openItem?.editable ?? false}
        onSave={(values) => {
          if (openItem) itemActions.update(openItem.id, values);
        }}
        onRemove={openItem ? () => itemActions.remove(openItem.id) : undefined}
      />
    </Box>
  );
}

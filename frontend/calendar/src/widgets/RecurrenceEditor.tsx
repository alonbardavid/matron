import { useEffect, useState } from "react";
import {
  Button,
  Chip,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  buildRule,
  defaultDraft,
  describeRule,
  parseRule,
  type RepeatDraft,
} from "../rrule";

interface RecurrenceEditorProps {
  /** The RRULE value, or null for a single event. */
  value: string | null;
  onChange: (rule: string | null) => void;
  /** The event's start, for the defaults: its weekday, its day of the month. */
  startAt: number;
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const FREQUENCIES = [
  { value: "NONE", label: "Never" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];
const UNITS: Record<string, [string, string]> = {
  DAILY: ["day", "days"],
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
  YEARLY: ["year", "years"],
};
const NTHS = [
  { value: "1", label: "First" },
  { value: "2", label: "Second" },
  { value: "3", label: "Third" },
  { value: "4", label: "Fourth" },
  { value: "-1", label: "Last" },
];

/**
 * How an event repeats, as an iCalendar RRULE: daily, weekly on chosen days,
 * monthly on days of the month or the nth weekday, or yearly; every so many;
 * forever, until a day or a number of times. A rule with more than these
 * shows in words and is kept unless replaced.
 */
export function RecurrenceEditor({ value, onChange, startAt }: RecurrenceEditorProps) {
  const [draft, setDraft] = useState<RepeatDraft>(() => parseRule(value, startAt));
  // A rule set from outside (another event opened) resets the fields.
  useEffect(() => {
    if (buildRule(draft) !== value) setDraft(parseRule(value, startAt));
  }, [value]);

  const update = (changes: Partial<RepeatDraft>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    onChange(buildRule(next));
  };

  const dayChips = Array.from({ length: 31 }, (_, i) => String(i + 1)).concat("-1");
  const unit = UNITS[draft.freq];

  return (
    <Stack gap="xs">
      <div>
        <Text size="sm" fw={500} mb={4}>
          Repeats
        </Text>
        <SegmentedControl
          value={draft.freq}
          data={FREQUENCIES}
          onChange={(freq) =>
            update({
              ...(freq === "NONE" ? {} : defaultsFor(draft, startAt)),
              freq: freq as RepeatDraft["freq"],
              custom: null,
            })
          }
        />
      </div>
      {draft.custom && (
        <Group gap="xs">
          <Text size="sm">{describeRule(draft.custom)}</Text>
          <Button
            size="compact-xs"
            variant="light"
            onClick={() => update({ ...defaultsFor(draft, startAt), custom: null })}
          >
            Replace
          </Button>
        </Group>
      )}
      {!draft.custom && unit && (
        <>
          <Group gap="xs" align="center">
            <Text size="sm">Every</Text>
            <NumberInput
              aria-label="Every how many"
              min={1}
              max={99}
              value={draft.interval}
              onChange={(v) =>
                update({ interval: typeof v === "number" && v > 0 ? v : 1 })
              }
              w={72}
            />
            <Text size="sm">{draft.interval === 1 ? unit[0] : unit[1]}</Text>
          </Group>
          {draft.freq === "WEEKLY" && (
            <Chip.Group
              multiple
              value={draft.weekdays.map(String)}
              onChange={(values) =>
                values.length &&
                update({ weekdays: values.map(Number).sort((a, b) => a - b) })
              }
            >
              <Group gap={4}>
                {WEEKDAY_LETTERS.map((label, index) => (
                  <Chip
                    key={index}
                    value={String(index)}
                    size="xs"
                    radius="xl"
                    aria-label={WEEKDAY_NAMES[index]}
                  >
                    {label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          )}
          {draft.freq === "MONTHLY" && (
            <>
              <SegmentedControl
                size="xs"
                value={draft.monthMode}
                onChange={(mode) =>
                  update({ monthMode: mode as RepeatDraft["monthMode"] })
                }
                data={[
                  { value: "day", label: "On days of the month" },
                  { value: "weekday", label: "On a weekday" },
                ]}
                w="fit-content"
              />
              {draft.monthMode === "day" ? (
                <Chip.Group
                  multiple
                  value={draft.monthDays.map(String)}
                  onChange={(values) =>
                    values.length &&
                    update({
                      monthDays: values
                        .map(Number)
                        .sort((a, b) => (a < 0 ? 99 : a) - (b < 0 ? 99 : b)),
                    })
                  }
                >
                  <Group gap={4}>
                    {dayChips.map((day) => (
                      <Chip key={day} value={day} size="xs" radius="xl">
                        {day === "-1" ? "Last" : day}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              ) : (
                <Group gap="xs">
                  <Select
                    aria-label="Which"
                    data={NTHS}
                    value={String(draft.nth)}
                    onChange={(v) => v && update({ nth: Number(v) })}
                    allowDeselect={false}
                    w={120}
                  />
                  <Select
                    aria-label="Weekday"
                    data={WEEKDAY_NAMES.map((label, i) => ({ value: String(i), label }))}
                    value={String(draft.nthWeekday)}
                    onChange={(v) => v && update({ nthWeekday: Number(v) })}
                    allowDeselect={false}
                    w={150}
                  />
                </Group>
              )}
            </>
          )}
          <Group align="flex-end" gap="sm">
            <SegmentedControl
              value={draft.ends}
              onChange={(ends) => update({ ends: ends as RepeatDraft["ends"] })}
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
                onChange={(v) => update({ until: v })}
                valueFormat="ddd D MMM YYYY"
              />
            )}
            {draft.ends === "after" && (
              <NumberInput
                label="Times"
                min={1}
                max={1000}
                value={draft.count}
                onChange={(v) => update({ count: typeof v === "number" ? v : 1 })}
                w={110}
              />
            )}
          </Group>
        </>
      )}
      {draft.freq !== "NONE" && (
        <Text size="xs" c="dimmed">
          {describeRule(buildRule(draft))}
        </Text>
      )}
    </Stack>
  );
}

/** The day-picking fields reset to the event's start, keeping the interval and the end. */
function defaultsFor(draft: RepeatDraft, startAt: number): Partial<RepeatDraft> {
  const fresh = defaultDraft(startAt);
  return {
    weekdays: fresh.weekdays,
    monthMode: "day",
    monthDays: fresh.monthDays,
    nth: fresh.nth,
    nthWeekday: fresh.nthWeekday,
    interval: draft.interval,
    ends: draft.ends,
    until: draft.until,
    count: draft.count,
    freq: draft.freq === "NONE" ? "WEEKLY" : draft.freq,
  };
}

import { Select } from "@mantine/core";
import { ALARM_MINUTES, type Alarm } from "@shared/contract/app/notifications";

type Minutes = Alarm["minutesBefore"];

const NONE = "none";

function describe(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes before`;
  return minutes === 60 ? "1 hour before" : `${minutes / 60} hours before`;
}

const OPTIONS = [
  { value: NONE, label: "No reminder" },
  ...ALARM_MINUTES.map((minutes) => ({
    value: String(minutes),
    label: describe(minutes),
  })),
];

interface AlarmSelectProps {
  /** The caller's alarm; undefined while it loads. */
  value: Minutes | undefined;
  onChange: (minutesBefore: Minutes) => void;
  disabled?: boolean;
}

/**
 * The caller's own reminder on an event or a task: how long before, or none.
 * It is theirs alone and saved at once; it reaches the devices they turned
 * reminders on for.
 */
export function AlarmSelect({ value, onChange, disabled }: AlarmSelectProps) {
  return (
    <Select
      label="Remind me"
      data={OPTIONS}
      value={value === undefined ? null : value === null ? NONE : String(value)}
      onChange={(chosen) => {
        if (chosen === null) return;
        const minutes = ALARM_MINUTES.find((m) => String(m) === chosen);
        onChange(minutes ?? null);
      }}
      allowDeselect={false}
      disabled={disabled || value === undefined}
      maw={280}
    />
  );
}

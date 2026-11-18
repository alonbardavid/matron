import { Text } from "@mantine/core";
import { formatAgo, formatMoment } from "../time";
import { useNow } from "../useNow";

/** When something in the chat was said, as "10 minutes ago"; the whole moment on hover. */
export function TimeAgo({ ts }: { ts: number }) {
  const now = useNow();
  return (
    <Text
      component="time"
      dateTime={new Date(ts).toISOString()}
      title={formatMoment(ts)}
      size="xs"
      c="dimmed"
      style={{ flexShrink: 0, whiteSpace: "nowrap" }}
    >
      {formatAgo(ts, now)}
    </Text>
  );
}

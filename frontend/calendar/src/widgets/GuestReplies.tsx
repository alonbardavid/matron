import { Badge, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import type { EventResponse, ExternalGuest } from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { UserAvatar } from "@frontend/auth/widgets/UserAvatar";

const LABELS: Record<EventResponse, string> = {
  accepted: "Going",
  tentative: "Maybe",
  declined: "Not going",
  needs_action: "No answer yet",
};

const COLORS: Record<EventResponse, string> = {
  accepted: "sage",
  tentative: "yellow",
  declined: "red",
  needs_action: "gray",
};

/** The order a guest list reads in: going first, then maybe, waiting and not going. */
const ORDER: EventResponse[] = ["accepted", "tentative", "needs_action", "declined"];

function ResponseBadge({ response }: { response: EventResponse }) {
  return (
    <Badge
      variant="light"
      color={COLORS[response]}
      size="sm"
      styles={{ root: { textTransform: "none" } }}
    >
      {LABELS[response]}
    </Badge>
  );
}

/** How many gave each answer, as one line. */
function summary(responses: EventResponse[]): string {
  const count = (r: EventResponse) => responses.filter((x) => x === r).length;
  return [
    count("accepted") && `${count("accepted")} going`,
    count("tentative") && `${count("tentative")} maybe`,
    count("declined") && `${count("declined")} not going`,
    count("needs_action") && `${count("needs_action")} yet to answer`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The caller's own answer: going, maybe or not, given at once. */
export function ReplyControl({
  value,
  onChange,
  disabled = false,
}: {
  value: EventResponse | null;
  onChange: (response: Exclude<EventResponse, "needs_action">) => void;
  disabled?: boolean;
}) {
  return (
    <Group gap="sm">
      <Text size="sm" fw={500}>
        Going?
      </Text>
      <SegmentedControl
        size="xs"
        aria-label="Your answer"
        disabled={disabled}
        value={value && value !== "needs_action" ? value : ""}
        onChange={(next) => onChange(next as Exclude<EventResponse, "needs_action">)}
        data={[
          { value: "accepted", label: "Yes" },
          { value: "tentative", label: "Maybe" },
          { value: "declined", label: "No" },
        ]}
      />
    </Group>
  );
}

/** Who attends and what each answered. */
export function RepliesList({ replies }: { replies: Record<string, EventResponse> }) {
  const { nameOf, avatarUrlOf } = useHouseholdMembers();
  const entries = Object.entries(replies).sort(
    ([a, ra], [b, rb]) =>
      ORDER.indexOf(ra) - ORDER.indexOf(rb) || nameOf(a).localeCompare(nameOf(b)),
  );
  if (entries.length === 0) return null;
  return (
    <Stack gap={4} aria-label="Replies">
      <Text size="sm" fw={500}>
        Replies{" "}
        <Text span size="xs" c="dimmed">
          {summary(entries.map(([, r]) => r))}
        </Text>
      </Text>
      {entries.map(([userId, response]) => (
        <Group
          key={userId}
          gap="xs"
          wrap="nowrap"
          role="listitem"
          aria-label={nameOf(userId)}
        >
          <UserAvatar size="sm" name={nameOf(userId)} avatarUrl={avatarUrlOf(userId)} />
          <Text size="sm" style={{ flex: 1 }} truncate>
            {nameOf(userId)}
          </Text>
          <ResponseBadge response={response} />
        </Group>
      ))}
    </Stack>
  );
}

/** An imported event's guests at its source, and their answers there; read-only. */
export function ExternalGuestsList({ guests }: { guests: ExternalGuest[] }) {
  const { nameOf, avatarUrlOf } = useHouseholdMembers();
  if (guests.length === 0) return null;
  const sorted = [...guests].sort(
    (a, b) => ORDER.indexOf(a.response) - ORDER.indexOf(b.response),
  );
  return (
    <Stack gap={4} aria-label="Guests in Google Calendar">
      <Text size="sm" fw={500}>
        Guests in Google Calendar{" "}
        <Text span size="xs" c="dimmed">
          {summary(guests.map((g) => g.response))}
        </Text>
      </Text>
      {sorted.map((guest) => {
        const name = guest.userId ? nameOf(guest.userId) : (guest.name ?? guest.email);
        return (
          <Group
            key={guest.email}
            gap="xs"
            wrap="nowrap"
            role="listitem"
            aria-label={name}
          >
            <UserAvatar
              size="sm"
              name={name}
              avatarUrl={guest.userId ? avatarUrlOf(guest.userId) : null}
            />
            <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate title={guest.email}>
              {name}
              {guest.organizer && (
                <Text span size="xs" c="dimmed">
                  {" "}
                  · organiser
                </Text>
              )}
            </Text>
            <ResponseBadge response={guest.response} />
          </Group>
        );
      })}
    </Stack>
  );
}

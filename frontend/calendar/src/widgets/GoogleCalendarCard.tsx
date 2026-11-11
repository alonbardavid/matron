import { useEffect, useState } from "react";
import { Badge, Button, Checkbox, Group, Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { GOOGLE_CALENDAR_SCOPE, type GoogleStatus } from "@shared/contract/app/calendar";
import { authClient, unwrapAuth } from "@frontend/api/auth-client";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useGoogleStatus } from "../useCalendar";

/** Where Google's page sends the member back to, and what `?google=` says happened there. */
const RETURN_PATH = "/settings";
const LINKED = "linked";
const NOT_LINKED = "failed";

/** Google returns the browser to production, so a branch, whose data is a copy, never connects. */
const MAIN_ONLY = "Connecting Google Calendar is only available on main.";

/** Reads `?google=` once when Google sends the member back, and takes it off the address. */
function useReturnFromGoogle(onLinked: () => void) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    if (!result) return;
    if (result === LINKED) onLinked();
    else {
      notifications.show({
        message: "Google Calendar was not connected; try again",
        color: "yellow",
      });
    }
    url.searchParams.delete("google");
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url);
    // Once, on arrival: what the callback is then is what runs.
  }, []);
}

/** The member's own Google Calendar link: connect, choose calendars, sync, disconnect. */
export function GoogleCalendarCard() {
  const queryClient = useQueryClient();
  const status = useGoogleStatus();
  const connection = status.data?.connection ?? null;
  const calendars = useQuery(
    orpc.calendar.google.calendars.queryOptions({
      enabled: connection?.status === "active",
      staleTime: 60_000,
      retry: false,
    }),
  );
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (calendars.data)
      setSelected(calendars.data.filter((c) => c.selected).map((c) => c.id));
  }, [calendars.data]);

  const saved = (data: GoogleStatus) => {
    queryClient.setQueryData(orpc.calendar.google.status.queryKey(), data);
    void queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
  };
  // The member links their Google account through the auth, allowing it to
  // read their calendars; the browser goes to Google and comes back here.
  const connect = useMutation({
    mutationFn: async () =>
      unwrapAuth(
        await authClient.linkSocial({
          provider: "google",
          scopes: [GOOGLE_CALENDAR_SCOPE],
          callbackURL: `${RETURN_PATH}?google=${LINKED}`,
          errorCallbackURL: `${RETURN_PATH}?google=${NOT_LINKED}`,
        }),
      ),
    onError: (err) => notifyError(err, "Could not start connecting"),
  });
  const select = useMutation(
    orpc.calendar.google.select.mutationOptions({
      onSuccess: (data) => {
        saved(data);
        notifications.show({ message: "Calendars imported" });
      },
      onError: (err) => notifyError(err, "Could not change the calendars"),
    }),
  );
  const sync = useMutation(
    orpc.calendar.google.sync.mutationOptions({
      onSuccess: saved,
      onError: (err) => notifyError(err, "Could not sync"),
    }),
  );
  const disconnect = useMutation(
    orpc.calendar.google.disconnect.mutationOptions({
      onSuccess: (data) => {
        saved(data);
        notifications.show({ message: "Google Calendar disconnected" });
      },
      onError: (err) => notifyError(err, "Could not disconnect"),
    }),
  );

  // Back from Google with the account linked: the first sync takes it up.
  const takeUp = useMutation(
    orpc.calendar.google.sync.mutationOptions({
      onSuccess: (data) => {
        saved(data);
        notifications.show({ message: "Google Calendar connected" });
      },
      onError: (err) => notifyError(err, "Could not connect Google Calendar"),
    }),
  );
  useReturnFromGoogle(() => takeUp.mutate({}));

  const startConnect = () => connect.mutate();
  const current = (calendars.data ?? []).filter((c) => c.selected).map((c) => c.id);
  const dirty =
    selected.length !== current.length || selected.some((id) => !current.includes(id));

  let body;
  if (status.isLoading || !status.data) {
    body = <Loader size="sm" />;
  } else if (!status.data.configured) {
    body = (
      <Text size="sm" c="dimmed">
        Not set up for the household yet: an owner or admin adds the household&apos;s
        Google app in App settings.
      </Text>
    );
  } else if (!connection) {
    body = (
      <Stack gap="xs" align="flex-start">
        <Button
          onClick={startConnect}
          loading={connect.isPending}
          disabled={!status.data.canConnect}
          title={status.data.canConnect ? undefined : MAIN_ONLY}
        >
          Connect Google Calendar
        </Button>
        {!status.data.canConnect && (
          <Text size="sm" c="dimmed">
            {MAIN_ONLY}
          </Text>
        )}
      </Stack>
    );
  } else {
    body = (
      <Stack gap="sm">
        <Group gap="xs">
          <Text size="sm">{connection.googleEmail}</Text>
          {connection.status === "active" ? (
            <Badge variant="light" color="sage">
              Connected
            </Badge>
          ) : (
            <Badge variant="light" color="red">
              Needs reconnecting
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {connection.lastSyncedAt
            ? `Last synced ${dayjs(connection.lastSyncedAt).format("ddd D MMM, HH:mm")}`
            : "Not synced yet"}
        </Text>
        {connection.lastError && (
          <Text size="sm" c="red">
            {connection.lastError}
          </Text>
        )}
        {connection.status === "active" &&
          (calendars.isLoading ? (
            <Loader size="sm" />
          ) : calendars.error ? (
            <Text size="sm" c="red">
              Could not read your Google calendars.
            </Text>
          ) : (
            <Checkbox.Group
              label="Calendars to import"
              value={selected}
              onChange={setSelected}
            >
              <Stack gap={6} mt={6}>
                {(calendars.data ?? []).map((cal) => (
                  <Checkbox
                    key={cal.id}
                    value={cal.id}
                    color={cal.color ?? undefined}
                    label={cal.primary ? `${cal.name} (primary)` : cal.name}
                  />
                ))}
              </Stack>
            </Checkbox.Group>
          ))}
        <Group gap="xs">
          {connection.status === "active" ? (
            <>
              <Button
                disabled={!dirty || selected.length === 0}
                loading={select.isPending}
                onClick={() => select.mutate({ calendarIds: selected })}
              >
                Save calendars
              </Button>
              <Button
                variant="light"
                loading={sync.isPending}
                onClick={() => sync.mutate({})}
              >
                Sync now
              </Button>
            </>
          ) : (
            <Button
              onClick={startConnect}
              loading={connect.isPending}
              disabled={!status.data.canConnect}
              title={status.data.canConnect ? undefined : MAIN_ONLY}
            >
              Reconnect
            </Button>
          )}
          <ConfirmButton
            variant="subtle"
            color="red"
            message="Disconnect Google Calendar? Its events leave the Matron calendar."
            confirmLabel="Disconnect"
            onConfirm={() => disconnect.mutateAsync({})}
          >
            Disconnect
          </ConfirmButton>
        </Group>
      </Stack>
    );
  }

  return (
    <Card>
      <Stack gap="sm">
        <Text fw={600}>Google Calendar</Text>
        <Text size="sm" c="dimmed">
          Show events from your own Google Calendar on the Matron calendar. They come one
          way, from Google: change them there. Only you see them, unless you share the
          calendar or an event.
        </Text>
        {body}
      </Stack>
    </Card>
  );
}

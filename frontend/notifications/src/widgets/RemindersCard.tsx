import { Button, Loader, Stack, Switch, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { Card } from "@frontend/ds/Card";
import { promptInstall, useInstallMethod } from "../installPrompt";
import { usePushDevice, type PushDevice } from "../usePushDevice";

/**
 * Reminders on this device: what the member asked to be reminded of on an
 * event or a task is pushed to the devices that turned them on. Installing
 * the app comes first where push needs it.
 */
export function RemindersCard() {
  const device = usePushDevice();
  return (
    <Card>
      <Stack gap="sm" role="group" aria-label="Reminders">
        <Text fw={600}>Reminders</Text>
        <Hint>A notification ahead of the events and tasks you set a reminder on.</Hint>
        <InstallApp />
        <DeviceControl device={device} />
      </Stack>
    </Card>
  );
}

function DeviceControl({ device }: { device: PushDevice }) {
  if (device.isLoading) return <Loader size="sm" />;
  if (!device.isOffered) return <Hint>This version of Matron sends no reminders.</Hint>;
  switch (device.availability) {
    case "needs-install":
      return <Hint>Add Matron to your Home Screen to get reminders on this device.</Hint>;
    case "unsupported":
      return <Hint>This browser can&apos;t show notifications.</Hint>;
    case "blocked":
      return (
        <Hint>
          Notifications are blocked for Matron. Allow them in this browser&apos;s settings
          to turn reminders on.
        </Hint>
      );
    case "available":
      return (
        <Switch
          label="Reminders on this device"
          checked={device.isOn}
          disabled={device.isSaving}
          onChange={(event) => device.setOn(event.currentTarget.checked)}
          w="fit-content"
        />
      );
  }
}

function InstallApp() {
  const method = useInstallMethod();
  if (method === "prompt") {
    return (
      <Button variant="light" w="fit-content" onClick={() => void promptInstall()}>
        Install Matron
      </Button>
    );
  }
  if (method === "ios-instructions") {
    return <Hint>To install Matron, tap Share in Safari, then Add to Home Screen.</Hint>;
  }
  return null;
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed">
      {children}
    </Text>
  );
}

import { useState, type ReactNode } from "react";
import { Button, Group, Popover, Stack, Text, type ButtonProps } from "@mantine/core";

interface ConfirmButtonProps extends ButtonProps {
  children: ReactNode;
  onConfirm: () => unknown;
  message?: string;
  confirmLabel?: string;
}

export function ConfirmButton({
  children,
  onConfirm,
  message = "Are you sure?",
  confirmLabel = "Yes, do it",
  ...props
}: ConfirmButtonProps) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpened(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom"
      withArrow
      shadow="md"
      trapFocus
    >
      <Popover.Target>
        <Button
          {...props}
          onClick={() => setOpened((o) => !o)}
          loading={busy || props.loading}
        >
          {children}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm">{message}</Text>
          <Group justify="flex-end" gap="xs">
            <Button
              size="xs"
              variant="default"
              onClick={() => setOpened(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button size="xs" color="red" onClick={confirm} loading={busy}>
              {confirmLabel}
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

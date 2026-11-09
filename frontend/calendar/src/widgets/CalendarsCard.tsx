import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  Popover,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { z } from "zod";
import { CALENDAR_COLORS, type Calendar } from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormTextInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";
import { IconChevronDown, IconTrash } from "@frontend/ds/icons";
import { useCalendarActions, useCalendars } from "../useCalendar";
import { ColorPicker } from "./ColorPicker";

const newCalendarSchema = z.object({
  name: z.string().trim().min(1, "Give the calendar a name").max(80),
});
type NewCalendarValues = z.infer<typeof newCalendarSchema>;

/** Who an own calendar is shared with, read-only, picked in a popover. */
function ShareButton({ calendar }: { calendar: Calendar }) {
  const { update } = useCalendarActions();
  const [opened, setOpened] = useState(false);
  const [people, setPeople] = useState(calendar.sharedWith);
  useEffect(() => setPeople(calendar.sharedWith), [calendar.sharedWith]);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      width={300}
    >
      <Popover.Target>
        <Button
          size="compact-sm"
          variant="subtle"
          aria-label={`Share ${calendar.name}`}
          onClick={() => setOpened((open) => !open)}
        >
          {calendar.sharedWith.length
            ? `Shared with ${calendar.sharedWith.length}`
            : "Share"}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <PeoplePicker
            label="Share read-only with"
            placeholder="No one"
            value={people}
            onChange={setPeople}
            exclude={[calendar.ownerId]}
            comboboxProps={{ withinPortal: false }}
          />
          <Text size="xs" c="dimmed">
            They see every event in it and choose their own colour for it; only you change
            it.
          </Text>
          <Button
            size="compact-sm"
            w="fit-content"
            loading={update.isPending}
            onClick={async () => {
              await update.mutateAsync({ id: calendar.id, sharedWith: people });
              setOpened(false);
            }}
          >
            Save
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function OwnCalendarRow({
  calendar,
  receives,
}: {
  calendar: Calendar;
  receives: boolean;
}) {
  const { update, remove } = useCalendarActions();
  const [name, setName] = useState(calendar.name);
  useEffect(() => setName(calendar.name), [calendar.name]);
  const rename = () => {
    const next = name.trim();
    if (next && next !== calendar.name) update.mutate({ id: calendar.id, name: next });
    else setName(calendar.name);
  };
  const matron = calendar.source === "matron";
  const canMakeDefault = matron && !calendar.isDefault;
  const canReceive = matron && !receives;
  return (
    <Group gap="sm" wrap="nowrap">
      <ColorPicker
        value={calendar.color}
        label={`Colour of ${calendar.name}`}
        onChange={(color) => update.mutate({ id: calendar.id, color })}
      />
      <TextInput
        aria-label="Calendar title"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        style={{ flex: 1 }}
        maw={260}
      />
      {!matron && (
        <Badge variant="light" color="gray">
          Google
        </Badge>
      )}
      {calendar.isDefault && <Badge variant="light">Default</Badge>}
      {receives && (
        <Badge variant="light" color="sage">
          Shared events
        </Badge>
      )}
      <ShareButton calendar={calendar} />
      {(canMakeDefault || canReceive) && (
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button
              size="compact-sm"
              variant="subtle"
              aria-label={`More for ${calendar.name}`}
              rightSection={<IconChevronDown size={14} />}
            >
              Use for
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {canMakeDefault && (
              <Menu.Item
                onClick={() => update.mutate({ id: calendar.id, isDefault: true })}
              >
                New events (make default)
              </Menu.Item>
            )}
            {canReceive && (
              <Menu.Item
                onClick={() => update.mutate({ id: calendar.id, receivesShared: true })}
              >
                Events shared with me
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
      {matron && !calendar.isDefault && (
        <ConfirmButton
          variant="subtle"
          color="red"
          size="compact-sm"
          message={`Remove ${calendar.name} and every event in it?`}
          confirmLabel="Remove"
          onConfirm={() => remove.mutateAsync({ id: calendar.id })}
          aria-label={`Remove ${calendar.name}`}
        >
          <IconTrash size={16} />
        </ConfirmButton>
      )}
    </Group>
  );
}

function SharedCalendarRow({ calendar }: { calendar: Calendar }) {
  const { update, remove } = useCalendarActions();
  const { nameOf } = useHouseholdMembers();
  return (
    <Group gap="sm" wrap="nowrap">
      <ColorPicker
        value={calendar.color}
        label={`Your colour for ${calendar.name}`}
        onChange={(color) => update.mutate({ id: calendar.id, color })}
      />
      <Text size="sm" style={{ flex: 1 }} truncate>
        {calendar.name}{" "}
        <Text span size="sm" c="dimmed">
          · {nameOf(calendar.ownerId)}
        </Text>
      </Text>
      {calendar.source === "google" && (
        <Badge variant="light" color="gray">
          Google
        </Badge>
      )}
      <Badge variant="light" color="gray">
        Read-only
      </Badge>
      <ConfirmButton
        variant="subtle"
        color="red"
        size="compact-sm"
        message={`Stop seeing ${calendar.name}? ${nameOf(calendar.ownerId)} can share it again.`}
        confirmLabel="Stop seeing it"
        onConfirm={() => remove.mutateAsync({ id: calendar.id })}
        aria-label={`Stop seeing ${calendar.name}`}
      >
        <IconTrash size={16} />
      </ConfirmButton>
    </Group>
  );
}

/**
 * The member's calendars: their own (names, colours, which take new and shared
 * events, who sees them) and those shared with them, in colours of their own.
 */
export function CalendarsCard() {
  const calendars = useCalendars();
  const { create } = useCalendarActions();
  const [color, setColor] = useState<string>(CALENDAR_COLORS[2]);
  const form = useForm<NewCalendarValues>({
    initialValues: { name: "" },
    schema: newCalendarSchema,
  });
  const add = async (values: NewCalendarValues) => {
    await create.mutateAsync({ name: values.name, color });
    form.reset();
  };
  const own = (calendars.data ?? []).filter((c) => c.access === "owner");
  const shared = (calendars.data ?? []).filter((c) => c.access === "viewer");
  // Events shared with you land in the calendar picked for them, else the default.
  const receiver = own.find((c) => c.receivesShared) ?? own.find((c) => c.isDefault);
  return (
    <Card>
      <Stack gap="sm">
        <Text fw={600}>Calendars</Text>
        <Text size="sm" c="dimmed">
          Every event belongs to a calendar and shows in its colour. New events go to the
          default one; events others share with you go to the one for shared events (the
          default unless you pick another), or wherever you place each. Share a calendar
          to let others see it read-only.
        </Text>
        {calendars.isLoading ? (
          <Loader size="sm" />
        ) : (
          <Stack gap="xs">
            {own.map((calendar) => (
              <OwnCalendarRow
                key={calendar.id}
                calendar={calendar}
                receives={calendar.id === receiver?.id}
              />
            ))}
          </Stack>
        )}
        <StandardForm form={form} onSubmit={add}>
          <Group gap="sm" align="flex-end" wrap="nowrap">
            <ColorPicker
              value={color}
              onChange={setColor}
              label="Colour for the calendar to add"
            />
            <FormTextInput
              name="name"
              label="New calendar"
              placeholder="Kids"
              maw={260}
            />
            <FormSubmitButton variant="light" w="fit-content">
              Add
            </FormSubmitButton>
          </Group>
          <FormGeneralErrors />
        </StandardForm>
        {shared.length > 0 && (
          <>
            <Text fw={600} size="sm" mt="xs">
              Shared with you
            </Text>
            <Stack gap="xs">
              {shared.map((calendar) => (
                <SharedCalendarRow key={calendar.id} calendar={calendar} />
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Card>
  );
}

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  ColorSwatch,
  Group,
  Loader,
  Popover,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { z } from "zod";
import { CALENDAR_COLORS, type Calendar } from "@shared/contract/app/calendar";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormTextInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";
import { IconTrash } from "@frontend/ds/icons";
import { useCalendarActions, useCalendars } from "../useCalendar";

const newCalendarSchema = z.object({
  name: z.string().trim().min(1, "Give the calendar a name").max(80),
});
type NewCalendarValues = z.infer<typeof newCalendarSchema>;

/** A swatch that opens Matron's colours to pick from. */
function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md">
      <Popover.Target>
        <ColorSwatch
          component="button"
          type="button"
          color={value}
          size={22}
          aria-label={label}
          onClick={() => setOpened((open) => !open)}
          style={{ cursor: "pointer" }}
        />
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <SimpleGrid cols={4} spacing={6}>
          {CALENDAR_COLORS.map((color) => (
            <ColorSwatch
              key={color}
              component="button"
              type="button"
              color={color}
              size={24}
              aria-label={color}
              onClick={() => {
                onChange(color);
                setOpened(false);
              }}
              style={{
                cursor: "pointer",
                outline: color === value ? "2px solid" : undefined,
              }}
            />
          ))}
        </SimpleGrid>
      </Popover.Dropdown>
    </Popover>
  );
}

function CalendarRow({ calendar }: { calendar: Calendar }) {
  const { update, remove } = useCalendarActions();
  const [name, setName] = useState(calendar.name);
  useEffect(() => setName(calendar.name), [calendar.name]);
  const rename = () => {
    const next = name.trim();
    if (next && next !== calendar.name) update.mutate({ id: calendar.id, name: next });
    else setName(calendar.name);
  };
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
        maw={280}
      />
      {calendar.source === "google" && (
        <Badge variant="light" color="gray">
          Google
        </Badge>
      )}
      {calendar.isDefault ? (
        <Badge variant="light">Default</Badge>
      ) : (
        calendar.source === "matron" && (
          <>
            <Button
              size="compact-sm"
              variant="subtle"
              onClick={() => update.mutate({ id: calendar.id, isDefault: true })}
            >
              Make default
            </Button>
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
          </>
        )
      )}
    </Group>
  );
}

/** The member's own calendars: their names and colours, and which one new events go to. */
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
  return (
    <Card>
      <Stack gap="sm">
        <Text fw={600}>Calendars</Text>
        <Text size="sm" c="dimmed">
          Every event belongs to one of your calendars, shown in its colour. New events go
          to the default one; calendars imported from Google change only there.
        </Text>
        {calendars.isLoading ? (
          <Loader size="sm" />
        ) : (
          <Stack gap="xs">
            {(calendars.data ?? []).map((calendar) => (
              <CalendarRow key={calendar.id} calendar={calendar} />
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
              maw={280}
            />
            <FormSubmitButton variant="light" w="fit-content">
              Add
            </FormSubmitButton>
          </Group>
          <FormGeneralErrors />
        </StandardForm>
      </Stack>
    </Card>
  );
}

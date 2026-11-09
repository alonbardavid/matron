import { useEffect, useState } from "react";
import { Group, Loader, Stack, Text, TextInput } from "@mantine/core";
import { z } from "zod";
import { CALENDAR_COLORS, type Label } from "@shared/contract/app/calendar";
import { useMe } from "@frontend/auth/useMe";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormTextInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";
import { IconTrash } from "@frontend/ds/icons";
import { useLabelActions, useLabels } from "../useCalendar";
import { ColorPicker } from "./ColorPicker";

const newLabelSchema = z.object({
  name: z.string().trim().min(1, "Give the label a name").max(40),
});
type NewLabelValues = z.infer<typeof newLabelSchema>;

function LabelRow({ label, canChange }: { label: Label; canChange: boolean }) {
  const { update, remove } = useLabelActions();
  const [name, setName] = useState(label.name);
  useEffect(() => setName(label.name), [label.name]);
  const rename = () => {
    const next = name.trim();
    if (next && next !== label.name) update.mutate({ id: label.id, name: next });
    else setName(label.name);
  };
  return (
    <Group gap="sm" wrap="nowrap">
      {canChange ? (
        <ColorPicker
          value={label.color}
          label={`Colour of ${label.name}`}
          onChange={(color) => update.mutate({ id: label.id, color })}
        />
      ) : (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: label.color,
            flexShrink: 0,
          }}
        />
      )}
      <TextInput
        aria-label="Label title"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        readOnly={!canChange}
        style={{ flex: 1 }}
        maw={260}
      />
      {canChange && (
        <ConfirmButton
          variant="subtle"
          color="red"
          size="compact-sm"
          message={`Remove the label ${label.name}? Events keep everything else.`}
          confirmLabel="Remove"
          onConfirm={() => remove.mutateAsync({ id: label.id })}
          aria-label={`Remove ${label.name}`}
        >
          <IconTrash size={16} />
        </ConfirmButton>
      )}
    </Group>
  );
}

/** The household's event labels: names and colours, shown as bars on events. */
export function LabelsCard() {
  const { me } = useMe();
  const labels = useLabels();
  const { create } = useLabelActions();
  const list = labels.data ?? [];
  const [color, setColor] = useState<string>(CALENDAR_COLORS[3]);
  const form = useForm<NewLabelValues>({
    initialValues: { name: "" },
    schema: newLabelSchema,
  });
  const add = async (values: NewLabelValues) => {
    await create.mutateAsync({ name: values.name, color });
    form.reset();
  };
  return (
    <Card>
      <Stack gap="sm">
        <Text fw={600}>Labels</Text>
        <Text size="sm" c="dimmed">
          Tag events with labels such as School or Medical; each shows as a coloured bar
          on the event&apos;s side. Labels are the household&apos;s: everyone uses them,
          and whoever made one, or an owner, changes it.
        </Text>
        {labels.isLoading ? (
          <Loader size="sm" />
        ) : (
          <Stack gap="xs">
            {list.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                canChange={label.creatorId === me?.id || me?.role === "owner"}
              />
            ))}
          </Stack>
        )}
        <StandardForm form={form} onSubmit={add}>
          <Group gap="sm" align="flex-end" wrap="nowrap">
            <ColorPicker
              value={color}
              onChange={setColor}
              label="Colour for the label to add"
            />
            <FormTextInput name="name" label="New label" placeholder="School" maw={260} />
            <FormSubmitButton variant="light" w="fit-content">
              Add label
            </FormSubmitButton>
          </Group>
          <FormGeneralErrors />
        </StandardForm>
      </Stack>
    </Card>
  );
}

import { useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Group,
  List,
  Loader,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormPasswordInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";

const formSchema = z.object({
  apiKey: z.string().trim().min(1, "Enter the API key").max(300),
});
type PlacesValues = z.infer<typeof formSchema>;

/**
 * The household's Google API key for Places, which suggests an event's
 * location as it is typed: one of the household's secrets.
 */
export function GooglePlacesCard() {
  const queryClient = useQueryClient();
  const stored = useQuery(orpc.settings.secrets.queryOptions());
  const form = useForm<PlacesValues>({
    initialValues: { apiKey: "" },
    schema: formSchema,
  });
  // A key that is set shows only as its hint; Replace opens an empty field for a new one.
  const [replacing, setReplacing] = useState(false);

  const update = useMutation(
    orpc.settings.updateSecrets.mutationOptions({
      onSuccess: (data) =>
        queryClient.setQueryData(orpc.settings.secrets.queryKey(), data),
    }),
  );

  const data = stored.data;
  const hint = data?.secrets.GOOGLE_PLACES_API_KEY ?? null;

  const submit = async (values: PlacesValues) => {
    await update.mutateAsync({ GOOGLE_PLACES_API_KEY: values.apiKey });
    form.setValues({ apiKey: "" });
    setReplacing(false);
    notifications.show({ message: "Places key saved. Matron is restarting with it." });
  };
  const remove = async () => {
    try {
      await update.mutateAsync({ GOOGLE_PLACES_API_KEY: null });
      notifications.show({
        message: "Places key removed. Matron is restarting without it.",
      });
    } catch (err) {
      notifyError(err, "Could not remove the Places key");
    }
  };

  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Google Places</Text>
          {data && (
            <Badge color={hint ? "sage" : "gray"} variant="light">
              {hint ? "Set up" : "Not set up"}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          Suggests places as a location is typed in an event, nearest first. What is typed
          there goes to Google. Without a key, a location is plain text.
        </Text>
        {stored.isLoading || !data ? (
          <Loader size="sm" />
        ) : (
          <>
            <List size="sm" spacing={4} type="ordered">
              <List.Item>
                In the{" "}
                <Anchor
                  href="https://console.cloud.google.com/apis/library/places.googleapis.com"
                  target="_blank"
                >
                  Google Cloud console
                </Anchor>
                , enable <Code>Places API (New)</Code> for a project; the Google Calendar
                one will do. Google asks for a billing account, even within its free
                monthly use.
              </List.Item>
              <List.Item>
                Under Credentials, create an API key and restrict it to Places API (New).
                Matron calls Google from its server, so leave the website restriction off.
              </List.Item>
              <List.Item>Paste the key here.</List.Item>
            </List>
            {data.changeable ? (
              <Alert color="yellow" variant="light">
                Saving or removing the key deploys Matron again, which takes a moment and
                can interrupt a build that is running.
              </Alert>
            ) : (
              <Alert color="gray" variant="light">
                This deployment holds no Cloudflare API token, so the key cannot be
                changed from here.
              </Alert>
            )}
            <StandardForm form={form} onSubmit={submit}>
              {hint && !replacing ? (
                <Group gap="xs" align="flex-end" wrap="nowrap">
                  <TextInput
                    label="API key"
                    value={hint}
                    readOnly
                    disabled
                    maw={360}
                    style={{ flex: 1 }}
                  />
                  <Button variant="light" onClick={() => setReplacing(true)}>
                    Replace
                  </Button>
                </Group>
              ) : (
                <FormPasswordInput
                  name="apiKey"
                  label={hint ? "New API key" : "API key"}
                  description={hint ? `Replaces ${hint}.` : undefined}
                  autoComplete="new-password"
                  maw={480}
                />
              )}
              <FormGeneralErrors />
              <Group>
                <FormSubmitButton
                  w="fit-content"
                  disabled={!data.changeable || (Boolean(hint) && !replacing)}
                >
                  Save Places key
                </FormSubmitButton>
                {hint && data.changeable && (
                  <ConfirmButton
                    variant="subtle"
                    color="red"
                    message="Remove the Places key? Locations are no longer suggested, and Matron deploys again."
                    confirmLabel="Remove"
                    onConfirm={remove}
                  >
                    Remove
                  </ConfirmButton>
                )}
              </Group>
            </StandardForm>
          </>
        )}
      </Stack>
    </Card>
  );
}

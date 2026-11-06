import { useEffect, useState } from "react";
import {
  Anchor,
  Badge,
  Code,
  CopyButton,
  Group,
  List,
  Loader,
  Stack,
  Text,
  TextInput,
  Button,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { googleOAuthUpdateSchema } from "@shared/contract/arch/settings";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormPasswordInput, FormTextInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";

// The secret may be left blank to keep the stored one.
const formSchema = googleOAuthUpdateSchema.extend({
  clientSecret: z.string().trim().max(300),
});
type GoogleValues = z.infer<typeof formSchema>;

/** The household's own Google OAuth app, which members connect their Google Calendar through. */
export function GoogleOAuthCard() {
  const queryClient = useQueryClient();
  const google = useQuery(orpc.settings.google.queryOptions());
  const form = useForm<GoogleValues>({
    initialValues: { clientId: "", clientSecret: "" },
    schema: formSchema,
  });
  const { setValues } = form;
  // A stored secret shows only as its hint; Replace opens an empty field for a new one.
  const [replacing, setReplacing] = useState(false);
  useEffect(() => {
    if (google.data)
      setValues({ clientId: google.data.clientId ?? "", clientSecret: "" });
  }, [google.data, setValues]);

  const saved = (data: NonNullable<typeof google.data>) => {
    queryClient.setQueryData(orpc.settings.google.queryKey(), data);
    void queryClient.invalidateQueries({ queryKey: orpc.calendar.google.key() });
  };
  const update = useMutation(
    orpc.settings.updateGoogle.mutationOptions({ onSuccess: saved }),
  );
  const remove = useMutation(
    orpc.settings.removeGoogle.mutationOptions({
      onSuccess: (data) => {
        saved(data);
        notifications.show({ message: "Google Calendar app removed" });
      },
      onError: (err) => notifyError(err, "Could not remove the Google app"),
    }),
  );

  const submit = async (values: GoogleValues) => {
    await update.mutateAsync({
      clientId: values.clientId,
      clientSecret: values.clientSecret || undefined,
    });
    form.setFieldValue("clientSecret", "");
    setReplacing(false);
    notifications.show({ message: "Google Calendar app saved" });
  };

  const data = google.data;
  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Google Calendar</Text>
          {data && (
            <Badge
              color={data.clientId && data.clientSecretHint ? "sage" : "gray"}
              variant="light"
            >
              {data.clientId && data.clientSecretHint ? "Set up" : "Not set up"}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          The household&apos;s own Google OAuth app. Once it is set up, each member
          connects their Google Calendar from their settings, and its events show on the
          Matron calendar. Events only come from Google; nothing is written back.
        </Text>
        {google.isLoading || !data ? (
          <Loader size="sm" />
        ) : (
          <>
            <List size="sm" spacing={4} type="ordered">
              <List.Item>
                In the{" "}
                <Anchor
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                >
                  Google Cloud console
                </Anchor>
                , enable the Google Calendar API for a project.
              </List.Item>
              <List.Item>
                On the OAuth consent screen, add the scope <Code>calendar.readonly</Code>.
                While the app is in Testing, add every member as a test user; Google then
                expires connections after 7 days, so publish it to keep them.
              </List.Item>
              <List.Item>
                Create an OAuth client ID of type Web application with this authorized
                redirect URI:
                <Group gap="xs" mt={4} wrap="nowrap">
                  <Code style={{ wordBreak: "break-all" }}>{data.redirectUri}</Code>
                  <CopyButton value={data.redirectUri}>
                    {({ copied, copy }) => (
                      <Button size="compact-xs" variant="light" onClick={copy}>
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
              </List.Item>
              <List.Item>Paste its client ID and client secret here.</List.Item>
            </List>
            <StandardForm form={form} onSubmit={submit}>
              <FormTextInput
                name="clientId"
                label="Client ID"
                placeholder="1234-abc.apps.googleusercontent.com"
                autoComplete="off"
                maw={480}
              />
              {data.clientSecretHint && !replacing ? (
                <Group gap="xs" align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Client secret"
                    value={data.clientSecretHint}
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
                  name="clientSecret"
                  label={data.clientSecretHint ? "New client secret" : "Client secret"}
                  description={
                    data.clientSecretHint
                      ? `Replaces ${data.clientSecretHint}; leave it empty to keep that one.`
                      : undefined
                  }
                  autoComplete="new-password"
                  maw={480}
                />
              )}
              <FormGeneralErrors />
              <Group>
                <FormSubmitButton w="fit-content">Save Google app</FormSubmitButton>
                {data.clientId && (
                  <ConfirmButton
                    variant="subtle"
                    color="red"
                    message="Remove the Google app? Members' calendars stop syncing until it is set up again."
                    confirmLabel="Remove"
                    onConfirm={() => remove.mutateAsync({})}
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

import { useState } from "react";
import {
  Alert,
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
import { GOOGLE_REDIRECT_PATH } from "@shared/contract/arch/settings";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormPasswordInput, FormTextInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";

// Either may be left blank to keep the one that is set.
const formSchema = z.object({
  clientId: z
    .string()
    .trim()
    .max(300)
    .regex(
      /^$|\.apps\.googleusercontent\.com$/,
      "A Google client ID ends in .apps.googleusercontent.com",
    ),
  clientSecret: z.string().trim().max(300),
});
type GoogleValues = z.infer<typeof formSchema>;

/**
 * The household's own Google OAuth app, which members connect their Google
 * Calendar through: two of the household's secrets.
 */
export function GoogleOAuthCard() {
  const queryClient = useQueryClient();
  const stored = useQuery(orpc.settings.secrets.queryOptions());
  const form = useForm<GoogleValues>({
    initialValues: { clientId: "", clientSecret: "" },
    schema: formSchema,
  });
  // A secret that is set shows only as its hint; Replace opens an empty field for a new one.
  const [replacing, setReplacing] = useState({ clientId: false, clientSecret: false });

  const update = useMutation(
    orpc.settings.updateSecrets.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(orpc.settings.secrets.queryKey(), data);
        void queryClient.invalidateQueries({ queryKey: orpc.calendar.google.key() });
      },
    }),
  );

  const data = stored.data;
  const clientIdHint = data?.secrets.GOOGLE_CLIENT_ID ?? null;
  const clientSecretHint = data?.secrets.GOOGLE_CLIENT_SECRET ?? null;
  const setUp = Boolean(clientIdHint && clientSecretHint);
  const redirectUri = `${window.location.origin}${GOOGLE_REDIRECT_PATH}`;

  const submit = async (values: GoogleValues) => {
    if (!values.clientId && !clientIdHint) {
      form.setFieldError("clientId", "Enter the client ID");
      return;
    }
    if (!values.clientSecret && !clientSecretHint) {
      form.setFieldError("clientSecret", "Enter the client secret");
      return;
    }
    await update.mutateAsync({
      GOOGLE_CLIENT_ID: values.clientId || undefined,
      GOOGLE_CLIENT_SECRET: values.clientSecret || undefined,
    });
    form.setValues({ clientId: "", clientSecret: "" });
    setReplacing({ clientId: false, clientSecret: false });
    notifications.show({
      message: "Google Calendar app saved. Matron is restarting with it.",
    });
  };
  const remove = async () => {
    try {
      await update.mutateAsync({ GOOGLE_CLIENT_ID: null, GOOGLE_CLIENT_SECRET: null });
      notifications.show({
        message: "Google Calendar app removed. Matron is restarting without it.",
      });
    } catch (err) {
      notifyError(err, "Could not remove the Google app");
    }
  };

  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Google Calendar</Text>
          {data && (
            <Badge color={setUp ? "sage" : "gray"} variant="light">
              {setUp ? "Set up" : "Not set up"}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          The household&apos;s own Google OAuth app. Once it is set up, each member
          connects their Google Calendar from their settings, and its events show on the
          Matron calendar. Events only come from Google; nothing is written back.
        </Text>
        {stored.isLoading || !data ? (
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
                  <Code style={{ wordBreak: "break-all" }}>{redirectUri}</Code>
                  <CopyButton value={redirectUri}>
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
            {data.changeable ? (
              <Alert color="yellow" variant="light">
                Saving or removing the app deploys Matron again, which takes a moment and
                can interrupt a build that is running. A branch takes the change the next
                time it is built.
              </Alert>
            ) : (
              <Alert color="gray" variant="light">
                This deployment holds no Cloudflare API token, so the app cannot be
                changed from here.
              </Alert>
            )}
            <StandardForm form={form} onSubmit={submit}>
              {clientIdHint && !replacing.clientId ? (
                <Group gap="xs" align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Client ID"
                    value={clientIdHint}
                    readOnly
                    disabled
                    maw={360}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="light"
                    onClick={() => setReplacing((r) => ({ ...r, clientId: true }))}
                  >
                    Replace
                  </Button>
                </Group>
              ) : (
                <FormTextInput
                  name="clientId"
                  label={clientIdHint ? "New client ID" : "Client ID"}
                  description={
                    clientIdHint
                      ? `Replaces ${clientIdHint}; leave it empty to keep that one.`
                      : undefined
                  }
                  placeholder="1234-abc.apps.googleusercontent.com"
                  autoComplete="off"
                  maw={480}
                />
              )}
              {clientSecretHint && !replacing.clientSecret ? (
                <Group gap="xs" align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Client secret"
                    value={clientSecretHint}
                    readOnly
                    disabled
                    maw={360}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="light"
                    onClick={() => setReplacing((r) => ({ ...r, clientSecret: true }))}
                  >
                    Replace
                  </Button>
                </Group>
              ) : (
                <FormPasswordInput
                  name="clientSecret"
                  label={clientSecretHint ? "New client secret" : "Client secret"}
                  description={
                    clientSecretHint
                      ? `Replaces ${clientSecretHint}; leave it empty to keep that one.`
                      : undefined
                  }
                  autoComplete="new-password"
                  maw={480}
                />
              )}
              <FormGeneralErrors />
              <Group>
                <FormSubmitButton w="fit-content" disabled={!data.changeable}>
                  Save Google app
                </FormSubmitButton>
                {(clientIdHint || clientSecretHint) && data.changeable && (
                  <ConfirmButton
                    variant="subtle"
                    color="red"
                    message="Remove the Google app? Members' calendars stop syncing until it is set up again, and Matron deploys again."
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

import { Loader, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ANTHROPIC_MODELS, type AnthropicModel } from "@shared/contract/arch/settings";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { Card } from "@frontend/ds/Card";
import { Page } from "@frontend/ds/Page";
import { GoogleOAuthCard } from "../widgets/GoogleOAuthCard";
import { GooglePlacesCard } from "../widgets/GooglePlacesCard";

const ANTHROPIC_OPTIONS = ANTHROPIC_MODELS.map((model) => ({
  value: model,
  label: model,
}));

/** Household-wide settings; owners only. */
export function AppSettingsScreen() {
  const queryClient = useQueryClient();
  const settings = useQuery(orpc.settings.get.queryOptions());
  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(orpc.settings.get.queryKey(), data);
        notifications.show({ message: "Settings saved" });
      },
      onError: (err) => notifyError(err, "Could not save the settings"),
    }),
  );

  return (
    <Page
      title="App settings"
      description="How the household's assistant, builder and integrations work."
    >
      <Stack gap="md">
        <Card>
          <Stack gap="sm">
            <Text fw={600}>Builder</Text>
            <Text size="sm" c="dimmed">
              The Anthropic model the planner and the builder use.
            </Text>
            {settings.isLoading ? (
              <Loader size="sm" />
            ) : (
              <Select
                label="Builder model"
                data={ANTHROPIC_OPTIONS}
                value={settings.data?.builderModel ?? null}
                allowDeselect={false}
                disabled={update.isPending}
                onChange={(value) =>
                  value && update.mutate({ builderModel: value as AnthropicModel })
                }
                maw={320}
              />
            )}
          </Stack>
        </Card>
        <Card>
          <Stack gap="sm">
            <Text fw={600}>Assistant</Text>
            <Text size="sm" c="dimmed">
              The Anthropic model the assistant answers with.
            </Text>
            {settings.isLoading ? (
              <Loader size="sm" />
            ) : (
              <Select
                label="Assistant model"
                data={ANTHROPIC_OPTIONS}
                value={settings.data?.askModel ?? null}
                allowDeselect={false}
                disabled={update.isPending}
                onChange={(value) =>
                  value && update.mutate({ askModel: value as AnthropicModel })
                }
                maw={320}
              />
            )}
          </Stack>
        </Card>
        <GoogleOAuthCard />
        <GooglePlacesCard />
      </Stack>
    </Page>
  );
}

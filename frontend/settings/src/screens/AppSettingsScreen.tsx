import { useEffect, useState } from "react";
import {
  Autocomplete,
  Button,
  defaultOptionsFilter,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  type OptionsFilter,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ANTHROPIC_MODELS,
  DEFAULT_ASK_MODEL,
  type AnthropicModel,
  type ModelCatalog,
} from "@shared/contract/arch/settings";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { Card } from "@frontend/ds/Card";
import { Page } from "@frontend/ds/Page";

const ANTHROPIC_OPTIONS = ANTHROPIC_MODELS.map((model) => ({
  value: model,
  label: model,
}));

/** The catalog for the picker, grouped by the family that made the models. */
function groupedCatalog(catalog: ModelCatalog | undefined) {
  const groups = new Map<string, string[]>();
  for (const model of catalog ?? []) {
    const items = groups.get(model.group) ?? [];
    items.push(model.id);
    groups.set(model.group, items);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

/** Household-wide settings; owners and admins only. */
export function AppSettingsScreen() {
  const queryClient = useQueryClient();
  const settings = useQuery(orpc.settings.get.queryOptions());
  const catalog = useQuery(orpc.settings.models.queryOptions({ staleTime: 10 * 60_000 }));
  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(orpc.settings.get.queryKey(), data);
        notifications.show({ message: "Settings saved" });
      },
      onError: (err) => notifyError(err, "Could not save the settings"),
    }),
  );

  // The assistant's model is typed as a draft and saved as one.
  const [draft, setDraft] = useState(DEFAULT_ASK_MODEL);
  // The last model picked from the list or loaded: while the field still shows
  // it, the list is whole, so another model is a pick away without clearing it.
  const [picked, setPicked] = useState(DEFAULT_ASK_MODEL);
  useEffect(() => {
    if (settings.data) {
      setDraft(settings.data.askModel);
      setPicked(settings.data.askModel);
    }
  }, [settings.data]);
  const model = draft.trim();
  const dirty = settings.data !== undefined && model !== settings.data.askModel;
  const filter: OptionsFilter = (input) =>
    input.search.trim() === picked
      ? input.options
      : (defaultOptionsFilter(input) as typeof input.options);

  return (
    <Page
      title="App settings"
      description="How the household's assistant and builder work."
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
              The model the assistant answers with: an Anthropic model through the
              account&apos;s AI Gateway, or a Workers AI model. The list holds the ones
              known to work with the assistant&apos;s tools; another can be typed in as
              anthropic/model or @cf/model.
            </Text>
            {settings.isLoading ? (
              <Loader size="sm" />
            ) : (
              <>
                <Autocomplete
                  label="Assistant model"
                  placeholder="anthropic/model or @cf/model"
                  data={groupedCatalog(catalog.data)}
                  value={draft}
                  onChange={setDraft}
                  onOptionSubmit={setPicked}
                  filter={filter}
                  limit={60}
                  maw={480}
                />
                <Group>
                  <Button
                    disabled={!dirty || !model}
                    loading={update.isPending}
                    onClick={() => update.mutate({ askModel: model })}
                  >
                    Save assistant model
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Card>
      </Stack>
    </Page>
  );
}

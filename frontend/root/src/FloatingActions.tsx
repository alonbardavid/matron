import { Affix, Button, Group } from "@mantine/core";
import { useAskChat } from "@frontend/ask/AskChatContext";
import { useStartAsk } from "@frontend/ask/useConversations";
import { useMe } from "@frontend/auth/useMe";
import { useBuildChat } from "@frontend/build/BuildChatContext";
import { useStartBuild } from "@frontend/build/useSessions";
import { IconHammer, IconSparkles } from "@frontend/ds/icons";

/** Ask and, for builders, Build: side by side at the bottom right, each opening its panel. */
export function FloatingActions() {
  const { can } = useMe();
  const askChat = useAskChat();
  const buildChat = useBuildChat();
  const ask = useStartAsk();
  const build = useStartBuild();
  if (askChat.opened || buildChat.opened) return null;

  return (
    <Affix position={{ bottom: 20, right: 20 }} zIndex={150}>
      <Group gap="xs">
        <Button
          radius="xl"
          size="md"
          leftSection={<IconSparkles />}
          onClick={() => {
            buildChat.close();
            ask.start();
          }}
        >
          Ask
        </Button>
        {can("create") && (
          <Button
            radius="xl"
            size="md"
            color="plum"
            leftSection={<IconHammer />}
            loading={build.busy}
            onClick={() => {
              askChat.close();
              void build.start();
            }}
          >
            Build
          </Button>
        )}
      </Group>
    </Affix>
  );
}

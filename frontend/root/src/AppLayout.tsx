import { useEffect } from "react";
import { AppShell, Burger, Divider, Group, Title } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { Outlet, useLocation } from "react-router-dom";
import { AskChat } from "@frontend/ask/widgets/AskChat";
import { useAskChat } from "@frontend/ask/AskChatContext";
import { BranchBanner } from "@frontend/branches/widgets/BranchBanner";
import { useBuildChat } from "@frontend/build/BuildChatContext";
import { useOutOfDateAction } from "@frontend/build/outOfDate";
import { BuildChat } from "@frontend/build/widgets/BuildChat";
import { FloatingActions } from "./FloatingActions";
import { Navbar } from "./Navbar";
import { pageTitle } from "./pages";
import { Wordmark } from "./Wordmark";

const NAVBAR_WIDTH = 260;
const SHELL_BORDER = { borderColor: "var(--matron-shell-border)" } as const;

/** The signed-in frame: a navbar on wide screens, a hamburger and a drawer on narrow ones. */
export function AppLayout() {
  const onOutOfDate = useOutOfDateAction();
  const [menuOpened, menu] = useDisclosure(false);
  const narrow = useMediaQuery("(max-width: 48em)");
  const askChat = useAskChat();
  const buildChat = useBuildChat();
  // The phone's top bar names the page; the page itself does on wider screens.
  const title = pageTitle(useLocation().pathname);

  // One side panel at a time.
  useEffect(() => {
    if (askChat.opened && buildChat.opened) buildChat.close();
  }, [askChat.opened]);
  useEffect(() => {
    if (buildChat.opened && askChat.opened) askChat.close();
  }, [buildChat.opened]);

  return (
    <AppShell
      header={{ height: 56, collapsed: !narrow }}
      navbar={{
        width: NAVBAR_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: !menuOpened },
      }}
      padding={0}
    >
      <AppShell.Header hiddenFrom="sm" bg="var(--matron-shell)" style={SHELL_BORDER}>
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Burger
            opened={menuOpened}
            onClick={menu.toggle}
            size="sm"
            color="var(--matron-on-shell)"
            aria-label="Menu"
          />
          {/* Aligned on the baseline: the lockup's text and the page's name share it. */}
          <Group gap="sm" wrap="nowrap" align="baseline" miw={0}>
            <Wordmark onShell />
            {title && (
              <>
                <Divider
                  orientation="vertical"
                  h={22}
                  size="sm"
                  color="var(--matron-on-shell-muted)"
                  opacity={0.5}
                  // Past the baseline a little, so it brackets the text rather than ending at its feet.
                  style={{ transform: "translateY(7px)" }}
                />
                <Title
                  order={2}
                  fz="lg"
                  fw={600}
                  lh={1}
                  c="var(--matron-on-shell)"
                  miw={0}
                  lineClamp={1}
                >
                  {title}
                </Title>
              </>
            )}
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar bg="var(--matron-shell)" style={SHELL_BORDER}>
        <Navbar onNavigate={menu.close} />
      </AppShell.Navbar>
      <AppShell.Main>
        <BranchBanner onOutOfDate={onOutOfDate} />
        <Outlet />
      </AppShell.Main>
      <FloatingActions />
      <BuildChat />
      <AskChat />
    </AppShell>
  );
}

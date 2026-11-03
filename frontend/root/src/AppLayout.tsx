import { AppShell, Group } from "@mantine/core";
import { Outlet } from "react-router-dom";
import { UserMenu } from "@frontend/auth/widgets/UserMenu";
import { BranchBanner } from "@frontend/branches/widgets/BranchBanner";
import { useOutOfDateAction } from "@frontend/build/outOfDate";
import { BuildButton } from "@frontend/build/widgets/BuildButton";
import { BuildChat } from "@frontend/build/widgets/BuildChat";
import { BranchSwitcher } from "@frontend/branches/widgets/BranchSwitcher";
import { NavLinks } from "./NavLinks";
import { Wordmark } from "./Wordmark";

export function AppLayout() {
  const onOutOfDate = useOutOfDateAction();

  return (
    <AppShell header={{ height: 56 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="lg" wrap="nowrap">
            <Wordmark />
            <NavLinks />
          </Group>
          <Group gap="xs" wrap="nowrap">
            <BranchSwitcher />
            <BuildButton />
            <UserMenu />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <BranchBanner onOutOfDate={onOutOfDate} />
        <Outlet />
      </AppShell.Main>
      <BuildChat />
    </AppShell>
  );
}

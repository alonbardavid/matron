import type { ReactNode } from "react";
import { Box, Group } from "@mantine/core";
import { NavLink, useLocation } from "react-router-dom";
import { withBranch } from "@frontend/api/branch";
import { useLogout } from "@frontend/auth/useLogout";
import { useMe } from "@frontend/auth/useMe";
import { BranchSwitcher } from "@frontend/branches/widgets/BranchSwitcher";
import {
  IconBranch,
  IconCalendar,
  IconChecklist,
  IconLogout,
  IconMessages,
  IconSettings,
  IconSliders,
  IconUsers,
  IconWrench,
} from "@frontend/ds/icons";
import classes from "./Navbar.module.css";
import { PAGE_TITLES } from "./pages";
import { Wordmark } from "./Wordmark";

interface Item {
  to: string;
  icon: ReactNode;
  show?: boolean;
}

/** The app's navigation: the household's pages, then its management, with the account at the bottom. */
export function Navbar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, canManage, canTroubleshoot } = useMe();
  const logout = useLogout();
  const { pathname } = useLocation();

  const main: Item[] = [
    { to: "/", icon: <IconCalendar size={20} /> },
    { to: "/tasks", icon: <IconChecklist size={20} /> },
  ];
  const more: Item[] = [
    { to: "/conversations", icon: <IconMessages size={20} /> },
    { to: "/branches", icon: <IconBranch size={20} />, show: can("view") },
    { to: "/users", icon: <IconUsers size={20} />, show: canManage },
    { to: "/app-settings", icon: <IconSliders size={20} />, show: canManage },
    { to: "/troubleshooting", icon: <IconWrench size={20} />, show: canTroubleshoot },
  ].filter((item) => item.show !== false);

  const link = (item: Item) => (
    <NavLink
      key={item.to}
      to={withBranch(item.to)}
      className={classes.link}
      data-active={pathname === item.to || undefined}
      onClick={onNavigate}
    >
      <span className={classes.linkIcon}>{item.icon}</span>
      <span>{PAGE_TITLES[item.to]}</span>
    </NavLink>
  );

  return (
    <nav className={classes.navbar} aria-label="Main">
      <div className={classes.main}>
        <Group className={classes.header} justify="space-between" wrap="nowrap" gap="sm">
          {/* The phone's top bar already carries the lockup. */}
          <Box visibleFrom="sm">
            <Wordmark onShell height={24} />
          </Box>
          <Box ml="auto" miw={0}>
            <BranchSwitcher />
          </Box>
        </Group>
        {main.map(link)}
        <div className={classes.spacer} />
        {more.map(link)}
      </div>
      <div className={classes.footer}>
        {link({ to: "/settings", icon: <IconSettings size={20} /> })}
        <button type="button" className={classes.link} onClick={() => void logout()}>
          <span className={classes.linkIcon}>
            <IconLogout size={20} />
          </span>
          <span>Logout</span>
        </button>
      </div>
    </nav>
  );
}

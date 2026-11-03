import { withBranch } from "@frontend/api/branch";
import { Avatar, Menu, Text, UnstyledButton, useMantineColorScheme } from "@mantine/core";
import { Link } from "react-router-dom";
import { IconCheck, IconMonitor, IconMoon, IconSun } from "@frontend/ds/icons";
import { useLogout } from "../useLogout";
import { useMe } from "../useMe";

const SCHEMES = [
  { value: "light", label: "Light", icon: <IconSun /> },
  { value: "dark", label: "Dark", icon: <IconMoon /> },
  { value: "auto", label: "System", icon: <IconMonitor /> },
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu() {
  const { me, isOwner } = useMe();
  const logout = useLogout();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  if (!me) return null;

  return (
    <Menu position="bottom-end" width={220} shadow="md">
      <Menu.Target>
        <UnstyledButton aria-label="Account menu">
          <Avatar color="clay" radius="xl" size="md">
            {initials(me.name) || "?"}
          </Avatar>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text size="sm" fw={600} c="var(--mantine-color-text)" truncate>
            {me.name}
          </Text>
          <Text size="xs" truncate>
            {me.email}
          </Text>
        </Menu.Label>
        {isOwner && (
          <>
            <Menu.Divider />
            <Menu.Item component={Link} to={withBranch("/household")}>
              Household
            </Menu.Item>
          </>
        )}
        <Menu.Divider />
        <Menu.Label>Appearance</Menu.Label>
        {SCHEMES.map((scheme) => (
          <Menu.Item
            key={scheme.value}
            leftSection={scheme.icon}
            rightSection={colorScheme === scheme.value ? <IconCheck /> : null}
            onClick={() => setColorScheme(scheme.value)}
          >
            {scheme.label}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item onClick={() => void logout()}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

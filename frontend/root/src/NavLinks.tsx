import { Anchor, Group } from "@mantine/core";
import { NavLink } from "react-router-dom";
import { withBranch } from "@frontend/api/branch";
import { useMe } from "@frontend/auth/useMe";

export function NavLinks() {
  const { can } = useMe();
  const links = [
    { to: "/branches", label: "Branches", show: can("view") },
    { to: "/sessions", label: "Sessions", show: can("create") },
  ].filter((link) => link.show);
  if (links.length === 0) return null;

  return (
    <Group gap="md" visibleFrom="sm">
      {links.map((link) => (
        <Anchor
          key={link.to}
          component={NavLink}
          to={withBranch(link.to)}
          size="sm"
          c="dimmed"
          underline="never"
          style={({ isActive }: { isActive: boolean }) => ({
            fontWeight: isActive ? 600 : 400,
            color: isActive ? "var(--mantine-color-text)" : undefined,
          })}
        >
          {link.label}
        </Anchor>
      ))}
    </Group>
  );
}

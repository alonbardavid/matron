import { useState } from "react";
import { Button, Group, Menu, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { withBranch } from "@frontend/api/branch";
import { notifyError } from "@frontend/api/errors";
import { IconBranch, IconCheck, IconChevronDown } from "@frontend/ds/icons";
import { branchLabel, MAIN_BRANCH, switchBranch, useBranches } from "../useBranches";
import { BranchStatusBadge } from "./BranchStatusBadge";

export function BranchSwitcher() {
  const { branches, current, currentBranch, canView } = useBranches();
  const [switching, setSwitching] = useState(false);
  if (!canView) return null;

  const go = async (target: string) => {
    if (target === current) return;
    setSwitching(true);
    try {
      await switchBranch(target);
    } catch (err) {
      setSwitching(false);
      notifyError(err, "Could not switch branch");
    }
  };

  return (
    <Menu position="bottom-end" width={260} shadow="md">
      <Menu.Target>
        <Button
          variant={current === MAIN_BRANCH ? "subtle" : "light"}
          color={current === MAIN_BRANCH ? "gray" : "clay"}
          size="xs"
          aria-label="Branch"
          leftSection={<IconBranch />}
          rightSection={<IconChevronDown size={14} />}
          loading={switching}
        >
          {branchLabel(currentBranch, current)}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Branch</Menu.Label>
        <Menu.Item
          onClick={() => void go(MAIN_BRANCH)}
          rightSection={current === MAIN_BRANCH ? <IconCheck /> : null}
        >
          main
        </Menu.Item>
        {branches.map((branch) => (
          <Menu.Item
            key={branch.id}
            disabled={branch.status !== "ready" && branch.id !== current}
            onClick={() => void go(branch.id)}
            rightSection={branch.id === current ? <IconCheck /> : null}
          >
            <Group gap="xs" wrap="nowrap" justify="space-between">
              <Text size="sm" truncate>
                {branch.name}
              </Text>
              <BranchStatusBadge status={branch.status} />
            </Group>
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item component={Link} to={withBranch("/branches")}>
          Manage branches
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

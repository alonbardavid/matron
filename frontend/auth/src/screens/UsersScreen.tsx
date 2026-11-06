import { Button, Group, Loader, Select, Stack, Table, Text } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import type { HouseholdUser as ListedUser } from "@shared/contract/app/users";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconPlus } from "@frontend/ds/icons";
import { Page } from "@frontend/ds/Page";
import { useHouseholdMembers } from "../useHouseholdMembers";
import { useHouseholdUsers } from "../useHouseholdUsers";
import { toRole, useMe, type Role } from "../useMe";
import { NewMemberModal, ROLE_OPTIONS } from "../widgets/NewMemberModal";
import { UserAvatar } from "../widgets/UserAvatar";

/** A member as the admin list gives them: the application's list adds the picture. */
type HouseholdUser = Omit<ListedUser, "avatarUrl">;

interface MemberControls {
  self: boolean;
  busy: boolean;
  onRole: (role: Role) => void;
  onRemove: () => Promise<unknown>;
}

function Identity({ user }: { user: Pick<HouseholdUser, "id" | "name" | "email"> }) {
  // The picture comes from the application, so a branch shows what it holds.
  const { avatarUrlOf } = useHouseholdMembers();
  return (
    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
      <UserAvatar
        size={40}
        name={user.name}
        avatarUrl={avatarUrlOf(user.id)}
        aria-hidden="true"
      />
      <div style={{ minWidth: 0 }}>
        <Text fz="sm" fw={500} truncate>
          {user.name}
        </Text>
        <Text fz="xs" c="dimmed" truncate>
          {user.email}
        </Text>
      </div>
    </Group>
  );
}

function RoleSelect({
  user,
  controls,
  variant,
}: {
  user: HouseholdUser;
  controls: MemberControls;
  variant: "unstyled" | "default";
}) {
  return (
    <Select
      data={ROLE_OPTIONS}
      value={toRole(user.role)}
      variant={variant}
      allowDeselect={false}
      aria-label={`Role of ${user.name}`}
      disabled={controls.self || controls.busy}
      onChange={(value) => value && controls.onRole(value as Role)}
    />
  );
}

function RemoveButton({
  user,
  controls,
}: {
  user: HouseholdUser;
  controls: MemberControls;
}) {
  if (controls.self) return null;
  return (
    <ConfirmButton
      size="xs"
      variant="subtle"
      color="red"
      message={`Remove ${user.name} from the household?`}
      confirmLabel="Remove"
      onConfirm={controls.onRemove}
    >
      Remove
    </ConfirmButton>
  );
}

/** The household's members and their roles; owners and admins manage them. */
export function UsersScreen() {
  const { me } = useMe();
  const { users, createUser, setRole, removeUser } = useHouseholdUsers();
  const [modalOpened, modal] = useDisclosure(false);
  const narrow = useMediaQuery("(max-width: 48em)");

  const controlsFor = (user: HouseholdUser): MemberControls => ({
    self: user.id === me?.id,
    busy: setRole.isPending,
    onRole: (role) => setRole.mutate({ userId: user.id, role }),
    onRemove: () => removeUser.mutateAsync({ userId: user.id }),
  });

  const members = (users.data ?? []) as HouseholdUser[];

  const body = users.isLoading ? (
    <Group justify="center" p="xl">
      <Loader size="sm" />
    </Group>
  ) : users.isError ? (
    <EmptyState title="Could not load users" description={users.error.message} />
  ) : members.length === 0 ? (
    <EmptyState title="No users yet" />
  ) : narrow ? (
    // Narrow screens: one card per member instead of a table.
    <Stack gap="sm">
      {members.map((user) => {
        const controls = controlsFor(user);
        return (
          <Card key={user.id}>
            <Stack gap="sm">
              <Identity user={user} />
              <Group justify="space-between" wrap="nowrap">
                <RoleSelect user={user} controls={controls} variant="default" />
                <RemoveButton user={user} controls={controls} />
              </Group>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  ) : (
    <Card p={0}>
      <Table verticalSpacing="sm" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Member</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {members.map((user) => {
            const controls = controlsFor(user);
            return (
              <Table.Tr key={user.id}>
                <Table.Td>
                  <Identity user={user} />
                </Table.Td>
                <Table.Td w={160}>
                  <RoleSelect user={user} controls={controls} variant="unstyled" />
                </Table.Td>
                <Table.Td w={110} ta="right">
                  <RemoveButton user={user} controls={controls} />
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );

  return (
    <Page
      title="Users"
      description="Who can sign in, and what they may do."
      size="md"
      action={
        <Button leftSection={<IconPlus />} onClick={modal.open}>
          Add user
        </Button>
      }
    >
      {body}
      <NewMemberModal
        opened={modalOpened}
        onClose={modal.close}
        onCreate={async (values) => {
          await createUser.mutateAsync(values);
        }}
      />
    </Page>
  );
}

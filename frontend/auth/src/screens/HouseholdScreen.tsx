import { Button, Group, Loader, Select, Table, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconPlus } from "@frontend/ds/icons";
import { Page } from "@frontend/ds/Page";
import { useHouseholdUsers } from "../useHouseholdUsers";
import { toRole, useMe, type Role } from "../useMe";
import { NewMemberModal, ROLE_OPTIONS } from "../widgets/NewMemberModal";

export function HouseholdScreen() {
  const { me } = useMe();
  const { users, createUser, setRole, removeUser } = useHouseholdUsers();
  const [modalOpened, modal] = useDisclosure(false);

  const rows = (users.data ?? []).map((user) => {
    const self = user.id === me?.id;
    return (
      <Table.Tr key={user.id}>
        <Table.Td>
          <Text fw={500}>{user.name}</Text>
          <Text size="xs" c="dimmed">
            {user.email}
          </Text>
        </Table.Td>
        <Table.Td w={140}>
          <Select
            size="xs"
            data={ROLE_OPTIONS}
            value={toRole(user.role)}
            disabled={self || setRole.isPending}
            allowDeselect={false}
            onChange={(value) =>
              value && setRole.mutate({ userId: user.id, role: value as Role })
            }
          />
        </Table.Td>
        <Table.Td w={100} ta="right">
          {!self && (
            <ConfirmButton
              size="xs"
              variant="subtle"
              color="red"
              message={`Remove ${user.name} from the household?`}
              confirmLabel="Remove"
              onConfirm={() => removeUser.mutateAsync({ userId: user.id })}
            >
              Remove
            </ConfirmButton>
          )}
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Page
      title="Household"
      description="Who can sign in, and what they may do."
      action={
        <Button leftSection={<IconPlus />} onClick={modal.open}>
          New member
        </Button>
      }
    >
      <Card p={0}>
        {users.isLoading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : users.isError ? (
          <EmptyState title="Could not load members" description={users.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState title="No members yet" />
        ) : (
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        )}
      </Card>
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

import {
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  useMantineColorScheme,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { z } from "zod";
import { authClient, unwrapAuth } from "@frontend/api/auth-client";
import { useMe } from "@frontend/auth/useMe";
import { Card } from "@frontend/ds/Card";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormPasswordInput, FormTextInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";
import { Page } from "@frontend/ds/Page";

const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
});
type ProfileValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "At least 8 characters"),
    repeat: z.string(),
  })
  .refine((v) => v.newPassword === v.repeat, {
    message: "The passwords differ",
    path: ["repeat"],
  });
type PasswordValues = z.infer<typeof passwordSchema>;

const SCHEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "System" },
];

/** Your own account: name, password and appearance. The email is fixed. */
export function SettingsScreen() {
  const { me } = useMe();
  const queryClient = useQueryClient();
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  const profile = useForm<ProfileValues>({
    initialValues: { name: me?.name ?? "" },
    schema: profileSchema,
  });
  const password = useForm<PasswordValues>({
    initialValues: { currentPassword: "", newPassword: "", repeat: "" },
    schema: passwordSchema,
  });

  const saveProfile = async (values: ProfileValues) => {
    unwrapAuth(await authClient.updateUser({ name: values.name }));
    await queryClient.invalidateQueries();
    notifications.show({ message: "Name saved" });
  };

  const savePassword = async (values: PasswordValues) => {
    unwrapAuth(
      await authClient.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: false,
      }),
    );
    password.reset();
    notifications.show({ message: "Password changed" });
  };

  return (
    <Page title="Settings" description="Your account.">
      <Card>
        <Stack gap="sm">
          <Text fw={600}>Profile</Text>
          <TextInput label="Email" value={me?.email ?? ""} readOnly disabled />
          <StandardForm form={profile} onSubmit={saveProfile}>
            <FormTextInput name="name" label="Name" autoComplete="name" />
            <FormGeneralErrors />
            <FormSubmitButton w="fit-content">Save name</FormSubmitButton>
          </StandardForm>
        </Stack>
      </Card>
      <Card>
        <Stack gap="sm">
          <Text fw={600}>Password</Text>
          <StandardForm form={password} onSubmit={savePassword}>
            <FormPasswordInput
              name="currentPassword"
              label="Current password"
              autoComplete="current-password"
            />
            <FormPasswordInput
              name="newPassword"
              label="New password"
              autoComplete="new-password"
            />
            <FormPasswordInput
              name="repeat"
              label="Repeat new password"
              autoComplete="new-password"
            />
            <FormGeneralErrors />
            <FormSubmitButton w="fit-content">Change password</FormSubmitButton>
          </StandardForm>
        </Stack>
      </Card>
      <Card>
        <Stack gap="sm">
          <Text fw={600}>Appearance</Text>
          <SegmentedControl
            data={SCHEMES}
            value={colorScheme}
            onChange={(value) => setColorScheme(value as "light" | "dark" | "auto")}
            w="fit-content"
          />
        </Stack>
      </Card>
    </Page>
  );
}

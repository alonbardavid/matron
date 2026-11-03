import { Center, Stack, Text, Title } from "@mantine/core";
import { z } from "zod";
import { signIn } from "@frontend/api/auth-client";
import { Card } from "@frontend/ds/Card";
import { useForm } from "@frontend/ds/forms/context";
import { FormGeneralErrors } from "@frontend/ds/forms/FormGeneralErrors";
import { FormPasswordInput, FormTextInput } from "@frontend/ds/forms/FormInputs";
import { FormSubmitButton } from "@frontend/ds/forms/FormSubmitButton";
import { StandardForm } from "@frontend/ds/forms/StandardForm";

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const form = useForm<LoginValues>({
    initialValues: { email: "", password: "" },
    schema: loginSchema,
  });

  const submit = async (values: LoginValues) => {
    const result = await signIn.email({ email: values.email, password: values.password });
    if (result.error) {
      throw new Error(result.error.message || "Email or password is wrong");
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Card w="100%" maw={380} p="xl">
        <Stack gap="lg">
          <div>
            <Title order={2}>Matron</Title>
            <Text c="dimmed" size="sm">
              Sign in to your household
            </Text>
          </div>
          <StandardForm form={form} onSubmit={submit}>
            <FormTextInput
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
            />
            <FormPasswordInput
              name="password"
              label="Password"
              autoComplete="current-password"
            />
            <FormGeneralErrors />
            <FormSubmitButton fullWidth mt="xs">
              Sign in
            </FormSubmitButton>
          </StandardForm>
        </Stack>
      </Card>
    </Center>
  );
}

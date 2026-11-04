import { Center, Container, Paper, Text, Title } from "@mantine/core";
import { z } from "zod";
import { signIn } from "@frontend/api/auth-client";
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

/** Sign-in only: accounts are made by the household's admins, and a session is always remembered. */
export function LoginScreen() {
  const form = useForm<LoginValues>({
    initialValues: { email: "", password: "" },
    schema: loginSchema,
  });

  const submit = async (values: LoginValues) => {
    const result = await signIn.email({
      email: values.email,
      password: values.password,
      rememberMe: true,
    });
    if (result.error) {
      throw new Error(result.error.message || "Email or password is wrong");
    }
  };

  return (
    <Container size={420} my={40}>
      <Center mb="md">
        <img src="/brand/matron-mark.svg" alt="" height={56} data-light-only="" />
        <img src="/brand/matron-mark-white.svg" alt="" height={56} data-dark-only="" />
      </Center>
      <Title ta="center" fw={900} fz={34}>
        Welcome back!
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Sign in to your household
      </Text>
      <Paper withBorder shadow="sm" p={22} mt={30} radius="md">
        <StandardForm form={form} onSubmit={submit} gap="md">
          <FormTextInput
            name="email"
            label="Email"
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            autoFocus
          />
          <FormPasswordInput
            name="password"
            label="Password"
            placeholder="Your password"
            autoComplete="current-password"
          />
          <FormGeneralErrors />
          <FormSubmitButton fullWidth mt="md">
            Sign in
          </FormSubmitButton>
        </StandardForm>
      </Paper>
    </Container>
  );
}

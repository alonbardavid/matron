import {
  PasswordInput,
  Select,
  Textarea,
  TextInput,
  type PasswordInputProps,
  type SelectProps,
  type TextareaProps,
  type TextInputProps,
} from "@mantine/core";
import { useFormContext } from "./context";

interface Named {
  name: string;
}

export function FormTextInput({ name, ...props }: TextInputProps & Named) {
  const { form, submitting } = useFormContext();
  return (
    <TextInput
      key={form.key(name)}
      disabled={submitting}
      {...form.getInputProps(name)}
      {...props}
    />
  );
}

export function FormPasswordInput({ name, ...props }: PasswordInputProps & Named) {
  const { form, submitting } = useFormContext();
  return (
    <PasswordInput
      key={form.key(name)}
      disabled={submitting}
      {...form.getInputProps(name)}
      {...props}
    />
  );
}

export function FormTextarea({ name, ...props }: TextareaProps & Named) {
  const { form, submitting } = useFormContext();
  return (
    <Textarea
      key={form.key(name)}
      disabled={submitting}
      {...form.getInputProps(name)}
      {...props}
    />
  );
}

export function FormSelect({ name, ...props }: SelectProps & Named) {
  const { form, submitting } = useFormContext();
  return (
    <Select
      key={form.key(name)}
      disabled={submitting}
      {...form.getInputProps(name)}
      {...props}
    />
  );
}

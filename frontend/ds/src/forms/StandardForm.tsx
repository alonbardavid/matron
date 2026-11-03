import { useState, type ReactNode } from "react";
import { Stack, type StackProps } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { errorText, FormProvider, GENERAL_ERROR_KEY } from "./context";

interface StandardFormProps<T extends Record<string, unknown>> {
  form: UseFormReturnType<T>;
  /** Throwing or rejecting shows the error above the submit button. */
  onSubmit: (values: T) => void | Promise<void>;
  children: ReactNode;
  gap?: StackProps["gap"];
}

export function StandardForm<T extends Record<string, unknown>>({
  form,
  onSubmit,
  children,
  gap = "sm",
}: StandardFormProps<T>) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = form.onSubmit(async (values) => {
    form.clearFieldError(GENERAL_ERROR_KEY);
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      form.setFieldError(GENERAL_ERROR_KEY, errorText(err));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <FormProvider form={form} submitting={submitting}>
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap={gap}>{children}</Stack>
      </form>
    </FormProvider>
  );
}

import type { FormEvent, ReactNode } from "react";
import { Stack, type StackProps } from "@mantine/core";

interface FormProps {
  /** Runs on Enter in a field and on the submit button; the page never reloads. */
  onSubmit: () => void;
  children: ReactNode;
  gap?: StackProps["gap"];
}

/**
 * A `<form>` for fields whose state lives outside `@mantine/form` (a modal's own draft, a
 * single setting). Prefer `StandardForm`; either way the save button is `type="submit"`, so
 * Enter submits and Tab walks the fields in order.
 */
export function Form({ onSubmit, children, gap = "sm" }: FormProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate>
      <Stack gap={gap}>{children}</Stack>
    </form>
  );
}
